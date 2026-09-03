from typing import List, Optional
from pydantic import BaseModel, Field


class BuyerIntentRequest(BaseModel):
    query: str


class BuyerIntent(BaseModel):
    raw_query: str
    purpose: Optional[str] = None
    category: Optional[str] = None
    max_budget: Optional[int] = Field(default=None, gt=0)
    min_budget: Optional[int] = Field(default=None, gt=0)
    required_tags: List[str] = []
    preferred_tags: List[str] = []
    exclude_tags: List[str] = []


class BuyerIntentResponse(BaseModel):
    intent: BuyerIntent
    matched_products: List[str]
    explanation: str
