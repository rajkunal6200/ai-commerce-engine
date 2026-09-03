from pydantic import BaseModel
from typing import List
from models.decision import DecisionTrace


class RecommendationRequest(BaseModel):
    query: str
    max_price: int
    preferred_tags: List[str] = []
    excluded_tags: List[str] = []


class RecommendedProduct(BaseModel):
    product_id: str
    name: str
    price: int
    currency: str
    reason: str


class RecommendationResponse(BaseModel):
    products: List[RecommendedProduct]
    explanation: str
    decision_trace: DecisionTrace