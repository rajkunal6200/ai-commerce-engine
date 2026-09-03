from typing import List
from pydantic import BaseModel, Field


class RevenueMetric(BaseModel):
    metric: str
    value: float
    currency: str = "INR"


class RevenueOpportunity(BaseModel):
    product_id: str
    product_name: str
    opportunity: str
    reason: str
    potential_action: str


class RevenueAgentResponse(BaseModel):
    merchant: str
    completed_orders: int = Field(ge=0)
    total_revenue: float = Field(ge=0)
    average_order_value: float = Field(ge=0)
    pending_payments: int = Field(ge=0)
    failed_payments: int = Field(ge=0)
    metrics: List[RevenueMetric] = Field(default_factory=list)
    opportunities: List[RevenueOpportunity] = Field(default_factory=list)
    explanation: str
    data_source: str
