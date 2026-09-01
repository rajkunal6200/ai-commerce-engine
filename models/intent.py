from pydantic import BaseModel, Field


class IntentContract(BaseModel):
    merchant: str
    purpose: str
    max_amount: float = Field(gt=0)
    currency: str = "INR"
    user_approval_required: bool = True