import os
import tempfile

from db import Database
from webhook import process_payment_event


def setup_db() -> Database:
    tmp = tempfile.NamedTemporaryFile(delete=False)
    os.environ["BOT_DB_PATH"] = tmp.name
    return Database()


def create_order_with_payment(db: Database, amount_minor: int = 49900) -> tuple[int, str]:
    db.upsert_user(1, "tester")
    order_id = db.create_order(1, "PUBG MOBILE", amount_minor, "RUB")
    db.update_order_status(order_id, "WAIT_PAY")
    payment_id = "pay_1"
    db.create_payment("demo", payment_id, order_id, "https://pay", amount_minor, "RUB")
    db.attach_payment_to_order(order_id, payment_id)
    return order_id, payment_id


def test_webhook_succeeded() -> None:
    db = setup_db()
    order_id, payment_id = create_order_with_payment(db)
    data = {
        "payment_id": payment_id,
        "status": "SUCCEEDED",
        "amount_minor": 49900,
        "currency": "RUB",
        "event_id": "evt_1",
        "provider": "demo",
    }
    process_payment_event(db, data)
    order = db.get_order(order_id)
    assert order["status"] == "PAID"


def test_webhook_duplicate_event() -> None:
    db = setup_db()
    order_id, payment_id = create_order_with_payment(db)
    data = {
        "payment_id": payment_id,
        "status": "SUCCEEDED",
        "amount_minor": 49900,
        "currency": "RUB",
        "event_id": "evt_1",
        "provider": "demo",
    }
    process_payment_event(db, data)
    process_payment_event(db, data)
    order = db.get_order(order_id)
    assert order["status"] == "PAID"


def test_webhook_mismatch_amount() -> None:
    db = setup_db()
    _, payment_id = create_order_with_payment(db)
    data = {
        "payment_id": payment_id,
        "status": "SUCCEEDED",
        "amount_minor": 49901,
        "currency": "RUB",
        "event_id": "evt_1",
        "provider": "demo",
    }
    process_payment_event(db, data)
    payment = db.get_payment("demo", payment_id)
    assert payment["status"] == "SUSPICIOUS"


def test_unknown_payment() -> None:
    db = setup_db()
    data = {
        "payment_id": "missing",
        "status": "SUCCEEDED",
        "amount_minor": 100,
        "currency": "RUB",
        "event_id": "evt_1",
        "provider": "demo",
    }
    try:
        process_payment_event(db, data)
    except Exception:
        assert True
    else:
        raise AssertionError("Expected failure")


def test_paid_on_closed_order() -> None:
    db = setup_db()
    order_id, payment_id = create_order_with_payment(db)
    db.update_order_status(order_id, "DONE")
    data = {
        "payment_id": payment_id,
        "status": "SUCCEEDED",
        "amount_minor": 49900,
        "currency": "RUB",
        "event_id": "evt_1",
        "provider": "demo",
    }
    process_payment_event(db, data)
    order = db.get_order(order_id)
    assert order["status"] == "DONE"


def test_recreate_payment() -> None:
    db = setup_db()
    order_id, payment_id = create_order_with_payment(db)
    db.deactivate_payments_for_order(order_id)
    payment = db.get_payment("demo", payment_id)
    assert payment["is_active"] == 0


if __name__ == "__main__":
    test_webhook_succeeded()
    test_webhook_duplicate_event()
    test_webhook_mismatch_amount()
    test_unknown_payment()
    test_paid_on_closed_order()
    test_recreate_payment()
    print("All smoke tests passed")
