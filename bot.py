import logging
import os
import time
from uuid import uuid4

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
PAY_URL_BASE = "https://pay.example.com/pay"
PAYMENT_PROVIDER = "demo"
CURRENCY = "RUB"
ADMIN_CHAT_ID = int(os.getenv("ADMIN_CHAT_ID", "0"))
AUTO_PAYMENTS = os.getenv("AUTO_PAYMENTS", "true").lower() == "true"
MANUAL_MODE = os.getenv("MANUAL_MODE", "false").lower() == "true"
MAINTENANCE_MODE = os.getenv("MAINTENANCE_MODE", "false").lower() == "true"
PAYMENT_PROVIDER = os.getenv("PAYMENT_PROVIDER", PAYMENT_PROVIDER)
ADMIN_IDS = {
    int(admin_id)
    for admin_id in os.getenv("ADMIN_IDS", "").split(",")
    if admin_id.strip()
}
PAYMENT_CHECK_COOLDOWN = int(os.getenv("PAYMENT_CHECK_COOLDOWN", "20"))
SUPPORT_IMAGE_URL = os.getenv("SUPPORT_IMAGE_URL", "")
REVIEWS_IMAGE_URL = os.getenv("REVIEWS_IMAGE_URL", "")

PRICE_MAP = {
    "PUBG MOBILE": 49900,
    "DELTA FORCE": 39900,
    "8 BALL POOL": 29900,
    "CROSS FIRE MOBILE": 45900,
    "MOBILE LEGENDS": 54900,
    "BLOOD STRIKE": 34900,
    "СЕРТИФИКАТ IOS": 99000,
    "БЕЛЫЙ ИНТЕРНЕТ": 19900,
}

MAIN_MENU = [
    [KeyboardButton("🛍 Каталог"), KeyboardButton("📢 Наш канал")],
    [KeyboardButton("👨🏻‍💻 Тех.Поддержка"), KeyboardButton("👤 Профиль / Баланс")],
    [KeyboardButton("❓ Как купить"), KeyboardButton("✉️ Отзывы")],
]

CATALOG_MENU = [
    [KeyboardButton("PUBG MOBILE")],
    [KeyboardButton("DELTA FORCE")],
    [KeyboardButton("8 BALL POOL")],
    [KeyboardButton("CROSS FIRE MOBILE")],
    [KeyboardButton("MOBILE LEGENDS")],
    [KeyboardButton("BLOOD STRIKE")],
    [KeyboardButton("СЕРТИФИКАТ IOS")],
    [KeyboardButton("БЕЛЫЙ ИНТЕРНЕТ")],
    [KeyboardButton("⬅️ Назад")],
]

PROFILE_MENU = [
    [KeyboardButton("Пополнить баланс")],
    [KeyboardButton("Купоны")],
    [KeyboardButton("Вывод баланса")],
    [KeyboardButton("🧾 История заказов")],
    [KeyboardButton("Реферальная программа")],
    [KeyboardButton("⭐️ Избранное")],
]

ORDER_TRANSITIONS = {
    "NEW": {"WAIT_PAY", "REJECTED"},
    "WAIT_PAY": {"PAID", "EXPIRED", "REJECTED"},
    "PAID": {"IN_PROGRESS", "REFUNDED", "REJECTED"},
    "IN_PROGRESS": {"DONE", "REJECTED"},
    "DONE": set(),
    "EXPIRED": {"WAIT_PAY", "REJECTED"},
    "REFUNDED": set(),
    "REJECTED": set(),
}
FINAL_PAYMENT_STATUSES = {"SUCCEEDED", "FAILED", "EXPIRED", "CANCELED", "SUSPICIOUS"}

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
VERSION = "1.2.0"
START_TIME = time.time()


def reply_keyboard(buttons: list[list[KeyboardButton]]) -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(buttons, resize_keyboard=True, one_time_keyboard=False)


def safe_username(username: str | None) -> str:
    return f"@{username}" if username else "—"


def from_minor(amount_minor: int) -> str:
    return f"{amount_minor / 100:.2f}"


def create_payment_link() -> tuple[str, str]:
    payment_id = uuid4().hex
    pay_url = f"{PAY_URL_BASE}/{payment_id}"
    return payment_id, pay_url


def order_card_text(order: dict, updated_by: str | None = None) -> str:
    base = (
        f"<b>Заказ #{order['order_id']}</b>\n"
        f"Товар: {order['item']}\n"
        f"Сумма: {from_minor(order['amount_minor'])} {order['currency']}\n"
        f"Статус: {order['status']}"
    )
    if updated_by:
        return f"{base}\nОбновил: {updated_by}"
    return base


def is_admin(user_id: int) -> bool:
    if ADMIN_IDS:
        return user_id in ADMIN_IDS
    return False


def can_transition(current: str, new_status: str) -> bool:
    return new_status in ORDER_TRANSITIONS.get(current, set())


def build_order_buttons(order: dict, payment: dict | None = None) -> InlineKeyboardMarkup:
    buttons: list[list[InlineKeyboardButton]] = []
    if payment and payment.get("pay_url"):
        buttons.append([InlineKeyboardButton("Оплатить", url=payment["pay_url"])])
    buttons.append([InlineKeyboardButton("🔄 Проверить оплату", callback_data=f"order_check:{order['order_id']}")])
    buttons.append([InlineKeyboardButton("♻️ Повторить заказ", callback_data=f"order_repeat:{order['order_id']}")])
    buttons.append([InlineKeyboardButton("⭐️ В избранное", callback_data=f"order_favorite:{order['order_id']}")])
    return InlineKeyboardMarkup(buttons)


def order_text(order: dict) -> str:
    return (
        f"<b>Заказ #{order['order_id']}</b>\n"
        f"Товар: {order['item']}\n"
        f"Сумма: {from_minor(order['amount_minor'])} {order['currency']}\n"
        f"Статус: {order['status']}"
    )


async def create_order_for_item(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    item: str,
    user_id: int,
    username: str | None,
) -> None:
    chat_id = update.effective_chat.id if update.effective_chat else user_id
    if MAINTENANCE_MODE:
        await context.bot.send_message(
            chat_id=chat_id,
            "Сервис временно на обслуживании. Попробуйте позже.",
            reply_markup=reply_keyboard(MAIN_MENU),
        )
        return
    if MANUAL_MODE:
        await context.bot.send_message(
            chat_id=chat_id,
            "Оплата временно в ручном режиме. Свяжитесь с поддержкой.",
            reply_markup=reply_keyboard(MAIN_MENU),
        )
        return
    if not AUTO_PAYMENTS:
        await context.bot.send_message(
            chat_id=chat_id,
            "Автооплата отключена. Обратитесь в поддержку для оформления.",
            reply_markup=reply_keyboard(MAIN_MENU),
        )
        return
    db = Database()
    db.upsert_user(user_id, username)
    amount_minor = PRICE_MAP[item]
    order_id = db.create_order(user_id, item, amount_minor, CURRENCY)
    db.deactivate_payments_for_order(order_id)
    payment_id, pay_url = create_payment_link()
    db.create_payment(
        PAYMENT_PROVIDER,
        payment_id,
        order_id,
        pay_url,
        amount_minor,
        CURRENCY,
    )
    db.attach_payment_to_order(order_id, payment_id)
    db.update_order_status_if(order_id, "NEW", "WAIT_PAY")
    payment = db.get_payment(PAYMENT_PROVIDER, payment_id)

    text = (
        f"<b>Заказ #{order_id}</b>\n"
        f"Товар: {item}\n"
        f"Сумма к оплате: {from_minor(amount_minor)} {CURRENCY}\n"
        "Статус: WAIT_PAY"
    )
    await context.bot.send_message(
        chat_id=chat_id,
        text=text,
        parse_mode=ParseMode.HTML,
        reply_markup=build_order_buttons(db.get_order(order_id), payment),
    )


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
    db = Database()
    user = update.effective_user
    if user is None or update.message is None:
        return
    db.upsert_user(user.id, user.username)

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


async def show_main_menu(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return
    await update.message.reply_text(
        "Главное меню:",
        reply_markup=reply_keyboard(MAIN_MENU),
    )


async def handle_catalog(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return
    await update.message.reply_text(
        "Выберите вашу игру ↓",
        reply_markup=reply_keyboard(CATALOG_MENU),
    )


async def handle_support(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    text = (
        "<b>Опишите вашу проблему целиком в одном сообщении!</b>\n"
        "Не умеете писать — запишите видео."
    )
    keyboard = InlineKeyboardMarkup(
        [
            [InlineKeyboardButton("Чат поддержки", url=SUPPORT_CHAT_URL)],
            [InlineKeyboardButton("Оставить заявку", callback_data="support_request")],
        ]
    )
    await send_photo_or_text(update, context, SUPPORT_IMAGE_URL, text, keyboard)


async def handle_how_to_buy(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return
    text = (
        "<b>Как купить:</b>\n"
        "1. Выберите игру в каталоге.\n"
        "2. Следуйте инструкции.\n"
        "3. Оплатите удобным способом.\n\n"
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
    totals = db.get_user_totals(user.id)

    profile_text = (
        f"<b>Ваш ID:</b> {profile['telegram_id']}\n"
        f"<b>Пользователь:</b> {safe_username(profile['username'])}\n"
        f"<b>Количество заказов:</b> {totals['order_count']}\n"
        f"<b>Общая сумма заказов:</b> {from_minor(totals['paid_sum'])} {CURRENCY}\n"
        f"<b>Баланс:</b> {from_minor(int(profile['balance']))} {CURRENCY}"
    )

    rules_keyboard = InlineKeyboardMarkup(
        [[InlineKeyboardButton("Правила", url=RULES_URL)]]
    )

    await update.message.reply_text(
        profile_text, parse_mode=ParseMode.HTML, reply_markup=rules_keyboard
    )
    await update.message.reply_text(
        "Выберите действие:", reply_markup=reply_keyboard(PROFILE_MENU)
    )


async def handle_catalog_item(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return
    item = update.message.text
    if item not in PRICE_MAP:
        await update.message.reply_text(
            "Выберите позицию из каталога.",
            reply_markup=reply_keyboard(CATALOG_MENU),
        )
        return

    user = update.effective_user
    if user is None:
        return
    await create_order_for_item(update, context, item, user.id, user.username)


async def handle_support_ticket_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> bool:
    if not context.user_data.get("support_pending"):
        return False
    if update.message is None:
        return False
    context.user_data["support_pending"] = False
    user = update.effective_user
    if user is None:
        return True
    if ADMIN_CHAT_ID:
        keyboard = InlineKeyboardMarkup(
            [
                [
                    InlineKeyboardButton(
                        "Ответить пользователю",
                        callback_data=f"support_reply:{user.id}",
                    )
                ]
            ]
        )
        await context.bot.send_message(
            chat_id=ADMIN_CHAT_ID,
            text=(
                "<b>Новая заявка в поддержку</b>\n"
                f"Пользователь: {safe_username(user.username)} ({user.id})"
            ),
            parse_mode=ParseMode.HTML,
            reply_markup=keyboard,
        )
        await context.bot.forward_message(
            chat_id=ADMIN_CHAT_ID,
            from_chat_id=update.effective_chat.id,
            message_id=update.message.message_id,
        )
    await update.message.reply_text(
        "Заявка отправлена в поддержку.",
        reply_markup=reply_keyboard(MAIN_MENU),
    )
    return True


async def handle_admin_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> bool:
    if update.message is None:
        return False
    if update.effective_user is None:
        return False
    if not is_admin(update.effective_user.id):
        return False
    pending = context.chat_data.get("admin_message_target")
    if not pending:
        return False
    user_id = pending.get("user_id")
    order_id = pending.get("order_id")
    is_support = pending.get("support")
    context.chat_data["admin_message_target"] = None
    if is_support:
        db = Database()
        db.log_support_message(user_id, update.effective_user.id, update.message.text)
        await context.bot.send_message(
            chat_id=user_id,
            text=(
                "<b>Сообщение от поддержки</b>\n"
                f"{update.message.text}"
            ),
            parse_mode=ParseMode.HTML,
        )
        await update.message.reply_text("Ответ отправлен пользователю.")
        return True
    await context.bot.send_message(
        chat_id=user_id,
        text=(
            "<b>Сообщение от поддержки</b>\n"
            f"По заказу #{order_id}:\n{update.message.text}"
        ),
        parse_mode=ParseMode.HTML,
    )
    await update.message.reply_text("Сообщение отправлено пользователю.")
    return True


async def handle_stats(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.effective_user is None or update.message is None:
        return
    if not is_admin(update.effective_user.id):
        await update.message.reply_text("Недостаточно прав.")
        return
    db = Database()
    period = context.args[0] if context.args else "today"
    if period == "week":
        stats = db.get_stats(7)
    else:
        stats = db.get_stats(1)
        period = "today"
    top_items = "\n".join(
        [f"- {item['item']}: {item['count']}" for item in stats["top_items"]]
    ) or "—"
    await update.message.reply_text(
        f"Период: {period}\n"
        f"Оплачено заказов: {stats['order_count']}\n"
        f"Сумма оплат: {from_minor(stats['paid_sum'])} {CURRENCY}\n"
        f"SUSPICIOUS: {stats['suspicious_count']}\n"
        f"Top товары:\n{top_items}"
    )


async def handle_order(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.effective_user is None or update.message is None:
        return
    if not is_admin(update.effective_user.id):
        await update.message.reply_text("Недостаточно прав.")
        return
    if not context.args:
        await update.message.reply_text("Использование: /order <id>")
        return
    order_id = int(context.args[0])
    db = Database()
    order = db.get_order_with_audit(order_id)
    text = order_card_text(order)
    if order["audit_logs"]:
        audit_lines = [
            f"{entry['created_at']}: {entry['old_status']} → {entry['new_status']}"
            f" (admin {entry['admin_id']})"
            for entry in order["audit_logs"]
        ]
        text = f"{text}\n\n<b>Аудит:</b>\n" + "\n".join(audit_lines)
    await update.message.reply_text(text, parse_mode=ParseMode.HTML)


async def handle_version(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.effective_user is None or update.message is None:
        return
    if not is_admin(update.effective_user.id):
        await update.message.reply_text("Недостаточно прав.")
        return
    await update.message.reply_text(f"Bot version: {VERSION}")


async def handle_reconcile(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.effective_user is None or update.message is None:
        return
    if not is_admin(update.effective_user.id):
        await update.message.reply_text("Недостаточно прав.")
        return
    if os.getenv("PAYMENT_RECONCILE_ENABLED", "false").lower() != "true":
        await update.message.reply_text(
            "Автоматическая сверка не настроена. Укажите PAYMENT_RECONCILE_ENABLED=true."
        )
        return
    await update.message.reply_text(
        "Сверка не настроена для данного провайдера. Требуется API провайдера."
    )


async def handle_order_history(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return
    user = update.effective_user
    if user is None:
        return
    db = Database()
    orders = db.list_user_orders(user.id, limit=10)
    if not orders:
        await update.message.reply_text("История заказов пуста.")
        return
    buttons = [
        [InlineKeyboardButton(f"Открыть заказ #{order['order_id']}", callback_data=f"order_view:{order['order_id']}")]
        for order in orders
    ]
    await update.message.reply_text(
        "Ваши заказы:", reply_markup=InlineKeyboardMarkup(buttons)
    )


async def handle_favorites(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return
    user = update.effective_user
    if user is None:
        return
    db = Database()
    favorites = db.list_favorites(user.id)
    favorites = [item for item in favorites if item in PRICE_MAP]
    if not favorites:
        await update.message.reply_text("Избранное пусто.")
        return
    buttons = [
        [InlineKeyboardButton(f"Заказать {item}", callback_data=f"favorite_order:{item}")]
        for item in favorites
    ]
    await update.message.reply_text("Избранное:", reply_markup=InlineKeyboardMarkup(buttons))


async def handle_diag(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.effective_user is None or update.message is None:
        return
    if not is_admin(update.effective_user.id):
        await update.message.reply_text("Недостаточно прав.")
        return
    db = Database()
    try:
        db.connection.execute("SELECT 1")
        db_ok = "ok"
    except Exception:  # noqa: BLE001
        db_ok = "error"
    outbox_size = db.get_outbox_size()
    last_webhook = db.get_service_status("last_webhook_at")
    last_webhook_time = last_webhook["value"] if last_webhook else "—"
    worker_heartbeat = db.get_service_status("worker_heartbeat")
    worker_time = worker_heartbeat["value"] if worker_heartbeat else "—"
    uptime_seconds = int(time.time() - START_TIME)
    load_avg = os.getloadavg()[0] if hasattr(os, "getloadavg") else None

    text = (
        f"<b>Diag</b>\n"
        f"Version: {VERSION}\n"
        f"Uptime(s): {uptime_seconds}\n"
        f"DB: {db_ok}\n"
        f"Outbox pending: {outbox_size}\n"
        f"Last webhook: {last_webhook_time}\n"
        f"Worker heartbeat: {worker_time}\n"
        f"Load avg: {load_avg if load_avg is not None else 'n/a'}\n"
        f"AUTO_PAYMENTS: {AUTO_PAYMENTS}\n"
        f"MANUAL_MODE: {MANUAL_MODE}\n"
        f"MAINTENANCE_MODE: {MAINTENANCE_MODE}\n"
        f"Payment provider: {PAYMENT_PROVIDER}"
    )
    await update.message.reply_text(text, parse_mode=ParseMode.HTML)


async def handle_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return

    if await handle_support_ticket_text(update, context):
        return

    if await handle_admin_message(update, context):
        return

    text = update.message.text

    actions = {
        "🛍 Каталог": handle_catalog,
        "👨🏻‍💻 Тех.Поддержка": handle_support,
        "❓ Как купить": handle_how_to_buy,
        "📢 Наш канал": handle_channel,
        "✉️ Отзывы": handle_reviews,
        "👤 Профиль / Баланс": handle_profile,
        "🧾 История заказов": handle_order_history,
        "⭐️ Избранное": handle_favorites,
        "⬅️ Назад": show_main_menu,
    }

    handler = actions.get(text)
    if handler:
        await handler(update, context)
        return

    if text in PRICE_MAP:
        await handle_catalog_item(update, context)
        return

    await update.message.reply_text(
        "Используйте кнопки меню ниже.", reply_markup=reply_keyboard(MAIN_MENU)
    )


async def handle_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    if query is None:
        return
    await query.answer()

    data = query.data or ""
    if data == "support_request":
        context.user_data["support_pending"] = True
        await query.message.reply_text("Напишите сообщение для поддержки одним текстом.")
        return

    if data.startswith("support_reply:"):
        if query.from_user is None or not is_admin(query.from_user.id):
            await query.answer("Недостаточно прав", show_alert=True)
            return
        _, user_id = data.split(":", 1)
        context.chat_data["admin_message_target"] = {
            "user_id": int(user_id),
            "support": True,
        }
        await query.message.reply_text("Введите ответ пользователю.")
        return

    if data.startswith("order_view:"):
        _, order_id = data.split(":", 1)
        db = Database()
        order = db.get_order(int(order_id))
        payment = db.get_payment_for_order(int(order_id))
        await query.message.reply_text(
            order_text(order),
            parse_mode=ParseMode.HTML,
            reply_markup=build_order_buttons(order, payment),
        )
        return

    if data.startswith("order_check:"):
        _, order_id = data.split(":", 1)
        db = Database()
        order = db.get_order(int(order_id))
        payment = db.get_payment_for_order(int(order_id))
        user = query.from_user
        if user is None:
            return
        if not db.can_check_payment(user.id, int(order_id), PAYMENT_CHECK_COOLDOWN):
            logger.warning("Payment check rate limit: user=%s order=%s", user.id, order_id)
            await query.message.reply_text(
                "Слишком частая проверка. Попробуйте позже."
            )
            return
        payment_status = payment["status"] if payment else "—"
        if payment_status in FINAL_PAYMENT_STATUSES:
            await query.message.reply_text(
                f"Оплата уже в финальном статусе: {payment_status}"
            )
            return
        await query.message.reply_text(
            f"Статус заказа: {order['status']}\nСтатус платежа: {payment_status}"
        )
        return

    if data.startswith("order_repeat:"):
        _, order_id = data.split(":", 1)
        db = Database()
        order = db.get_order(int(order_id))
        user = query.from_user
        if user is None:
            return
        if order["item"] not in PRICE_MAP:
            await query.message.reply_text("Товар недоступен для повтора.")
            return
        await create_order_for_item(update, context, order["item"], user.id, user.username)
        return

    if data.startswith("order_favorite:"):
        _, order_id = data.split(":", 1)
        db = Database()
        order = db.get_order(int(order_id))
        user = query.from_user
        if user is None:
            return
        db.add_favorite(user.id, order["item"])
        await query.message.reply_text("Добавлено в избранное.")
        return

    if data.startswith("favorite_order:"):
        _, item = data.split(":", 1)
        user = query.from_user
        if user is None:
            return
        if item not in PRICE_MAP:
            await query.message.reply_text("Товар недоступен.")
            return
        await create_order_for_item(update, context, item, user.id, user.username)
        return

    if not data.startswith("admin:"):
        return

    if query.from_user is None or not is_admin(query.from_user.id):
        await query.answer("Недостаточно прав", show_alert=True)
        return
    if ADMIN_CHAT_ID and query.message and query.message.chat_id != ADMIN_CHAT_ID:
        await query.answer("Недостаточно прав", show_alert=True)
        return

    _, action, order_id = data.split(":", 2)
    db = Database()
    order = db.get_order(int(order_id))

    if action in {"IN_PROGRESS", "DONE", "REJECT"}:
        action_map = {
            "IN_PROGRESS": "IN_PROGRESS",
            "DONE": "DONE",
            "REJECT": "REJECTED",
        }
        new_status = action_map[action]
        if not can_transition(order["status"], new_status):
            await query.answer("Недопустимый переход", show_alert=True)
            return
        if new_status == "IN_PROGRESS":
            updated = db.update_order_status_if(
                int(order_id), "PAID", "IN_PROGRESS"
            )
        elif new_status == "DONE":
            updated = db.update_order_status_if(
                int(order_id), "IN_PROGRESS", "DONE"
            )
        else:
            db.update_order_status(int(order_id), "REJECTED")
            updated = True
        if not updated:
            await query.answer("Статус уже изменен", show_alert=True)
            return
        db.log_order_audit(
            int(order_id),
            query.from_user.id,
            order["status"],
            new_status,
        )
        order = db.get_order(int(order_id))
        await query.message.edit_text(
            order_card_text(order, safe_username(query.from_user.username)),
            parse_mode=ParseMode.HTML,
            reply_markup=query.message.reply_markup,
        )
        return

    if action == "MESSAGE":
        context.chat_data["admin_message_target"] = {
            "user_id": order["user_id"],
            "order_id": order_id,
        }
        await query.message.reply_text("Введите сообщение для пользователя.")
        return

    if action == "RECREATE":
        db.deactivate_payments_for_order(int(order_id))
        payment_id, pay_url = create_payment_link()
        db.create_payment(
            PAYMENT_PROVIDER,
            payment_id,
            int(order_id),
            pay_url,
            order["amount_minor"],
            order["currency"],
        )
        db.attach_payment_to_order(int(order_id), payment_id)
        if can_transition(order["status"], "WAIT_PAY"):
            db.update_order_status(int(order_id), "WAIT_PAY")
        keyboard = InlineKeyboardMarkup(
            [[InlineKeyboardButton("Оплатить", url=pay_url)]]
        )
        await context.bot.send_message(
            chat_id=order["user_id"],
            text=(
                f"<b>Новая ссылка на оплату по заказу #{order_id}</b>\n"
                f"Сумма: {from_minor(order['amount_minor'])} {order['currency']}"
            ),
            parse_mode=ParseMode.HTML,
            reply_markup=keyboard,
        )
        db.log_order_audit(
            int(order_id),
            query.from_user.id,
            order["status"],
            "WAIT_PAY",
            reason="recreate_payment",
        )
        order = db.get_order(int(order_id))
        await query.message.edit_text(
            order_card_text(order, safe_username(query.from_user.username)),
            parse_mode=ParseMode.HTML,
            reply_markup=query.message.reply_markup,
        )


def main() -> None:
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not token:
        raise RuntimeError("TELEGRAM_BOT_TOKEN is not set")

    application = Application.builder().token(token).build()

    application.add_handler(CommandHandler("start", start))
    application.add_handler(CommandHandler("stats", handle_stats))
    application.add_handler(CommandHandler("order", handle_order))
    application.add_handler(CommandHandler("version", handle_version))
    application.add_handler(CommandHandler("diag", handle_diag))
    application.add_handler(CommandHandler("reconcile", handle_reconcile))
    application.add_handler(CallbackQueryHandler(handle_callback))
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text))

    logger.info("Bot started")
    application.run_polling()


if __name__ == "__main__":
    main()
