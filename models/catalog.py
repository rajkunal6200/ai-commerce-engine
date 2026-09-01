from pydantic import BaseModel
from typing import List


class Product(BaseModel):
    product_id: str
    name: str
    description: str
    category: str
    price: int
    currency: str
    stock: int
    tags: List[str]