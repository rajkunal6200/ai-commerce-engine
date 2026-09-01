import hmac
import hashlib

import pytest

from payment import verify_webhook_signature


def test_webhook_signature_accepts_valid_signature():
    body = b'{"event":"payment.captured"}'
    secret = "test_webhook_secret"

    signature = hmac.new(
        secret.encode("utf-8"),
        body,
        hashlib.sha256
    ).hexdigest()

    monkeypatch = pytest.MonkeyPatch()

    monkeypatch.setattr(
        "payment.RAZORPAY_WEBHOOK_SECRET",
        secret
    )

    try:
        assert verify_webhook_signature(body, signature) is True
    finally:
        monkeypatch.undo()


def test_webhook_signature_rejects_invalid_signature():
    body = b'{"event":"payment.captured"}'
    secret = "test_webhook_secret"

    monkeypatch = pytest.MonkeyPatch()

    monkeypatch.setattr(
        "payment.RAZORPAY_WEBHOOK_SECRET",
        secret
    )

    try:
        with pytest.raises(ValueError, match="Invalid Razorpay webhook signature"):
            verify_webhook_signature(body, "invalid_signature")
    finally:
        monkeypatch.undo()


def test_webhook_signature_rejects_missing_signature():
    body = b'{"event":"payment.captured"}'
    secret = "test_webhook_secret"

    monkeypatch = pytest.MonkeyPatch()

    monkeypatch.setattr(
        "payment.RAZORPAY_WEBHOOK_SECRET",
        secret
    )

    try:
        with pytest.raises(ValueError, match="Missing Razorpay webhook signature"):
            verify_webhook_signature(body, "")
    finally:
        monkeypatch.undo()
