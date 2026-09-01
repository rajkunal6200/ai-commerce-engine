from pydantic import BaseModel
from typing import Optional


class AuditEvent(BaseModel):
    intent_id: str
    event: str
    status: str
    reason: Optional[str] = None