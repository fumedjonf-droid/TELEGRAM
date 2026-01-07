import logging
import os

import requests
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update, WebAppInfo
from telegram.constants import ParseMode
from telegram.ext import (
    ApplicationBuilder,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
)

BOT_TOKEN = os.getenv("BOT_TOKEN")
ADMIN_GROUP_ID = int(os.getenv("ADMIN_GROUP_ID", "0"))
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000")
WEBAPP_URL = os.getenv("WEBAPP_URL", "https://example.com")
FILE_ID = os.getenv("FILE_ID")

logging.basicConfig(level=logging.INFO)


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.effective_chat is None:
        return

    keyboard = InlineKeyboardMarkup(
        [[InlineKeyboardButton("Открыть магазин", web_app=WebAppInfo(url=WEBAPP_URL))]]
    )
    await update.effective_chat.send_message(
        "Добро пожаловать! Откройте магазин для оформления заказа.",
        reply_markup=keyboard,
    )


async def handle_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.callback_query is None:
        return

    query = update.callback_query
    await query.answer()

    try:
        action, order_id, tg_user_id = query.data.split(":")
    except ValueError:
        await query.answer("Неверные данные", show_alert=True)
        return

    member = await context.bot.get_chat_member(ADMIN_GROUP_ID, query.from_user.id)
    if member.status not in {"administrator", "creator"}:
        await query.answer("Нет прав", show_alert=True)
        return

    status_map = {"ok": "DONE", "no": "REJECTED", "wait": "WAIT"}
    status = status_map.get(action)
    if not status:
        await query.answer("Неизвестное действие", show_alert=True)
        return

    response = requests.post(
        f"{BACKEND_URL}/order/{order_id}/status",
        json={"status": status},
        timeout=10,
    )
    response.raise_for_status()

    if status == "DONE":
        await context.bot.send_message(
            chat_id=int(tg_user_id),
            text="✅ Оплата подтверждена. Отправляем файл.",
        )
        if FILE_ID:
            await context.bot.send_document(chat_id=int(tg_user_id), document=FILE_ID)
    elif status == "REJECTED":
        await context.bot.send_message(
            chat_id=int(tg_user_id),
            text="❌ Оплата отклонена. Обратитесь в поддержку.",
        )
    elif status == "WAIT":
        await context.bot.send_message(
            chat_id=int(tg_user_id),
            text="⏳ Оплата в обработке. Мы сообщим позже.",
        )

    admin_text = query.message.text if query.message else ""
    admin_text += f"\n\nСтатус: {status} (by @{query.from_user.username or query.from_user.id})"
    await query.edit_message_text(admin_text, parse_mode=ParseMode.HTML)


def main() -> None:
    if not BOT_TOKEN:
        raise RuntimeError("BOT_TOKEN is required")

    app = ApplicationBuilder().token(BOT_TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CallbackQueryHandler(handle_callback))

    app.run_polling()


if __name__ == "__main__":
    main()
