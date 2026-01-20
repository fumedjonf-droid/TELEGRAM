# TELEGRAM

Telegram бот с ручной оплатой по реквизитам, каталогом и админ‑подтверждением чеков.

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
   export ADMIN_IDS=11111111,22222222
   ```
4. Реквизиты оплаты (только через ENV):
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

## Как работает ручная оплата

1. Пользователь выбирает раздел и товар.
2. Бот показывает реквизиты, сумму и комментарий к переводу.
3. Пользователь отправляет чек/скрин оплаты.
4. Бот пересылает заказ в админ‑чат, админ подтверждает или отклоняет.

## Админ-кнопки в чате

- ✅ Подтвердить оплату → статус `PAID_MANUAL`.
- ❌ Отклонить → статус `REJECTED` + причина.
- 💬 Написать пользователю → ответ админа в личку.
- ✅ Выполнено → статус `DONE`.
