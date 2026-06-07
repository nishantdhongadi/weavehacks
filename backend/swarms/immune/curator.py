"""
Curator agent — receives quarantine proposals from the validator, presents them
to the human via CopilotKit for approval, then acts on the decision.

Two things make this more than a stub:
  1. Pending proposals are persisted in a Redis Hash, so a backend reload
     (uvicorn --reload) never drops an in-flight ApprovalCard.
  2. The human's approve/reject decision is written back to W&B Weave as
     *feedback* on the exact contradiction-detection call that produced the
     proposal — turning the human-in-the-loop step into recorded trust signal.
"""
import weave
from memory.redis_client import quarantine_memory, get_redis, IMMUNE_STREAM, CONSUMER_GROUP
from memory.schemas import QuarantineProposal

PENDING_KEY = "proposals:pending"  # Redis Hash: target_id -> proposal JSON


async def _attach_weave_feedback(call_id: str | None, decision: str, proposal: QuarantineProposal):
    """Record the human decision as Weave feedback on the contradiction call."""
    if not call_id:
        return
    try:
        client = weave.get_client()
        if client is None:
            return
        call = client.get_call(call_id)
        call.feedback.add(
            "human_review",
            {
                "decision": decision,
                "target_id": proposal.target_id,
                "keep_id": proposal.keep_id,
                "confidence": proposal.conflict.confidence,
            },
        )
    except Exception as e:  # feedback is a nice-to-have, never break the flow
        print(f"[curator] weave feedback skipped: {e}")


@weave.op()
async def receive_proposals() -> list[QuarantineProposal]:
    """Drain pending proposals off the immune stream into the Redis pending hash."""
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
                await r.hset(PENDING_KEY, p.target_id, p.model_dump_json())
                proposals.append(p)
            await r.xack(IMMUNE_STREAM, CONSUMER_GROUP, msg_id)
    return proposals


async def _pop_proposal(target_id: str) -> QuarantineProposal | None:
    r = await get_redis()
    raw = await r.hget(PENDING_KEY, target_id)
    if not raw:
        return None
    if isinstance(raw, bytes):
        raw = raw.decode()
    await r.hdel(PENDING_KEY, target_id)
    return QuarantineProposal.model_validate_json(raw)


@weave.op()
async def approve_quarantine(target_id: str) -> bool:
    """Human approved — quarantine the target memory and record the decision."""
    proposal = await _pop_proposal(target_id)
    await quarantine_memory(target_id)
    if proposal:
        await _attach_weave_feedback(proposal.weave_call_id, "approved", proposal)
    print(f"[curator] ✅ Quarantined memory {target_id[:8]}...")
    return True


@weave.op()
async def reject_quarantine(target_id: str) -> bool:
    """Human rejected — discard the proposal and record the decision."""
    proposal = await _pop_proposal(target_id)
    if proposal:
        await _attach_weave_feedback(proposal.weave_call_id, "rejected", proposal)
    print(f"[curator] ❌ Proposal rejected for {target_id[:8]}...")
    return True


async def get_pending_proposals() -> list[QuarantineProposal]:
    r = await get_redis()
    raw = await r.hgetall(PENDING_KEY)
    proposals = []
    for v in (raw or {}).values():
        if isinstance(v, bytes):
            v = v.decode()
        proposals.append(QuarantineProposal.model_validate_json(v))
    return proposals
