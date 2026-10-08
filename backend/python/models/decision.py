from typing import List
from pydantic import BaseModel, Field


class DecisionFactor(BaseModel):
    factor: str
    value: str
    impact: str


class DecisionTrace(BaseModel):
    decision_type: str
    decision: str
    factors: List[DecisionFactor] = Field(default_factory=list)
    explanation: str
