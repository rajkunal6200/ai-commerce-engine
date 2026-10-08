import os
import hmac
import hashlib

import razorpay
from dotenv import load_dotenv

load_dotenv()

RAZORPAY_KEY_ID = os.getenv("RAZORPAY_KEY_ID")
RAZORPAY_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET")
RAZORPAY_WEBHOOK_SECRET = os.getenv("RAZORPAY_WEBHOOK_SECRET")

if not RAZORPAY_KEY_ID or not RAZORPAY_KEY_SECRET:
    raise RuntimeError(
        "RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be configured in the backend environment."
    )

client = razorpay.Client(
    auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET)
)


def create_payment(intent, intent_id=None):
    """Create one Razorpay order for a bounded purchase intent."""

    if intent.purpose == "TEST_FAILURE":
        raise Exception("Simulated payment failure")

    receipt = intent_id or intent.merchant

    order = client.order.create({
        "amount": int(round(intent.max_amount * 100)),
        "currency": intent.currency.upper(),
        "receipt": receipt
    })

    return {
        "status": "payment_pending",
        "order_id": order["id"],
        "merchant": intent.merchant,
        "amount": intent.max_amount,
        "currency": intent.currency.upper(),
        "key_id": RAZORPAY_KEY_ID
    }


def _expected_amount_paise(intent):
    return int(round(intent.max_amount * 100))


def _verify_checkout_signature(order_id, payment_id, signature):
    if not RAZORPAY_KEY_SECRET:
        raise ValueError("Razorpay key secret is not configured")

    generated = hmac.new(
        RAZORPAY_KEY_SECRET.encode("utf-8"),
        f"{order_id}|{payment_id}".encode("utf-8"),
        hashlib.sha256
    ).hexdigest()

    return hmac.compare_digest(generated, signature)


def verify_payment(
    intent,
    *,
    server_order_id,
    razorpay_payment_id,
    razorpay_order_id,
    razorpay_signature
):
    """Verify Checkout signature and confirm the Razorpay payment state."""

    if razorpay_order_id != server_order_id:
        raise ValueError("Razorpay order mismatch")

    if not razorpay_payment_id or not razorpay_signature:
        raise ValueError("Incomplete Razorpay payment verification data")

    if not _verify_checkout_signature(
        server_order_id,
        razorpay_payment_id,
        razorpay_signature
    ):
        raise ValueError("Razorpay payment signature verification failed")

    payment = client.payment.fetch(razorpay_payment_id)
    order = client.order.fetch(server_order_id)

    expected_amount = _expected_amount_paise(intent)
    actual_amount = int(payment.get("amount", 0))
    order_amount = int(order.get("amount", 0))

    expected_currency = intent.currency.upper()
    actual_currency = str(payment.get("currency", "")).upper()

    if actual_amount != expected_amount or order_amount != expected_amount:
        raise ValueError("Payment amount does not match the approved purchase intent")

    if actual_currency != expected_currency:
        raise ValueError("Payment currency does not match the approved purchase intent")

    if payment.get("order_id") != server_order_id:
        raise ValueError("Payment is linked to a different Razorpay order")

    payment_status = payment.get("status")
    captured = payment_status == "captured"

    return {
        "status": "payment_verified" if captured else "payment_authorized",
        "captured": captured,
        "amount_rupees": actual_amount / 100,
        "currency": actual_currency,
        "payment_status": payment_status,
        "order_status": order.get("status")
    }


def verify_webhook_signature(raw_body: bytes, received_signature: str):
    if not RAZORPAY_WEBHOOK_SECRET:
        raise ValueError("Razorpay webhook secret is not configured")

    if not received_signature:
        raise ValueError("Missing Razorpay webhook signature")

    generated = hmac.new(
        RAZORPAY_WEBHOOK_SECRET.encode("utf-8"),
        raw_body,
        hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(generated, received_signature):
        raise ValueError("Invalid Razorpay webhook signature")

    return True
