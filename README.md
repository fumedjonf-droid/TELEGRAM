# TELEGRAM

Минимальный пример Telegram Bot + WebApp + Backend для потока заказа: оплата → подтверждение → отправка файла.

## Структура

- `backend/` — FastAPI + SQLite (создание заказа, хранение статусов).
- `bot/` — python-telegram-bot (кнопка WebApp, обработка callback, отправка файла).
- `webapp/` — статическая WebApp (имитация оплаты, отправка заказа на backend).

## Переменные окружения

Общие:

- `BOT_TOKEN` — токен Telegram-бота.
- `ADMIN_GROUP_ID` — ID админ-группы (например, `-1001234567890`).

Backend:

- `BOT_TOKEN` — используется для отправки сообщения в админ-группу.
- `ADMIN_GROUP_ID` — чат, куда уходят заявки.

Bot:

- `BACKEND_URL` — адрес backend (например, `http://localhost:8000`).
- `WEBAPP_URL` — URL WebApp (https).
- `FILE_ID` — `file_id` документа, который бот отправляет после подтверждения.

## Запуск

### Backend

```bash
python -m venv .venv
source .venv/bin/activate
pip install fastapi uvicorn requests pydantic
uvicorn backend.main:app --reload --port 8000
```

### Bot

```bash
python -m venv .venv
source .venv/bin/activate
pip install python-telegram-bot requests
python bot/main.py
```

### WebApp

Разместите `webapp/index.html` на HTTPS-хостинге. Для локального теста можно проксировать через backend.

## Поток

1. Пользователь открывает WebApp по кнопке в боте.
2. WebApp вызывает `POST /order` → backend создаёт заказ и отправляет сообщение в админ-группу.
3. Админ нажимает кнопку → бот проверяет права, меняет статус и отправляет файл.
