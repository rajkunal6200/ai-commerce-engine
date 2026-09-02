from fastapi import FastAPI, HTTPException, Request, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

from models.intent import IntentContract
from models.approval import ApprovalRequest
from models.audit import AuditEvent
from models.catalog import Product

from models.recommendation import (
    RecommendationRequest,
    RecommendationResponse,
    RecommendedProduct
)

from models.cross_sell import (
    CrossSellRequest,
    CrossSellResponse,
    CrossSellProduct
)

from models.shopping import (
    ShoppingRequest,
    ShoppingResponse,
    ShoppingProduct
)

from policy import check_policy

from payment import (
    create_payment,
    verify_payment,
    verify_webhook_signature
)

import uuid
import re
import json
import time
from pathlib import Path


app = FastAPI(title="AI Commerce Engine")


# ============================================================
# CORS
# ============================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5500",
        "http://127.0.0.1:5500",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# IN-MEMORY STORAGE
# ============================================================

# Persistent state is loaded below after the loader functions are defined.
intents = {}
audit_logs = []

# Stores conversation information between messages.
conversations = {}

# Razorpay webhook event IDs already processed in this process.
processed_webhook_events = set()


# ============================================================
# PERSISTENT WEBHOOK EVENT STORAGE
# ============================================================

WEBHOOK_EVENTS_FILE = Path("webhook_events.json")
INTENTS_FILE = Path("intents.json")
AUDIT_LOGS_FILE = Path("audit_logs.json")


def load_processed_webhook_events():
    if not WEBHOOK_EVENTS_FILE.exists():
        return set()

    try:
        data = json.loads(
            WEBHOOK_EVENTS_FILE.read_text()
        )

        if not isinstance(data, list):
            return set()

        return set(data)

    except (OSError, json.JSONDecodeError):
        return set()


def save_processed_webhook_events(events):
    WEBHOOK_EVENTS_FILE.write_text(
        json.dumps(
            sorted(events),
            indent=2
        )
    )


processed_webhook_events = load_processed_webhook_events()


def load_intents():
    if not INTENTS_FILE.exists():
        return {}

    try:
        data = json.loads(
            INTENTS_FILE.read_text()
        )

        if not isinstance(data, dict):
            return {}

        return data

    except (OSError, json.JSONDecodeError):
        return {}


def load_audit_logs():
    if not AUDIT_LOGS_FILE.exists():
        return []

    try:
        data = json.loads(
            AUDIT_LOGS_FILE.read_text()
        )

        if not isinstance(data, list):
            return []

        return [
            AuditEvent.model_validate(item)
            for item in data
            if isinstance(item, dict)
        ]

    except (OSError, json.JSONDecodeError):
        return []


def save_intents():
    INTENTS_FILE.write_text(
        json.dumps(
            intents,
            indent=2,
            default=str
        )
    )


def save_audit_logs():
    AUDIT_LOGS_FILE.write_text(
        json.dumps(
            [
                event.model_dump()
                if isinstance(event, AuditEvent)
                else event
                for event in audit_logs
            ],
            indent=2,
            default=str
        )
    )




# Load persistent application state after all loader functions are defined.
intents = load_intents()
audit_logs = load_audit_logs()


# ============================================================
# PRODUCT CATALOG
# ============================================================

catalog = [
    Product(
        product_id="LAP001",
        name="ProBook Laptop",
        description="High-performance laptop for work and development",
        category="Laptop",
        price=50000,
        currency="INR",
        stock=10,
        tags=[
            "laptop",
            "work",
            "developer",
            "productivity"
        ]
    ),

    Product(
        product_id="HP001",
        name="SoundMax Headphones",
        description="Wireless headphones with noise cancellation",
        category="Headphones",
        price=5000,
        currency="INR",
        stock=25,
        tags=[
            "headphones",
            "wireless",
            "audio",
            "noise-cancellation"
        ]
    ),

    Product(
        product_id="MS001",
        name="ProMouse",
        description="Wireless ergonomic mouse for productivity",
        category="Mouse",
        price=1500,
        currency="INR",
        stock=40,
        tags=[
            "mouse",
            "wireless",
            "productivity",
            "accessory"
        ]
    )
]


# ============================================================
# STOP WORDS
# ============================================================

STOP_WORDS = {
    "a",
    "an",
    "the",
    "for",
    "to",
    "with",
    "and",
    "or",
    "of",
    "in",
    "on",
    "is",
    "my",
    "me",
    "i",
    "need",
    "want",
    "looking",
    "please",
    "buy",
    "get",
    "something",
    "under",
    "below",
    "less",
    "than"
}


# ============================================================
# ROOT
# ============================================================

@app.get("/")
def root():
    return {
        "message": "AI Commerce Engine is running",
        "status": "ok"
    }


# ============================================================
# CATALOG
# ============================================================

@app.get("/catalog")
def get_catalog():
    return {
        "merchant": "Amazon",
        "products": catalog
    }


# ============================================================
# STEP 19A
# BUYER UNDERSTANDING
# ============================================================

class UnderstandRequest(BaseModel):
    message: str


def extract_budget(message: str):

    text = message.lower()

    match = re.search(
        r"(?:₹|rs\.?|inr)?\s*(\d+(?:,\d+)?)\s*(k)?",
        text
    )

    if not match:
        return None

    number = int(
        match.group(1).replace(",", "")
    )

    if match.group(2) == "k":
        number *= 1000

    return number


def extract_product_type(message: str):

    text = message.lower()

    product_types = {
        "mouse": "mouse",
        "mice": "mouse",
        "headphone": "headphones",
        "headphones": "headphones",
        "laptop": "laptop",
        "laptops": "laptop"
    }

    for word, product_type in product_types.items():

        if word in text:
            return product_type

    return None


def extract_features(message: str):

    text = message.lower()

    possible_features = [
        "wireless",
        "noise cancellation",
        "noise-cancellation",
        "ergonomic",
        "audio",
        "developer",
        "productivity"
    ]

    features = []

    for feature in possible_features:

        if feature in text:
            features.append(feature)

    return features


def extract_purpose(message: str):

    text = message.lower()

    purposes = [
        "work",
        "gaming",
        "productivity",
        "development",
        "developer",
        "study",
        "travel"
    ]

    for purpose in purposes:

        if purpose in text:
            return purpose

    return None


# ============================================================
# UNDERSTAND ENDPOINT
# ============================================================

@app.post("/understand")
def understand_buyer(
    request: UnderstandRequest
):

    product_type = extract_product_type(
        request.message
    )

    features = extract_features(
        request.message
    )

    purpose = extract_purpose(
        request.message
    )

    budget = extract_budget(
        request.message
    )

    return {
        "buyer_message": request.message,
        "understanding": {
            "product_type": product_type,
            "features": features,
            "purpose": purpose,
            "max_price": budget
        },
        "explanation": (
            "The buyer message was converted into "
            "structured shopping requirements."
        )
    }


# ============================================================
# PRODUCT MATCHING
# ============================================================

def find_matching_products(
    query: str,
    max_price: int
):

    raw_words = query.lower().split()

    query_words = [
        word.strip(".,!?")
        for word in raw_words
        if word.strip(".,!?") not in STOP_WORDS
    ]

    matches = []

    for product in catalog:

        if product.price > max_price:
            continue

        if product.stock <= 0:
            continue

        product_name = product.name.lower()
        product_category = product.category.lower()
        product_description = product.description.lower()

        product_tags = [
            tag.lower()
            for tag in product.tags
        ]

        score = 0
        matched_words = []

        for word in query_words:

            if word in product_name:

                score += 5

                if word not in matched_words:
                    matched_words.append(word)

            elif word == product_category:

                score += 5

                if word not in matched_words:
                    matched_words.append(word)

            elif word in product_tags:

                score += 4

                if word not in matched_words:
                    matched_words.append(word)

            elif word in product_description:

                score += 2

                if word not in matched_words:
                    matched_words.append(word)

        if score > 0:

            matches.append(
                {
                    "score": score,
                    "product": product,
                    "matched_words": matched_words
                }
            )

    matches.sort(
        key=lambda item: item["score"],
        reverse=True
    )

    return matches


# ============================================================
# RECOMMENDATION EXPLANATION
# ============================================================

def build_recommendation_reason(
    product,
    matched_words,
    max_price
):

    reasons = []

    meaningful_tags = [
        tag
        for tag in product.tags
        if tag.lower() in matched_words
    ]

    if meaningful_tags:

        if len(meaningful_tags) == 1:

            reasons.append(
                f"it has the {meaningful_tags[0]} feature you asked for"
            )

        else:

            reasons.append(
                "it matches "
                + ", ".join(meaningful_tags)
            )

    if (
        "work" in matched_words
        and "work" in product.description.lower()
    ):

        reasons.append(
            "it is suitable for work"
        )

    if (
        "productivity" in matched_words
        and "productivity" in product.tags
    ):

        reasons.append(
            "it is designed for productivity"
        )

    reasons.append(
        f"it costs ₹{product.price:,}, "
        f"within your ₹{max_price:,} budget"
    )

    unique_reasons = []

    for reason in reasons:

        if reason not in unique_reasons:
            unique_reasons.append(reason)

    return (
        f"{product.name} is a good match because "
        + ", ".join(unique_reasons)
        + "."
    )


# ============================================================
# RECOMMEND
# ============================================================

@app.post(
    "/recommend",
    response_model=RecommendationResponse
)
def recommend_products(
    request: RecommendationRequest
):

    matches = find_matching_products(
        request.query,
        request.max_price
    )

    recommended_products = []

    for item in matches:

        product = item["product"]

        reason = build_recommendation_reason(
            product,
            item["matched_words"],
            request.max_price
        )

        recommended_products.append(
            RecommendedProduct(
                product_id=product.product_id,
                name=product.name,
                price=product.price,
                currency=product.currency,
                reason=reason
            )
        )

    if recommended_products:

        explanation = (
            "Products were ranked using buyer intent, "
            "product relevance, price limit, "
            "and stock availability."
        )

    else:

        explanation = (
            "No in-stock products matched the "
            "buyer's request within the price limit."
        )

    return RecommendationResponse(
        products=recommended_products,
        explanation=explanation
    )


# ============================================================
# CROSS SELL
# ============================================================

@app.post(
    "/cross-sell",
    response_model=CrossSellResponse
)
def cross_sell_products(
    request: CrossSellRequest
):

    main_product = next(
        (
            product
            for product in catalog
            if product.product_id == request.product_id
        ),
        None
    )

    if main_product is None:

        raise HTTPException(
            status_code=404,
            detail="Product not found"
        )

    suggestions = []

    for product in catalog:

        if product.product_id == main_product.product_id:
            continue

        if product.stock <= 0:
            continue

        if main_product.category == "Mouse":

            if product.category in [
                "Headphones",
                "Laptop"
            ]:
                suggestions.append(product)

        elif main_product.category == "Laptop":

            if product.category in [
                "Mouse",
                "Headphones"
            ]:
                suggestions.append(product)

        elif main_product.category == "Headphones":

            if product.category in [
                "Mouse",
                "Laptop"
            ]:
                suggestions.append(product)

    cross_sell_products = []

    for product in suggestions:

        cross_sell_products.append(
            CrossSellProduct(
                product_id=product.product_id,
                name=product.name,
                price=product.price,
                currency=product.currency,
                reason=(
                    f"Useful complementary product for "
                    f"{main_product.name}."
                )
            )
        )

    return CrossSellResponse(
        main_product=main_product.name,
        suggestions=cross_sell_products,
        explanation=(
            "These products were selected as "
            "potential complementary purchases."
        )
    )


# ============================================================
# SHOP
# ============================================================

@app.post(
    "/shop",
    response_model=ShoppingResponse
)
def shopping_agent(
    request: ShoppingRequest
):

    matches = find_matching_products(
        request.query,
        request.max_price
    )

    if not matches:

        return ShoppingResponse(
            buyer_query=request.query,
            budget=request.max_price,
            recommendations=[],
            cross_sell=[],
            intent_id=None,
            message=(
                "I could not find an in-stock product "
                "matching your request within your budget."
            )
        )

    best_match = matches[0]

    main_product = best_match["product"]

    matched_words = best_match["matched_words"]

    recommendation_reason = build_recommendation_reason(
        main_product,
        matched_words,
        request.max_price
    )

    recommendations = [
        ShoppingProduct(
            product_id=main_product.product_id,
            name=main_product.name,
            price=main_product.price,
            currency=main_product.currency,
            reason=recommendation_reason
        )
    ]

    cross_sell = []

    for product in catalog:

        if product.product_id == main_product.product_id:
            continue

        if product.stock <= 0:
            continue

        if product.price > request.max_price:
            continue

        compatible = False

        if main_product.category == "Mouse":

            compatible = product.category in [
                "Headphones",
                "Laptop"
            ]

        elif main_product.category == "Laptop":

            compatible = product.category in [
                "Mouse",
                "Headphones"
            ]

        elif main_product.category == "Headphones":

            compatible = product.category in [
                "Mouse",
                "Laptop"
            ]

        if compatible:

            cross_sell.append(
                ShoppingProduct(
                    product_id=product.product_id,
                    name=product.name,
                    price=product.price,
                    currency=product.currency,
                    reason=(
                        f"Complementary product for "
                        f"{main_product.name}."
                    )
                )
            )

    intent = IntentContract(
        merchant="Amazon",
        purpose=f"Buy {main_product.name}",
        max_amount=main_product.price,
        currency=main_product.currency,
        user_approval_required=True
    )

    intent_id = str(uuid.uuid4())

    policy_result = check_policy(intent)

    intents[intent_id] = {
        "intent": intent,
        "policy": policy_result,
        "approved": False,
        "status": "intent_created",
        "payment": None,
        "execution_count": 0
    }

    save_intents()

    audit_logs.append(
        AuditEvent(
            intent_id=intent_id,
            event="intent_created",
            status="success",
            reason=policy_result["reason"]
        )
    )

    audit_logs.append(
        AuditEvent(
            intent_id=intent_id,
            event="policy_checked",
            status=(
                "allowed"
                if policy_result["allowed"]
                else "blocked"
            ),
            reason=policy_result["reason"]
        )
    )

    save_audit_logs()

    return ShoppingResponse(
        buyer_query=request.query,
        budget=request.max_price,
        recommendations=recommendations,
        cross_sell=cross_sell,
        intent_id=intent_id,
        message=(
            "Product recommended and purchase intent "
            "created. User approval is required before payment."
        )
    )


# ============================================================
# STEP 19B / 19F
# CONVERSATIONAL SHOP + MEMORY
# ============================================================

class ConversationalShopRequest(BaseModel):
    message: str
    session_id: Optional[str] = None


@app.post("/conversational-shop")
def conversational_shop(
    request: ConversationalShopRequest
):

    # --------------------------------------------------------
    # 1. Get or create session
    # --------------------------------------------------------

    session_id = request.session_id

    if session_id is None:
        session_id = str(uuid.uuid4())

    if session_id not in conversations:

        conversations[session_id] = {
            "product_type": None,
            "features": [],
            "purpose": None,
            "max_price": None,
            "history": []
        }

    conversation = conversations[session_id]

    # --------------------------------------------------------
    # 2. Save current message
    # --------------------------------------------------------

    conversation["history"].append(
        {
            "role": "user",
            "message": request.message
        }
    )

    # --------------------------------------------------------
    # 3. Understand current message
    # --------------------------------------------------------

    current_product_type = extract_product_type(
        request.message
    )

    current_features = extract_features(
        request.message
    )

    current_purpose = extract_purpose(
        request.message
    )

    current_budget = extract_budget(
        request.message
    )

    # --------------------------------------------------------
    # 4. Merge current information into memory
    # --------------------------------------------------------

    if current_product_type is not None:

        conversation["product_type"] = current_product_type

    if current_features:

        for feature in current_features:

            if feature not in conversation["features"]:

                conversation["features"].append(feature)

    if current_purpose is not None:

        conversation["purpose"] = current_purpose

    if current_budget is not None:

        conversation["max_price"] = current_budget

    # --------------------------------------------------------
    # 5. Read complete conversation state
    # --------------------------------------------------------

    product_type = conversation["product_type"]

    features = conversation["features"]

    purpose = conversation["purpose"]

    budget = conversation["max_price"]

    # --------------------------------------------------------
    # 6. Budget required
    # --------------------------------------------------------

    if budget is None:

        return {
            "session_id": session_id,
            "buyer_message": request.message,
            "understanding": {
                "product_type": product_type,
                "features": features,
                "purpose": purpose,
                "max_price": None
            },
            "recommendations": [],
            "cross_sell": [],
            "intent_id": None,
            "message": (
                "Please provide a maximum budget "
                "so I can safely recommend a product."
            )
        }

    # --------------------------------------------------------
    # 7. Product type required
    # --------------------------------------------------------

    if product_type is None:

        return {
            "session_id": session_id,
            "buyer_message": request.message,
            "understanding": {
                "product_type": None,
                "features": features,
                "purpose": purpose,
                "max_price": budget
            },
            "recommendations": [],
            "cross_sell": [],
            "intent_id": None,
            "message": (
                "What type of product are you looking for, "
                "such as a mouse, headphones, or laptop?"
            )
        }

    # --------------------------------------------------------
    # 8. Build structured query from memory
    # --------------------------------------------------------

    query_parts = []

    query_parts.append(product_type)

    query_parts.extend(features)

    if purpose:
        query_parts.append(purpose)

    structured_query = " ".join(query_parts)

    # --------------------------------------------------------
    # 9. Search catalog
    # --------------------------------------------------------

    matches = find_matching_products(
        structured_query,
        budget
    )

    # --------------------------------------------------------
    # 10. No matching product
    # --------------------------------------------------------

    if not matches:

        return {
            "session_id": session_id,
            "buyer_message": request.message,
            "understanding": {
                "product_type": product_type,
                "features": features,
                "purpose": purpose,
                "max_price": budget
            },
            "recommendations": [],
            "cross_sell": [],
            "intent_id": None,
            "message": (
                "I could not find an in-stock product "
                "matching your request within your budget."
            )
        }

    # --------------------------------------------------------
    # 11. Best product
    # --------------------------------------------------------

    best_match = matches[0]

    product = best_match["product"]

    matched_words = best_match["matched_words"]

    reason = build_recommendation_reason(
        product,
        matched_words,
        budget
    )

    recommendation = {
        "product_id": product.product_id,
        "name": product.name,
        "price": product.price,
        "currency": product.currency,
        "reason": reason
    }

    # --------------------------------------------------------
    # 12. Cross-sell
    # --------------------------------------------------------

    cross_sell = []

    for other in catalog:

        if other.product_id == product.product_id:
            continue

        if other.stock <= 0:
            continue

        if other.price > budget:
            continue

        compatible = False

        if product.category == "Mouse":

            compatible = other.category in [
                "Headphones",
                "Laptop"
            ]

        elif product.category == "Laptop":

            compatible = other.category in [
                "Mouse",
                "Headphones"
            ]

        elif product.category == "Headphones":

            compatible = other.category in [
                "Mouse",
                "Laptop"
            ]

        if compatible:

            cross_sell.append(
                {
                    "product_id": other.product_id,
                    "name": other.name,
                    "price": other.price,
                    "currency": other.currency,
                    "reason": (
                        f"Complementary product for "
                        f"{product.name}."
                    )
                }
            )

    # --------------------------------------------------------
    # 13. Create bounded purchase intent
    # --------------------------------------------------------

    intent = IntentContract(
        merchant="Amazon",
        purpose=f"Buy {product.name}",
        max_amount=product.price,
        currency=product.currency,
        user_approval_required=True
    )

    intent_id = str(uuid.uuid4())

    # --------------------------------------------------------
    # 14. Policy check
    # --------------------------------------------------------

    policy_result = check_policy(intent)

    # --------------------------------------------------------
    # 15. Store intent
    # --------------------------------------------------------

    intents[intent_id] = {
        "intent": intent,
        "policy": policy_result,
        "approved": False,
        "session_id": session_id,
        "status": "intent_created",
        "payment": None,
        "execution_count": 0
    }

    # --------------------------------------------------------
    # 16. Audit
    # --------------------------------------------------------

    audit_logs.append(
        AuditEvent(
            intent_id=intent_id,
            event="intent_created",
            status="success",
            reason=policy_result["reason"]
        )
    )

    audit_logs.append(
        AuditEvent(
            intent_id=intent_id,
            event="policy_checked",
            status=(
                "allowed"
                if policy_result["allowed"]
                else "blocked"
            ),
            reason=policy_result["reason"]
        )
    )

    # --------------------------------------------------------
    # 17. Save assistant response
    # --------------------------------------------------------

    response_message = (
        "I found a suitable product and created "
        "a purchase intent. User approval is required "
        "before payment."
    )

    conversation["history"].append(
        {
            "role": "assistant",
            "message": response_message
        }
    )

    # --------------------------------------------------------
    # 18. Return
    # --------------------------------------------------------

    return {
        "session_id": session_id,
        "buyer_message": request.message,
        "understanding": {
            "product_type": product_type,
            "features": features,
            "purpose": purpose,
            "max_price": budget
        },
        "recommendations": [
            recommendation
        ],
        "cross_sell": cross_sell,
        "intent_id": intent_id,
        "message": response_message
    }


# ============================================================
# CREATE INTENT
# ============================================================

@app.post("/intent")
def create_intent(
    intent: IntentContract
):

    intent_id = str(uuid.uuid4())

    policy_result = check_policy(intent)

    intents[intent_id] = {
        "intent": intent,
        "policy": policy_result,
        "approved": False,
        "status": "intent_created",
        "payment": None,
        "execution_count": 0
    }

    save_intents()

    audit_logs.append(
        AuditEvent(
            intent_id=intent_id,
            event="intent_created",
            status="success",
            reason=policy_result["reason"]
        )
    )

    audit_logs.append(
        AuditEvent(
            intent_id=intent_id,
            event="policy_checked",
            status=(
                "allowed"
                if policy_result["allowed"]
                else "blocked"
            ),
            reason=policy_result["reason"]
        )
    )

    save_audit_logs()

    return {
        "intent_id": intent_id,
        "intent": intent,
        "policy": policy_result
    }


# ============================================================
# APPROVAL
# ============================================================

@app.post("/approval")
def approve_intent(
    approval: ApprovalRequest
):

    if approval.intent_id not in intents:

        raise HTTPException(
            status_code=404,
            detail="Intent not found"
        )

    stored_intent = intents[approval.intent_id]

    if stored_intent.get("status") == "execution_completed":

        raise HTTPException(
            status_code=409,
            detail="Intent has already been executed"
        )

    stored_intent["approved"] = approval.approved

    stored_intent["status"] = (
        "approved"
        if approval.approved
        else "rejected"
    )

    save_intents()

    audit_logs.append(
        AuditEvent(
            intent_id=approval.intent_id,
            event="approval_received",
            status=(
                "approved"
                if approval.approved
                else "rejected"
            ),
            reason=(
                "User approval"
                if approval.approved
                else "User rejected intent"
            )
        )
    )

    save_audit_logs()

    if approval.approved:

        return {
            "intent_id": approval.intent_id,
            "approved": True,
            "message": "Intent approved"
        }

    return {
        "intent_id": approval.intent_id,
        "approved": False,
        "message": "Intent rejected"
    }


# ============================================================
# EXECUTE PAYMENT / CREATE RAZORPAY ORDER
# ============================================================

@app.post("/execute/{intent_id}")
def execute_intent(
    intent_id: str
):

    if intent_id not in intents:

        raise HTTPException(
            status_code=404,
            detail="Intent not found"
        )

    stored_intent = intents[intent_id]

    # A verified payment is terminal for this intent.
    if stored_intent.get("status") == "payment_verified":

        safe_payment = {
            key: value
            for key, value in (stored_intent.get("payment") or {}).items()
            if not key.startswith("_")
        }

        return {
            "intent_id": intent_id,
            "status": "payment_verified",
            "payment": safe_payment,
            "idempotent": True
        }

    # Reuse the existing Razorpay order when checkout is being retried.
    if (
        stored_intent.get("status") == "payment_pending"
        and stored_intent.get("payment")
    ):

        safe_payment = {
            key: value
            for key, value in (stored_intent.get("payment") or {}).items()
            if not key.startswith("_")
        }

        return {
            "intent_id": intent_id,
            "status": "payment_pending",
            "payment": safe_payment,
            "idempotent": True
        }

    # Prevent concurrent/repeated execution attempts.
    if stored_intent.get("status") == "execution_in_progress":

        raise HTTPException(
            status_code=409,
            detail="Intent execution is already in progress"
        )

    # Policy gate
    if not stored_intent["policy"]["allowed"]:

        audit_logs.append(
            AuditEvent(
                intent_id=intent_id,
                event="execution_blocked",
                status="blocked",
                reason="Intent is not allowed by policy"
            )
        )

        stored_intent["status"] = "blocked"

        raise HTTPException(
            status_code=403,
            detail="Intent is not allowed by policy"
        )

    # Approval gate
    if not stored_intent["approved"]:

        audit_logs.append(
            AuditEvent(
                intent_id=intent_id,
                event="execution_blocked",
                status="blocked",
                reason="User approval is required"
            )
        )

        raise HTTPException(
            status_code=403,
            detail="User approval is required"
        )

    stored_intent["status"] = "execution_in_progress"

    stored_intent["execution_count"] = (
        stored_intent.get("execution_count", 0) + 1
    )

    audit_logs.append(
        AuditEvent(
            intent_id=intent_id,
            event="execution_started",
            status="started",
            reason="Policy and approval gates passed"
        )
    )

    try:

        payment_result = create_payment(
            stored_intent["intent"],
            intent_id=intent_id
        )

        stored_intent["payment"] = payment_result

        stored_intent["status"] = "payment_pending"

        audit_logs.append(
            AuditEvent(
                intent_id=intent_id,
                event="payment_order_created",
                status="success",
                reason=(
                    "Razorpay order created; "
                    "customer payment is still pending"
                )
            )
        )

        save_intents()
        save_audit_logs()

    except Exception:

        stored_intent["status"] = "payment_failed"

        save_intents()

        audit_logs.append(
            AuditEvent(
                intent_id=intent_id,
                event="payment_failed",
                status="failed",
                reason="Razorpay order creation failed"
            )
        )

        raise HTTPException(
            status_code=502,
            detail="Payment creation failed"
        )

    return {
        "intent_id": intent_id,
        "status": "payment_pending",
        "payment": payment_result
    }


# ============================================================
# PAYMENT VERIFICATION
# ============================================================

class PaymentVerificationRequest(BaseModel):
    razorpay_payment_id: str
    razorpay_order_id: str
    razorpay_signature: str


@app.post("/payment/verify")
def verify_payment_endpoint(
    request: PaymentVerificationRequest
):

    # Find the intent using the server-created Razorpay order.
    intent_id = next(
        (
            current_id
            for current_id, stored in intents.items()
            if (stored.get("payment") or {}).get("order_id")
            == request.razorpay_order_id
        ),
        None
    )

    if intent_id is None:

        raise HTTPException(
            status_code=404,
            detail=(
                "Razorpay order is not associated "
                "with a known purchase intent"
            )
        )

    stored_intent = intents[intent_id]

    payment = stored_intent.get("payment") or {}

    server_order_id = payment.get("order_id")

    if server_order_id != request.razorpay_order_id:

        raise HTTPException(
            status_code=400,
            detail="Razorpay order mismatch"
        )

    # --------------------------------------------------------
    # Payment verification idempotency
    # --------------------------------------------------------

    if stored_intent.get("status") == "payment_verified":

        stored_payment_id = payment.get("payment_id")

        if stored_payment_id != request.razorpay_payment_id:

            raise HTTPException(
                status_code=400,
                detail="Payment ID does not match the verified payment"
            )

        safe_payment = {
            key: value
            for key, value in payment.items()
            if not key.startswith("_")
        }

        return {
            "intent_id": intent_id,
            "status": "payment_verified",
            "payment": safe_payment,
            "idempotent": True
        }

    try:

        verification = verify_payment(
            stored_intent["intent"],
            server_order_id=server_order_id,
            razorpay_payment_id=request.razorpay_payment_id,
            razorpay_order_id=request.razorpay_order_id,
            razorpay_signature=request.razorpay_signature
        )

    except ValueError as exc:

        audit_logs.append(
            AuditEvent(
                intent_id=intent_id,
                event="payment_verification_failed",
                status="failed",
                reason=str(exc)
            )
        )

        raise HTTPException(
            status_code=400,
            detail=str(exc)
        )

    except Exception:

        audit_logs.append(
            AuditEvent(
                intent_id=intent_id,
                event="payment_verification_failed",
                status="failed",
                reason="Razorpay verification service error"
            )
        )

        raise HTTPException(
            status_code=502,
            detail="Unable to verify payment with Razorpay"
        )

    stored_intent["payment"].update(
        {
            "status": verification["status"],
            "payment_id": request.razorpay_payment_id,
            "captured": verification["captured"],
            "amount": verification["amount_rupees"],
            "currency": verification["currency"]
        }
    )

    # Never expose or log the signature.
    # Keep it only server-side for audit/idempotency.
    stored_intent["payment"]["signature_verified"] = True

    stored_intent["payment"]["_signature"] = (
        request.razorpay_signature
    )

    audit_logs.append(
        AuditEvent(
            intent_id=intent_id,
            event="payment_signature_verified",
            status="success",
            reason="Razorpay payment signature verified server-side"
        )
    )

    if verification["captured"]:

        stored_intent["status"] = "payment_verified"

        audit_logs.append(
            AuditEvent(
                intent_id=intent_id,
                event="execution_completed",
                status="success",
                reason="Payment was successfully verified and captured"
            )
        )

        audit_logs.append(
            AuditEvent(
                intent_id=intent_id,
                event="payment_captured",
                status="success",
                reason="Razorpay confirms the payment is captured"
            )
        )

        save_intents()
        save_audit_logs()

        return {
            "intent_id": intent_id,
            "status": "payment_verified",
            "payment": {
                "status": "payment_verified",
                "order_id": server_order_id,
                "payment_id": request.razorpay_payment_id,
                "amount": verification["amount_rupees"],
                "currency": verification["currency"],
                "captured": True
            }
        }

    stored_intent["status"] = "payment_authorized"

    audit_logs.append(
        AuditEvent(
            intent_id=intent_id,
            event="payment_authorized",
            status="pending",
            reason=(
                "Signature verified, but payment "
                "is not captured yet"
            )
        )
    )

    return {
        "intent_id": intent_id,
        "status": "payment_authorized",
        "payment": {
            "status": "payment_authorized",
            "order_id": server_order_id,
            "payment_id": request.razorpay_payment_id,
            "amount": verification["amount_rupees"],
            "currency": verification["currency"],
            "captured": False
        }
    }


# ============================================================
# RAZORPAY WEBHOOK
# ============================================================

@app.post("/webhooks/razorpay")
async def razorpay_webhook(
    request: Request,
    x_razorpay_signature: str = Header(
        default="",
        alias="X-Razorpay-Signature"
    ),
    x_razorpay_event_id: str = Header(
        default="",
        alias="x-razorpay-event-id"
    )
):

    raw_body = await request.body()

    # --------------------------------------------------------
    # Verify webhook signature
    # --------------------------------------------------------

    try:

        verify_webhook_signature(
            raw_body,
            x_razorpay_signature
        )

    except ValueError as exc:

        raise HTTPException(
            status_code=400,
            detail=str(exc)
        )

    # --------------------------------------------------------
    # Idempotency
    # --------------------------------------------------------

    if (
        x_razorpay_event_id
        and x_razorpay_event_id in processed_webhook_events
    ):

        return {
            "status": "ignored",
            "reason": "duplicate_event"
        }

    if x_razorpay_event_id:

        processed_webhook_events.add(
            x_razorpay_event_id
        )

        save_processed_webhook_events(
            processed_webhook_events
        )

    # --------------------------------------------------------
    # Parse webhook JSON
    # --------------------------------------------------------

    try:

        payload = json.loads(
            raw_body.decode("utf-8")
        )

    except Exception:

        raise HTTPException(
            status_code=400,
            detail="Invalid webhook JSON"
        )

    # --------------------------------------------------------
    # Reject stale webhook replays
    # --------------------------------------------------------

    created_at = payload.get("created_at")

    if (
        isinstance(created_at, (int, float))
        and abs(time.time() - created_at) > 300
    ):

        raise HTTPException(
            status_code=400,
            detail="Stale Razorpay webhook event"
        )

    # --------------------------------------------------------
    # Extract event
    # --------------------------------------------------------

    event_name = payload.get(
        "event",
        ""
    )

    entity = (
        payload.get("payload", {})
        .get("payment", {})
        .get("entity", {})
    )

    if not entity:

        entity = (
            payload.get("payload", {})
            .get("order", {})
            .get("entity", {})
        )

    # --------------------------------------------------------
    # Extract order/payment IDs
    # --------------------------------------------------------

    order_id = (
        entity.get("order_id")
        or entity.get("id")
    )

    payment_id = (
        entity.get("id")
        if entity.get("entity") == "payment"
        else None
    )

    # --------------------------------------------------------
    # Find intent
    # --------------------------------------------------------

    intent_id = next(
        (
            current_id
            for current_id, stored in intents.items()
            if (stored.get("payment") or {}).get("order_id")
            == order_id
        ),
        None
    )

    if intent_id is None:

        return {
            "status": "ignored",
            "reason": "unknown_order"
        }

    stored_intent = intents[intent_id]

    # --------------------------------------------------------
    # Validate webhook payload against stored payment state
    # --------------------------------------------------------

    payment_state = stored_intent.setdefault(
        "payment",
        {}
    )

    expected_order_id = (payment_state or {}).get("order_id")
    expected_payment_id = (payment_state or {}).get("payment_id")

    if expected_order_id and order_id != expected_order_id:

        return {
            "status": "ignored",
            "reason": "order_id_mismatch"
        }

    # A payment ID is required when the webhook represents
    # a specific payment and one is already stored.
    if (
        payment_id
        and expected_payment_id
        and payment_id != expected_payment_id
    ):

        return {
            "status": "ignored",
            "reason": "payment_id_mismatch"
        }

    # --------------------------------------------------------
    # PAYMENT CAPTURED
    # --------------------------------------------------------

    if event_name == "payment.captured":

        payment_state = stored_intent.setdefault(
            "payment",
            {}
        )

        # ----------------------------------------------------
        # Payment-level idempotency
        # ----------------------------------------------------
        # If this payment was already confirmed by a webhook,
        # do not process the same payment again even when
        # Razorpay sends the event with a different event ID.

        if payment_state.get("webhook_confirmed"):

            return {
                "status": "ignored",
                "reason": "payment_already_confirmed"
            }

        stored_intent["status"] = "payment_verified"

        payment_state.update(
            {
                "status": "payment_verified",
                "payment_id": (
                    payment_id
                    or payment_state.get("payment_id")
                ),
                "captured": True,
                "webhook_confirmed": True
            }
        )

        audit_logs.append(
            AuditEvent(
                intent_id=intent_id,
                event="payment_captured",
                status="success",
                reason=(
                    "Razorpay payment.captured "
                    "webhook received"
                )
            )
        )

    # --------------------------------------------------------
    # ORDER PAID
    # --------------------------------------------------------

    elif event_name == "order.paid":

        payment_state = stored_intent.setdefault(
            "payment",
            {}
        )

        if not expected_payment_id:
            return {
                "status": "ignored",
                "reason": "order_paid_missing_payment_id"
            }

        # ----------------------------------------------------
        # Order-paid webhook idempotency
        # ----------------------------------------------------

        if payment_state.get("order_paid_webhook_confirmed"):

            return {
                "status": "ignored",
                "reason": "order_paid_already_confirmed"
            }

        # ----------------------------------------------------
        # Synchronize payment state
        # ----------------------------------------------------

        stored_intent["status"] = "payment_verified"

        payment_state.update(
            {
                "status": "payment_verified",
                "captured": True,
                "webhook_confirmed": True,
                "order_paid_webhook_confirmed": True
            }
        )

        audit_logs.append(
            AuditEvent(
                intent_id=intent_id,
                event="order_paid",
                status="success",
                reason=(
                    "Razorpay order.paid "
                    "webhook received"
                )
            )
        )

    # --------------------------------------------------------
    # PAYMENT FAILED
    # --------------------------------------------------------

    elif event_name == "payment.failed":

        payment_state = stored_intent.get("payment") or {}
        stored_intent["payment"] = payment_state

        # ----------------------------------------------------
        # Payment-failed webhook idempotency
        # ----------------------------------------------------

        if payment_state.get("failed_webhook_confirmed"):

            return {
                "status": "ignored",
                "reason": "payment_failed_already_confirmed"
            }

        # A verified/captured payment is already terminal.
        # Do not let a late failure webhook downgrade it.
        if stored_intent.get("status") == "payment_verified":

            return {
                "status": "ignored",
                "reason": "payment_already_verified"
            }

        payment_state["failed_webhook_confirmed"] = True
        stored_intent["status"] = "payment_failed"

        audit_logs.append(
            AuditEvent(
                intent_id=intent_id,
                event="payment_failed",
                status="failed",
                reason=(
                    "Razorpay payment.failed "
                    "webhook received"
                )
            )
        )

    save_intents()
    save_audit_logs()

    return {
        "status": "received"
    }


# ============================================================
# INTENT STATUS
# ============================================================

@app.get("/intent/{intent_id}")
def get_intent_status(
    intent_id: str
):

    if intent_id not in intents:

        raise HTTPException(
            status_code=404,
            detail="Intent not found"
        )

    stored = intents[intent_id]

    return {
        "intent_id": intent_id,
        "status": stored.get(
            "status",
            "intent_created"
        ),
        "approved": stored.get(
            "approved",
            False
        ),
        "policy": stored.get(
            "policy"
        ),
        "payment": {
            key: value
            for key, value in (
                stored.get("payment") or {}
            ).items()
            if not key.startswith("_")
        },
        "execution_count": stored.get(
            "execution_count",
            0
        ),
        "session_id": stored.get(
            "session_id"
        )
    }


# ============================================================
# AUDIT TRAIL
# ============================================================

@app.get("/audit/{intent_id}")
def get_audit(
    intent_id: str
):

    if intent_id not in intents:

        raise HTTPException(
            status_code=404,
            detail="Intent not found"
        )

    events = [
        event.model_dump()
        for event in audit_logs
        if event.intent_id == intent_id
    ]

    return {
        "intent_id": intent_id,
        "audit_trail": events
    }