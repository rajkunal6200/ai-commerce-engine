from pydantic import BaseModel
from typing import List


class CrossSellRequest(BaseModel):
    product_id: str


class CrossSellProduct(BaseModel):
    product_id: str
    name: str
    price: int
    currency: str
    reason: str


class CrossSellResponse(BaseModel):
    main_product: str
    suggestions: List[CrossSellProduct]
    explanation: str