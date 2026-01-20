import os
import sqlite3
import time
from pathlib import Path
from typing import Any

DB_PATH = Path(os.getenv("BOT_DB_PATH", Path(__file__).with_name("bot.db")))

ROLE_ORDER = {"MODERATOR": 1, "ADMIN": 2, "OWNER": 3}

ALLOWED_TRANSITIONS = {
    "NEW": {"WAIT_PAY_MANUAL", "REJECTED"},
    "WAIT_PAY_MANUAL": {"WAIT_ADMIN_CONFIRM", "REJECTED"},
    "WAIT_ADMIN_CONFIRM": {"PAID_MANUAL", "REJECTED"},
    "PAID_MANUAL": {"IN_PROGRESS", "DONE", "REJECTED"},
    "IN_PROGRESS": {"DONE", "REJECTED"},
    "DONE": set(),
    "REJECTED": set(),
}


class Database:
    def __init__(self) -> None:
        self.connection = sqlite3.connect(DB_PATH)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.execute("PRAGMA synchronous=NORMAL")
        self.connection.execute("PRAGMA busy_timeout=3000")
        self._init_schema()

    def _now_ts(self) -> int:
        return int(time.time())

    def _init_schema(self) -> None:
        with self.connection:
            self.connection.execute(
                """
                CREATE TABLE IF NOT EXISTS users (
                    telegram_id INTEGER PRIMARY KEY,
                    username TEXT,
                    balance_minor INTEGER DEFAULT 0,
                    created_at_ts INTEGER NOT NULL,
                    last_active_ts INTEGER NOT NULL
                )
                """
            )
            self.connection.execute(
                """
                CREATE TABLE IF NOT EXISTS staff (
                    user_id INTEGER PRIMARY KEY,
                    role TEXT NOT NULL,
                    added_by INTEGER,
                    created_at_ts INTEGER NOT NULL,
                    is_active INTEGER NOT NULL DEFAULT 1
                )
                """
            )
            self.connection.execute(
                """
                CREATE TABLE IF NOT EXISTS admin_sessions (
                    user_id INTEGER PRIMARY KEY,
                    expires_at_ts INTEGER NOT NULL
                )
                """
            )
            self.connection.execute(
                """
                CREATE TABLE IF NOT EXISTS payment_settings (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    enabled INTEGER NOT NULL,
                    card_number TEXT,
                    card_owner TEXT,
                    bank_name TEXT,
                    comment_template TEXT,
                    updated_by INTEGER,
                    updated_at_ts INTEGER NOT NULL
                )
                """
            )
            self.connection.execute(
                """
                CREATE TABLE IF NOT EXISTS orders (
                    order_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    username TEXT,
                    section TEXT NOT NULL,
                    game TEXT,
                    item_name TEXT NOT NULL,
                    amount_minor INTEGER NOT NULL,
                    player_id TEXT,
                    status TEXT NOT NULL,
                    receipt_file_id TEXT,
                    created_at_ts INTEGER NOT NULL,
                    updated_at_ts INTEGER NOT NULL
                )
                """
            )
            self.connection.execute(
                """
                CREATE TABLE IF NOT EXISTS order_status_logs (
                    log_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    order_id INTEGER NOT NULL,
                    old_status TEXT NOT NULL,
                    new_status TEXT NOT NULL,
                    admin_id INTEGER,
                    reason TEXT,
                    created_at_ts INTEGER NOT NULL
                )
                """
            )
            self.connection.execute(
                """
                CREATE TABLE IF NOT EXISTS balance_ledger (
                    ledger_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    delta_minor INTEGER NOT NULL,
                    reason TEXT NOT NULL,
                    order_id INTEGER,
                    admin_id INTEGER,
                    created_at_ts INTEGER NOT NULL
                )
                """
            )
            self.connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_orders_user_created
                ON orders(user_id, created_at_ts)
                """
            )
            self.connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_orders_created
                ON orders(created_at_ts)
                """
            )

    def upsert_user(self, telegram_id: int, username: str | None) -> None:
        now_ts = self._now_ts()
        with self.connection:
            self.connection.execute(
                """
                INSERT INTO users (telegram_id, username, created_at_ts, last_active_ts)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(telegram_id) DO UPDATE SET
                    username=excluded.username,
                    last_active_ts=excluded.last_active_ts
                """,
                (telegram_id, username, now_ts, now_ts),
            )

    def get_user(self, telegram_id: int) -> dict[str, Any]:
        cursor = self.connection.execute(
            "SELECT * FROM users WHERE telegram_id = ?", (telegram_id,)
        )
        row = cursor.fetchone()
        if row is None:
            raise ValueError("User not found")
        return dict(row)

    def list_users_active_since(self, since_ts: int) -> list[dict[str, Any]]:
        cursor = self.connection.execute(
            """
            SELECT * FROM users
            WHERE last_active_ts >= ?
            ORDER BY last_active_ts DESC
            """,
            (since_ts,),
        )
        return [dict(row) for row in cursor.fetchall()]

    def get_staff(self, user_id: int) -> dict[str, Any] | None:
        cursor = self.connection.execute(
            "SELECT * FROM staff WHERE user_id = ? AND is_active = 1",
            (user_id,),
        )
        row = cursor.fetchone()
        return dict(row) if row else None

    def set_staff(self, user_id: int, role: str, added_by: int) -> None:
        now_ts = self._now_ts()
        with self.connection:
            self.connection.execute(
                """
                INSERT INTO staff (user_id, role, added_by, created_at_ts, is_active)
                VALUES (?, ?, ?, ?, 1)
                ON CONFLICT(user_id) DO UPDATE SET
                    role=excluded.role,
                    added_by=excluded.added_by,
                    created_at_ts=excluded.created_at_ts,
                    is_active=1
                """,
                (user_id, role, added_by, now_ts),
            )

    def deactivate_staff(self, user_id: int) -> None:
        with self.connection:
            self.connection.execute(
                "UPDATE staff SET is_active = 0 WHERE user_id = ?",
                (user_id,),
            )

    def is_staff(self, user_id: int) -> bool:
        return self.get_staff(user_id) is not None

    def has_role(self, user_id: int, min_role: str) -> bool:
        staff = self.get_staff(user_id)
        if not staff:
            return False
        return ROLE_ORDER.get(staff["role"], 0) >= ROLE_ORDER.get(min_role, 0)

    def create_session(self, user_id: int, expires_at_ts: int) -> None:
        with self.connection:
            self.connection.execute(
                """
                INSERT INTO admin_sessions (user_id, expires_at_ts)
                VALUES (?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    expires_at_ts=excluded.expires_at_ts
                """,
                (user_id, expires_at_ts),
            )

    def clear_session(self, user_id: int) -> None:
        with self.connection:
            self.connection.execute(
                "DELETE FROM admin_sessions WHERE user_id = ?",
                (user_id,),
            )

    def session_valid(self, user_id: int) -> bool:
        cursor = self.connection.execute(
            "SELECT expires_at_ts FROM admin_sessions WHERE user_id = ?",
            (user_id,),
        )
        row = cursor.fetchone()
        if not row:
            return False
        return int(row[0]) >= self._now_ts()

    def get_payment_settings(self) -> dict[str, Any]:
        cursor = self.connection.execute("SELECT * FROM payment_settings WHERE id = 1")
        row = cursor.fetchone()
        if row:
            return dict(row)
        now_ts = self._now_ts()
        default = {
            "id": 1,
            "enabled": 1,
            "card_number": None,
            "card_owner": None,
            "bank_name": None,
            "comment_template": "ORDER-{order_id}",
            "updated_by": None,
            "updated_at_ts": now_ts,
        }
        with self.connection:
            self.connection.execute(
                """
                INSERT INTO payment_settings (
                    id, enabled, card_number, card_owner, bank_name,
                    comment_template, updated_by, updated_at_ts
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    default["id"],
                    default["enabled"],
                    default["card_number"],
                    default["card_owner"],
                    default["bank_name"],
                    default["comment_template"],
                    default["updated_by"],
                    default["updated_at_ts"],
                ),
            )
        return default

    def update_payment_settings(
        self,
        enabled: int | None = None,
        card_number: str | None = None,
        card_owner: str | None = None,
        bank_name: str | None = None,
        comment_template: str | None = None,
        updated_by: int | None = None,
    ) -> None:
        current = self.get_payment_settings()
        now_ts = self._now_ts()
        payload = {
            "enabled": current["enabled"] if enabled is None else enabled,
            "card_number": current["card_number"] if card_number is None else card_number,
            "card_owner": current["card_owner"] if card_owner is None else card_owner,
            "bank_name": current["bank_name"] if bank_name is None else bank_name,
            "comment_template": (
                current["comment_template"] if comment_template is None else comment_template
            ),
            "updated_by": updated_by,
            "updated_at_ts": now_ts,
        }
        with self.connection:
            self.connection.execute(
                """
                UPDATE payment_settings
                SET enabled = ?, card_number = ?, card_owner = ?, bank_name = ?,
                    comment_template = ?, updated_by = ?, updated_at_ts = ?
                WHERE id = 1
                """,
                (
                    payload["enabled"],
                    payload["card_number"],
                    payload["card_owner"],
                    payload["bank_name"],
                    payload["comment_template"],
                    payload["updated_by"],
                    payload["updated_at_ts"],
                ),
            )

    def create_order(
        self,
        user_id: int,
        username: str | None,
        section: str,
        game: str | None,
        item_name: str,
        amount_minor: int,
        player_id: str | None = None,
        status: str = "NEW",
    ) -> int:
        now_ts = self._now_ts()
        with self.connection:
            cursor = self.connection.execute(
                """
                INSERT INTO orders (
                    user_id, username, section, game, item_name, amount_minor,
                    player_id, status, created_at_ts, updated_at_ts
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    user_id,
                    username,
                    section,
                    game,
                    item_name,
                    amount_minor,
                    player_id,
                    status,
                    now_ts,
                    now_ts,
                ),
            )
        return int(cursor.lastrowid)

    def get_order(self, order_id: int) -> dict[str, Any]:
        cursor = self.connection.execute(
            "SELECT * FROM orders WHERE order_id = ?",
            (order_id,),
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
            ORDER BY created_at_ts DESC
            LIMIT ?
            """,
            (user_id, limit),
        )
        return [dict(row) for row in cursor.fetchall()]

    def list_last_orders(self, limit: int = 10) -> list[dict[str, Any]]:
        cursor = self.connection.execute(
            """
            SELECT * FROM orders
            ORDER BY created_at_ts DESC
            LIMIT ?
            """,
            (limit,),
        )
        return [dict(row) for row in cursor.fetchall()]

    def list_new_users(self, since_ts: int, limit: int = 20) -> list[dict[str, Any]]:
        cursor = self.connection.execute(
            """
            SELECT * FROM users
            WHERE created_at_ts >= ?
            ORDER BY created_at_ts DESC
            LIMIT ?
            """,
            (since_ts, limit),
        )
        return [dict(row) for row in cursor.fetchall()]

    def update_order_player_id(self, order_id: int, player_id: str) -> None:
        now_ts = self._now_ts()
        with self.connection:
            self.connection.execute(
                """
                UPDATE orders
                SET player_id = ?, updated_at_ts = ?
                WHERE order_id = ?
                """,
                (player_id, now_ts, order_id),
            )

    def update_order_receipt(self, order_id: int, file_id: str) -> bool:
        now_ts = self._now_ts()
        with self.connection:
            cursor = self.connection.execute(
                """
                UPDATE orders
                SET receipt_file_id = ?, status = 'WAIT_ADMIN_CONFIRM', updated_at_ts = ?
                WHERE order_id = ? AND status = 'WAIT_PAY_MANUAL'
                """,
                (file_id, now_ts, order_id),
            )
        return cursor.rowcount > 0

    def can_transition(self, current: str, new_status: str) -> bool:
        return new_status in ALLOWED_TRANSITIONS.get(current, set())

    def transition_order_status(
        self,
        order_id: int,
        expected: str,
        new_status: str,
        admin_id: int | None = None,
        reason: str | None = None,
    ) -> bool:
        if not self.can_transition(expected, new_status):
            return False
        now_ts = self._now_ts()
        with self.connection:
            cursor = self.connection.execute(
                """
                UPDATE orders
                SET status = ?, updated_at_ts = ?
                WHERE order_id = ? AND status = ?
                """,
                (new_status, now_ts, order_id, expected),
            )
            if cursor.rowcount > 0:
                self.connection.execute(
                    """
                    INSERT INTO order_status_logs (
                        order_id, old_status, new_status, admin_id, reason, created_at_ts
                    )
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (order_id, expected, new_status, admin_id, reason, now_ts),
                )
        return cursor.rowcount > 0

    def cancel_order(self, order_id: int) -> bool:
        now_ts = self._now_ts()
        with self.connection:
            cursor = self.connection.execute(
                """
                UPDATE orders
                SET status = 'REJECTED', updated_at_ts = ?
                WHERE order_id = ? AND status IN ('NEW', 'WAIT_PAY_MANUAL')
                """,
                (now_ts, order_id),
            )
        return cursor.rowcount > 0

    def get_user_stats(self, user_id: int) -> dict[str, Any]:
        cursor = self.connection.execute(
            """
            SELECT COUNT(*) as order_count,
                   COALESCE(SUM(amount_minor), 0) as paid_sum
            FROM orders
            WHERE user_id = ? AND status IN ('PAID_MANUAL', 'IN_PROGRESS', 'DONE')
            """,
            (user_id,),
        )
        row = cursor.fetchone()
        return {"order_count": row[0], "paid_sum": row[1]}

    def stats_for_period(self, start_ts: int, end_ts: int) -> dict[str, Any]:
        cursor = self.connection.execute(
            """
            SELECT COUNT(*) as order_count,
                   COALESCE(SUM(CASE WHEN status IN ('PAID_MANUAL','IN_PROGRESS','DONE') THEN amount_minor END), 0) as paid_sum,
                   COALESCE(SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END), 0) as rejected
            FROM orders
            WHERE created_at_ts BETWEEN ? AND ?
            """,
            (start_ts, end_ts),
        )
        row = cursor.fetchone()
        users_cursor = self.connection.execute(
            """
            SELECT COUNT(*) FROM users
            WHERE created_at_ts BETWEEN ? AND ?
            """,
            (start_ts, end_ts),
        )
        new_users = int(users_cursor.fetchone()[0])
        active_cursor = self.connection.execute(
            """
            SELECT COUNT(*) FROM users
            WHERE last_active_ts BETWEEN ? AND ?
            """,
            (start_ts, end_ts),
        )
        active_users = int(active_cursor.fetchone()[0])
        avg_check = 0
        if row[0] and row[1]:
            avg_check = int(row[1] / max(row[0], 1))
        return {
            "order_count": row[0],
            "paid_sum": row[1],
            "rejected": row[2],
            "new_users": new_users,
            "active_users": active_users,
            "avg_check": avg_check,
        }

    def top_items(self, start_ts: int, end_ts: int, section: str | None = None) -> list[dict[str, Any]]:
        params: list[Any] = [start_ts, end_ts]
        section_filter = ""
        if section:
            section_filter = "AND section = ?"
            params.append(section)
        cursor = self.connection.execute(
            f"""
            SELECT item_name, COUNT(*) as count, COALESCE(SUM(amount_minor), 0) as amount
            FROM orders
            WHERE created_at_ts BETWEEN ? AND ? {section_filter}
            GROUP BY item_name
            ORDER BY count DESC
            LIMIT 10
            """,
            params,
        )
        return [dict(row) for row in cursor.fetchall()]

    def get_order_logs(self, order_id: int) -> list[dict[str, Any]]:
        cursor = self.connection.execute(
            """
            SELECT * FROM order_status_logs
            WHERE order_id = ?
            ORDER BY created_at_ts DESC
            """,
            (order_id,),
        )
        return [dict(row) for row in cursor.fetchall()]

    def add_balance_ledger(
        self,
        user_id: int,
        delta_minor: int,
        reason: str,
        order_id: int | None,
        admin_id: int | None,
    ) -> None:
        now_ts = self._now_ts()
        with self.connection:
            self.connection.execute(
                """
                INSERT INTO balance_ledger (user_id, delta_minor, reason, order_id, admin_id, created_at_ts)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (user_id, delta_minor, reason, order_id, admin_id, now_ts),
            )
            self.connection.execute(
                """
                UPDATE users
                SET balance_minor = balance_minor + ?
                WHERE telegram_id = ?
                """,
                (delta_minor, user_id),
            )

    def get_balance(self, user_id: int) -> int:
        cursor = self.connection.execute(
            "SELECT balance_minor FROM users WHERE telegram_id = ?",
            (user_id,),
        )
        row = cursor.fetchone()
        if not row:
            return 0
        return int(row[0])
