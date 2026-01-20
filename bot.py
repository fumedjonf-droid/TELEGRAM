import logging
import os
import time
from typing import Any

from telegram import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    ReplyKeyboardMarkup,
    Update,
)
from telegram.constants import ParseMode
from telegram.ext import (
    Application,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

from db import Database

SUPPORT_URL = "https://t.me/your_support"
SUPPORT_CHAT_URL = "https://t.me/your_support_chat"
TERMS_URL = "https://example.com/terms"
BUY_GUIDE_URL = "https://example.com/how-to-buy"
CHANNEL_URL = "https://t.me/your_channel"
REVIEWS_URL = "https://t.me/your_reviews"
RULES_URL = "https://example.com/rules"

ADMIN_CHAT_ID = int(os.getenv("ADMIN_CHAT_ID", "0"))
ADMIN_IDS = {
    int(admin_id)
    for admin_id in os.getenv("ADMIN_IDS", "").split(",")
    if admin_id.strip()
}

PAYMENT_CARD_OWNER = os.getenv("PAYMENT_CARD_OWNER", "НЕ УКАЗАНО")
PAYMENT_CARD_NUMBER = os.getenv("PAYMENT_CARD_NUMBER", "НЕ УКАЗАНО")
PAYMENT_BANK_NAME = os.getenv("PAYMENT_BANK_NAME", "")
PAYMENT_COMMENT_TEMPLATE = os.getenv("PAYMENT_COMMENT_TEMPLATE", "ORDER-{order_id}")

SUPPORT_IMAGE_URL = os.getenv("SUPPORT_IMAGE_URL", "")
REVIEWS_IMAGE_URL = os.getenv("REVIEWS_IMAGE_URL", "")

CURRENCY = "RUB"
VERSION = "2.0.0"
START_TIME = time.time()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

MAIN_MENU = [
    [KeyboardButton("🛍 Каталог"), KeyboardButton("📢 Наш канал")],
    [KeyboardButton("👨🏻‍💻 Тех.Поддержка"), KeyboardButton("👤 Профиль / Баланс")],
    [KeyboardButton("❓ Как купить"), KeyboardButton("✉️ Отзывы")],
]

NAV_BACK = "⬅️ Назад"
NAV_MAIN = "🏠 Главное меню"

CATALOG_SECTIONS = {
    "💎 Донат": "DONATE",
    "🧩 Стороннее ПО": "SOFTWARE",
}

DONATE_GAMES: dict[str, list[dict[str, Any]]] = {
    "FREE FIRE": [
        {"name": "Алмазы 100", "amount_minor": 9900, "player_required": True},
        {"name": "Алмазы 500", "amount_minor": 39900, "player_required": True},
    ],
    "PUBG MOBILE": [
        {"name": "UC 60", "amount_minor": 19900, "player_required": True},
        {"name": "UC 325", "amount_minor": 99900, "player_required": True},
    ],
}

SOFTWARE_ITEMS: list[dict[str, Any]] = [
    {"name": "Антибан 30 дней", "amount_minor": 49900, "player_required": False},
    {"name": "Софт VIP", "amount_minor": 99900, "player_required": False},
]


def reply_keyboard(buttons: list[list[KeyboardButton]]) -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(buttons, resize_keyboard=True, one_time_keyboard=False)


def nav_keyboard() -> ReplyKeyboardMarkup:
    return reply_keyboard([[KeyboardButton(NAV_BACK), KeyboardButton(NAV_MAIN)]])


def safe_username(username: str | None) -> str:
    return f"@{username}" if username else "—"


def from_minor(amount_minor: int) -> str:
    return f"{amount_minor / 100:.2f}"


def is_admin(user_id: int) -> bool:
    if ADMIN_IDS:
        return user_id in ADMIN_IDS
    return False


def build_start_inline() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        [
            [InlineKeyboardButton("📦 Быстро купить", callback_data="start_quick_buy")],
            [InlineKeyboardButton("🛍 Открыть каталог", callback_data="start_catalog")],
            [InlineKeyboardButton("👨‍💻 Поддержка", callback_data="start_support")],
            [InlineKeyboardButton("📌 Правила", url=RULES_URL)],
        ]
    )


def build_catalog_sections() -> ReplyKeyboardMarkup:
    buttons = [[KeyboardButton(name)] for name in CATALOG_SECTIONS.keys()]
    buttons.append([KeyboardButton(NAV_BACK), KeyboardButton(NAV_MAIN)])
    return reply_keyboard(buttons)


def build_donate_games() -> ReplyKeyboardMarkup:
    buttons = [[KeyboardButton(game)] for game in DONATE_GAMES.keys()]
    buttons.append([KeyboardButton(NAV_BACK), KeyboardButton(NAV_MAIN)])
    return reply_keyboard(buttons)


def build_software_items() -> ReplyKeyboardMarkup:
    buttons = [[KeyboardButton(item["name"]) ] for item in SOFTWARE_ITEMS]
    buttons.append([KeyboardButton(NAV_BACK), KeyboardButton(NAV_MAIN)])
    return reply_keyboard(buttons)


def build_items_for_game(game: str) -> ReplyKeyboardMarkup:
    items = DONATE_GAMES.get(game, [])
    buttons = [[KeyboardButton(item["name"]) ] for item in items]
    buttons.append([KeyboardButton(NAV_BACK), KeyboardButton(NAV_MAIN)])
    return reply_keyboard(buttons)


def build_admin_keyboard(order_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        [
            [InlineKeyboardButton("✅ Подтвердить оплату", callback_data=f"admin_confirm:{order_id}")],
            [InlineKeyboardButton("❌ Отклонить", callback_data=f"admin_reject:{order_id}")],
            [InlineKeyboardButton("💬 Написать пользователю", callback_data=f"admin_message:{order_id}")],
            [InlineKeyboardButton("✅ Выполнено", callback_data=f"admin_done:{order_id}")],
        ]
    )


def build_cancel_keyboard(order_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        [[InlineKeyboardButton("Отменить заказ", callback_data=f"order_cancel:{order_id}")]]
    )


def order_card(order: dict[str, Any]) -> str:
    return (
        f"<b>Заказ #{order['order_id']}</b>\n"
        f"User: {safe_username(order.get('username'))} ({order['user_id']})\n"
        f"Категория: {order['section']}\n"
        f"Игра: {order.get('game') or '—'}\n"
        f"Товар: {order['item_name']}\n"
        f"Сумма: {from_minor(order['amount_minor'])} {CURRENCY}\n"
        f"Player ID: {order.get('player_id') or '—'}\n"
        f"Статус: {order['status']}"
    )


def build_payment_text(order: dict[str, Any]) -> str:
    comment = PAYMENT_COMMENT_TEMPLATE.format(order_id=order["order_id"])
    bank_line = f"Банк: {PAYMENT_BANK_NAME}\n" if PAYMENT_BANK_NAME else ""
    return (
        "<b>Оплатите по реквизитам ниже, затем отправьте чек сюда.</b>\n"
        "После проверки админом статус изменится.\n\n"
        f"Сумма: {from_minor(order['amount_minor'])} {CURRENCY}\n"
        f"Получатель: {PAYMENT_CARD_OWNER}\n"
        f"Карта: {PAYMENT_CARD_NUMBER}\n"
        f"{bank_line}"
        f"Комментарий: {comment}"
    )


def find_item(section: str, game: str | None, item_name: str) -> dict[str, Any] | None:
    if section == "DONATE" and game:
        for item in DONATE_GAMES.get(game, []):
            if item["name"] == item_name:
                return item
    if section == "SOFTWARE":
        for item in SOFTWARE_ITEMS:
            if item["name"] == item_name:
                return item
    return None


async def send_photo_or_text(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    image_url: str,
    text: str,
    keyboard: InlineKeyboardMarkup | None = None,
) -> None:
    if image_url:
        await context.bot.send_photo(
            chat_id=update.effective_chat.id,
            photo=image_url,
            caption=text,
            parse_mode=ParseMode.HTML,
            reply_markup=keyboard,
        )
    else:
        await context.bot.send_message(
            chat_id=update.effective_chat.id,
            text=text,
            parse_mode=ParseMode.HTML,
            reply_markup=keyboard,
        )


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None or update.effective_user is None:
        return
    db = Database()
    db.upsert_user(update.effective_user.id, update.effective_user.username)
    text = (
        "<b>Спасибо, что решили воспользоваться нашим сервисом…</b>\n\n"
        "Если нужна помощь — пишите в техподдержку.\n"
        "Как купить — в соответствующем разделе меню.\n"
        f"Пользовательское соглашение: {TERMS_URL}"
    )
    await update.message.reply_text(
        text,
        parse_mode=ParseMode.HTML,
        reply_markup=reply_keyboard(MAIN_MENU),
    )
    await update.message.reply_text(
        "Быстрые действия:",
        reply_markup=build_start_inline(),
    )


async def show_main_menu(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return
    context.user_data["section"] = None
    context.user_data["game"] = None
    await update.message.reply_text(
        "Главное меню:",
        reply_markup=reply_keyboard(MAIN_MENU),
    )


async def show_catalog_sections(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return
    context.user_data["section"] = None
    context.user_data["game"] = None
    await update.message.reply_text(
        "Выберите раздел каталога:",
        reply_markup=build_catalog_sections(),
    )


async def handle_support(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    text = (
        "<b>Опишите вашу проблему целиком в одном сообщении!</b>\n"
        "Не умеете писать — запишите видео."
    )
    keyboard = InlineKeyboardMarkup(
        [
            [InlineKeyboardButton("Чат поддержки", url=SUPPORT_CHAT_URL)],
            [InlineKeyboardButton("ПОДДЕРЖКА ПОЛЬЗОВАТЕЛЕЙ", url=SUPPORT_URL)],
        ]
    )
    await send_photo_or_text(update, context, SUPPORT_IMAGE_URL, text, keyboard)


async def handle_how_to_buy(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return
    text = (
        "<b>Как купить:</b>\n"
        "1. Выберите раздел и товар.\n"
        "2. Получите реквизиты и оплатите.\n"
        "3. Отправьте чек, дождитесь подтверждения.\n\n"
        "Подробная инструкция доступна по кнопке ниже."
    )
    keyboard = InlineKeyboardMarkup(
        [[InlineKeyboardButton("Перейти", url=BUY_GUIDE_URL)]]
    )
    await update.message.reply_text(text, parse_mode=ParseMode.HTML, reply_markup=keyboard)


async def handle_channel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return
    text = "Подписывайтесь на наш канал, чтобы быть в курсе новостей и акций."
    keyboard = InlineKeyboardMarkup(
        [[InlineKeyboardButton("Наш канал 📢", url=CHANNEL_URL)]]
    )
    await update.message.reply_text(text, reply_markup=keyboard)


async def handle_reviews(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    text = (
        "<b>Отзывы наших клиентов</b>\n"
        "Переходите в канал с отзывами и оставляйте свой."
    )
    keyboard = InlineKeyboardMarkup(
        [[InlineKeyboardButton("Отзывы ✉️", url=REVIEWS_URL)]]
    )
    await send_photo_or_text(update, context, REVIEWS_IMAGE_URL, text, keyboard)


async def handle_profile(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    db = Database()
    user = update.effective_user
    if user is None or update.message is None:
        return
    db.upsert_user(user.id, user.username)
    profile = db.get_user(user.id)
    stats = db.get_user_stats(user.id)
    profile_text = (
        f"<b>Ваш ID:</b> {profile['telegram_id']}\n"
        f"<b>Пользователь:</b> {safe_username(profile['username'])}\n"
        f"<b>Количество заказов:</b> {stats['order_count']}\n"
        f"<b>Общая сумма заказов:</b> {from_minor(stats['paid_sum'])} {CURRENCY}\n"
        f"<b>Баланс:</b> {from_minor(int(profile['balance_minor']))} {CURRENCY}"
    )
    rules_keyboard = InlineKeyboardMarkup(
        [[InlineKeyboardButton("Правила", url=RULES_URL)]]
    )
    await update.message.reply_text(
        profile_text, parse_mode=ParseMode.HTML, reply_markup=rules_keyboard
    )


async def handle_user_receipt(update: Update, context: ContextTypes.DEFAULT_TYPE) -> bool:
    if update.message is None or update.effective_user is None:
        return False
    order_id = context.user_data.get("awaiting_receipt")
    if not order_id:
        return False
    file_id = None
    receipt_type = None
    if update.message.photo:
        file_id = update.message.photo[-1].file_id
        receipt_type = "photo"
    elif update.message.document:
        file_id = update.message.document.file_id
        receipt_type = "document"
    if not file_id:
        await update.message.reply_text("Пожалуйста, отправьте чек фото или файлом.")
        return True
    db = Database()
    updated = db.update_order_receipt(int(order_id), file_id)
    if not updated:
        await update.message.reply_text("Не удалось сохранить чек. Проверьте статус заказа.")
        return True
    order = db.get_order(int(order_id))
    context.user_data["awaiting_receipt"] = None

    if ADMIN_CHAT_ID:
        admin_text = order_card(order) + "\nСтатус: WAIT_ADMIN_CONFIRM"
        keyboard = build_admin_keyboard(order["order_id"])
        if receipt_type == "photo":
            await context.bot.send_photo(
                chat_id=ADMIN_CHAT_ID,
                photo=file_id,
                caption=admin_text,
                parse_mode=ParseMode.HTML,
                reply_markup=keyboard,
            )
        elif receipt_type == "document":
            await context.bot.send_document(
                chat_id=ADMIN_CHAT_ID,
                document=file_id,
                caption=admin_text,
                parse_mode=ParseMode.HTML,
                reply_markup=keyboard,
            )
        else:
            await context.bot.send_message(
                chat_id=ADMIN_CHAT_ID,
                text=admin_text,
                parse_mode=ParseMode.HTML,
                reply_markup=keyboard,
            )

    await update.message.reply_text(
        "Чек получен. Ожидайте подтверждения администратора.",
        reply_markup=reply_keyboard(MAIN_MENU),
    )
    return True


async def handle_player_id(update: Update, context: ContextTypes.DEFAULT_TYPE) -> bool:
    if update.message is None or update.effective_user is None:
        return False
    if update.message.text is None:
        return False
    order_id = context.user_data.get("awaiting_player_id")
    if not order_id:
        return False
    player_id = update.message.text.strip()
    db = Database()
    db.update_order_player_id(int(order_id), player_id)
    updated = db.transition_order_status(int(order_id), "NEW", "WAIT_PAY_MANUAL")
    if not updated:
        await update.message.reply_text("Не удалось обновить заказ.")
        return True
    order = db.get_order(int(order_id))
    context.user_data["awaiting_player_id"] = None
    context.user_data["awaiting_receipt"] = order_id
    await update.message.reply_text(
        build_payment_text(order),
        parse_mode=ParseMode.HTML,
        reply_markup=build_cancel_keyboard(order["order_id"]),
    )
    await update.message.reply_text(
        "Отправьте чек/скрин оплаты сюда.",
        reply_markup=nav_keyboard(),
    )
    return True


async def handle_admin_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> bool:
    if update.message is None or update.effective_user is None:
        return False
    if not is_admin(update.effective_user.id):
        return False
    if ADMIN_CHAT_ID and update.effective_chat and update.effective_chat.id != ADMIN_CHAT_ID:
        return False
    pending_message = context.chat_data.get("admin_message_target")
    if pending_message:
        context.chat_data["admin_message_target"] = None
        user_id = pending_message["user_id"]
        await context.bot.send_message(
            chat_id=user_id,
            text=(
                "<b>Сообщение от поддержки</b>\n"
                f"{update.message.text}"
            ),
            parse_mode=ParseMode.HTML,
        )
        await update.message.reply_text("Сообщение отправлено пользователю.")
        return True
    pending_reject = context.chat_data.get("admin_reject_target")
    if pending_reject:
        context.chat_data["admin_reject_target"] = None
        db = Database()
        order = db.get_order(int(pending_reject))
        if not db.can_transition(order["status"], "REJECTED"):
            await update.message.reply_text("Нельзя отклонить заказ в этом статусе.")
            return True
        db.transition_order_status(order["order_id"], order["status"], "REJECTED")
        await context.bot.send_message(
            chat_id=order["user_id"],
            text=(
                f"<b>Заказ #{order['order_id']} отклонён.</b>\n"
                f"Причина: {update.message.text}"
            ),
            parse_mode=ParseMode.HTML,
        )
        await update.message.reply_text("Заказ отклонён.")
        return True
    return False


async def create_order_for_item(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    section: str,
    game: str | None,
    item: dict[str, Any],
) -> None:
    if update.message is None or update.effective_user is None:
        return
    db = Database()
    db.upsert_user(update.effective_user.id, update.effective_user.username)
    order_id = db.create_order(
        update.effective_user.id,
        update.effective_user.username,
        section,
        game,
        item["name"],
        item["amount_minor"],
        status="NEW",
    )
    context.user_data["order_id"] = order_id
    if item.get("player_required"):
        context.user_data["awaiting_player_id"] = order_id
        await update.message.reply_text(
            "Введите Player ID для оформления заказа:",
            reply_markup=nav_keyboard(),
        )
        return
    updated = db.transition_order_status(order_id, "NEW", "WAIT_PAY_MANUAL")
    if not updated:
        await update.message.reply_text("Не удалось обновить заказ.")
        return
    order = db.get_order(order_id)
    context.user_data["awaiting_receipt"] = order_id
    await update.message.reply_text(
        build_payment_text(order),
        parse_mode=ParseMode.HTML,
        reply_markup=build_cancel_keyboard(order_id),
    )
    await update.message.reply_text(
        "Отправьте чек/скрин оплаты сюда.",
        reply_markup=nav_keyboard(),
    )


async def handle_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None or update.effective_user is None:
        return

    if await handle_player_id(update, context):
        return
    if await handle_user_receipt(update, context):
        return
    if await handle_admin_message(update, context):
        return

    text = update.message.text

    actions = {
        "🛍 Каталог": show_catalog_sections,
        "👨🏻‍💻 Тех.Поддержка": handle_support,
        "❓ Как купить": handle_how_to_buy,
        "📢 Наш канал": handle_channel,
        "✉️ Отзывы": handle_reviews,
        "👤 Профиль / Баланс": handle_profile,
        NAV_MAIN: show_main_menu,
    }

    if text in actions:
        await actions[text](update, context)
        return

    if text == NAV_BACK:
        if context.user_data.get("game"):
            await update.message.reply_text(
                "Выберите игру:", reply_markup=build_donate_games()
            )
            return
        if context.user_data.get("section"):
            await show_catalog_sections(update, context)
            return
        await show_main_menu(update, context)
        return

    if text in CATALOG_SECTIONS:
        section = CATALOG_SECTIONS[text]
        context.user_data["section"] = section
        context.user_data["game"] = None
        if section == "DONATE":
            await update.message.reply_text(
                "Выберите игру:",
                reply_markup=build_donate_games(),
            )
            return
        await update.message.reply_text(
            "Выберите товар:",
            reply_markup=build_software_items(),
        )
        return

    if text in DONATE_GAMES:
        context.user_data["section"] = "DONATE"
        context.user_data["game"] = text
        await update.message.reply_text(
            "Выберите товар:",
            reply_markup=build_items_for_game(text),
        )
        return

    if text in {item["name"] for item in SOFTWARE_ITEMS}:
        item = find_item("SOFTWARE", None, text)
        if item is None:
            await update.message.reply_text("Товар недоступен.")
            return
        await create_order_for_item(update, context, "SOFTWARE", None, item)
        return

    section = context.user_data.get("section")
    game = context.user_data.get("game")
    if section == "DONATE" and game:
        item = find_item("DONATE", game, text)
        if item:
            await create_order_for_item(update, context, "DONATE", game, item)
            return

    await update.message.reply_text(
        "Используйте кнопки меню ниже.",
        reply_markup=reply_keyboard(MAIN_MENU),
    )


async def handle_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    if query is None:
        return
    await query.answer()
    data = query.data or ""

    if data == "start_quick_buy":
        await query.message.reply_text(
            "Выберите раздел каталога:",
            reply_markup=build_catalog_sections(),
        )
        return

    if data == "start_catalog":
        await query.message.reply_text(
            "Выберите раздел каталога:",
            reply_markup=build_catalog_sections(),
        )
        return

    if data == "start_support":
        await handle_support(update, context)
        return

    if data.startswith("order_cancel:"):
        _, order_id = data.split(":", 1)
        db = Database()
        order = db.get_order(int(order_id))
        if query.from_user and order["user_id"] != query.from_user.id:
            await query.answer("Недостаточно прав", show_alert=True)
            return
        if db.cancel_order(int(order_id)):
            if context.user_data.get("awaiting_receipt") == int(order_id):
                context.user_data["awaiting_receipt"] = None
            if context.user_data.get("awaiting_player_id") == int(order_id):
                context.user_data["awaiting_player_id"] = None
            await query.message.reply_text(
                "Заказ отменён.", reply_markup=reply_keyboard(MAIN_MENU)
            )
        else:
            await query.message.reply_text("Нельзя отменить заказ на этом этапе.")
        return

    if data.startswith("admin_confirm:"):
        if query.from_user is None or not is_admin(query.from_user.id):
            await query.answer("Недостаточно прав", show_alert=True)
            return
        if ADMIN_CHAT_ID and query.message and query.message.chat_id != ADMIN_CHAT_ID:
            await query.answer("Недостаточно прав", show_alert=True)
            return
        _, order_id = data.split(":", 1)
        db = Database()
        order = db.get_order(int(order_id))
        if not db.transition_order_status(order["order_id"], order["status"], "PAID_MANUAL"):
            await query.answer("Статус уже изменён", show_alert=True)
            return
        await context.bot.send_message(
            chat_id=order["user_id"],
            text=f"<b>Оплата подтверждена</b>\nЗаказ #{order['order_id']} принят в работу.",
            parse_mode=ParseMode.HTML,
        )
        await query.message.edit_text(order_card(db.get_order(order["order_id"])), parse_mode=ParseMode.HTML, reply_markup=query.message.reply_markup)
        return

    if data.startswith("admin_done:"):
        if query.from_user is None or not is_admin(query.from_user.id):
            await query.answer("Недостаточно прав", show_alert=True)
            return
        if ADMIN_CHAT_ID and query.message and query.message.chat_id != ADMIN_CHAT_ID:
            await query.answer("Недостаточно прав", show_alert=True)
            return
        _, order_id = data.split(":", 1)
        db = Database()
        order = db.get_order(int(order_id))
        if not db.transition_order_status(order["order_id"], order["status"], "DONE"):
            await query.answer("Недоступно для текущего статуса", show_alert=True)
            return
        await context.bot.send_message(
            chat_id=order["user_id"],
            text=f"<b>Заказ #{order['order_id']} выполнен.</b>",
            parse_mode=ParseMode.HTML,
        )
        await query.message.edit_text(order_card(db.get_order(order["order_id"])), parse_mode=ParseMode.HTML, reply_markup=query.message.reply_markup)
        return

    if data.startswith("admin_reject:"):
        if query.from_user is None or not is_admin(query.from_user.id):
            await query.answer("Недостаточно прав", show_alert=True)
            return
        if ADMIN_CHAT_ID and query.message and query.message.chat_id != ADMIN_CHAT_ID:
            await query.answer("Недостаточно прав", show_alert=True)
            return
        _, order_id = data.split(":", 1)
        context.chat_data["admin_reject_target"] = int(order_id)
        await query.message.reply_text("Введите причину отклонения заказа.")
        return

    if data.startswith("admin_message:"):
        if query.from_user is None or not is_admin(query.from_user.id):
            await query.answer("Недостаточно прав", show_alert=True)
            return
        if ADMIN_CHAT_ID and query.message and query.message.chat_id != ADMIN_CHAT_ID:
            await query.answer("Недостаточно прав", show_alert=True)
            return
        _, order_id = data.split(":", 1)
        db = Database()
        order = db.get_order(int(order_id))
        context.chat_data["admin_message_target"] = {
            "user_id": order["user_id"],
        }
        await query.message.reply_text("Введите сообщение пользователю.")
        return


def main() -> None:
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not token:
        raise RuntimeError("TELEGRAM_BOT_TOKEN is not set")

    application = Application.builder().token(token).build()

    application.add_handler(CommandHandler("start", start))
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text))
    application.add_handler(MessageHandler(filters.PHOTO | filters.Document.ALL, handle_text))
    application.add_handler(CallbackQueryHandler(handle_callback))

    application.run_polling()


if __name__ == "__main__":
    main()
