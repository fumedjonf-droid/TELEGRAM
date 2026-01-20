import os
import sqlite3
import time
from pathlib import Path
from typing import Any

DB_PATH = Path(os.getenv("BOT_DB_PATH", Path(__file__).with_name("bot.db")))

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
                    balance_minor INTEGER DEFAULT 0
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
                CREATE INDEX IF NOT EXISTS idx_orders_user_created
                ON orders(user_id, created_at_ts)
                """
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

    def can_transition(self, current: str, new_status: str) -> bool:
        return new_status in ALLOWED_TRANSITIONS.get(current, set())

    def transition_order_status(self, order_id: int, expected: str, new_status: str) -> bool:
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
