from pydantic import BaseModel
from typing import List


class RecommendationRequest(BaseModel):
    query: str
    max_price: int


class RecommendedProduct(BaseModel):
    product_id: str
    name: str
    price: int
    currency: str
    reason: str


class RecommendationResponse(BaseModel):
    products: List[RecommendedProduct]
    explanation: str