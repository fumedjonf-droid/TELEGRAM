import hmac
import json
import logging
import os
import time
from datetime import datetime, timezone
from hashlib import sha256
from logging.handlers import RotatingFileHandler
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Request

from alerting import AlertRouter
from db import Database

VERSION = "1.2.0"
WEBHOOK_SECRET = os.getenv("PAYMENT_WEBHOOK_SECRET", "")
LOG_PATH = os.getenv("WEBHOOK_LOG_PATH", "webhook.log")
RATE_LIMIT_PER_MIN = int(os.getenv("WEBHOOK_RATE_LIMIT_PER_MIN", "120"))
AUTO_PAYMENTS = os.getenv("AUTO_PAYMENTS", "true").lower() == "true"
MANUAL_MODE = os.getenv("MANUAL_MODE", "false").lower() == "true"
ALLOWED_IPS = {
    ip.strip()
    for ip in os.getenv("WEBHOOK_ALLOWED_IPS", "").split(",")
    if ip.strip()
}
MAX_BODY_BYTES = int(os.getenv("WEBHOOK_MAX_BODY_BYTES", "1048576"))

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
handler = RotatingFileHandler(LOG_PATH, maxBytes=1_000_000, backupCount=3)
formatter = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")
handler.setFormatter(formatter)
logger.addHandler(handler)

app = FastAPI()

FINAL_STATUSES = {"SUCCEEDED", "FAILED", "EXPIRED", "CANCELED"}
RATE_LIMIT_STATE: dict[str, tuple[int, float]] = {}


def verify_signature(body: bytes, signature: str | None) -> None:
    if not signature:
        raise HTTPException(status_code=401, detail="Missing signature")
    expected = hmac.new(WEBHOOK_SECRET.encode(), body, sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=401, detail="Invalid signature")


def parse_payload(payload: dict[str, Any]) -> dict[str, Any]:
    required = {"payment_id", "status", "amount", "currency", "event_id", "provider"}
    if not required.issubset(payload):
        raise HTTPException(status_code=400, detail="Invalid payload")
    amount_minor = payload.get("amount_minor")
    if amount_minor is None:
        amount_minor = int(round(float(payload["amount"]) * 100))
    return {
        "payment_id": str(payload["payment_id"]),
        "status": str(payload["status"]),
        "amount_minor": int(amount_minor),
        "currency": str(payload["currency"]),
        "event_id": str(payload["event_id"]),
        "provider": str(payload["provider"]),
    }


def rate_limit_ok(ip: str) -> bool:
    now = time.time()
    count, window_start = RATE_LIMIT_STATE.get(ip, (0, now))
    if now - window_start > 60:
        RATE_LIMIT_STATE[ip] = (1, now)
        return True
    if count >= RATE_LIMIT_PER_MIN:
        return False
    RATE_LIMIT_STATE[ip] = (count + 1, window_start)
    return True


def log_payload(payload: dict[str, Any]) -> None:
    raw = json.dumps(payload)
    truncated = raw[:500] + ("..." if len(raw) > 500 else "")
    logger.info("Payload: %s", truncated)


def enqueue_admin_alert(db: Database, text: str) -> None:
    db.enqueue_outbox("admin_alert", {"text": text})


def enqueue_paid_notifications(db: Database, order: dict[str, Any]) -> None:
    db.enqueue_outbox(
        "user_paid",
        {
            "user_id": order["user_id"],
            "order_id": order["order_id"],
        },
    )
    db.enqueue_outbox(
        "admin_paid",
        {
            "order_id": order["order_id"],
        },
    )


def process_payment_event(db: Database, data: dict[str, Any]) -> dict[str, str]:
    router = AlertRouter(db, lambda msg: enqueue_admin_alert(db, msg))
    if not AUTO_PAYMENTS or MANUAL_MODE:
        logger.info("Auto payments disabled; skipping processing")
        router.alert(
            "alert:manual_mode",
            "Auto payments disabled or manual mode enabled. Webhook processed without changes.",
            "SEV2",
            value="manual_mode",
            is_active=True,
        )
        return {"status": "ok"}
    payment_id = data["payment_id"]
    provider = data["provider"]
    status = data["status"]

    with db.connection:
        if not db.record_webhook_event(provider, data["event_id"]):
            logger.info("Duplicate webhook event %s", data["event_id"])
            return {"status": "ok"}

        try:
            payment = db.get_payment(provider, payment_id)
        except ValueError as exc:
            logger.error("Payment not found: %s", exc)
            enqueue_admin_alert(
                db, f"<b>Unknown payment_id:</b> {payment_id} ({provider})"
            )
            return {"status": "ok"}

        if payment["amount_minor"] != data["amount_minor"] or payment["currency"] != data["currency"]:
            db.update_payment_status(provider, payment_id, "SUSPICIOUS")
            enqueue_admin_alert(
                db,
                (
                    "<b>Подозрительная оплата</b>\n"
                    f"Payment: {payment_id}\n"
                    f"Expected: {payment['amount_minor']} {payment['currency']}\n"
                    f"Got: {data['amount_minor']} {data['currency']}"
                ),
            )
            return {"status": "ok"}

        db.update_payment_status(provider, payment_id, status)

        if status != "SUCCEEDED":
            logger.info("Payment %s updated to %s", payment_id, status)
            return {"status": "ok"}

        order = db.get_order_by_payment(provider, payment_id)
        if order["status"] in {"DONE", "REJECTED"}:
            db.update_payment_status(provider, payment_id, "SUSPICIOUS")
            enqueue_admin_alert(
                db,
                (
                    "<b>Оплата на закрытый заказ</b>\n"
                    f"Заказ #{order['order_id']} ({order['status']})"
                ),
            )
            return {"status": "ok"}

        updated = db.update_order_status_if(int(order["order_id"]), "WAIT_PAY", "PAID")
        if not updated:
            logger.info("Order %s already updated", order["order_id"])
            return {"status": "ok"}
        db.append_ledger_entry(
            provider,
            payment_id,
            int(order["order_id"]),
            int(order["user_id"]),
            int(order["amount_minor"]),
            order["currency"],
            "SUCCEEDED",
        )
        if order.get("notified_paid_at") is None:
            db.update_order_notified_paid(int(order["order_id"]))
            enqueue_paid_notifications(db, order)

    logger.info("Payment %s succeeded", payment_id)
    return {"status": "ok"}


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {
        "status": "ok",
        "version": VERSION,
        "time": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/webhook/payment")
async def payment_webhook(
    request: Request, x_signature: str | None = Header(default=None)
) -> dict[str, str]:
    if not WEBHOOK_SECRET:
        logger.error("PAYMENT_WEBHOOK_SECRET is not set")
        db = Database()
        router = AlertRouter(db, lambda msg: enqueue_admin_alert(db, msg))
        router.alert(
            "alert:webhook_secret_missing",
            "PAYMENT_WEBHOOK_SECRET is not set. Webhook disabled.",
            "SEV1",
            value="missing_secret",
            is_active=True,
        )
        raise HTTPException(status_code=500, detail="Webhook secret not configured")
    client_ip = request.client.host if request.client else "unknown"
    if ALLOWED_IPS and client_ip not in ALLOWED_IPS:
        raise HTTPException(status_code=403, detail="Forbidden")
    if not rate_limit_ok(client_ip):
        raise HTTPException(status_code=429, detail="Too many requests")

    body = await request.body()
    if len(body) > MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="Payload too large")

    try:
        verify_signature(body, x_signature)
    except HTTPException as exc:
        logger.error("Signature error: %s", exc.detail)
        db = Database()
        enqueue_admin_alert(db, "<b>Webhook подпись не прошла проверку</b>")
        raise

    try:
        payload = json.loads(body.decode())
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON") from exc
    log_payload(payload)
    data = parse_payload(payload)
    status = data["status"]

    if status not in FINAL_STATUSES:
        logger.info("Non-final status %s", status)
        return {"status": "ok"}

    db = Database()
    db.set_service_status("last_webhook_at", str(int(time.time())))
    worker_heartbeat = db.get_service_status("worker_heartbeat")
    if worker_heartbeat:
        try:
            last_ts = int(worker_heartbeat["value"])
        except (TypeError, ValueError):
            last_ts = 0
        if int(time.time()) - last_ts > 120:
            router = AlertRouter(db, lambda msg: enqueue_admin_alert(db, msg))
            router.alert(
                "alert:worker_stale",
                "Worker heartbeat stale > 2 minutes.",
                "SEV2",
                value=worker_heartbeat["value"],
                is_active=True,
            )
    return process_payment_event(db, data)
