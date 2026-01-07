import sqlite3
from pathlib import Path
from typing import Any, Dict, Optional

DB_PATH = Path(__file__).resolve().parent / "orders.db"


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with get_connection() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tg_user_id INTEGER NOT NULL,
                tg_username TEXT,
                title TEXT NOT NULL,
                description TEXT,
                player_id TEXT,
                amount REAL NOT NULL,
                currency TEXT NOT NULL,
                status TEXT NOT NULL,
                payment_ref TEXT,
                comment TEXT,
                source TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.commit()


def create_order(data: Dict[str, Any]) -> int:
    with get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO orders (
                tg_user_id,
                tg_username,
                title,
                description,
                player_id,
                amount,
                currency,
                status,
                payment_ref,
                comment,
                source,
                created_at,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data["tg_user_id"],
                data.get("tg_username"),
                data["title"],
                data.get("description"),
                data.get("player_id"),
                data["amount"],
                data["currency"],
                data["status"],
                data.get("payment_ref"),
                data.get("comment"),
                data.get("source"),
                data["created_at"],
                data["updated_at"],
            ),
        )
        conn.commit()
        return int(cursor.lastrowid)


def update_order_status(order_id: int, status: str) -> None:
    with get_connection() as conn:
        conn.execute(
            "UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?",
            (status, order_id),
        )
        conn.commit()


def get_order(order_id: int) -> Optional[Dict[str, Any]]:
    with get_connection() as conn:
        cursor = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,))
        row = cursor.fetchone()
        if row is None:
            return None
        return dict(row)
