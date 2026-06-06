"""
Curator agent — receives quarantine proposals from the validator,
presents them to the human via CopilotKit for approval, then acts.
"""
import json
import weave
from memory.redis_client import quarantine_memory, get_redis, IMMUNE_STREAM, CONSUMER_GROUP
from memory.schemas import QuarantineProposal

# In-memory pending proposals; in prod use Redis Hash
_pending: dict[str, QuarantineProposal] = {}


@weave.op()
async def receive_proposals() -> list[QuarantineProposal]:
    """Pull pending proposals from the immune stream."""
    r = await get_redis()
    messages = await r.xreadgroup(
        groupname=CONSUMER_GROUP,
        consumername="curator-1",
        streams={IMMUNE_STREAM: ">"},
        count=20,
        block=100,
    )
    proposals = []
    for _stream, entries in (messages or []):
        for msg_id, fields in entries:
            raw = fields.get(b"proposal") or fields.get("proposal")
            if raw:
                if isinstance(raw, bytes):
                    raw = raw.decode()
                p = QuarantineProposal.model_validate_json(raw)
                _pending[p.target_id] = p
                proposals.append(p)
            await r.xack(IMMUNE_STREAM, CONSUMER_GROUP, msg_id)
    return proposals


@weave.op()
async def approve_quarantine(target_id: str) -> bool:
    """Human approved — quarantine the target memory."""
    await quarantine_memory(target_id)
    _pending.pop(target_id, None)
    print(f"[curator] ✅ Quarantined memory {target_id[:8]}...")
    return True


@weave.op()
async def reject_quarantine(target_id: str) -> bool:
    """Human rejected — discard the proposal."""
    _pending.pop(target_id, None)
    print(f"[curator] ❌ Proposal rejected for {target_id[:8]}...")
    return True


def get_pending_proposals() -> list[QuarantineProposal]:
    return list(_pending.values())
