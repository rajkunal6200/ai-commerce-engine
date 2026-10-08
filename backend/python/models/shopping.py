from pydantic import BaseModel
from typing import List, Optional


class ShoppingRequest(BaseModel):
    query: str
    max_price: int


class ShoppingProduct(BaseModel):
    product_id: str
    name: str
    price: int
    currency: str
    reason: str


class ShoppingResponse(BaseModel):
    buyer_query: str
    budget: int
    recommendations: List[ShoppingProduct]
    cross_sell: List[ShoppingProduct]
    intent_id: Optional[str] = None
    message: str


# ============================================================
# CONVERSATIONAL SHOPPING
# ============================================================

class ConversationalShopRequest(BaseModel):
    message: str
    session_id: Optional[str] = None