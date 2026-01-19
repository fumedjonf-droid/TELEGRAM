# TELEGRAM

Telegram бот с меню, каталогом, оплатой через pay_url и webhook-уведомлениями.

## Запуск

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
4. Feature flags (без деплоя):
   ```bash
   export AUTO_PAYMENTS=true
   export MANUAL_MODE=false
   export MAINTENANCE_MODE=false
   export PAYMENT_PROVIDER=demo
   export PAYMENT_CHECK_COOLDOWN=20
   export ADMIN_ACTION_MAX_AGE_DAYS=30
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

## Webhook оплаты

1. Установите секрет для подписи:
   ```bash
   export PAYMENT_WEBHOOK_SECRET=YOUR_SECRET
   ```
2. (Опционально) Логи webhook:
   ```bash
   export WEBHOOK_LOG_PATH=webhook.log
   ```
3. Ограничения и allowlist:
   ```bash
   export WEBHOOK_RATE_LIMIT_PER_MIN=120
   export WEBHOOK_ALLOWED_IPS=1.2.3.4,5.6.7.8
   export WEBHOOK_MAX_BODY_BYTES=1048576
   ```
4. Запуск сервера webhook:
   ```bash
   uvicorn webhook:app --host 0.0.0.0 --port 8080
   ```
5. Провайдер оплаты должен отправлять POST запросы на:
   ```
   http://<host>:8080/webhook/payment
   ```
   Заголовок `X-Signature` должен содержать HMAC-SHA256 подпись тела запроса.

## Воркер уведомлений (outbox)

1. Запуск воркера:
   ```bash
   python worker.py
   ```
2. Одноразовый прогон:
   ```bash
   python worker.py --once
   ```
3. Истечение оплат:
   ```bash
   python worker.py --expire-minutes 30
   ```
4. Очистка и алерты:
   ```bash
   export OUTBOX_ALERT_THRESHOLD=50
   export OUTBOX_RETENTION_DAYS=7
   export WEBHOOK_RETENTION_DAYS=60
   export OUTBOX_MAX_ATTEMPTS=5
   ```

## Админ-команды

- `/stats [today|week]` — статистика за период.
- `/order <id>` — карточка заказа с аудитом.
- `/version` — версия бота.
- `/diag` — быстрая диагностика.
- `/reconcile today` — сверка платежей (если доступен API провайдера).
- `/requeue_dead` — вернуть DEAD задачи в очередь (admin).

## Definition of Done

### SLO/стабильность
- Webhook отвечает `200 OK` за ≤ 1–2 секунды (внутри только БД, без Telegram).
- Worker обрабатывает outbox без роста очереди при нормальной нагрузке.

### Гарантии идемпотентности
- Повтор webhook не меняет состояние и не шлёт повторные уведомления.
- Уникальные ключи в БД: `webhook_events(provider,event_id)` и `payments(provider,payment_id)`.

### Безопасность
- Секреты webhook — только через env (`PAYMENT_WEBHOOK_SECRET`).
- Allowlist/rate-limit/size-limit включены и задокументированы.
- Логи не содержат секретов и полных платёжных данных (payload обрезается).

### Данные и бэкапы
- Есть расписание бэкапов БД и тест восстановления (restore test).
- Указано, где лежат бэкапы и сколько хранятся.

### Роли и доступ
- Список `ADMIN_IDS` обязателен, кнопки работают только для админов.
- Аудит: кто нажал, когда, что поменял (order audit log).

### Статусы
- Заказы: `NEW` → `WAIT_PAY` → `PAID` → `IN_PROGRESS` → `DONE`.
- Дополнительно: `WAIT_PAY` → `EXPIRED`, `PAID` → `REFUNDED`, любой → `REJECTED`.
- Платежи: `WAIT_PAY`, `SUCCEEDED`, `FAILED`, `EXPIRED`, `CANCELED`, `SUSPICIOUS`.

### Админ-доступ и кнопки
- Доступ к админ-действиям имеют только `ADMIN_IDS`.
- Кнопки в админ-группе: `IN_PROGRESS`, `DONE`, `REJECT`, `MESSAGE USER`, `RECREATE PAYMENT`.

### Алерты в админ-группу
- Неверная подпись webhook.
- Неизвестный `payment_id`.
- Несовпадение суммы/валюты (SUSPICIOUS).
- Оплата по закрытому заказу (DONE/REJECTED).

### Восстановление после сбоев
- Перезапуск воркера: `python worker.py` (обработает очередь outbox).
- Очистка outbox по необходимости: удалить записи со статусом `SENT` или `FAILED`.
- Резервная копия: бэкап файла базы `bot.db` (или `BOT_DB_PATH`).

## Приёмка (checklist)

- ✅ Оплата успешна → `PAID` → уведомления пользователю и админам через outbox.
- ✅ Повтор webhook → уведомления не дублируются (idempotency + `notified_paid_at`).
- ✅ Несовпадение суммы → `SUSPICIOUS` + alert в админ-группу.
- ✅ Закрытый заказ + webhook → alert, статусы не меняются.
- ✅ Пересоздание оплаты → старая `inactive`, новая `active`.
- ✅ Expire оплаты → пользователь получает «время вышло».
- ✅ Воркер выключен → outbox растёт; после перезапуска — догоняет отправку.
- ✅ `SUCCEEDED` → order=`PAID`, payment=`SUCCEEDED`.
- ✅ Повтор `SUCCEEDED` → нет дублей.
- ✅ Unknown `payment_id` → alert в админ-группу.
- ✅ Outbox копится при выключенном worker и разгрeбается после включения.
- ✅ Ретраи Telegram работают (временная ошибка → последующий успех).
- ✅ Не-админ нажимает кнопки → отказ.
- ✅ Два админа одновременно → один успешен, второй видит «статус уже изменён».
- ✅ Карточка заказа в группе обновляется (edit), видно кто изменил.
- ✅ “Ответить пользователю” отправляет и логируется.
- ✅ Вложения поддержки пересылаются и сохраняются (message_id).
- ✅ Восстановление сервиса с нуля по инструкции (env + миграции + запуск).
- ✅ Восстановление из бэкапа подтверждено.

## Smoke-тесты

```bash
python scripts/smoke_tests.py
```

## Нагрузочный мини-тест

```bash
python scripts/load_test.py
```

## Go-Live criteria

Перед запуском в продакшн должно быть подтверждено:

- ✅ Webhook endpoint протестирован на реальных событиях провайдера.
- ✅ Тест “оплата → PAID → DONE” пройден минимум 5 раз подряд.
- ✅ Проверены 2–3 подозрительных сценария (mismatch/unknown/closed order).
- ✅ Протестирован restore из бэкапа.
- ✅ Админ-группа настроена, бот имеет нужные права.
- ✅ Контакты/поддержка/ссылки актуальны.

## Rollback plan

Если после релиза что-то пошло не так:

- Отключить приём webhook: выставить env-флаг (например `WEBHOOK_DISABLED=1`) и отклонять запросы на уровне ingress или сервиса.
- Временно перевести оплату в ручной режим: отключить создание новых pay_url и принимать оплату через поддержку.
- Остановить worker: `python worker.py --once` (не запускать в цикле) или остановить сервис systemd/pm2/docker.
- Очистка outbox безопасно: удалить записи со статусом `SENT`; для `FAILED` вернуть в `PENDING` после устранения причины.

## Контроль денег

- Ежедневная сверка: сумма платежей провайдера vs сумма `PAID` в БД.
- Отдельный список для `SUSPICIOUS/UNKNOWN` событий.
- Команда `/reconcile today` (если есть доступ к API провайдера) для автоматизированной сверки.

## Incident Severity Levels (SEV)

| Уровень | Симптомы | Действия |
| --- | --- | --- |
| SEV1 | Оплата проходит, но заказ не `PAID` / webhook падает | Немедленный rollback, отключить webhook, алерт всем |
| SEV2 | Задержка outbox/worker | Перезапуск worker, проверка очереди |
| SEV3 | Проблема поддержки/кнопок | Фикс без остановки сервиса |

## On-call checklist (10 минут)

- Проверить `/healthz` у webhook сервиса.
- Проверить очередь outbox (`outbox_messages`) и размер backlog.
- Проверить последние webhook events в БД.
- Перезапустить worker.
- Включить ручной режим оплат (feature flag/отключение pay_url).

## Data retention policy

- `webhook_events` хранить 30–90 дней.
- `outbox_messages` удалять после `SENT`.
- `order_audit_logs` и `orders` хранить не менее 1 года.

## Versioning + changelog

- Версия сервиса доступна в `/healthz` (webhook) и `/version` (бот).
- Правила обновлений: миграции БД перед деплоем.

## Настройка ссылок и баннеров

URL, цены и пути к баннерам настраиваются в `bot.py`.

## Настройка базы

Можно переопределить путь к базе:
```bash
export BOT_DB_PATH=/path/to/bot.db
```

## Восстановление после сбоев (пошагово)

### Как понять, что упал worker
- Проверить отсутствие обработки outbox (рост таблицы `outbox_messages`).
- Алерт/метрика: backlog outbox > 0 длительное время.

### Как перезапустить worker
- Запустить вручную: `python worker.py`.
- Если используется systemd/pm2/docker — перезапустить соответствующий сервис/контейнер.

### Что делать, если webhook валится по подписи
- Проверить `PAYMENT_WEBHOOK_SECRET` в окружении и у провайдера.
- Сравнить формат подписи (`X-Signature`) и алгоритм HMAC-SHA256.
- После исправления — повторить тестовый запрос от провайдера.

### Что делать, если outbox “залип”
- Перезапустить worker.
- Проверить записи `FAILED` и `last_error`.
- Разрешено безопасно ретраить: сбросить `status` в `PENDING` или дождаться `next_attempt_at`.
