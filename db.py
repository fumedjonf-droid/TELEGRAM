import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DB_PATH = Path(os.getenv("BOT_DB_PATH", Path(__file__).with_name("bot.db")))


class Database:
    def __init__(self) -> None:
        self.connection = sqlite3.connect(DB_PATH)
        self.connection.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self) -> None:
        with self.connection:
            self.connection.execute(
                """
                CREATE TABLE IF NOT EXISTS users (
                    telegram_id INTEGER PRIMARY KEY,
                    username TEXT,
                    balance REAL DEFAULT 0,
                    total_orders INTEGER DEFAULT 0,
                    total_amount_minor INTEGER DEFAULT 0,
                    ref_code TEXT,
                    ref_from INTEGER
                )
                """
            )
            self.connection.execute(
                """
                CREATE TABLE IF NOT EXISTS orders (
                    order_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    item TEXT NOT NULL,
                    amount_minor INTEGER NOT NULL,
                    currency TEXT NOT NULL DEFAULT 'RUB',
                    status TEXT NOT NULL DEFAULT 'NEW',
                    payment_id TEXT,
                    notified_paid_at TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users (telegram_id)
                )
                """
            )
            self.connection.execute(
                """
                CREATE TABLE IF NOT EXISTS payments (
                    payment_id TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    order_id INTEGER NOT NULL,
                    pay_url TEXT NOT NULL,
                    status TEXT NOT NULL,
                    amount_minor INTEGER NOT NULL,
                    currency TEXT NOT NULL,
                    is_active INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (provider, payment_id),
                    FOREIGN KEY (order_id) REFERENCES orders (order_id)
                )
                """
            )
            self.connection.execute(
                """
                CREATE TABLE IF NOT EXISTS webhook_events (
                    event_id TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (provider, event_id)
                )
                """
            )
            self.connection.execute(
                """
                CREATE TABLE IF NOT EXISTS support_messages (
                    message_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    admin_id INTEGER NOT NULL,
                    text TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )
            self.connection.execute(
                """
                CREATE TABLE IF NOT EXISTS favorites (
                    user_id INTEGER NOT NULL,
                    item TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (user_id, item)
                )
                """
            )
            self.connection.execute(
                """
                CREATE TABLE IF NOT EXISTS order_audit_logs (
                    audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    order_id INTEGER NOT NULL,
                    admin_id INTEGER NOT NULL,
                    old_status TEXT NOT NULL,
                    new_status TEXT NOT NULL,
                    reason TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (order_id) REFERENCES orders (order_id)
                )
                """
            )
            self.connection.execute(
                """
                CREATE TABLE IF NOT EXISTS outbox_messages (
                    outbox_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    message_type TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'PENDING',
                    attempts INTEGER NOT NULL DEFAULT 0,
                    next_attempt_at TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    last_error TEXT
                )
                """
            )
            self.connection.execute(
                """
                CREATE TABLE IF NOT EXISTS service_status (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            self.connection.execute(
                """
                CREATE TABLE IF NOT EXISTS alerts (
                    alert_key TEXT PRIMARY KEY,
                    severity TEXT NOT NULL,
                    last_value TEXT,
                    is_active INTEGER NOT NULL DEFAULT 1,
                    updated_at TEXT NOT NULL
                )
                """
            )
            self.connection.execute(
                """
                CREATE TABLE IF NOT EXISTS payment_ledger (
                    ledger_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    provider TEXT NOT NULL,
                    payment_id TEXT NOT NULL,
                    order_id INTEGER NOT NULL,
                    user_id INTEGER NOT NULL,
                    amount_minor INTEGER NOT NULL,
                    currency TEXT NOT NULL,
                    operation TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    UNIQUE(provider, payment_id, operation)
                )
                """
            )
            self.connection.execute(
                """
                CREATE TABLE IF NOT EXISTS payment_checks (
                    user_id INTEGER NOT NULL,
                    order_id INTEGER NOT NULL,
                    last_checked_at TEXT NOT NULL,
                    PRIMARY KEY (user_id, order_id)
                )
                """
            )
        self._ensure_column("users", "total_amount_minor", "INTEGER NOT NULL DEFAULT 0")
        self._ensure_column("orders", "status", "TEXT NOT NULL DEFAULT 'NEW'")
        self._ensure_column("orders", "payment_id", "TEXT")
        self._ensure_column("orders", "currency", "TEXT NOT NULL DEFAULT 'RUB'")
        self._ensure_column("orders", "amount_minor", "INTEGER NOT NULL DEFAULT 0")
        self._ensure_column("orders", "notified_paid_at", "TEXT")
        self._ensure_column("payments", "provider", "TEXT NOT NULL DEFAULT 'demo'")
        self._ensure_column("payments", "currency", "TEXT NOT NULL DEFAULT 'RUB'")
        self._ensure_column("payments", "is_active", "INTEGER NOT NULL DEFAULT 1")
        self._ensure_column("payments", "amount_minor", "INTEGER NOT NULL DEFAULT 0")

    def _ensure_column(self, table: str, column: str, definition: str) -> None:
        cursor = self.connection.execute(f"PRAGMA table_info({table})")
        existing = {row[1] for row in cursor.fetchall()}
        if column in existing:
            return
        with self.connection:
            self.connection.execute(
                f"ALTER TABLE {table} ADD COLUMN {column} {definition}"
            )

    def upsert_user(self, telegram_id: int, username: str | None) -> None:
        with self.connection:
            self.connection.execute(
                """
                INSERT INTO users (telegram_id, username)
                VALUES (?, ?)
                ON CONFLICT(telegram_id) DO UPDATE SET
                    username=excluded.username
                """,
                (telegram_id, username),
            )

    def get_user(self, telegram_id: int) -> dict[str, Any]:
        cursor = self.connection.execute(
            "SELECT * FROM users WHERE telegram_id = ?", (telegram_id,)
        )
        row = cursor.fetchone()
        if row is None:
            raise ValueError("User not found")
        return dict(row)

    def create_order(self, user_id: int, item: str, amount_minor: int, currency: str) -> int:
        created_at = datetime.now(timezone.utc).isoformat()
        with self.connection:
            cursor = self.connection.execute(
                """
                INSERT INTO orders (user_id, item, amount_minor, currency, status, created_at)
                VALUES (?, ?, ?, ?, 'NEW', ?)
                """,
                (user_id, item, amount_minor, currency, created_at),
            )
        return int(cursor.lastrowid)

    def attach_payment_to_order(self, order_id: int, payment_id: str) -> None:
        with self.connection:
            self.connection.execute(
                "UPDATE orders SET payment_id = ? WHERE order_id = ?",
                (payment_id, order_id),
            )

    def get_order(self, order_id: int) -> dict[str, Any]:
        cursor = self.connection.execute(
            "SELECT * FROM orders WHERE order_id = ?", (order_id,)
        )
        row = cursor.fetchone()
        if row is None:
            raise ValueError("Order not found")
        return dict(row)

    def list_user_orders(self, user_id: int, limit: int = 10) -> list[dict[str, Any]]:
        cursor = self.connection.execute(
            """
            SELECT * FROM orders
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (user_id, limit),
        )
        return [dict(row) for row in cursor.fetchall()]

    def get_order_with_audit(self, order_id: int) -> dict[str, Any]:
        order = self.get_order(order_id)
        cursor = self.connection.execute(
            """
            SELECT admin_id, old_status, new_status, reason, created_at
            FROM order_audit_logs
            WHERE order_id = ?
            ORDER BY created_at DESC
            """,
            (order_id,),
        )
        order["audit_logs"] = [dict(row) for row in cursor.fetchall()]
        return order

    def get_order_by_payment(self, provider: str, payment_id: str) -> dict[str, Any]:
        cursor = self.connection.execute(
            """
            SELECT orders.*
            FROM orders
            JOIN payments ON payments.order_id = orders.order_id
            WHERE payments.provider = ? AND payments.payment_id = ?
            """,
            (provider, payment_id),
        )
        row = cursor.fetchone()
        if row is None:
            raise ValueError("Order not found")
        return dict(row)

    def update_order_status(self, order_id: int, status: str) -> None:
        with self.connection:
            self.connection.execute(
                "UPDATE orders SET status = ? WHERE order_id = ?",
                (status, order_id),
            )

    def update_order_status_if(self, order_id: int, expected: str, new_status: str) -> bool:
        with self.connection:
            cursor = self.connection.execute(
                """
                UPDATE orders
                SET status = ?
                WHERE order_id = ? AND status = ?
                """,
                (new_status, order_id, expected),
            )
        return cursor.rowcount > 0

    def update_order_notified_paid(self, order_id: int) -> None:
        notified_at = datetime.now(timezone.utc).isoformat()
        with self.connection:
            self.connection.execute(
                "UPDATE orders SET notified_paid_at = ? WHERE order_id = ?",
                (notified_at, order_id),
            )

    def increment_user_totals(self, user_id: int, amount_minor: int) -> None:
        with self.connection:
            self.connection.execute(
                """
                UPDATE users
                SET total_orders = total_orders + 1,
                    total_amount_minor = total_amount_minor + ?
                WHERE telegram_id = ?
                """,
                (amount_minor, user_id),
            )

    def create_payment(
        self,
        provider: str,
        payment_id: str,
        order_id: int,
        pay_url: str,
        amount_minor: int,
        currency: str,
        status: str = "WAIT_PAY",
    ) -> None:
        created_at = datetime.now(timezone.utc).isoformat()
        with self.connection:
            self.connection.execute(
                """
                INSERT INTO payments (
                    payment_id, provider, order_id, pay_url, status,
                    amount_minor, currency, is_active, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                """,
                (
                    payment_id,
                    provider,
                    order_id,
                    pay_url,
                    status,
                    amount_minor,
                    currency,
                    created_at,
                    created_at,
                ),
            )

    def update_payment_status(self, provider: str, payment_id: str, status: str) -> None:
        updated_at = datetime.now(timezone.utc).isoformat()
        with self.connection:
            self.connection.execute(
                """
                UPDATE payments
                SET status = ?, updated_at = ?
                WHERE provider = ? AND payment_id = ?
                """,
                (status, updated_at, provider, payment_id),
            )

    def deactivate_payments_for_order(self, order_id: int) -> None:
        updated_at = datetime.now(timezone.utc).isoformat()
        with self.connection:
            self.connection.execute(
                """
                UPDATE payments
                SET is_active = 0, status = 'EXPIRED', updated_at = ?
                WHERE order_id = ? AND is_active = 1
                """,
                (updated_at, order_id),
            )

    def get_payment(self, provider: str, payment_id: str) -> dict[str, Any]:
        cursor = self.connection.execute(
            "SELECT * FROM payments WHERE provider = ? AND payment_id = ?",
            (provider, payment_id),
        )
        row = cursor.fetchone()
        if row is None:
            raise ValueError("Payment not found")
        return dict(row)

    def get_payment_for_order(self, order_id: int) -> dict[str, Any] | None:
        cursor = self.connection.execute(
            """
            SELECT * FROM payments
            WHERE order_id = ? AND is_active = 1
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (order_id,),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return dict(row)

    def record_webhook_event(self, provider: str, event_id: str) -> bool:
        created_at = datetime.now(timezone.utc).isoformat()
        try:
            with self.connection:
                self.connection.execute(
                    """
                    INSERT INTO webhook_events (provider, event_id, created_at)
                    VALUES (?, ?, ?)
                    """,
                    (provider, event_id, created_at),
                )
        except sqlite3.IntegrityError:
            return False
        return True

    def log_support_message(self, user_id: int, admin_id: int, text: str) -> None:
        created_at = datetime.now(timezone.utc).isoformat()
        with self.connection:
            self.connection.execute(
                """
                INSERT INTO support_messages (user_id, admin_id, text, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (user_id, admin_id, text, created_at),
            )

    def can_check_payment(self, user_id: int, order_id: int, cooldown_seconds: int) -> bool:
        now = datetime.now(timezone.utc)
        cursor = self.connection.execute(
            """
            SELECT last_checked_at FROM payment_checks
            WHERE user_id = ? AND order_id = ?
            """,
            (user_id, order_id),
        )
        row = cursor.fetchone()
        if row:
            last = datetime.fromisoformat(row[0])
            if (now - last).total_seconds() < cooldown_seconds:
                return False
        with self.connection:
            self.connection.execute(
                """
                INSERT INTO payment_checks (user_id, order_id, last_checked_at)
                VALUES (?, ?, ?)
                ON CONFLICT(user_id, order_id) DO UPDATE SET
                    last_checked_at=excluded.last_checked_at
                """,
                (user_id, order_id, now.isoformat()),
            )
        return True

    def get_alert(self, alert_key: str) -> dict[str, Any] | None:
        cursor = self.connection.execute(
            "SELECT * FROM alerts WHERE alert_key = ?",
            (alert_key,),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return dict(row)

    def upsert_alert(
        self, alert_key: str, severity: str, last_value: str | None, is_active: bool
    ) -> None:
        updated_at = datetime.now(timezone.utc).isoformat()
        with self.connection:
            self.connection.execute(
                """
                INSERT INTO alerts (alert_key, severity, last_value, is_active, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(alert_key) DO UPDATE SET
                    severity=excluded.severity,
                    last_value=excluded.last_value,
                    is_active=excluded.is_active,
                    updated_at=excluded.updated_at
                """,
                (alert_key, severity, last_value, int(is_active), updated_at),
            )

    def append_ledger_entry(
        self,
        provider: str,
        payment_id: str,
        order_id: int,
        user_id: int,
        amount_minor: int,
        currency: str,
        operation: str,
    ) -> None:
        created_at = datetime.now(timezone.utc).isoformat()
        with self.connection:
            self.connection.execute(
                """
                INSERT OR IGNORE INTO payment_ledger (
                    provider, payment_id, order_id, user_id, amount_minor, currency, operation, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (provider, payment_id, order_id, user_id, amount_minor, currency, operation, created_at),
            )

    def get_user_totals(self, user_id: int) -> dict[str, Any]:
        cursor = self.connection.execute(
            """
            SELECT COUNT(*) as order_count, COALESCE(SUM(amount_minor), 0) as paid_sum
            FROM payment_ledger
            WHERE user_id = ? AND operation = 'SUCCEEDED'
            """,
            (user_id,),
        )
        row = cursor.fetchone()
        return {"order_count": row[0], "paid_sum": row[1]}

    def cleanup_outbox(self, older_than_days: int) -> int:
        with self.connection:
            cursor = self.connection.execute(
                """
                DELETE FROM outbox_messages
                WHERE status = 'SENT' AND datetime(created_at) < datetime('now', ?)
                """,
                (f"-{older_than_days} days",),
            )
        return cursor.rowcount

    def cleanup_webhook_events(self, older_than_days: int) -> int:
        with self.connection:
            cursor = self.connection.execute(
                """
                DELETE FROM webhook_events
                WHERE datetime(created_at) < datetime('now', ?)
                """,
                (f"-{older_than_days} days",),
            )
        return cursor.rowcount

    def add_favorite(self, user_id: int, item: str) -> None:
        created_at = datetime.now(timezone.utc).isoformat()
        with self.connection:
            self.connection.execute(
                """
                INSERT OR IGNORE INTO favorites (user_id, item, created_at)
                VALUES (?, ?, ?)
                """,
                (user_id, item, created_at),
            )

    def list_favorites(self, user_id: int) -> list[str]:
        cursor = self.connection.execute(
            "SELECT item FROM favorites WHERE user_id = ? ORDER BY created_at DESC",
            (user_id,),
        )
        return [row[0] for row in cursor.fetchall()]

    def log_order_audit(
        self,
        order_id: int,
        admin_id: int,
        old_status: str,
        new_status: str,
        reason: str | None = None,
    ) -> None:
        created_at = datetime.now(timezone.utc).isoformat()
        with self.connection:
            self.connection.execute(
                """
                INSERT INTO order_audit_logs (order_id, admin_id, old_status, new_status, reason, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (order_id, admin_id, old_status, new_status, reason, created_at),
            )

    def enqueue_outbox(self, message_type: str, payload: dict[str, Any]) -> None:
        now = datetime.now(timezone.utc).isoformat()
        with self.connection:
            self.connection.execute(
                """
                INSERT INTO outbox_messages (message_type, payload, status, attempts, next_attempt_at, created_at)
                VALUES (?, ?, 'PENDING', 0, ?, ?)
                """,
                (message_type, json.dumps(payload), now, now),
            )

    def get_pending_outbox(self, limit: int = 10) -> list[dict[str, Any]]:
        now = datetime.now(timezone.utc).isoformat()
        cursor = self.connection.execute(
            """
            SELECT * FROM outbox_messages
            WHERE status = 'PENDING' AND next_attempt_at <= ?
            ORDER BY outbox_id ASC
            LIMIT ?
            """,
            (now, limit),
        )
        return [dict(row) for row in cursor.fetchall()]

    def get_outbox_size(self) -> int:
        cursor = self.connection.execute(
            "SELECT COUNT(*) FROM outbox_messages WHERE status = 'PENDING'"
        )
        return int(cursor.fetchone()[0])

    def count_active_payments(self) -> int:
        cursor = self.connection.execute(
            "SELECT COUNT(*) FROM payments WHERE is_active = 1 AND status = 'WAIT_PAY'"
        )
        return int(cursor.fetchone()[0])

    def mark_outbox_sent(self, outbox_id: int) -> None:
        with self.connection:
            self.connection.execute(
                "UPDATE outbox_messages SET status = 'SENT' WHERE outbox_id = ?",
                (outbox_id,),
            )

    def mark_outbox_failed(self, outbox_id: int, error: str, next_attempt_at: str) -> None:
        with self.connection:
            self.connection.execute(
                """
                UPDATE outbox_messages
                SET attempts = attempts + 1,
                    last_error = ?,
                    next_attempt_at = ?
                WHERE outbox_id = ?
                """,
                (error[:500], next_attempt_at, outbox_id),
            )

    def expire_old_payments(self, older_than_minutes: int) -> list[dict[str, Any]]:
        cutoff = datetime.now(timezone.utc).timestamp() - older_than_minutes * 60
        cutoff_iso = datetime.fromtimestamp(cutoff, tz=timezone.utc).isoformat()
        with self.connection:
            cursor = self.connection.execute(
                """
                SELECT payments.payment_id, payments.order_id, orders.user_id
                FROM payments
                JOIN orders ON orders.order_id = payments.order_id
                WHERE payments.is_active = 1 AND payments.created_at < ?
                """,
                (cutoff_iso,),
            )
            rows = [dict(row) for row in cursor.fetchall()]
            self.connection.execute(
                """
                UPDATE payments
                SET is_active = 0, status = 'EXPIRED', updated_at = ?
                WHERE is_active = 1 AND created_at < ?
                """,
                (datetime.now(timezone.utc).isoformat(), cutoff_iso),
            )
            self.connection.execute(
                """
                UPDATE orders
                SET status = 'EXPIRED'
                WHERE order_id IN (
                    SELECT order_id FROM payments WHERE is_active = 0 AND status = 'EXPIRED'
                ) AND status = 'WAIT_PAY'
                """,
            )
        return rows

    def set_service_status(self, key: str, value: str) -> None:
        updated_at = datetime.now(timezone.utc).isoformat()
        with self.connection:
            self.connection.execute(
                """
                INSERT INTO service_status (key, value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                    value=excluded.value,
                    updated_at=excluded.updated_at
                """,
                (key, value, updated_at),
            )

    def get_service_status(self, key: str) -> dict[str, Any] | None:
        cursor = self.connection.execute(
            "SELECT key, value, updated_at FROM service_status WHERE key = ?",
            (key,),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return dict(row)

    def get_today_stats(self) -> dict[str, Any]:
        today = datetime.now(timezone.utc).date().isoformat()
        cursor = self.connection.execute(
            """
            SELECT COUNT(*) as paid_count, COALESCE(SUM(amount_minor), 0) as paid_sum
            FROM payment_ledger
            WHERE operation = 'SUCCEEDED' AND date(created_at) = ?
            """,
            (today,),
        )
        row = cursor.fetchone()
        return {"paid_count": row[0], "paid_sum": row[1]}

    def get_stats(self, days: int) -> dict[str, Any]:
        cursor = self.connection.execute(
            """
            SELECT COUNT(*) as order_count, COALESCE(SUM(amount_minor), 0) as paid_sum
            FROM payment_ledger
            WHERE operation = 'SUCCEEDED' AND datetime(created_at) >= datetime('now', ?)
            """,
            (f"-{days} days",),
        )
        row = cursor.fetchone()
        suspicious_cursor = self.connection.execute(
            "SELECT COUNT(*) FROM payments WHERE status = 'SUSPICIOUS'"
        )
        suspicious = int(suspicious_cursor.fetchone()[0])
        top_cursor = self.connection.execute(
            """
            SELECT item, COUNT(*) as count
            FROM orders
            WHERE datetime(created_at) >= datetime('now', ?)
            GROUP BY item
            ORDER BY count DESC
            LIMIT 5
            """,
            (f"-{days} days",),
        )
        top_items = [dict(row) for row in top_cursor.fetchall()]
        return {
            "order_count": row[0],
            "paid_sum": row[1],
            "suspicious_count": suspicious,
            "top_items": top_items,
        }
