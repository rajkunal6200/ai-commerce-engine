import hmac
import hashlib

import pytest

import payment
from payment import verify_payment, verify_webhook_signature


def make_signature(order_id, payment_id, secret):
    return hmac.new(
        secret.encode("utf-8"),
        f"{order_id}|{payment_id}".encode("utf-8"),
        hashlib.sha256
    ).hexdigest()


class FakeIntent:
    max_amount = 5000.0
    currency = "INR"


class FakePaymentAPI:
    def __init__(self, payment_data):
        self.payment_data = payment_data

    def fetch(self, payment_id):
        return self.payment_data


class FakeOrderAPI:
    def __init__(self, order_data):
        self.order_data = order_data

    def fetch(self, order_id):
        return self.order_data


class FakeClient:
    def __init__(self, payment_data, order_data):
        self.payment = FakePaymentAPI(payment_data)
        self.order = FakeOrderAPI(order_data)


def test_verify_payment_accepts_valid_captured_payment(monkeypatch):
    secret = "test_key_secret"
    order_id = "order_test_123"
    payment_id = "pay_test_123"

    monkeypatch.setattr(
        payment,
        "RAZORPAY_KEY_SECRET",
        secret
    )

    monkeypatch.setattr(
        payment,
        "client",
        FakeClient(
            {
                "amount": 500000,
                "currency": "INR",
                "order_id": order_id,
                "status": "captured"
            },
            {
                "amount": 500000,
                "status": "paid"
            }
        )
    )

    result = verify_payment(
        FakeIntent(),
        server_order_id=order_id,
        razorpay_payment_id=payment_id,
        razorpay_order_id=order_id,
        razorpay_signature=make_signature(
            order_id,
            payment_id,
            secret
        )
    )

    assert result["status"] == "payment_verified"
    assert result["captured"] is True
    assert result["amount_rupees"] == 5000.0
    assert result["currency"] == "INR"


def test_verify_payment_rejects_invalid_signature(monkeypatch):
    monkeypatch.setattr(
        payment,
        "RAZORPAY_KEY_SECRET",
        "test_key_secret"
    )

    with pytest.raises(
        ValueError,
        match="Razorpay payment signature verification failed"
    ):
        verify_payment(
            FakeIntent(),
            server_order_id="order_test_123",
            razorpay_payment_id="pay_test_123",
            razorpay_order_id="order_test_123",
            razorpay_signature="attacker_signature"
        )


def test_verify_payment_rejects_order_id_mismatch():
    with pytest.raises(
        ValueError,
        match="Razorpay order mismatch"
    ):
        verify_payment(
            FakeIntent(),
            server_order_id="order_server",
            razorpay_payment_id="pay_test_123",
            razorpay_order_id="order_attacker",
            razorpay_signature="anything"
        )


def test_verify_payment_rejects_missing_payment_id(monkeypatch):
    monkeypatch.setattr(
        payment,
        "RAZORPAY_KEY_SECRET",
        "test_key_secret"
    )

    with pytest.raises(
        ValueError,
        match="Incomplete Razorpay payment verification data"
    ):
        verify_payment(
            FakeIntent(),
            server_order_id="order_test_123",
            razorpay_payment_id="",
            razorpay_order_id="order_test_123",
            razorpay_signature="anything"
        )


def test_verify_payment_rejects_amount_mismatch(monkeypatch):
    secret = "test_key_secret"
    order_id = "order_test_123"
    payment_id = "pay_test_123"

    monkeypatch.setattr(
        payment,
        "RAZORPAY_KEY_SECRET",
        secret
    )

    monkeypatch.setattr(
        payment,
        "client",
        FakeClient(
            {
                "amount": 499900,
                "currency": "INR",
                "order_id": order_id,
                "status": "captured"
            },
            {
                "amount": 499900,
                "status": "paid"
            }
        )
    )

    with pytest.raises(
        ValueError,
        match="Payment amount does not match"
    ):
        verify_payment(
            FakeIntent(),
            server_order_id=order_id,
            razorpay_payment_id=payment_id,
            razorpay_order_id=order_id,
            razorpay_signature=make_signature(
                order_id,
                payment_id,
                secret
            )
        )


def test_verify_payment_rejects_currency_mismatch(monkeypatch):
    secret = "test_key_secret"
    order_id = "order_test_123"
    payment_id = "pay_test_123"

    monkeypatch.setattr(
        payment,
        "RAZORPAY_KEY_SECRET",
        secret
    )

    monkeypatch.setattr(
        payment,
        "client",
        FakeClient(
            {
                "amount": 500000,
                "currency": "USD",
                "order_id": order_id,
                "status": "captured"
            },
            {
                "amount": 500000,
                "status": "paid"
            }
        )
    )

    with pytest.raises(
        ValueError,
        match="Payment currency does not match"
    ):
        verify_payment(
            FakeIntent(),
            server_order_id=order_id,
            razorpay_payment_id=payment_id,
            razorpay_order_id=order_id,
            razorpay_signature=make_signature(
                order_id,
                payment_id,
                secret
            )
        )


def test_verify_payment_rejects_payment_linked_to_different_order(monkeypatch):
    secret = "test_key_secret"
    order_id = "order_test_123"
    payment_id = "pay_test_123"

    monkeypatch.setattr(
        payment,
        "RAZORPAY_KEY_SECRET",
        secret
    )

    monkeypatch.setattr(
        payment,
        "client",
        FakeClient(
            {
                "amount": 500000,
                "currency": "INR",
                "order_id": "order_attacker",
                "status": "captured"
            },
            {
                "amount": 500000,
                "status": "paid"
            }
        )
    )

    with pytest.raises(
        ValueError,
        match="Payment is linked to a different Razorpay order"
    ):
        verify_payment(
            FakeIntent(),
            server_order_id=order_id,
            razorpay_payment_id=payment_id,
            razorpay_order_id=order_id,
            razorpay_signature=make_signature(
                order_id,
                payment_id,
                secret
            )
        )


def test_webhook_signature_accepts_valid_signature():
    body = b'{"event":"payment.captured"}'
    secret = "test_webhook_secret"

    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(
        payment,
        "RAZORPAY_WEBHOOK_SECRET",
        secret
    )

    try:
        signature = hmac.new(
            secret.encode("utf-8"),
            body,
            hashlib.sha256
        ).hexdigest()

        assert verify_webhook_signature(body, signature) is True
    finally:
        monkeypatch.undo()


def test_webhook_signature_rejects_invalid_signature():
    body = b'{"event":"payment.captured"}'
    secret = "test_webhook_secret"

    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(
        payment,
        "RAZORPAY_WEBHOOK_SECRET",
        secret
    )

    try:
        with pytest.raises(
            ValueError,
            match="Invalid Razorpay webhook signature"
        ):
            verify_webhook_signature(
                body,
                "invalid_signature"
            )
    finally:
        monkeypatch.undo()


def test_webhook_signature_rejects_missing_signature():
    body = b'{"event":"payment.captured"}'
    secret = "test_webhook_secret"

    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(
        payment,
        "RAZORPAY_WEBHOOK_SECRET",
        secret
    )

    try:
        with pytest.raises(
            ValueError,
            match="Missing Razorpay webhook signature"
        ):
            verify_webhook_signature(body, "")
    finally:
        monkeypatch.undo()
