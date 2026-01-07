import os
from datetime import datetime
from typing import Optional

import requests
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from db import create_order, get_order, init_db, update_order_status

BOT_TOKEN = os.getenv("BOT_TOKEN")
ADMIN_GROUP_ID = os.getenv("ADMIN_GROUP_ID")

app = FastAPI(title="Telegram Orders Backend")


class OrderCreate(BaseModel):
    tg_user_id: int
    tg_username: Optional[str] = None
    title: str
    description: Optional[str] = None
    player_id: Optional[str] = None
    amount: float
    currency: str = "USD"
    payment_ref: Optional[str] = None
    comment: Optional[str] = None
    source: str = "webapp"


class OrderStatusUpdate(BaseModel):
    status: str = Field(pattern="^(PAID|WAIT|DONE|REJECTED)$")


@app.on_event("startup")
async def startup_event() -> None:
    init_db()


@app.post("/order")
async def create_order_endpoint(payload: OrderCreate) -> dict:
    if not BOT_TOKEN or not ADMIN_GROUP_ID:
        raise HTTPException(status_code=500, detail="BOT_TOKEN or ADMIN_GROUP_ID not configured")

    now = datetime.utcnow().isoformat()
    order_data = payload.model_dump()
    order_data.update({"status": "PAID", "created_at": now, "updated_at": now})
    order_id = create_order(order_data)

    admin_text = (
        "🧾 Новый заказ\n"
        f"ID: {order_id}\n"
        f"User: {payload.tg_username or payload.tg_user_id}\n"
        f"Amount: {payload.amount} {payload.currency}\n"
        f"Title: {payload.title}\n"
        f"Player ID: {payload.player_id or '-'}\n"
        f"Comment: {payload.comment or '-'}"
    )

    keyboard = {
        "inline_keyboard": [
            [
                {"text": "✅ Confirm", "callback_data": f"ok:{order_id}:{payload.tg_user_id}"},
                {"text": "❌ Reject", "callback_data": f"no:{order_id}:{payload.tg_user_id}"},
                {"text": "⏳ Wait", "callback_data": f"wait:{order_id}:{payload.tg_user_id}"},
            ]
        ]
    }

    response = requests.post(
        f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
        json={
            "chat_id": int(ADMIN_GROUP_ID),
            "text": admin_text,
            "reply_markup": keyboard,
        },
        timeout=10,
    )
    response.raise_for_status()

    return {"order_id": order_id, "status": "PAID"}


@app.post("/order/{order_id}/status")
async def update_order_status_endpoint(order_id: int, payload: OrderStatusUpdate) -> dict:
    order = get_order(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    update_order_status(order_id, payload.status)
    return {"order_id": order_id, "status": payload.status}
