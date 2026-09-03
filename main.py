from fastapi import FastAPI, HTTPException, Request, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

from models.intent import IntentContract
from models.approval import ApprovalRequest
from models.audit import AuditEvent
from models.buyer_intent import BuyerIntent, BuyerIntentRequest, BuyerIntentResponse
from models.catalog import Product
from models.commerce_contract import CommerceContract, BuyerConstraints, MerchantRules, CommerceOffer
from models.offer import OfferRequest, OfferItem, OfferProposal
from models.decision import DecisionTrace, DecisionFactor
from models.revenue import (
    RevenueMetric,
    RevenueOpportunity,
    RevenueAgentResponse
)

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
import os
import logging
from pathlib import Path


app = FastAPI(title="AI Commerce Engine")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s"
)

logger = logging.getLogger("ai-commerce-engine")



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
# REQUEST CORRELATION ID
# ============================================================

@app.middleware("http")
async def add_request_id(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())

    request.state.request_id = request_id

    start_time = time.perf_counter()

    response = await call_next(request)

    duration_ms = (time.perf_counter() - start_time) * 1000

    response.headers["X-Request-ID"] = request_id

    logger.info(
        "request_completed request_id=%s method=%s path=%s status=%s duration_ms=%.2f",
        request_id,
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
    )

    return response


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


def atomic_write_json(path, data):
    temp_path = path.with_suffix(path.suffix + ".tmp")

    temp_path.write_text(
        json.dumps(
            data,
            indent=2,
            default=str
        )
    )

    os.replace(temp_path, path)


def save_intents():
    atomic_write_json(
        INTENTS_FILE,
        intents
    )


def save_audit_logs():
    atomic_write_json(
        AUDIT_LOGS_FILE,
        [
            event.model_dump()
            if isinstance(event, AuditEvent)
            else event
            for event in audit_logs
        ]
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
        "merchant": "AI Commerce Demo Store",
        "products": catalog
    }


@app.post("/buyer-intent", response_model=BuyerIntentResponse)
def create_buyer_intent(request: BuyerIntentRequest):
    query = request.query.lower().strip()
    extracted_budget = extract_budget(request.query)

    category = None
    if "laptop" in query or "computer" in query:
        category = "Laptop"
    elif "headphone" in query:
        category = "Headphones"
    elif "mouse" in query:
        category = "Mouse"

    purpose = None
    if "coding" in query or "developer" in query or "development" in query:
        purpose = "development"
    elif "work" in query or "productivity" in query:
        purpose = "productivity"
    elif "gaming" in query:
        purpose = "gaming"

    tag_map = {
        "wireless": "wireless",
        "productivity": "productivity",
        "audio": "audio",
        "ergonomic": "ergonomic",
        "developer": "developer",
        "accessory": "accessory",
    }

    requested_tags = [
        tag
        for keyword, tag in tag_map.items()
        if keyword in query
    ]

    products = []

    for product in catalog:
        if product.stock <= 0:
            continue

        if extracted_budget is not None and product.price > extracted_budget:
            continue

        if category and product.category != category:
            continue

        score = 0

        if purpose:
            if purpose == "development" and (
                "developer" in product.tags or
                "work" in product.tags
            ):
                score += 3
            elif purpose == "productivity" and "productivity" in product.tags:
                score += 3

        score += sum(
            2 for tag in requested_tags
            if tag in product.tags
        )

        products.append((score, product))

    products.sort(key=lambda item: (-item[0], item[1].price))

    matched_ids = [
        product.product_id
        for _, product in products
    ]

    intent = BuyerIntent(
        raw_query=request.query,
        purpose=purpose,
        category=category,
        max_budget=extracted_budget,
        required_tags=requested_tags,
        preferred_tags=[],
        exclude_tags=[]
    )

    if matched_ids:
        explanation = (
            f"Matched {len(matched_ids)} available product(s) "
            "using budget, category, purpose, and requested features."
        )
    else:
        explanation = (
            "No available catalog product satisfies the "
            "requested budget and constraints."
        )

    return BuyerIntentResponse(
        intent=intent,
        matched_products=matched_ids,
        explanation=explanation
    )


@app.post("/commerce-contract", response_model=CommerceContract)
def create_commerce_contract(request: BuyerIntentRequest):
    query = request.query.strip()

    buyer_response = create_buyer_intent(request)
    buyer_intent = buyer_response.intent

    if not buyer_response.matched_products:
        raise HTTPException(
            status_code=404,
            detail="No product satisfies the buyer constraints."
        )

    selected_product_id = buyer_response.matched_products[0]

    product = next(
        (
            item
            for item in catalog
            if item.product_id == selected_product_id
        ),
        None
    )

    if product is None:
        raise HTTPException(
            status_code=404,
            detail="Matched product is no longer available."
        )

    buyer = BuyerConstraints(
        query=query,
        category=buyer_intent.category,
        max_budget=buyer_intent.max_budget,
        min_budget=buyer_intent.min_budget,
        required_tags=buyer_intent.required_tags,
        preferred_tags=buyer_intent.preferred_tags,
        exclude_tags=buyer_intent.exclude_tags
    )

    merchant = MerchantRules(
        currency=product.currency,
        user_approval_required=True,
        max_discount_percent=0
    )

    offer = CommerceOffer(
        product_id=product.product_id,
        product_name=product.name,
        base_amount=product.price,
        discount_amount=0,
        final_amount=product.price,
        currency=product.currency
    )

    return CommerceContract(
        buyer=buyer,
        merchant=merchant,
        offer=offer,
        policy_approved=False,
        user_authorized=False
    )


@app.get("/commerce-profile")
def get_commerce_profile():
    return {
        "protocol": "ai-commerce-profile-v1",
        "merchant": "AI Commerce Demo Store",
        "description": "AI-native merchant catalog for bounded, auditable commerce.",
        "currency": "INR",
        "capabilities": {
            "catalog_discovery": True,
            "natural_language_shopping": True,
            "recommendations": True,
            "cross_sell": True,
            "bounded_purchase_intent": True,
            "user_approval_required": True,
            "razorpay_payment": True,
            "server_side_payment_verification": True,
            "audit_trail": True
        },
        "purchase_rules": {
            "approval_required": True,
            "execution_is_bounded_by_intent": True,
            "payment_is_server_verified": True
        },
        "products": [
            {
                "product_id": product.product_id,
                "name": product.name,
                "description": product.description,
                "category": product.category,
                "price": product.price,
                "currency": product.currency,
                "stock": product.stock,
                "available": product.stock > 0,
                "tags": product.tags
            }
            for product in catalog
        ]
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
    max_price: int,
    preferred_tags=None,
    excluded_tags=None
):
    preferred_tags = [
        tag.lower()
        for tag in (preferred_tags or [])
    ]

    excluded_tags = [
        tag.lower()
        for tag in (excluded_tags or [])
    ]

    raw_words = query.lower().split()

    query_words = [
        word.strip(".,!?")
        for word in raw_words
        if word.strip(".,!?") not in STOP_WORDS
    ]

    matches = []

    # Explicit product categories in the buyer query are hard
    # constraints. A different category must never win merely
    # because it shares a feature such as "wireless".
    requested_category = None

    category_aliases = {
        "laptop": "laptop",
        "laptops": "laptop",
        "headphone": "headphones",
        "headphones": "headphones",
        "mouse": "mouse",
        "mice": "mouse",
    }

    for word in query_words:
        if word in category_aliases:
            requested_category = category_aliases[word]
            break

    for product in catalog:

        if product.price > max_price:
            continue

        if product.stock <= 0:
            continue

        if (
            requested_category is not None
            and product.category.lower() != requested_category
        ):
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

        # Personalization safety boundary:
        # excluded preferences always remove the product.
        if any(tag in product_tags for tag in excluded_tags):
            continue

        score = 0

        # Personalization boost:
        # preferred tags improve ranking but never bypass
        # budget, stock, or relevance requirements.
        preferred_matches = sum(
            1
            for tag in preferred_tags
            if tag in product_tags
        )

        score += preferred_matches * 2
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
        request.max_price,
        request.preferred_tags,
        request.excluded_tags
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

    decision_trace = DecisionTrace(
        decision_type="recommendation",
        decision=(
            "Recommend matching in-stock products within "
            "the buyer's maximum price."
        ),
        factors=[
            DecisionFactor(
                factor="buyer_query",
                value=request.query,
                impact="Determines product relevance."
            ),
            DecisionFactor(
                factor="maximum_price",
                value=f"INR {request.max_price}",
                impact="Excludes products above the buyer's budget."
            ),
            DecisionFactor(
                factor="relevance",
                value=f"{len(recommended_products)} matching product(s)",
                impact="Prioritizes products matching the buyer's intent."
            ),
            DecisionFactor(
                factor="availability",
                value="in-stock products only",
                impact="Prevents unavailable products from being recommended."
            ),
            DecisionFactor(
                factor="preferred_tags",
                value=(
                    ", ".join(request.preferred_tags)
                    if request.preferred_tags
                    else "none"
                ),
                impact="Boosts products matching the buyer's stated preferences."
            ),
            DecisionFactor(
                factor="excluded_tags",
                value=(
                    ", ".join(request.excluded_tags)
                    if request.excluded_tags
                    else "none"
                ),
                impact="Removes products containing buyer-excluded attributes."
            ),
        ],
        explanation=explanation
    )

    return RecommendationResponse(
        products=recommended_products,
        explanation=explanation,
        decision_trace=decision_trace
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
# OFFER ENGINE
# ============================================================

@app.post(
    "/offer",
    response_model=OfferProposal
)
def create_offer(
    request: OfferRequest
):

    # --------------------------------------------------------
    # 1. Find primary product
    # --------------------------------------------------------

    primary_product = next(
        (
            product
            for product in catalog
            if product.product_id == request.product_id
        ),
        None
    )

    if primary_product is None:

        raise HTTPException(
            status_code=404,
            detail="Product not found"
        )

    if primary_product.stock <= 0:

        raise HTTPException(
            status_code=409,
            detail="Primary product is out of stock"
        )

    # --------------------------------------------------------
    # 2. Find complementary products
    # --------------------------------------------------------

    complementary_products = []

    if (
        request.max_budget is not None
        and primary_product.price > request.max_budget
    ):
        raise HTTPException(
            status_code=422,
            detail="Primary product exceeds the buyer budget"
        )

    current_total = primary_product.price

    for product in catalog:

        if len(complementary_products) >= request.max_items:
            break

        if product.product_id == primary_product.product_id:
            continue

        if product.stock <= 0:
            continue

        compatible = False

        if primary_product.category == "Mouse":

            compatible = product.category in [
                "Headphones",
                "Laptop"
            ]

        elif primary_product.category == "Laptop":

            compatible = product.category in [
                "Mouse",
                "Headphones"
            ]

        elif primary_product.category == "Headphones":

            compatible = product.category in [
                "Mouse",
                "Laptop"
            ]

        if not compatible:
            continue

        if (
            request.max_budget is not None
            and current_total + product.price > request.max_budget
        ):
            continue

        complementary_products.append(
            OfferItem(
                product_id=product.product_id,
                name=product.name,
                price=product.price,
                currency=product.currency,
                reason=(
                    f"Useful complementary product for "
                    f"{primary_product.name}."
                )
            )
        )

        current_total += product.price

    # --------------------------------------------------------
    # 3. Bundle size is enforced during selection
    # --------------------------------------------------------

    primary_item = OfferItem(
        product_id=primary_product.product_id,
        name=primary_product.name,
        price=primary_product.price,
        currency=primary_product.currency,
        reason="Primary product selected from the merchant catalog."
    )

    # --------------------------------------------------------
    # 4. Calculate real bundle amount
    # --------------------------------------------------------

    subtotal = primary_product.price + sum(
        item.price
        for item in complementary_products
    )

    # No discount is invented.
    # A discount can only be introduced later through
    # an explicit merchant-configured rule.

    discount_amount = 0

    final_amount = subtotal

    discount_percent = 0.0

    # --------------------------------------------------------
    # 5. Explain the bounded offer
    # --------------------------------------------------------

    if complementary_products:

        explanation = (
            f"Bundle proposal combines {primary_product.name} "
            f"with {len(complementary_products)} complementary "
            "in-stock product(s). Pricing uses the merchant "
            "catalog and no discount is applied."
        )

    else:

        explanation = (
            f"No complementary in-stock products were available "
            f"for {primary_product.name}. The offer contains only "
            "the primary product."
        )

    bounded_by = [
        "merchant_catalog_prices",
        "stock_availability",
        "explicit_product_compatibility",
        "no_unconfigured_discount"
    ]

    if request.max_budget is not None:
        bounded_by.append("buyer_max_budget")

    decision_trace = DecisionTrace(
        decision_type="offer",
        decision=(
            f"Build a bounded offer for {primary_product.name} "
            "using catalog, stock, compatibility, and buyer constraints."
        ),
        factors=[
            DecisionFactor(
                factor="primary_product",
                value=primary_product.name,
                impact="Selected from the merchant catalog."
            ),
            DecisionFactor(
                factor="complementary_products",
                value=f"{len(complementary_products)} selected",
                impact="Only compatible and in-stock products were included."
            ),
            DecisionFactor(
                factor="budget",
                value=(
                    f"INR {request.max_budget}"
                    if request.max_budget is not None
                    else "not specified"
                ),
                impact="Limits the total offer when a buyer budget is provided."
            ),
            DecisionFactor(
                factor="discount",
                value=f"{discount_percent}% / INR {discount_amount}",
                impact="No unconfigured discount is applied."
            ),
        ],
        explanation=explanation
    )

    return OfferProposal(
        primary_product=primary_item,
        complementary_products=complementary_products,
        subtotal=subtotal,
        discount_amount=discount_amount,
        final_amount=final_amount,
        currency=primary_product.currency,
        discount_percent=discount_percent,
        explanation=explanation,
        bounded_by=bounded_by,
        decision_trace=decision_trace
    )



def _create_offer_from_contract(
    contract: CommerceContract
) -> OfferProposal:

    # 1. Validate merchant currency
    if contract.merchant.currency != contract.offer.currency:
        raise HTTPException(
            status_code=422,
            detail="Contract merchant currency does not match offer currency."
        )

    # 2. Find contract primary product
    primary_product = next(
        (
            product
            for product in catalog
            if product.product_id == contract.offer.product_id
        ),
        None
    )

    if primary_product is None:
        raise HTTPException(
            status_code=404,
            detail="Contract product not found in merchant catalog."
        )

    if primary_product.stock <= 0:
        raise HTTPException(
            status_code=409,
            detail="Contract product is out of stock."
        )

    # 3. Contract price must match catalog price
    if contract.offer.base_amount != primary_product.price:
        raise HTTPException(
            status_code=409,
            detail="Contract price does not match merchant catalog price."
        )

    # 4. Enforce buyer maximum budget
    max_budget = contract.buyer.max_budget

    if (
        max_budget is not None
        and primary_product.price > max_budget
    ):
        raise HTTPException(
            status_code=422,
            detail="Contract product exceeds the buyer's maximum budget."
        )

    current_total = primary_product.price
    complementary_products = []

    # 5. Select contract-compliant complementary products
    candidates = []

    for product in catalog:

        if product.product_id == primary_product.product_id:
            continue

        if product.stock <= 0:
            continue

        if product.currency != contract.merchant.currency:
            continue

        if any(
            tag in product.tags
            for tag in contract.buyer.exclude_tags
        ):
            continue

        if contract.buyer.required_tags:
            if not all(
                tag in product.tags
                for tag in contract.buyer.required_tags
            ):
                continue

        compatible = False

        if primary_product.category == "Mouse":
            compatible = product.category in ["Headphones", "Laptop"]

        elif primary_product.category == "Laptop":
            compatible = product.category in ["Mouse", "Headphones"]

        elif primary_product.category == "Headphones":
            compatible = product.category in ["Mouse", "Laptop"]

        if not compatible:
            continue

        preferred_matches = sum(
            1
            for tag in contract.buyer.preferred_tags
            if tag in product.tags
        )

        candidates.append((preferred_matches, product))

    candidates.sort(
        key=lambda item: item[0],
        reverse=True
    )

    for preferred_matches, product in candidates:

        if len(complementary_products) >= 2:
            break

        if (
            max_budget is not None
            and current_total + product.price > max_budget
        ):
            continue

        complementary_products.append(
            OfferItem(
                product_id=product.product_id,
                name=product.name,
                price=product.price,
                currency=product.currency,
                reason=(
                    f"Contract-compliant complementary product "
                    f"for {primary_product.name}."
                    + (
                        f" Matches {preferred_matches} preferred tag(s)."
                        if preferred_matches
                        else ""
                    )
                )
            )
        )

        current_total += product.price

    # 6. Calculate final offer
    subtotal = (
        primary_product.price
        + sum(item.price for item in complementary_products)
    )

    # Merchant-bounded dynamic discount
    # The engine may propose up to 5%, but never above
    # the merchant-configured maximum.
    discount_percent = min(
        5.0,
        contract.merchant.max_discount_percent
    )

    discount_amount = int(
        subtotal * discount_percent / 100
    )

    if discount_amount >= subtotal:
        discount_amount = max(0, subtotal - 1)

    if discount_percent > contract.merchant.max_discount_percent:
        raise HTTPException(
            status_code=422,
            detail="Offer discount exceeds the merchant maximum discount."
        )

    final_amount = subtotal - discount_amount

    if final_amount <= 0:
        raise HTTPException(
            status_code=422,
            detail="Contract discount produces an invalid final amount."
        )

    # 7. Audit-friendly bounds
    bounded_by = [
        "commerce_contract",
        "merchant_catalog_prices",
        "stock_availability",
        "explicit_product_compatibility",
        "buyer_constraints",
        "required_tags",
        "excluded_tags",
        "merchant_max_discount"
    ]

    if max_budget is not None:
        bounded_by.append("buyer_max_budget")

    # 8. Primary item
    primary_item = OfferItem(
        product_id=primary_product.product_id,
        name=primary_product.name,
        price=primary_product.price,
        currency=primary_product.currency,
        reason="Primary product selected by the Commerce Contract."
    )

    # 9. Explanation
    if complementary_products:
        explanation = (
            f"Contract-driven bundle combines "
            f"{primary_product.name} with "
            f"{len(complementary_products)} complementary "
            "in-stock product(s). Buyer constraints and "
            "merchant rules were enforced."
        )
    else:
        explanation = (
            f"Contract-driven offer contains "
            f"{primary_product.name}. No additional "
            "contract-compliant complementary products "
            "were available within the buyer constraints."
        )

    # 10. Explainable offer decision
    decision_trace = DecisionTrace(
        decision_type="bounded_offer",
        decision=(
            f"Build a contract-compliant bundle for "
            f"{primary_product.name} with bounded dynamic pricing."
        ),
        factors=[
            DecisionFactor(
                factor="primary_product",
                value=primary_product.name,
                impact="Selected from the merchant catalog and validated against the Commerce Contract."
            ),
            DecisionFactor(
                factor="complementary_products",
                value=f"{len(complementary_products)} selected",
                impact="Only compatible, in-stock products satisfying buyer constraints were included."
            ),
            DecisionFactor(
                factor="subtotal",
                value=f"INR {subtotal}",
                impact="Determines the bundle value before discount."
            ),
            DecisionFactor(
                factor="merchant_discount_limit",
                value=f"{contract.merchant.max_discount_percent}%",
                impact="Sets the absolute merchant-authorized discount ceiling."
            ),
            DecisionFactor(
                factor="applied_discount",
                value=f"{discount_percent}% / INR {discount_amount}",
                impact="Dynamic discount is capped at 5% and cannot exceed the merchant limit."
            ),
            DecisionFactor(
                factor="buyer_budget",
                value=(
                    f"INR {max_budget}"
                    if max_budget is not None
                    else "not specified"
                ),
                impact="Prevents the selected bundle from exceeding the buyer's maximum budget."
            ),
        ],
        explanation=explanation
    )

    # 11. Return offer
    return OfferProposal(
        primary_product=primary_item,
        complementary_products=complementary_products,
        subtotal=subtotal,
        discount_amount=discount_amount,
        final_amount=final_amount,
        currency=primary_product.currency,
        discount_percent=discount_percent,
        explanation=explanation,
        bounded_by=bounded_by,
        decision_trace=decision_trace
    )


@app.post(
    "/offer-from-contract",
    response_model=OfferProposal
)
def create_offer_from_contract(
    contract: CommerceContract
):
    return _create_offer_from_contract(contract)


# ============================================================
# REVENUE AGENT
# ============================================================

@app.get(
    "/revenue-agent",
    response_model=RevenueAgentResponse
)
def revenue_agent():

    completed_orders = 0
    total_revenue = 0.0
    pending_payments = 0
    failed_payments = 0

    product_sales = {}

    for stored in intents.values():

        status = stored.get("status")
        payment = stored.get("payment") or {}
        intent = stored.get("intent")

        # Only a server-verified, captured payment counts
        # as completed revenue.
        if (
            status == "payment_verified"
            and payment.get("captured") is True
        ):

            amount = payment.get("amount")

            if isinstance(amount, (int, float)):

                completed_orders += 1
                total_revenue += float(amount)

            purpose = getattr(intent, "purpose", "")

            for product in catalog:

                if product.name in purpose:

                    product_sales[product.product_id] = (
                        product_sales.get(product.product_id, 0) + 1
                    )

                    break

        elif status in [
            "payment_pending",
            "payment_authorized"
        ]:

            pending_payments += 1

        elif status == "payment_failed":

            failed_payments += 1

    average_order_value = (
        total_revenue / completed_orders
        if completed_orders
        else 0.0
    )

    metrics = [
        RevenueMetric(
            metric="completed_orders",
            value=completed_orders
        ),
        RevenueMetric(
            metric="total_revenue",
            value=total_revenue
        ),
        RevenueMetric(
            metric="average_order_value",
            value=average_order_value
        ),
        RevenueMetric(
            metric="pending_payments",
            value=pending_payments
        ),
        RevenueMetric(
            metric="failed_payments",
            value=failed_payments
        )
    ]

    opportunities = []

    # Identify products with completed sales and suggest
    # complementary catalog products that could increase
    # basket size. No revenue is attributed to the suggestion.
    for product_id, sales_count in product_sales.items():

        purchased_product = next(
            (
                product
                for product in catalog
                if product.product_id == product_id
            ),
            None
        )

        if purchased_product is None:
            continue

        for product in catalog:

            if product.product_id == purchased_product.product_id:
                continue

            if product.stock <= 0:
                continue

            compatible = False

            if purchased_product.category == "Mouse":

                compatible = product.category in [
                    "Headphones",
                    "Laptop"
                ]

            elif purchased_product.category == "Laptop":

                compatible = product.category in [
                    "Mouse",
                    "Headphones"
                ]

            elif purchased_product.category == "Headphones":

                compatible = product.category in [
                    "Mouse",
                    "Laptop"
                ]

            if compatible:

                opportunities.append(
                    RevenueOpportunity(
                        product_id=product.product_id,
                        product_name=product.name,
                        opportunity="Cross-sell",
                        reason=(
                            f"{purchased_product.name} has "
                            f"{sales_count} completed purchase(s). "
                            f"{product.name} is an in-stock "
                            "complementary product."
                        ),
                        potential_action=(
                            f"Offer {product.name} after "
                            f"{purchased_product.name} selection."
                        )
                    )
                )

    if completed_orders:

        explanation = (
            "Revenue metrics are calculated from persisted "
            "commerce intents and server-verified captured "
            "Razorpay payments. Opportunities are catalog-based "
            "cross-sell suggestions and are not counted as revenue."
        )

    else:

        explanation = (
            "No completed server-verified payments are currently "
            "recorded. Revenue is not estimated. Opportunities "
            "are generated only from actual completed purchases."
        )

    # Revenue Agent 2.0 decision intelligence
    revenue_health = (
        "healthy"
        if completed_orders > 0 and failed_payments == 0
        else "attention_required"
        if failed_payments > 0 or pending_payments > 0
        else "no_completed_revenue"
    )

    decision_trace = DecisionTrace(
        decision_type="revenue_analysis",
        decision=(
            "Analyze verified merchant revenue and identify "
            "bounded catalog-based growth opportunities."
        ),
        factors=[
            DecisionFactor(
                factor="completed_orders",
                value=str(completed_orders),
                impact="Counts only server-verified captured payments."
            ),
            DecisionFactor(
                factor="total_revenue",
                value=f"INR {total_revenue:.2f}",
                impact="Measures realized revenue from verified payments."
            ),
            DecisionFactor(
                factor="average_order_value",
                value=f"INR {average_order_value:.2f}",
                impact="Measures the merchant's realized average basket value."
            ),
            DecisionFactor(
                factor="payment_health",
                value=revenue_health,
                impact=(
                    "Highlights pending or failed payment states "
                    "without estimating missing revenue."
                )
            ),
            DecisionFactor(
                factor="cross_sell_opportunities",
                value=str(len(opportunities)),
                impact=(
                    "Identifies compatible in-stock catalog products "
                    "that may increase basket size."
                )
            ),
        ],
        explanation=explanation
    )

    return RevenueAgentResponse(
        merchant="AI Commerce Demo Store",
        completed_orders=completed_orders,
        total_revenue=total_revenue,
        average_order_value=average_order_value,
        pending_payments=pending_payments,
        failed_payments=failed_payments,
        metrics=metrics,
        opportunities=opportunities,
        explanation=explanation,
        data_source=(
            "Persisted purchase intents and server-verified "
            "Razorpay payment records"
        ),
        decision_trace=decision_trace
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
        merchant="AI Commerce Demo Store",
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
            "stage": "discovery",
            "last_intent_id": None,
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
            "stage": conversation["stage"],
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
            "stage": conversation["stage"],
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

        conversation["stage"] = "discovery"

        return {
            "session_id": session_id,
            "buyer_message": request.message,
            "stage": conversation["stage"],
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
        merchant="AI Commerce Demo Store",
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
    # 15A. Create Commerce Contract
    # --------------------------------------------------------

    commerce_contract = CommerceContract(
        buyer=BuyerConstraints(
            query=request.message.strip(),
            category=product.category,
            max_budget=budget,
            required_tags=[],
            preferred_tags=features,
            exclude_tags=[]
        ),
        merchant=MerchantRules(
            currency=product.currency,
            user_approval_required=True,
            max_discount_percent=0
        ),
        offer=CommerceOffer(
            product_id=product.product_id,
            product_name=product.name,
            base_amount=product.price,
            discount_amount=0,
            final_amount=product.price,
            currency=product.currency
        ),
        policy_approved=False,
        user_authorized=False,
        intent_id=intent_id
    )

    # --------------------------------------------------------
    # 15B. Generate validated Offer from Contract
    # --------------------------------------------------------

    offer = _create_offer_from_contract(commerce_contract)

    # Synchronize the Commerce Contract with the validated final offer.
    commerce_contract.offer.final_amount = offer.final_amount
    commerce_contract.policy_approved = policy_result["allowed"]

    # The validated offer is the amount that will actually be purchased.
    # Keep the purchase intent synchronized with that approved offer.
    intent.max_amount = offer.final_amount

    # Re-check policy against the final validated offer amount.
    policy_result = check_policy(intent)

    if not policy_result["allowed"]:
        raise HTTPException(
            status_code=403,
            detail=policy_result["reason"]
        )

    # --------------------------------------------------------
    # 15C. Persist Contract + Offer with Intent
    # --------------------------------------------------------

    intents[intent_id]["commerce_contract"] = commerce_contract
    intents[intent_id]["offer"] = offer

    save_intents()

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
    # 17. Mark conversation stage
    # --------------------------------------------------------

    previous_intent_id = conversation.get("last_intent_id")

    conversation["stage"] = "intent_created"
    conversation["last_intent_id"] = intent_id

    # --------------------------------------------------------
    # 18. Save assistant response
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
        "stage": conversation["stage"],
        "last_intent_id": conversation["last_intent_id"],
        "refined_from_intent_id": previous_intent_id,
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
# AUTONOMOUS COMMERCE LOOP
# ============================================================

@app.get("/commerce-loop/{intent_id}")
def commerce_loop_status(intent_id: str):

    if intent_id not in intents:
        raise HTTPException(
            status_code=404,
            detail="Intent not found"
        )

    stored_intent = intents[intent_id]
    policy = stored_intent.get("policy") or {}
    contract = stored_intent.get("commerce_contract")

    policy_allowed = bool(policy.get("allowed"))
    approved = bool(stored_intent.get("approved"))

    if stored_intent.get("status") == "payment_verified":
        stage = "payment_verified"
        next_action = "none"
    elif stored_intent.get("status") == "payment_authorized":
        stage = "payment_authorized"
        next_action = "await_capture"
    elif stored_intent.get("status") == "payment_pending":
        stage = "payment_pending"
        next_action = "complete_payment"
    elif not policy_allowed:
        stage = "blocked"
        next_action = "none"
    elif not approved:
        stage = "awaiting_approval"
        next_action = "approve"
    else:
        stage = "ready_for_execution"
        next_action = "execute"

    return {
        "intent_id": intent_id,
        "stage": stage,
        "next_action": next_action,
        "policy_allowed": policy_allowed,
        "user_approved": approved,
        "payment_status": stored_intent.get("status"),
        "commerce_contract_present": contract is not None,
        "autonomous_payment": False,
        "message": (
            "Commerce loop is ready for the next safe action. "
            "Payment always requires the existing approval and "
            "execution gates."
        )
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

    if stored_intent.get("commerce_contract"):
        stored_intent["commerce_contract"].user_authorized = approval.approved

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

        stored_intent["status"] = "blocked"

        audit_logs.append(
            AuditEvent(
                intent_id=intent_id,
                event="execution_blocked",
                status="blocked",
                reason="Intent is not allowed by policy"
            )
        )

        save_intents()
        save_audit_logs()

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

    except Exception as exc:

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

        # `order.paid` identifies the paid order directly.
        # A payment_id may not have been stored yet if the webhook
        # arrives before the frontend calls /payment/verify.
        # The order_id has already been matched against server state.

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
        ),
        "commerce_contract": stored.get(
            "commerce_contract"
        ),
        "offer": stored.get(
            "offer"
        )
    }


# ============================================================
# ORDER HISTORY
# ============================================================

@app.get("/orders")
def get_orders():

    orders = []

    for intent_id, stored in intents.items():

        payment = stored.get("payment") or {}

        if not payment:
            continue

        order_id = payment.get("order_id")

        if not order_id:
            continue

        # Expose only real merchant orders.
        if payment.get("merchant") != "AI Commerce Demo Store":
            continue

        if payment.get("amount") is None:
            continue

        orders.append(
            {
                "intent_id": intent_id,
                "order_id": order_id,
                "payment_id": payment.get("payment_id"),
                "status": stored.get(
                    "status",
                    payment.get("status", "unknown")
                ),
                "amount": payment.get("amount"),
                "currency": payment.get(
                    "currency",
                    "INR"
                ),
                "captured": payment.get(
                    "captured",
                    False
                ),
                "merchant": payment.get(
                    "merchant"
                )
            }
        )

    orders.reverse()

    return {
        "orders": orders,
        "count": len(orders)
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