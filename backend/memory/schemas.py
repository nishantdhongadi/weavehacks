from pydantic import BaseModel, Field
from typing import Literal
from datetime import datetime
import uuid


class Memory(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    content: str
    source_agent: str
    session_id: str
    status: Literal["active", "quarantined"] = "active"
    trust_score: float = 1.0
    usage_count: int = 0
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    embedding: list[float] | None = None


class ConflictReport(BaseModel):
    memory_a_id: str
    memory_b_id: str
    memory_a_content: str
    memory_b_content: str
    explanation: str
    confidence: float  # 0-1


class QuarantineProposal(BaseModel):
    conflict: ConflictReport
    target_id: str           # the memory to quarantine
    keep_id: str             # the memory to keep
    reasoning: str
    status: Literal["pending", "approved", "rejected"] = "pending"
    # Weave call id of the contradiction-detection op, so the human
    # approve/reject decision can be attached back as Weave feedback.
    weave_call_id: str | None = None
