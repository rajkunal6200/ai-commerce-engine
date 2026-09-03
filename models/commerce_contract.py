from typing import List, Optional

from pydantic import BaseModel, Field


class BuyerConstraints(BaseModel):
    query: str
    category: Optional[str] = None
    max_budget: Optional[int] = Field(default=None, gt=0)
    min_budget: Optional[int] = Field(default=None, gt=0)
    required_tags: List[str] = Field(default_factory=list)
    preferred_tags: List[str] = Field(default_factory=list)
    exclude_tags: List[str] = Field(default_factory=list)


class MerchantRules(BaseModel):
    currency: str = "INR"
    user_approval_required: bool = True
    max_discount_percent: float = Field(default=0, ge=0, le=100)


class CommerceOffer(BaseModel):
    product_id: str
    product_name: str
    base_amount: int = Field(gt=0)
    discount_amount: int = Field(default=0, ge=0)
    final_amount: int = Field(gt=0)
    currency: str = "INR"


class CommerceContract(BaseModel):
    buyer: BuyerConstraints
    merchant: MerchantRules
    offer: CommerceOffer
    policy_approved: bool = False
    user_authorized: bool = False
    intent_id: Optional[str] = None
