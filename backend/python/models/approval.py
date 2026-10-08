from pydantic import BaseModel


class ApprovalRequest(BaseModel):
    intent_id: str
    approved: bool