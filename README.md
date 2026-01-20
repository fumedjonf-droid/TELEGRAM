# TELEGRAM

Telegram бот с ручной оплатой по реквизитам, ролями админов и подтверждением чеков.

## Запуск

> Рекомендуемая версия Python: 3.12.

1. Установите зависимости:
   ```bash
   pip install -r requirements.txt
   ```
2. Установите токен:
   ```bash
   export TELEGRAM_BOT_TOKEN=YOUR_TOKEN
   ```
3. Укажите ID админ-чата и админов:
   ```bash
   export ADMIN_CHAT_ID=-1001234567890
   export ADMIN_LOGIN_CODE=123456
   ```
4. Реквизиты оплаты (управляются через БД, но для старта можно установить пустые значения):
   ```bash
   export PAYMENT_CARD_OWNER="Иванов И.И."
   export PAYMENT_CARD_NUMBER="0000 0000 0000 0000"
   export PAYMENT_BANK_NAME="Bank Name"
   export PAYMENT_COMMENT_TEMPLATE="ORDER-{order_id}"
   ```
5. (Опционально) Баннеры поддержки/отзывов через URL:
   ```bash
   export SUPPORT_IMAGE_URL=https://example.com/support.jpg
   export REVIEWS_IMAGE_URL=https://example.com/reviews.jpg
   ```
6. Запуск бота:
   ```bash
   python bot.py
   ```

## Роли и доступ

Роли: `MODERATOR`, `ADMIN`, `OWNER`.

- В админ-группе команды доступны только staff.
- В личке staff должен войти по коду `/admin` (сессия действует 12 часов).

Команды входа:
- `/admin` — ввод кода.
- `/logout` — выход.

## Реквизиты оплаты

Настройки хранятся в БД таблице `payment_settings`:

- `/set_card <номер> <владелец> <банк>`
- `/set_comment <текст>`
- `/pay_on` / `/pay_off`
- `/show_card`

Если оплата выключена, новые заказы не создаются.

## Админ-команды (по ролям)

MODERATOR:
- `/stats day|week|month`
- `/new_users day|week|month`
- `/last_orders N`
- `/top_items day|week|month [donate|software]`
- `/order <id>`
- `/find_user <@username|user_id>`

ADMIN:
- `/broadcast <text>`
- `/broadcast_test <text>`
- `/broadcast_last <N> <text>`
- `/send <user_id> <text>`
- `/give <user_id> <amount> <reason>`
- `/take <user_id> <amount> <reason>`
- `/balance <user_id>`
- `/set_status <order_id> <status>`
- `/set_card`, `/set_comment`, `/pay_on`, `/pay_off`, `/show_card`
- `/diag`

OWNER:
- `/add_staff <user_id> <role>`
- `/remove_staff <user_id>`
- `/set_role <user_id> <role>`
- `/maintenance_on /maintenance_off`

## Ручная оплата (flow)

1. Пользователь выбирает раздел и товар.
2. Бот показывает реквизиты и просит отправить чек.
3. Чек пересылается в админ‑чат.
4. Админ подтверждает или отклоняет оплату.

## Inline-кнопки администратора

- ✅ Подтвердить оплату → статус `PAID_MANUAL`.
- ❌ Отклонить → статус `REJECTED` + причина.
- 💬 Написать пользователю → сообщение в личку.
- ✅ Выполнено → статус `DONE`.
