import main
import pytest

from fastapi.testclient import TestClient


client = TestClient(main.app)


@pytest.fixture(autouse=True)
def isolate_api_state(monkeypatch):
    """
    Keep API tests isolated from the application's persistent
    runtime state.
    """

    original_intents = main.intents.copy()
    original_audit_logs = main.audit_logs.copy()
    original_conversations = main.conversations.copy()

    main.intents.clear()
    main.audit_logs.clear()
    main.conversations.clear()

    monkeypatch.setattr(
        main,
        "save_intents",
        lambda: None
    )

    monkeypatch.setattr(
        main,
        "save_audit_logs",
        lambda: None
    )

    yield

    main.intents.clear()
    main.intents.update(original_intents)

    main.audit_logs.clear()
    main.audit_logs.extend(original_audit_logs)

    main.conversations.clear()
    main.conversations.update(original_conversations)


# ============================================================
# ROOT + CATALOG
# ============================================================


def test_root_health_check():
    response = client.get("/")

    assert response.status_code == 200
    assert response.json() == {
        "message": "AI Commerce Engine is running",
        "status": "ok"
    }


def test_catalog_returns_products():
    response = client.get("/catalog")

    assert response.status_code == 200

    data = response.json()

    assert data["merchant"] == "AI Commerce Demo Store"
    assert isinstance(data["products"], list)
    assert len(data["products"]) == 3

    product_ids = {
        product["product_id"]
        for product in data["products"]
    }

    assert product_ids == {
        "LAP001",
        "HP001",
        "MS001"
    }


# ============================================================
# UNDERSTAND
# ============================================================


def test_understand_extracts_buyer_requirements():
    response = client.post(
        "/understand",
        json={
            "message": (
                "I need wireless headphones for travel "
                "under 5k"
            )
        }
    )

    assert response.status_code == 200

    data = response.json()

    assert data["buyer_message"] == (
        "I need wireless headphones for travel under 5k"
    )

    assert data["understanding"]["product_type"] == "headphones"
    assert "wireless" in data["understanding"]["features"]
    assert data["understanding"]["purpose"] == "travel"
    assert data["understanding"]["max_price"] == 5000

    assert (
        data["explanation"]
        == (
            "The buyer message was converted into "
            "structured shopping requirements."
        )
    )


def test_understand_missing_information_returns_nulls():
    response = client.post(
        "/understand",
        json={
            "message": "hello"
        }
    )

    assert response.status_code == 200

    data = response.json()

    assert data["understanding"]["product_type"] is None
    assert data["understanding"]["features"] == []
    assert data["understanding"]["purpose"] is None
    assert data["understanding"]["max_price"] is None


def test_understand_requires_message():
    response = client.post(
        "/understand",
        json={}
    )

    assert response.status_code == 422


# ============================================================
# RECOMMENDATION
# ============================================================


def test_recommend_returns_matching_product():
    response = client.post(
        "/recommend",
        json={
            "query": "wireless headphones",
            "max_price": 5000
        }
    )

    assert response.status_code == 200

    data = response.json()

    assert len(data["products"]) >= 1

    first = data["products"][0]

    assert first["product_id"] == "HP001"
    assert first["name"] == "SoundMax Headphones"
    assert first["price"] == 5000
    assert first["currency"] == "INR"
    assert first["reason"]

    assert (
        data["explanation"]
        == (
            "Products were ranked using buyer intent, "
            "product relevance, price limit, "
            "and stock availability."
        )
    )


def test_recommend_returns_empty_for_no_match():
    response = client.post(
        "/recommend",
        json={
            "query": "laptop",
            "max_price": 1000
        }
    )

    assert response.status_code == 200

    data = response.json()

    assert data["products"] == []

    assert (
        data["explanation"]
        == (
            "No in-stock products matched the "
            "buyer's request within the price limit."
        )
    )


def test_recommend_requires_query_and_budget():
    response = client.post(
        "/recommend",
        json={}
    )

    assert response.status_code == 422


# ============================================================
# CROSS SELL
# ============================================================


def test_cross_sell_returns_complementary_products():
    response = client.post(
        "/cross-sell",
        json={
            "product_id": "LAP001"
        }
    )

    assert response.status_code == 200

    data = response.json()

    assert data["main_product"] == "ProBook Laptop"

    suggestion_ids = {
        product["product_id"]
        for product in data["suggestions"]
    }

    assert suggestion_ids == {
        "HP001",
        "MS001"
    }

    assert (
        data["explanation"]
        == (
            "These products were selected as "
            "potential complementary purchases."
        )
    )


def test_cross_sell_unknown_product_returns_404():
    response = client.post(
        "/cross-sell",
        json={
            "product_id": "UNKNOWN"
        }
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Product not found"


def test_cross_sell_requires_product_id():
    response = client.post(
        "/cross-sell",
        json={}
    )

    assert response.status_code == 422


# ============================================================
# SHOP
# ============================================================


def test_shop_creates_recommendation_and_intent():
    response = client.post(
        "/shop",
        json={
            "query": "wireless headphones",
            "max_price": 5000
        }
    )

    assert response.status_code == 200

    data = response.json()

    assert data["buyer_query"] == "wireless headphones"
    assert data["budget"] == 5000
    assert len(data["recommendations"]) == 1

    recommendation = data["recommendations"][0]

    assert recommendation["product_id"] == "HP001"
    assert recommendation["name"] == "SoundMax Headphones"
    assert recommendation["price"] == 5000
    assert recommendation["currency"] == "INR"

    assert data["intent_id"] is not None

    intent_id = data["intent_id"]

    assert intent_id in main.intents

    stored = main.intents[intent_id]

    assert stored["status"] == "intent_created"
    assert stored["approved"] is False
    assert stored["payment"] is None
    assert stored["execution_count"] == 0

    assert len(main.audit_logs) == 2

    events = [
        event.event
        for event in main.audit_logs
        if event.intent_id == intent_id
    ]

    assert events == [
        "intent_created",
        "policy_checked"
    ]


def test_shop_no_match_does_not_create_intent():
    response = client.post(
        "/shop",
        json={
            "query": "laptop",
            "max_price": 1000
        }
    )

    assert response.status_code == 200

    data = response.json()

    assert data["recommendations"] == []
    assert data["cross_sell"] == []
    assert data["intent_id"] is None

    assert (
        data["message"]
        == (
            "I could not find an in-stock product "
            "matching your request within your budget."
        )
    )

    assert main.intents == {}


# ============================================================
# CONVERSATIONAL SHOP
# ============================================================


def test_conversational_shop_creates_session_and_intent():
    response = client.post(
        "/conversational-shop",
        json={
            "message": "I need headphones under 5000"
        }
    )

    assert response.status_code == 200

    data = response.json()

    assert data["session_id"] is not None
    assert data["understanding"]["product_type"] == "headphones"
    assert data["understanding"]["max_price"] == 5000

    assert len(data["recommendations"]) == 1
    assert data["recommendations"][0]["product_id"] == "HP001"

    assert data["intent_id"] is not None

    session_id = data["session_id"]

    assert session_id in main.conversations

    history = main.conversations[session_id]["history"]

    assert history[0]["role"] == "user"
    assert history[0]["message"] == (
        "I need headphones under 5000"
    )

    assert history[1]["role"] == "assistant"


def test_conversational_shop_requires_budget():
    response = client.post(
        "/conversational-shop",
        json={
            "message": "I need headphones"
        }
    )

    assert response.status_code == 200

    data = response.json()

    assert data["understanding"]["product_type"] == "headphones"
    assert data["understanding"]["max_price"] is None
    assert data["recommendations"] == []
    assert data["intent_id"] is None

    assert (
        data["message"]
        == (
            "Please provide a maximum budget "
            "so I can safely recommend a product."
        )
    )


def test_conversational_shop_remembers_previous_message():
    first = client.post(
        "/conversational-shop",
        json={
            "message": "I need headphones",
            "session_id": "test-session-001"
        }
    )

    assert first.status_code == 200
    assert first.json()["intent_id"] is None

    second = client.post(
        "/conversational-shop",
        json={
            "message": "under 5000",
            "session_id": "test-session-001"
        }
    )

    assert second.status_code == 200

    data = second.json()

    assert data["session_id"] == "test-session-001"
    assert data["understanding"]["product_type"] == "headphones"
    assert data["understanding"]["max_price"] == 5000

    assert len(data["recommendations"]) == 1
    assert data["recommendations"][0]["product_id"] == "HP001"

    assert data["intent_id"] is not None

    history = main.conversations["test-session-001"]["history"]

    assert len(history) == 3
    assert history[0]["message"] == "I need headphones"
    assert history[1]["message"] == "under 5000"
    assert history[2]["role"] == "assistant"


def test_conversational_shop_unknown_product_type_after_budget():
    response = client.post(
        "/conversational-shop",
        json={
            "message": "under 5000",
            "session_id": "test-session-002"
        }
    )

    assert response.status_code == 200

    data = response.json()

    assert data["understanding"]["product_type"] is None
    assert data["understanding"]["max_price"] == 5000
    assert data["recommendations"] == []
    assert data["intent_id"] is None

    assert (
        data["message"]
        == (
            "What type of product are you looking for, "
            "such as a mouse, headphones, or laptop?"
        )
    )


# ============================================================
# INTENT CREATION
# ============================================================


def test_create_intent():
    payload = {
        "merchant": "Amazon",
        "purpose": "Buy SoundMax Headphones",
        "max_amount": 5000,
        "currency": "INR",
        "user_approval_required": True
    }

    response = client.post(
        "/intent",
        json=payload
    )

    assert response.status_code == 200

    data = response.json()

    assert data["intent_id"] is not None
    assert data["intent"] == payload

    assert data["policy"]["allowed"] is True
    assert "reason" in data["policy"]

    intent_id = data["intent_id"]

    assert intent_id in main.intents
    assert main.intents[intent_id]["status"] == "intent_created"
    assert main.intents[intent_id]["approved"] is False

    events = [
        event.event
        for event in main.audit_logs
        if event.intent_id == intent_id
    ]

    assert events == [
        "intent_created",
        "policy_checked"
    ]


def test_create_intent_rejects_invalid_amount():
    response = client.post(
        "/intent",
        json={
            "merchant": "Amazon",
            "purpose": "Buy headphones",
            "max_amount": 0,
            "currency": "INR",
            "user_approval_required": True
        }
    )

    assert response.status_code == 422


# ============================================================
# APPROVAL
# ============================================================


def create_test_intent():
    response = client.post(
        "/intent",
        json={
            "merchant": "Amazon",
            "purpose": "Buy SoundMax Headphones",
            "max_amount": 5000,
            "currency": "INR",
            "user_approval_required": True
        }
    )

    assert response.status_code == 200

    return response.json()["intent_id"]


def test_approve_intent():
    intent_id = create_test_intent()

    response = client.post(
        "/approval",
        json={
            "intent_id": intent_id,
            "approved": True
        }
    )

    assert response.status_code == 200

    assert response.json() == {
        "intent_id": intent_id,
        "approved": True,
        "message": "Intent approved"
    }

    assert main.intents[intent_id]["approved"] is True
    assert main.intents[intent_id]["status"] == "approved"


def test_reject_intent():
    intent_id = create_test_intent()

    response = client.post(
        "/approval",
        json={
            "intent_id": intent_id,
            "approved": False
        }
    )

    assert response.status_code == 200

    assert response.json() == {
        "intent_id": intent_id,
        "approved": False,
        "message": "Intent rejected"
    }

    assert main.intents[intent_id]["approved"] is False
    assert main.intents[intent_id]["status"] == "rejected"


def test_approval_rejected_after_execution_completed():
    intent_id = create_test_intent()

    main.intents[intent_id]["status"] = "execution_completed"
    main.intents[intent_id]["approved"] = True

    response = client.post(
        "/approval",
        json={
            "intent_id": intent_id,
            "approved": False
        }
    )

    assert response.status_code == 409
    assert response.json()["detail"] == (
        "Intent has already been executed"
    )

    assert main.intents[intent_id]["status"] == (
        "execution_completed"
    )
    assert main.intents[intent_id]["approved"] is True


def test_approval_unknown_intent_returns_404():
    response = client.post(
        "/approval",
        json={
            "intent_id": "does-not-exist",
            "approved": True
        }
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Intent not found"


# ============================================================
# EXECUTION GATES
# ============================================================


def test_execute_blocks_intent_rejected_by_policy():
    intent_id = create_test_intent()

    main.intents[intent_id]["approved"] = True
    main.intents[intent_id]["policy"] = {
        "allowed": False,
        "reason": "Policy rejected this intent."
    }

    response = client.post(
        f"/execute/{intent_id}"
    )

    assert response.status_code == 403
    assert response.json()["detail"] == (
        "Intent is not allowed by policy"
    )

    assert main.intents[intent_id]["status"] == "blocked"

    events = [
        event
        for event in main.audit_logs
        if event.intent_id == intent_id
    ]

    assert events[-1].event == "execution_blocked"
    assert events[-1].status == "blocked"
    assert events[-1].reason == (
        "Intent is not allowed by policy"
    )


def test_execute_requires_approval():
    intent_id = create_test_intent()

    response = client.post(
        f"/execute/{intent_id}"
    )

    assert response.status_code == 403
    assert response.json()["detail"] == (
        "User approval is required"
    )

    assert main.intents[intent_id]["status"] == "intent_created"

    events = [
        event.event
        for event in main.audit_logs
        if event.intent_id == intent_id
    ]

    assert events[-1] == "execution_blocked"


def test_execute_unknown_intent_returns_404():
    response = client.post(
        "/execute/does-not-exist"
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Intent not found"


def test_execute_creates_payment_order_after_approval(
    monkeypatch
):
    intent_id = create_test_intent()

    approval_response = client.post(
        "/approval",
        json={
            "intent_id": intent_id,
            "approved": True
        }
    )

    assert approval_response.status_code == 200

    fake_payment = {
        "status": "payment_pending",
        "order_id": "order_test_api_001",
        "merchant": "Amazon",
        "amount": 5000,
        "currency": "INR",
        "key_id": "rzp_test_fake"
    }

    monkeypatch.setattr(
        main,
        "create_payment",
        lambda intent, intent_id=None: fake_payment.copy()
    )

    response = client.post(
        f"/execute/{intent_id}"
    )

    assert response.status_code == 200

    data = response.json()

    assert data == {
        "intent_id": intent_id,
        "status": "payment_pending",
        "payment": fake_payment
    }

    stored = main.intents[intent_id]

    assert stored["status"] == "payment_pending"
    assert stored["payment"]["order_id"] == "order_test_api_001"
    assert stored["execution_count"] == 1


def test_execute_rejects_execution_already_in_progress():
    intent_id = create_test_intent()

    main.intents[intent_id]["approved"] = True
    main.intents[intent_id]["status"] = "execution_in_progress"

    response = client.post(
        f"/execute/{intent_id}"
    )

    assert response.status_code == 409
    assert response.json()["detail"] == (
        "Intent execution is already in progress"
    )

    assert main.intents[intent_id]["status"] == (
        "execution_in_progress"
    )
    assert main.intents[intent_id]["execution_count"] == 0


def test_execute_handles_payment_creation_failure(monkeypatch):
    intent_id = create_test_intent()

    main.intents[intent_id]["approved"] = True

    def failing_create_payment(intent, intent_id=None):
        raise RuntimeError("simulated Razorpay failure")

    monkeypatch.setattr(
        main,
        "create_payment",
        failing_create_payment
    )

    response = client.post(
        f"/execute/{intent_id}"
    )

    assert response.status_code == 502
    assert response.json()["detail"] == (
        "Payment creation failed"
    )

    assert main.intents[intent_id]["status"] == (
        "payment_failed"
    )

    assert main.intents[intent_id]["execution_count"] == 1

    events = [
        event
        for event in main.audit_logs
        if event.intent_id == intent_id
    ]

    assert events[-1].event == "payment_failed"
    assert events[-1].status == "failed"
    assert events[-1].reason == (
        "Razorpay order creation failed"
    )


def test_execute_reuses_existing_pending_payment():
    intent_id = create_test_intent()

    main.intents[intent_id]["approved"] = True
    main.intents[intent_id]["status"] = "payment_pending"
    main.intents[intent_id]["payment"] = {
        "status": "payment_pending",
        "order_id": "order_existing_001",
        "merchant": "Amazon",
        "amount": 5000,
        "currency": "INR",
        "key_id": "rzp_test_fake"
    }

    response = client.post(
        f"/execute/{intent_id}"
    )

    assert response.status_code == 200

    data = response.json()

    assert data["status"] == "payment_pending"
    assert data["idempotent"] is True
    assert data["payment"]["order_id"] == "order_existing_001"

    assert main.intents[intent_id]["execution_count"] == 0


def test_execute_verified_payment_is_idempotent():
    intent_id = create_test_intent()

    main.intents[intent_id]["status"] = "payment_verified"
    main.intents[intent_id]["payment"] = {
        "status": "payment_verified",
        "order_id": "order_verified_001",
        "payment_id": "pay_verified_001",
        "captured": True,
        "signature_verified": True
    }

    response = client.post(
        f"/execute/{intent_id}"
    )

    assert response.status_code == 200

    data = response.json()

    assert data["status"] == "payment_verified"
    assert data["idempotent"] is True
    assert data["payment"]["order_id"] == "order_verified_001"
    assert data["payment"]["payment_id"] == "pay_verified_001"

    assert main.intents[intent_id]["execution_count"] == 0


# ============================================================
# INTENT STATUS
# ============================================================


def test_get_intent_status():
    intent_id = create_test_intent()

    response = client.get(
        f"/intent/{intent_id}"
    )

    assert response.status_code == 200

    data = response.json()

    assert data["intent_id"] == intent_id
    assert data["status"] == "intent_created"
    assert data["approved"] is False
    assert data["payment"] == {}
    assert data["execution_count"] == 0
    assert data["session_id"] is None
    assert data["policy"]["allowed"] is True


def test_get_intent_status_unknown_intent_returns_404():
    response = client.get(
        "/intent/does-not-exist"
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Intent not found"


# ============================================================
# AUDIT
# ============================================================


def test_get_audit_trail():
    intent_id = create_test_intent()

    response = client.get(
        f"/audit/{intent_id}"
    )

    assert response.status_code == 200

    data = response.json()

    assert data["intent_id"] == intent_id
    assert len(data["audit_trail"]) == 2

    events = [
        event["event"]
        for event in data["audit_trail"]
    ]

    assert events == [
        "intent_created",
        "policy_checked"
    ]



def test_payment_verification_records_success_audit_events(
    monkeypatch
):
    intent_id = create_test_intent()

    main.intents[intent_id]["approved"] = True
    main.intents[intent_id]["status"] = "payment_pending"
    main.intents[intent_id]["payment"] = {
        "status": "payment_pending",
        "order_id": "order_verify_001",
        "merchant": "Amazon",
        "amount": 5000,
        "currency": "INR",
        "key_id": "rzp_test_fake"
    }

    fake_verification = {
        "status": "payment_verified",
        "captured": True,
        "amount_rupees": 5000,
        "currency": "INR"
    }

    monkeypatch.setattr(
        main,
        "verify_payment",
        lambda *args, **kwargs: fake_verification
    )

    response = client.post(
        "/payment/verify",
        json={
            "intent_id": intent_id,
            "razorpay_payment_id": "pay_verify_001",
            "razorpay_order_id": "order_verify_001",
            "razorpay_signature": "fake_signature"
        }
    )

    assert response.status_code == 200

    data = response.json()

    assert data["intent_id"] == intent_id
    assert data["status"] == "payment_verified"
    assert data["payment"]["order_id"] == "order_verify_001"
    assert data["payment"]["payment_id"] == "pay_verify_001"
    assert data["payment"]["captured"] is True

    events = [
        event.event
        for event in main.audit_logs
        if event.intent_id == intent_id
    ]

    assert events[-3:] == [
        "payment_signature_verified",
        "execution_completed",
        "payment_captured"
    ]

def test_get_audit_unknown_intent_returns_404():
    response = client.get(
        "/audit/does-not-exist"
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Intent not found"
