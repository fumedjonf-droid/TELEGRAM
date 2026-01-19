from __future__ import annotations

from datetime import datetime, timezone
from typing import Callable

from db import Database


class AlertRouter:
    def __init__(self, db: Database, send_fn: Callable[[str], None]) -> None:
        self.db = db
        self.send_fn = send_fn

    def alert(
        self,
        key: str,
        message: str,
        severity: str,
        value: str | None = None,
        is_active: bool = True,
    ) -> None:
        current = self.db.get_alert(key)
        if is_active:
            if not current or current["is_active"] == 0 or current["last_value"] != value:
                self.db.upsert_alert(key, severity, value, True)
                suffix = f" (value: {value})" if value is not None else ""
                self.send_fn(f"{severity} ⚠️ {message}{suffix}")
            return

        if current and current["is_active"] == 1:
            self.db.upsert_alert(key, severity, value, False)
            recovered = f"{severity} ✅ RECOVERED: {message}"
            self.send_fn(recovered)

    def clear(self, key: str, message: str, severity: str) -> None:
        self.alert(key, message, severity, is_active=False)

    def update_heartbeat(self, key: str) -> None:
        self.db.set_service_status(key, datetime.now(timezone.utc).isoformat())
