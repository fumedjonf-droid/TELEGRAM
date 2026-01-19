import os
import tempfile
from random import randint

from db import Database
from webhook import process_payment_event


def setup_db() -> Database:
    tmp = tempfile.NamedTemporaryFile(delete=False)
    os.environ["BOT_DB_PATH"] = tmp.name
    return Database()


def simulate_orders(db: Database, count: int) -> None:
    db.upsert_user(1, "loadtest")
    for idx in range(count):
        order_id = db.create_order(1, f"ITEM-{idx}", 10000, "RUB")
        db.update_order_status(order_id, "WAIT_PAY")
        payment_id = f"pay_{idx}"
        db.create_payment("demo", payment_id, order_id, "https://pay", 10000, "RUB")
        db.attach_payment_to_order(order_id, payment_id)


def simulate_webhooks(db: Database, count: int) -> None:
    for idx in range(count):
        data = {
            "payment_id": f"pay_{idx % 200}",
            "status": "SUCCEEDED",
            "amount_minor": 10000,
            "currency": "RUB",
            "event_id": f"evt_{idx}",
            "provider": "demo",
        }
        process_payment_event(db, data)


def main() -> None:
    db = setup_db()
    simulate_orders(db, 200)
    simulate_webhooks(db, 200)
    print("Load test complete")


if __name__ == "__main__":
    main()
