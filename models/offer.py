from typing import List, Optional
from pydantic import BaseModel, Field
from models.decision import DecisionTrace


class OfferRequest(BaseModel):
    product_id: str
    max_items: int = Field(default=2, ge=1, le=5)
    max_budget: Optional[int] = Field(default=None, gt=0)


class OfferItem(BaseModel):
    product_id: str
    name: str
    price: int = Field(gt=0)
    currency: str
    reason: str


class OfferProposal(BaseModel):
    primary_product: OfferItem
    complementary_products: List[OfferItem] = Field(default_factory=list)
    subtotal: int = Field(gt=0)
    discount_amount: int = Field(default=0, ge=0)
    final_amount: int = Field(gt=0)
    currency: str
    discount_percent: float = Field(default=0, ge=0, le=100)
    explanation: str
    bounded_by: List[str] = Field(default_factory=list)
    decision_trace: DecisionTrace
