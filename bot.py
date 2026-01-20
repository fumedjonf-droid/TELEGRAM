import asyncio
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

from db import Database, ROLE_ORDER

SUPPORT_URL = "https://t.me/your_support"
SUPPORT_CHAT_URL = "https://t.me/your_support_chat"
TERMS_URL = "https://example.com/terms"
BUY_GUIDE_URL = "https://example.com/how-to-buy"
CHANNEL_URL = "https://t.me/your_channel"
REVIEWS_URL = "https://t.me/your_reviews"
RULES_URL = "https://example.com/rules"

ADMIN_CHAT_ID = int(os.getenv("ADMIN_CHAT_ID", "0"))
ADMIN_LOGIN_CODE = os.getenv("ADMIN_LOGIN_CODE", "")
MAINTENANCE_MODE = os.getenv("MAINTENANCE_MODE", "false").lower() == "true"
MANUAL_MODE = os.getenv("MANUAL_MODE", "true").lower() == "true"

SUPPORT_IMAGE_URL = os.getenv("SUPPORT_IMAGE_URL", "")
REVIEWS_IMAGE_URL = os.getenv("REVIEWS_IMAGE_URL", "")

CREDIT_ON_CONFIRM = os.getenv("CREDIT_ON_CONFIRM", "false").lower() == "true"
BROADCAST_RATE_LIMIT = float(os.getenv("BROADCAST_RATE_LIMIT", "0.05"))
ADMIN_SESSION_HOURS = int(os.getenv("ADMIN_SESSION_HOURS", "12"))

CURRENCY = "RUB"
VERSION = "2.1.0"
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


ROLE_COMMANDS = {
    "MODERATOR": [
        "/stats day|week|month",
        "/new_users day|week|month",
        "/last_orders N",
        "/top_items day|week|month [donate|software]",
        "/order ID",
        "/find_user <@username|user_id>",
    ],
    "ADMIN": [
        "/broadcast <text>",
        "/broadcast_test <text>",
        "/broadcast_last <N> <text>",
        "/send <user_id> <text>",
        "/give <user_id> <amount> <reason>",
        "/take <user_id> <amount> <reason>",
        "/balance <user_id>",
        "/set_card <number> <owner> <bank>",
        "/set_comment <text>",
        "/pay_on /pay_off /show_card",
        "/set_status <order_id> <status>",
        "/diag",
    ],
    "OWNER": [
        "/add_staff <user_id> <role>",
        "/remove_staff <user_id>",
        "/set_role <user_id> <role>",
        "/maintenance_on /maintenance_off",
    ],
}


def reply_keyboard(buttons: list[list[KeyboardButton]]) -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(buttons, resize_keyboard=True, one_time_keyboard=False)


def nav_keyboard() -> ReplyKeyboardMarkup:
    return reply_keyboard([[KeyboardButton(NAV_BACK), KeyboardButton(NAV_MAIN)]])


def safe_username(username: str | None) -> str:
    return f"@{username}" if username else "—"


def from_minor(amount_minor: int) -> str:
    return f"{amount_minor / 100:.2f}"


def is_private(update: Update) -> bool:
    return update.effective_chat is not None and update.effective_chat.type == "private"


def is_admin_chat(update: Update) -> bool:
    return update.effective_chat is not None and update.effective_chat.id == ADMIN_CHAT_ID


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


def build_payment_text(order: dict[str, Any], settings: dict[str, Any]) -> str:
    comment = (settings.get("comment_template") or "ORDER-{order_id}").format(
        order_id=order["order_id"]
    )
    bank_line = f"Банк: {settings.get('bank_name')}\n" if settings.get("bank_name") else ""
    return (
        "<b>Оплатите по реквизитам ниже, затем отправьте чек сюда.</b>\n"
        "После проверки админом статус изменится.\n\n"
        f"Сумма: {from_minor(order['amount_minor'])} {CURRENCY}\n"
        f"Получатель: {settings.get('card_owner') or '—'}\n"
        f"Карта: {settings.get('card_number') or '—'}\n"
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


def require_role(db: Database, update: Update, min_role: str) -> bool:
    if update.effective_user is None:
        return False
    user_id = update.effective_user.id
    if is_admin_chat(update):
        if not db.is_staff(user_id):
            if update.message:
                update.message.reply_text("Недостаточно прав")
            return False
        return db.has_role(user_id, min_role)
    if is_private(update):
        if not db.is_staff(user_id):
            if update.message:
                update.message.reply_text("Команда недоступна")
            return False
        if not db.session_valid(user_id):
            if update.message:
                update.message.reply_text("Сначала войдите через /admin")
            return False
        return db.has_role(user_id, min_role)
    return False


def get_period_bounds(period: str) -> tuple[int, int]:
    now = int(time.time())
    if period == "day":
        return now - 86400, now
    if period == "week":
        return now - 86400 * 7, now
    if period == "month":
        return now - 86400 * 30, now
    return now - 86400, now


def parse_amount_to_minor(amount_text: str) -> int:
    return int(float(amount_text.replace(",", ".")) * 100)


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


async def handle_admin_login(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None or update.effective_user is None:
        return
    if not is_private(update):
        await update.message.reply_text("Команда доступна только в личке")
        return
    db = Database()
    if not db.is_staff(update.effective_user.id):
        await update.message.reply_text("Команда недоступна")
        return
    context.user_data["awaiting_admin_code"] = True
    await update.message.reply_text("Введите код доступа:")


async def handle_logout(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None or update.effective_user is None:
        return
    db = Database()
    db.clear_session(update.effective_user.id)
    await update.message.reply_text("Сессия завершена.")


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
    settings = db.get_payment_settings()
    context.user_data["awaiting_player_id"] = None
    context.user_data["awaiting_receipt"] = order_id
    await update.message.reply_text(
        build_payment_text(order, settings),
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
    db = Database()
    if not db.is_staff(update.effective_user.id):
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
        order_id = int(pending_reject)
        order = db.get_order(order_id)
        if not db.can_transition(order["status"], "REJECTED"):
            await update.message.reply_text("Нельзя отклонить заказ в этом статусе.")
            return True
        db.transition_order_status(order_id, order["status"], "REJECTED", update.effective_user.id, update.message.text)
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
    if MAINTENANCE_MODE:
        await update.message.reply_text("Сервис временно на обслуживании.")
        return
    db = Database()
    settings = db.get_payment_settings()
    if not settings.get("enabled"):
        await update.message.reply_text("Оплата временно недоступна.")
        return
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
        build_payment_text(order, settings),
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

    db = Database()
    db.upsert_user(update.effective_user.id, update.effective_user.username)

    if context.user_data.get("awaiting_admin_code"):
        context.user_data["awaiting_admin_code"] = False
        if update.message.text == ADMIN_LOGIN_CODE and ADMIN_LOGIN_CODE:
            expires_at_ts = int(time.time()) + ADMIN_SESSION_HOURS * 3600
            db.create_session(update.effective_user.id, expires_at_ts)
            await update.message.reply_text("Вход выполнен.")
        else:
            await update.message.reply_text("Неверный код.")
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
        db = Database()
        if query.from_user is None or not db.has_role(query.from_user.id, "MODERATOR"):
            await query.answer("Недостаточно прав", show_alert=True)
            return
        if ADMIN_CHAT_ID and query.message and query.message.chat_id != ADMIN_CHAT_ID:
            await query.answer("Недостаточно прав", show_alert=True)
            return
        _, order_id = data.split(":", 1)
        order = db.get_order(int(order_id))
        if not db.transition_order_status(
            order["order_id"],
            order["status"],
            "PAID_MANUAL",
            query.from_user.id,
        ):
            await query.answer("Статус уже изменён", show_alert=True)
            return
        if CREDIT_ON_CONFIRM or order["item_name"].lower().startswith("пополнение"):
            db.add_balance_ledger(
                order["user_id"],
                order["amount_minor"],
                "manual_payment",
                order["order_id"],
                query.from_user.id,
            )
            balance = db.get_balance(order["user_id"])
            await context.bot.send_message(
                chat_id=order["user_id"],
                text=(
                    f"<b>Пополнение подтверждено ✅</b>\n"
                    f"Баланс +{from_minor(order['amount_minor'])} {CURRENCY}\n"
                    f"Текущий баланс: {from_minor(balance)} {CURRENCY}"
                ),
                parse_mode=ParseMode.HTML,
            )
        else:
            await context.bot.send_message(
                chat_id=order["user_id"],
                text=f"<b>Оплата подтверждена</b>\nЗаказ #{order['order_id']} принят в работу.",
                parse_mode=ParseMode.HTML,
            )
        await query.message.edit_text(
            order_card(db.get_order(order["order_id"])),
            parse_mode=ParseMode.HTML,
            reply_markup=query.message.reply_markup,
        )
        return

    if data.startswith("admin_done:"):
        db = Database()
        if query.from_user is None or not db.has_role(query.from_user.id, "MODERATOR"):
            await query.answer("Недостаточно прав", show_alert=True)
            return
        if ADMIN_CHAT_ID and query.message and query.message.chat_id != ADMIN_CHAT_ID:
            await query.answer("Недостаточно прав", show_alert=True)
            return
        _, order_id = data.split(":", 1)
        order = db.get_order(int(order_id))
        if not db.transition_order_status(
            order["order_id"],
            order["status"],
            "DONE",
            query.from_user.id,
        ):
            await query.answer("Недоступно для текущего статуса", show_alert=True)
            return
        await context.bot.send_message(
            chat_id=order["user_id"],
            text=f"<b>Заказ #{order['order_id']} выполнен.</b>",
            parse_mode=ParseMode.HTML,
        )
        await query.message.edit_text(
            order_card(db.get_order(order["order_id"])),
            parse_mode=ParseMode.HTML,
            reply_markup=query.message.reply_markup,
        )
        return

    if data.startswith("admin_reject:"):
        db = Database()
        if query.from_user is None or not db.has_role(query.from_user.id, "MODERATOR"):
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
        db = Database()
        if query.from_user is None or not db.has_role(query.from_user.id, "MODERATOR"):
            await query.answer("Недостаточно прав", show_alert=True)
            return
        if ADMIN_CHAT_ID and query.message and query.message.chat_id != ADMIN_CHAT_ID:
            await query.answer("Недостаточно прав", show_alert=True)
            return
        _, order_id = data.split(":", 1)
        order = db.get_order(int(order_id))
        context.chat_data["admin_message_target"] = {
            "user_id": order["user_id"],
        }
        await query.message.reply_text("Введите сообщение пользователю.")
        return


async def handle_stats(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return
    db = Database()
    if not require_role(db, update, "MODERATOR"):
        return
    period = context.args[0] if context.args else "day"
    start_ts, end_ts = get_period_bounds(period)
    stats = db.stats_for_period(start_ts, end_ts)
    text = (
        f"Период: {period}\n"
        f"Новые пользователи: {stats['new_users']}\n"
        f"Заказов: {stats['order_count']}\n"
        f"Оплачено: {from_minor(stats['paid_sum'])} {CURRENCY}\n"
        f"Отклонено: {stats['rejected']}\n"
        f"Средний чек: {from_minor(stats['avg_check'])} {CURRENCY}\n"
        f"Активные пользователи: {stats['active_users']}"
    )
    await update.message.reply_text(text)


async def handle_new_users(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return
    db = Database()
    if not require_role(db, update, "MODERATOR"):
        return
    period = context.args[0] if context.args else "day"
    start_ts, _ = get_period_bounds(period)
    users = db.list_new_users(start_ts)
    lines = [
        f"{u['created_at_ts']} — {u['telegram_id']} {safe_username(u['username'])}"
        for u in users
    ]
    text = "Новые пользователи:\n" + ("\n".join(lines) if lines else "—")
    await update.message.reply_text(text)


async def handle_last_orders(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return
    db = Database()
    if not require_role(db, update, "MODERATOR"):
        return
    limit = int(context.args[0]) if context.args else 10
    orders = db.list_last_orders(limit)
    lines = [
        (
            f"#{o['order_id']} {safe_username(o['username'])} "
            f"{from_minor(o['amount_minor'])} {CURRENCY} {o['status']}"
        )
        for o in orders
    ]
    text = "Последние заказы:\n" + ("\n".join(lines) if lines else "—")
    await update.message.reply_text(text)


async def handle_top_items(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return
    db = Database()
    if not require_role(db, update, "MODERATOR"):
        return
    period = context.args[0] if context.args else "day"
    section = context.args[1].upper() if len(context.args) > 1 else None
    if section == "DONATE":
        section = "DONATE"
    elif section == "SOFTWARE":
        section = "SOFTWARE"
    else:
        section = None
    start_ts, end_ts = get_period_bounds(period)
    items = db.top_items(start_ts, end_ts, section)
    lines = [
        f"{item['item_name']}: {item['count']} / {from_minor(item['amount'])} {CURRENCY}"
        for item in items
    ]
    text = "Топ товары:\n" + ("\n".join(lines) if lines else "—")
    await update.message.reply_text(text)


async def handle_order(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return
    db = Database()
    if not require_role(db, update, "MODERATOR"):
        return
    if not context.args:
        await update.message.reply_text("Использование: /order <id>")
        return
    order_id = int(context.args[0])
    order = db.get_order(order_id)
    logs = db.get_order_logs(order_id)
    audit = "\n".join(
        [
            f"{log['created_at_ts']}: {log['old_status']} → {log['new_status']}"
            for log in logs
        ]
    ) or "—"
    text = order_card(order) + f"\n\n<b>Аудит:</b>\n{audit}"
    await update.message.reply_text(text, parse_mode=ParseMode.HTML)


async def handle_find_user(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return
    db = Database()
    if not require_role(db, update, "MODERATOR"):
        return
    if not context.args:
        await update.message.reply_text("Использование: /find_user <@username|user_id>")
        return
    query = context.args[0].lstrip("@")
    if query.isdigit():
        user = db.get_user(int(query))
        await update.message.reply_text(f"User: {user['telegram_id']} {safe_username(user['username'])}")
        return
    cursor = db.connection.execute("SELECT * FROM users WHERE username = ?", (query,))
    row = cursor.fetchone()
    if not row:
        await update.message.reply_text("Пользователь не найден")
        return
    await update.message.reply_text(f"User: {row['telegram_id']} {safe_username(row['username'])}")


async def handle_set_status(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return
    db = Database()
    if not require_role(db, update, "ADMIN"):
        return
    if len(context.args) < 2:
        await update.message.reply_text("Использование: /set_status <order_id> <status>")
        return
    order_id = int(context.args[0])
    status = context.args[1]
    order = db.get_order(order_id)
    if not db.transition_order_status(order_id, order["status"], status, update.effective_user.id):
        await update.message.reply_text("Недопустимый переход")
        return
    await update.message.reply_text("Статус обновлён")


async def handle_set_card(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return
    db = Database()
    if not require_role(db, update, "ADMIN"):
        return
    if len(context.args) < 3:
        await update.message.reply_text("Использование: /set_card <номер> <владелец> <банк>")
        return
    card_number = context.args[0]
    card_owner = context.args[1]
    bank_name = " ".join(context.args[2:])
    db.update_payment_settings(
        card_number=card_number,
        card_owner=card_owner,
        bank_name=bank_name,
        updated_by=update.effective_user.id,
    )
    await update.message.reply_text("Реквизиты обновлены")


async def handle_set_comment(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return
    db = Database()
    if not require_role(db, update, "ADMIN"):
        return
    text = " ".join(context.args)
    if not text:
        await update.message.reply_text("Использование: /set_comment <текст>")
        return
    db.update_payment_settings(comment_template=text, updated_by=update.effective_user.id)
    await update.message.reply_text("Комментарий обновлён")


async def handle_pay_toggle(update: Update, context: ContextTypes.DEFAULT_TYPE, enabled: bool) -> None:
    if update.message is None:
        return
    db = Database()
    if not require_role(db, update, "ADMIN"):
        return
    db.update_payment_settings(enabled=1 if enabled else 0, updated_by=update.effective_user.id)
    await update.message.reply_text("Готово")


async def handle_show_card(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return
    db = Database()
    if not require_role(db, update, "ADMIN"):
        return
    settings = db.get_payment_settings()
    text = (
        f"Enabled: {settings['enabled']}\n"
        f"Owner: {settings.get('card_owner') or '—'}\n"
        f"Number: {settings.get('card_number') or '—'}\n"
        f"Bank: {settings.get('bank_name') or '—'}\n"
        f"Comment: {settings.get('comment_template') or '—'}"
    )
    await update.message.reply_text(text)


async def handle_broadcast(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return
    db = Database()
    if not require_role(db, update, "ADMIN"):
        return
    text = " ".join(context.args)
    if not text:
        await update.message.reply_text("Использование: /broadcast <текст>")
        return
    context.chat_data["broadcast_pending"] = {"scope": "all", "text": text}
    keyboard = InlineKeyboardMarkup(
        [[InlineKeyboardButton("Да", callback_data="broadcast_confirm"), InlineKeyboardButton("Нет", callback_data="broadcast_cancel")]]
    )
    await update.message.reply_text("Вы уверены?", reply_markup=keyboard)


async def handle_broadcast_test(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return
    db = Database()
    if not require_role(db, update, "ADMIN"):
        return
    text = " ".join(context.args)
    if not text:
        await update.message.reply_text("Использование: /broadcast_test <текст>")
        return
    context.chat_data["broadcast_pending"] = {"scope": "staff", "text": text}
    keyboard = InlineKeyboardMarkup(
        [[InlineKeyboardButton("Да", callback_data="broadcast_confirm"), InlineKeyboardButton("Нет", callback_data="broadcast_cancel")]]
    )
    await update.message.reply_text("Вы уверены?", reply_markup=keyboard)


async def handle_broadcast_last(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return
    db = Database()
    if not require_role(db, update, "ADMIN"):
        return
    if len(context.args) < 2:
        await update.message.reply_text("Использование: /broadcast_last <N> <текст>")
        return
    days = int(context.args[0])
    text = " ".join(context.args[1:])
    context.chat_data["broadcast_pending"] = {
        "scope": "last",
        "days": days,
        "text": text,
    }
    keyboard = InlineKeyboardMarkup(
        [[InlineKeyboardButton("Да", callback_data="broadcast_confirm"), InlineKeyboardButton("Нет", callback_data="broadcast_cancel")]]
    )
    await update.message.reply_text("Вы уверены?", reply_markup=keyboard)


async def handle_send(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return
    db = Database()
    if not require_role(db, update, "ADMIN"):
        return
    if len(context.args) < 2:
        await update.message.reply_text("Использование: /send <user_id> <текст>")
        return
    user_id = int(context.args[0])
    text = " ".join(context.args[1:])
    await context.bot.send_message(chat_id=user_id, text=text)
    await update.message.reply_text("Отправлено")


async def handle_give(update: Update, context: ContextTypes.DEFAULT_TYPE, sign: int) -> None:
    if update.message is None:
        return
    db = Database()
    if not require_role(db, update, "ADMIN"):
        return
    if len(context.args) < 3:
        await update.message.reply_text("Использование: /give|/take <user_id> <amount> <reason>")
        return
    user_id = int(context.args[0])
    amount_minor = parse_amount_to_minor(context.args[1]) * sign
    reason = " ".join(context.args[2:])
    db.add_balance_ledger(user_id, amount_minor, reason, None, update.effective_user.id)
    balance = db.get_balance(user_id)
    await context.bot.send_message(
        chat_id=user_id,
        text=(
            f"<b>Изменение баланса</b>\n"
            f"Сумма: {from_minor(amount_minor)} {CURRENCY}\n"
            f"Причина: {reason}\n"
            f"Текущий баланс: {from_minor(balance)} {CURRENCY}"
        ),
        parse_mode=ParseMode.HTML,
    )
    await update.message.reply_text("Готово")


async def handle_balance(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return
    db = Database()
    if not require_role(db, update, "ADMIN"):
        return
    if not context.args:
        await update.message.reply_text("Использование: /balance <user_id>")
        return
    user_id = int(context.args[0])
    balance = db.get_balance(user_id)
    await update.message.reply_text(f"Баланс: {from_minor(balance)} {CURRENCY}")


async def handle_add_staff(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return
    db = Database()
    if not require_role(db, update, "OWNER"):
        return
    if len(context.args) < 2:
        await update.message.reply_text("Использование: /add_staff <user_id> <role>")
        return
    user_id = int(context.args[0])
    role = context.args[1].upper()
    if role not in ROLE_ORDER:
        await update.message.reply_text("Роль недоступна")
        return
    db.set_staff(user_id, role, update.effective_user.id)
    await update.message.reply_text("Готово")


async def handle_remove_staff(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return
    db = Database()
    if not require_role(db, update, "OWNER"):
        return
    if not context.args:
        await update.message.reply_text("Использование: /remove_staff <user_id>")
        return
    db.deactivate_staff(int(context.args[0]))
    await update.message.reply_text("Готово")


async def handle_set_role(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await handle_add_staff(update, context)


async def handle_help(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return
    db = Database()
    if is_private(update) and db.is_staff(update.effective_user.id):
        role = db.get_staff(update.effective_user.id)["role"]
        lines = ["Команды:"]
        for r, cmds in ROLE_COMMANDS.items():
            if ROLE_ORDER[r] <= ROLE_ORDER[role]:
                lines.append(f"\n{r}:")
                lines.extend(cmds)
        await update.message.reply_text("\n".join(lines))
        return
    if is_admin_chat(update) and db.is_staff(update.effective_user.id):
        role = db.get_staff(update.effective_user.id)["role"]
        lines = ["Команды:"]
        for r, cmds in ROLE_COMMANDS.items():
            if ROLE_ORDER[r] <= ROLE_ORDER[role]:
                lines.append(f"\n{r}:")
                lines.extend(cmds)
        await update.message.reply_text("\n".join(lines))
        return
    await update.message.reply_text(
        "Доступные команды:\n/start — начать\nКаталог и профиль через меню"
    )


async def handle_diag(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return
    db = Database()
    if not require_role(db, update, "ADMIN"):
        return
    try:
        db.connection.execute("SELECT 1")
        db_ok = "ok"
    except Exception:  # noqa: BLE001
        db_ok = "error"
    uptime_seconds = int(time.time() - START_TIME)
    text = (
        f"Version: {VERSION}\n"
        f"Uptime(s): {uptime_seconds}\n"
        f"DB: {db_ok}\n"
        f"MAINTENANCE_MODE: {MAINTENANCE_MODE}\n"
        f"MANUAL_MODE: {MANUAL_MODE}"
    )
    await update.message.reply_text(text)


async def handle_broadcast_confirm(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    if query is None:
        return
    db = Database()
    if query.from_user is None or not db.has_role(query.from_user.id, "ADMIN"):
        await query.answer("Недостаточно прав", show_alert=True)
        return
    payload = context.chat_data.get("broadcast_pending")
    if not payload:
        await query.answer("Нечего отправлять", show_alert=True)
        return
    scope = payload["scope"]
    text = payload["text"]
    context.chat_data["broadcast_pending"] = None
    await query.edit_message_text("Рассылка запущена")

    recipients: list[int] = []
    if scope == "staff":
        cursor = db.connection.execute("SELECT user_id FROM staff WHERE is_active = 1")
        recipients = [int(row[0]) for row in cursor.fetchall()]
    elif scope == "last":
        since_ts = int(time.time()) - int(payload.get("days", 1)) * 86400
        recipients = [u["telegram_id"] for u in db.list_users_active_since(since_ts)]
    else:
        cursor = db.connection.execute("SELECT telegram_id FROM users")
        recipients = [int(row[0]) for row in cursor.fetchall()]

    for user_id in recipients:
        try:
            await query.bot.send_message(chat_id=user_id, text=text)
            await asyncio.sleep(BROADCAST_RATE_LIMIT)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Broadcast failed for %s: %s", user_id, exc)


async def handle_broadcast_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    if query is None:
        return
    context.chat_data["broadcast_pending"] = None
    await query.edit_message_text("Отменено")


async def handle_maintenance_toggle(update: Update, context: ContextTypes.DEFAULT_TYPE, value: bool) -> None:
    if update.message is None:
        return
    db = Database()
    if not require_role(db, update, "OWNER"):
        return
    status = "on" if value else "off"
    await update.message.reply_text(f"Maintenance {status} (ENV only).")


def main() -> None:
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not token:
        raise RuntimeError("TELEGRAM_BOT_TOKEN is not set")

    application = Application.builder().token(token).build()

    application.add_handler(CommandHandler("start", start))
    application.add_handler(CommandHandler("help", handle_help))
    application.add_handler(CommandHandler("admin", handle_admin_login))
    application.add_handler(CommandHandler("logout", handle_logout))

    application.add_handler(CommandHandler("stats", handle_stats))
    application.add_handler(CommandHandler("new_users", handle_new_users))
    application.add_handler(CommandHandler("last_orders", handle_last_orders))
    application.add_handler(CommandHandler("top_items", handle_top_items))
    application.add_handler(CommandHandler("order", handle_order))
    application.add_handler(CommandHandler("find_user", handle_find_user))
    application.add_handler(CommandHandler("set_status", handle_set_status))

    application.add_handler(CommandHandler("set_card", handle_set_card))
    application.add_handler(CommandHandler("set_comment", handle_set_comment))
    application.add_handler(CommandHandler("pay_on", lambda u, c: handle_pay_toggle(u, c, True)))
    application.add_handler(CommandHandler("pay_off", lambda u, c: handle_pay_toggle(u, c, False)))
    application.add_handler(CommandHandler("show_card", handle_show_card))

    application.add_handler(CommandHandler("broadcast", handle_broadcast))
    application.add_handler(CommandHandler("broadcast_test", handle_broadcast_test))
    application.add_handler(CommandHandler("broadcast_last", handle_broadcast_last))
    application.add_handler(CommandHandler("send", handle_send))

    application.add_handler(CommandHandler("give", lambda u, c: handle_give(u, c, 1)))
    application.add_handler(CommandHandler("take", lambda u, c: handle_give(u, c, -1)))
    application.add_handler(CommandHandler("balance", handle_balance))

    application.add_handler(CommandHandler("add_staff", handle_add_staff))
    application.add_handler(CommandHandler("remove_staff", handle_remove_staff))
    application.add_handler(CommandHandler("set_role", handle_set_role))
    application.add_handler(CommandHandler("maintenance_on", lambda u, c: handle_maintenance_toggle(u, c, True)))
    application.add_handler(CommandHandler("maintenance_off", lambda u, c: handle_maintenance_toggle(u, c, False)))
    application.add_handler(CommandHandler("diag", handle_diag))

    application.add_handler(CallbackQueryHandler(handle_callback))
    application.add_handler(CallbackQueryHandler(handle_broadcast_confirm, pattern="^broadcast_confirm$"))
    application.add_handler(CallbackQueryHandler(handle_broadcast_cancel, pattern="^broadcast_cancel$"))

    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text))
    application.add_handler(MessageHandler(filters.PHOTO | filters.Document.ALL, handle_text))

    application.run_polling()


if __name__ == "__main__":
    main()
