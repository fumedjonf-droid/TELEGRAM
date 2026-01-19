import argparse
import asyncio
import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any

from telegram import InlineKeyboardButton, InlineKeyboardMarkup
from telegram.constants import ParseMode
from telegram.ext import Application

from alerting import AlertRouter
from db import Database

ADMIN_CHAT_ID = int(os.getenv("ADMIN_CHAT_ID", "0"))
BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
CURRENCY = os.getenv("CURRENCY", "RUB")
AUTO_PAYMENTS = os.getenv("AUTO_PAYMENTS", "true").lower() == "true"
MANUAL_MODE = os.getenv("MANUAL_MODE", "false").lower() == "true"
MAINTENANCE_MODE = os.getenv("MAINTENANCE_MODE", "false").lower() == "true"
OUTBOX_ALERT_THRESHOLD = int(os.getenv("OUTBOX_ALERT_THRESHOLD", "50"))
OUTBOX_RETENTION_DAYS = int(os.getenv("OUTBOX_RETENTION_DAYS", "7"))
WEBHOOK_RETENTION_DAYS = int(os.getenv("WEBHOOK_RETENTION_DAYS", "60"))

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def admin_keyboard(order_id: int) -> InlineKeyboardMarkup:
    buttons = [
        [InlineKeyboardButton("IN_PROGRESS", callback_data=f"admin:IN_PROGRESS:{order_id}")],
        [InlineKeyboardButton("DONE", callback_data=f"admin:DONE:{order_id}")],
        [InlineKeyboardButton("REJECT", callback_data=f"admin:REJECT:{order_id}")],
        [InlineKeyboardButton("MESSAGE USER", callback_data=f"admin:MESSAGE:{order_id}")],
        [InlineKeyboardButton("RECREATE PAYMENT", callback_data=f"admin:RECREATE:{order_id}")],
    ]
    return InlineKeyboardMarkup(buttons)


def from_minor(amount_minor: int) -> str:
    return f"{amount_minor / 100:.2f}"


def backoff_delay(attempts: int) -> int:
    return min(60, 2**attempts)


def next_attempt_time(attempts: int) -> str:
    delay = backoff_delay(attempts)
    return datetime.fromtimestamp(time.time() + delay, tz=timezone.utc).isoformat()




def send_message_with_retry(
    application: Application,
    chat_id: int,
    text: str,
    reply_markup: InlineKeyboardMarkup | None = None,
    retries: int = 2,
) -> None:
    for attempt in range(retries + 1):
        try:
            asyncio.run(
                application.bot.send_message(
                    chat_id=chat_id,
                    text=text,
                    parse_mode=ParseMode.HTML,
                    reply_markup=reply_markup,
                )
            )
            return
        except Exception as exc:  # noqa: BLE001
            if attempt >= retries:
                raise exc
            time.sleep(backoff_delay(attempt))


def handle_outbox(db: Database, application: Application, item: dict[str, Any]) -> None:
    payload = json.loads(item["payload"])
    message_type = item["message_type"]

    if message_type == "admin_alert":
        if ADMIN_CHAT_ID:
            send_message_with_retry(application, ADMIN_CHAT_ID, payload["text"])
        return

    if message_type == "user_paid":
        send_message_with_retry(
            application,
            payload["user_id"],
            f"<b>Оплата подтверждена</b>\nЗаказ #{payload['order_id']} оплачен.",
        )
        return

    if message_type == "admin_paid":
        if not ADMIN_CHAT_ID:
            return
        order = db.get_order(payload["order_id"])
        admin_text = (
            f"<b>Оплачен заказ #{order['order_id']}</b>\n"
            f"Пользователь: {order['user_id']}\n"
            f"Товар: {order['item']}\n"
            f"Сумма: {from_minor(order['amount_minor'])} {order['currency']}"
        )
        send_message_with_retry(
            application,
            ADMIN_CHAT_ID,
            admin_text,
            reply_markup=admin_keyboard(int(order["order_id"])),
        )
        return

    if message_type == "payment_expired":
        send_message_with_retry(
            application,
            payload["user_id"],
            (
                "<b>Время оплаты истекло</b>\n"
                f"Заказ #{payload['order_id']} истёк. Нажмите «Создать оплату заново»."
            ),
        )
        return


def enqueue_admin_alert(db: Database, text: str) -> None:
    db.enqueue_outbox("admin_alert", {"text": text})


def run_worker(loop: bool = True, expire_minutes: int = 30) -> None:
    if not BOT_TOKEN:
        raise RuntimeError("TELEGRAM_BOT_TOKEN is not set")
    application = Application.builder().token(BOT_TOKEN).build()
    db = Database()

    while True:
        db.set_service_status("worker_heartbeat", datetime.now(timezone.utc).isoformat())
        router = AlertRouter(db, lambda msg: enqueue_admin_alert(db, msg))
        outbox_size = db.get_outbox_size()
        if outbox_size > OUTBOX_ALERT_THRESHOLD:
            router.alert(
                "alert:outbox_backlog",
                "Outbox backlog растёт",
                "SEV2",
                value=str(outbox_size),
                is_active=True,
            )
        else:
            router.clear("alert:outbox_backlog", "Outbox backlog растёт", "SEV2")

        last_webhook = db.get_service_status("last_webhook_at")
        if last_webhook:
            last_time = datetime.fromisoformat(last_webhook["value"])
            if (datetime.now(timezone.utc) - last_time).total_seconds() > 600:
                if db.count_active_payments() > 0:
                    router.alert(
                        "alert:webhook_stale",
                        "Нет webhook > 10 минут при активных оплатах.",
                        "SEV1",
                        value=last_webhook["value"],
                        is_active=True,
                    )
                else:
                    router.clear(
                        "alert:webhook_stale",
                        "Нет webhook > 10 минут при активных оплатах.",
                        "SEV1",
                    )
            else:
                router.clear(
                    "alert:webhook_stale",
                    "Нет webhook > 10 минут при активных оплатах.",
                    "SEV1",
                )

        router.alert(
            "alert:manual_mode",
            "Включён MANUAL_MODE.",
            "SEV2",
            value="enabled",
            is_active=MANUAL_MODE,
        )
        router.alert(
            "alert:maintenance_mode",
            "Включён MAINTENANCE_MODE.",
            "SEV2",
            value="enabled",
            is_active=MAINTENANCE_MODE,
        )
        router.clear(
            "alert:worker_stale",
            "Worker heartbeat stale > 2 minutes.",
            "SEV2",
        )
        expired = db.expire_old_payments(expire_minutes)
        for entry in expired:
            db.enqueue_outbox(
                "payment_expired",
                {"user_id": entry["user_id"], "order_id": entry["order_id"]},
            )
        db.cleanup_outbox(OUTBOX_RETENTION_DAYS)
        db.cleanup_webhook_events(WEBHOOK_RETENTION_DAYS)

        items = db.get_pending_outbox(limit=20)
        for item in items:
            try:
                handle_outbox(db, application, item)
                db.mark_outbox_sent(item["outbox_id"])
            except Exception as exc:  # noqa: BLE001
                next_time = next_attempt_time(item["attempts"])
                db.mark_outbox_failed(item["outbox_id"], str(exc), next_time)
        if not loop:
            break
        time.sleep(5)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--expire-minutes", type=int, default=30)
    args = parser.parse_args()
    run_worker(loop=not args.once, expire_minutes=args.expire_minutes)
