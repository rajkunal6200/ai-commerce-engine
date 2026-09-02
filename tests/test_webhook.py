import hashlib
import hmac
import json
import time

from fastapi.testclient import TestClient
import pytest

import main
import payment


client = TestClient(main.app)


@pytest.fixture(autouse=True)
def isolate_webhook_state():
    original_events = main.processed_webhook_events.copy()

    main.processed_webhook_events.difference_update(
        {
            "evt_test_webhook_001",
            "evt_invalid_signature_001",
            "evt_missing_signature_001",
            "evt_duplicate_event_001",
            "evt_stale_webhook_001",
            "evt_payment_duplicate_001",
            "evt_payment_duplicate_002",
            "evt_order_paid_001",
            "evt_duplicate_order_paid_001",
            "evt_duplicate_order_paid_002",
            "evt_payment_failed_001",
            "evt_late_payment_failed_001",
        }
    )

    yield

    main.processed_webhook_events.clear()
    main.processed_webhook_events.update(original_events)


def make_webhook_signature(payload: bytes) -> str:
    return hmac.new(
        payment.RAZORPAY_WEBHOOK_SECRET.encode(),
        payload,
        hashlib.sha256,
    ).hexdigest()


def test_payment_captured_webhook():
    intent_id = "test_webhook_intent_001"
    order_id = "order_test_webhook_001"
    payment_id = "pay_test_webhook_001"

    main.intents[intent_id] = {
        "status": "payment_pending",
        "payment": {
            "order_id": order_id,
            "payment_id": payment_id,
            "status": "payment_pending",
            "captured": False,
        },
    }

    payload = {
        "event": "payment.captured",
        "created_at": int(time.time()),
        "payload": {
            "payment": {
                "entity": {
                    "entity": "payment",
                    "id": payment_id,
                    "order_id": order_id,
                }
            }
        },
    }

    raw_body = json.dumps(
        payload,
        separators=(",", ":"),
    ).encode()

    signature = make_webhook_signature(raw_body)

    response = client.post(
        "/webhooks/razorpay",
        content=raw_body,
        headers={
            "X-Razorpay-Signature": signature,
            "x-razorpay-event-id": "evt_test_webhook_001",
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "status": "received"
    }

    assert main.intents[intent_id]["status"] == "payment_verified"

    payment_state = main.intents[intent_id]["payment"]

    assert payment_state["status"] == "payment_verified"
    assert payment_state["payment_id"] == payment_id
    assert payment_state["captured"] is True
    assert payment_state["webhook_confirmed"] is True
def test_invalid_webhook_signature():
    payload = {
        "event": "payment.captured",
        "created_at": int(time.time()),
        "payload": {
            "payment": {
                "entity": {
                    "entity": "payment",
                    "id": "pay_invalid_signature",
                    "order_id": "order_invalid_signature",
                }
            }
        },
    }

    raw_body = json.dumps(
        payload,
        separators=(",", ":"),
    ).encode()

    response = client.post(
        "/webhooks/razorpay",
        content=raw_body,
        headers={
            "X-Razorpay-Signature": "invalid_signature",
            "x-razorpay-event-id": "evt_invalid_signature_001",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid Razorpay webhook signature"

def test_missing_webhook_signature():
    payload = {
        "event": "payment.captured",
        "created_at": int(time.time()),
        "payload": {
            "payment": {
                "entity": {
                    "entity": "payment",
                    "id": "pay_missing_signature",
                    "order_id": "order_missing_signature",
                }
            }
        },
    }

    raw_body = json.dumps(
        payload,
        separators=(",", ":"),
    ).encode()

    response = client.post(
        "/webhooks/razorpay",
        content=raw_body,
        headers={
            "x-razorpay-event-id": "evt_missing_signature_001",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Missing Razorpay webhook signature"

def test_duplicate_webhook_event_id_is_ignored():
    intent_id = "test_duplicate_event_001"
    order_id = "order_duplicate_event_001"
    payment_id = "pay_duplicate_event_001"
    event_id = "evt_duplicate_event_001"

    main.intents[intent_id] = {
        "status": "payment_pending",
        "payment": {
            "order_id": order_id,
            "payment_id": payment_id,
            "status": "payment_pending",
            "captured": False,
        },
    }

    payload = {
        "event": "payment.captured",
        "created_at": int(time.time()),
        "payload": {
            "payment": {
                "entity": {
                    "entity": "payment",
                    "id": payment_id,
                    "order_id": order_id,
                }
            }
        },
    }

    raw_body = json.dumps(
        payload,
        separators=(",", ":"),
    ).encode()

    signature = make_webhook_signature(raw_body)

    headers = {
        "X-Razorpay-Signature": signature,
        "x-razorpay-event-id": event_id,
    }

    first_response = client.post(
        "/webhooks/razorpay",
        content=raw_body,
        headers=headers,
    )

    second_response = client.post(
        "/webhooks/razorpay",
        content=raw_body,
        headers=headers,
    )

    assert first_response.status_code == 200
    assert first_response.json() == {
        "status": "received"
    }

    assert second_response.status_code == 200
    assert second_response.json() == {
        "status": "ignored",
        "reason": "duplicate_event",
    }

def test_stale_webhook_is_rejected():
    payload = {
        "event": "payment.captured",
        "created_at": int(time.time()) - 301,
        "payload": {
            "payment": {
                "entity": {
                    "entity": "payment",
                    "id": "pay_stale_webhook",
                    "order_id": "order_stale_webhook",
                }
            }
        },
    }

    raw_body = json.dumps(
        payload,
        separators=(",", ":"),
    ).encode()

    signature = make_webhook_signature(raw_body)

    response = client.post(
        "/webhooks/razorpay",
        content=raw_body,
        headers={
            "X-Razorpay-Signature": signature,
            "x-razorpay-event-id": "evt_stale_webhook_001",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Stale Razorpay webhook event"

def test_same_payment_with_different_event_id_is_ignored():
    intent_id = "test_payment_duplicate_001"
    order_id = "order_payment_duplicate_001"
    payment_id = "pay_payment_duplicate_001"

    main.intents[intent_id] = {
        "status": "payment_pending",
        "payment": {
            "order_id": order_id,
            "payment_id": payment_id,
            "status": "payment_pending",
            "captured": False,
        },
    }

    payload = {
        "event": "payment.captured",
        "created_at": int(time.time()),
        "payload": {
            "payment": {
                "entity": {
                    "entity": "payment",
                    "id": payment_id,
                    "order_id": order_id,
                }
            }
        },
    }

    raw_body = json.dumps(
        payload,
        separators=(",", ":"),
    ).encode()

    signature = make_webhook_signature(raw_body)

    first_response = client.post(
        "/webhooks/razorpay",
        content=raw_body,
        headers={
            "X-Razorpay-Signature": signature,
            "x-razorpay-event-id": "evt_payment_duplicate_001",
        },
    )

    second_response = client.post(
        "/webhooks/razorpay",
        content=raw_body,
        headers={
            "X-Razorpay-Signature": signature,
            "x-razorpay-event-id": "evt_payment_duplicate_002",
        },
    )

    assert first_response.status_code == 200
    assert first_response.json() == {
        "status": "received"
    }

    assert second_response.status_code == 200
    assert second_response.json() == {
        "status": "ignored",
        "reason": "payment_already_confirmed",
    }

def test_order_paid_webhook_confirms_payment():
    intent_id = "test_order_paid_001"
    order_id = "order_order_paid_001"
    payment_id = "pay_order_paid_001"

    main.intents[intent_id] = {
        "status": "payment_pending",
        "payment": {
            "order_id": order_id,
            "payment_id": payment_id,
            "status": "payment_pending",
            "captured": False,
        },
    }

    payload = {
        "event": "order.paid",
        "created_at": int(time.time()),
        "payload": {
            "order": {
                "entity": {
                    "entity": "order",
                    "id": order_id,
                }
            }
        },
    }

    raw_body = json.dumps(
        payload,
        separators=(",", ":"),
    ).encode()

    signature = make_webhook_signature(raw_body)

    response = client.post(
        "/webhooks/razorpay",
        content=raw_body,
        headers={
            "X-Razorpay-Signature": signature,
            "x-razorpay-event-id": "evt_order_paid_001",
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "status": "received"
    }

    assert main.intents[intent_id]["status"] == "payment_verified"

    payment_state = main.intents[intent_id]["payment"]

    assert payment_state["status"] == "payment_verified"
    assert payment_state["captured"] is True
    assert payment_state["webhook_confirmed"] is True
    assert payment_state["order_paid_webhook_confirmed"] is True

def test_duplicate_order_paid_with_different_event_id_is_ignored():
    intent_id = "test_duplicate_order_paid_001"
    order_id = "order_duplicate_order_paid_001"
    payment_id = "pay_duplicate_order_paid_001"

    main.intents[intent_id] = {
        "status": "payment_pending",
        "payment": {
            "order_id": order_id,
            "payment_id": payment_id,
            "status": "payment_pending",
            "captured": False,
        },
    }

    payload = {
        "event": "order.paid",
        "created_at": int(time.time()),
        "payload": {
            "order": {
                "entity": {
                    "entity": "order",
                    "id": order_id,
                }
            }
        },
    }

    raw_body = json.dumps(
        payload,
        separators=(",", ":"),
    ).encode()

    signature = make_webhook_signature(raw_body)

    first_response = client.post(
        "/webhooks/razorpay",
        content=raw_body,
        headers={
            "X-Razorpay-Signature": signature,
            "x-razorpay-event-id": "evt_duplicate_order_paid_001",
        },
    )

    second_response = client.post(
        "/webhooks/razorpay",
        content=raw_body,
        headers={
            "X-Razorpay-Signature": signature,
            "x-razorpay-event-id": "evt_duplicate_order_paid_002",
        },
    )

    assert first_response.status_code == 200
    assert first_response.json() == {
        "status": "received"
    }

    assert second_response.status_code == 200
    assert second_response.json() == {
        "status": "ignored",
        "reason": "order_paid_already_confirmed",
    }

def test_payment_failed_webhook_marks_payment_failed():
    intent_id = "test_payment_failed_001"
    order_id = "order_payment_failed_001"
    payment_id = "pay_payment_failed_001"

    main.intents[intent_id] = {
        "status": "payment_pending",
        "payment": {
            "order_id": order_id,
            "payment_id": payment_id,
            "status": "payment_pending",
            "captured": False,
        },
    }

    payload = {
        "event": "payment.failed",
        "created_at": int(time.time()),
        "payload": {
            "payment": {
                "entity": {
                    "entity": "payment",
                    "id": payment_id,
                    "order_id": order_id,
                }
            }
        },
    }

    raw_body = json.dumps(
        payload,
        separators=(",", ":"),
    ).encode()

    signature = make_webhook_signature(raw_body)

    response = client.post(
        "/webhooks/razorpay",
        content=raw_body,
        headers={
            "X-Razorpay-Signature": signature,
            "x-razorpay-event-id": "evt_payment_failed_001",
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "status": "received"
    }

    assert main.intents[intent_id]["status"] == "payment_failed"

    payment_state = main.intents[intent_id]["payment"]

    assert payment_state["failed_webhook_confirmed"] is True

def test_late_payment_failed_cannot_downgrade_verified_payment():
    intent_id = "test_late_payment_failed_001"
    order_id = "order_late_payment_failed_001"
    payment_id = "pay_late_payment_failed_001"

    main.intents[intent_id] = {
        "status": "payment_verified",
        "payment": {
            "order_id": order_id,
            "payment_id": payment_id,
            "status": "payment_verified",
            "captured": True,
            "webhook_confirmed": True,
        },
    }

    payload = {
        "event": "payment.failed",
        "created_at": int(time.time()),
        "payload": {
            "payment": {
                "entity": {
                    "entity": "payment",
                    "id": payment_id,
                    "order_id": order_id,
                }
            }
        },
    }

    raw_body = json.dumps(
        payload,
        separators=(",", ":"),
    ).encode()

    signature = make_webhook_signature(raw_body)

    response = client.post(
        "/webhooks/razorpay",
        content=raw_body,
        headers={
            "X-Razorpay-Signature": signature,
            "x-razorpay-event-id": "evt_late_payment_failed_001",
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "status": "ignored",
        "reason": "payment_already_verified",
    }

    assert main.intents[intent_id]["status"] == "payment_verified"

    payment_state = main.intents[intent_id]["payment"]

    assert payment_state["status"] == "payment_verified"
    assert payment_state["captured"] is True
