"""
Validator agent — the immune swarm's detection organ.

Runs as a Redis Stream consumer. For every new memory written by a worker,
retrieves semantically similar memories and asks the LLM to judge whether any
pair logically contradicts the new one. Emits ConflictReport on true contradictions.

Detection is DETERMINISTIC (contradiction-finding by a reasoning LLM), not fuzzy
outcome-degradation from traces. This is the reliable demo trigger.
"""
import asyncio
import json
import weave
from openai import AsyncOpenAI
from memory.redis_client import get_memory, search_similar
from memory.bus import consume_memory_events, publish_quarantine_proposal
from memory.schemas import ConflictReport, QuarantineProposal
from events import emit
from dotenv import load_dotenv

load_dotenv()

# Lazy-initialized — avoids crash at import time when OPENAI_API_KEY is absent
_client: AsyncOpenAI | None = None


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI()
    return _client


# Cosine DISTANCE ceiling (0=identical, 2=opposite) for a memory to count as a
# candidate. Contradictions are about the same subject, so they sit very close;
# this filters out unrelated noise on a sparse store without dropping real conflicts.
MAX_CANDIDATE_DISTANCE = 1.2


CONTRADICTION_PROMPT = """You are a memory auditor for a multi-agent system.

You will be given a NEW memory and a list of EXISTING memories. Your job is to
determine if any existing memory directly CONTRADICTS the new one.

CONTRADICTION means the two memories assign DIFFERENT values to the SAME attribute
of the SAME subject, such that accepting both would be inconsistent. Examples:
- "X is in City A" vs "X is in City B" → CONTRADICTION (same subject, different location)
- "Use tool A" vs "Use tool B" → CONTRADICTION (same context, different tool)
- "The value is 5" vs "The value is 10" → CONTRADICTION (same attribute, different value)
- "X happens on Monday" vs "X happens on Friday" → CONTRADICTION

Do NOT flag:
- Memories about completely different subjects
- Memories that add detail without conflicting (e.g. "X is in SF" + "X is at 123 Main St, SF")

When two memories assign conflicting values to the same property of the same entity,
that IS a contradiction even if they don't explicitly negate each other.

New memory:
{new_memory}

Existing memories (each prefixed with its [ID: ...]):
{existing_memories}

Respond in JSON only. Use the EXACT id string from the [ID: ...] prefix:
{{
  "has_contradiction": true | false,
  "conflicting_memory_id": "<the id of the conflicting existing memory, or null>",
  "conflicting_memory_content": "<exact text of the conflicting memory, or null>",
  "explanation": "<one sentence explaining the contradiction, or null>",
  "confidence": <0.0 to 1.0>
}}"""


@weave.op()
async def check_for_contradiction(
    new_memory_id: str,
    new_memory_content: str,
    candidates: list[dict],
) -> ConflictReport | None:
    """
    Ask the LLM whether any candidate memory contradicts the new one.
    Returns a ConflictReport if a contradiction is found, else None.
    """
    if not candidates:
        return None

    emit("immune", "Validator", "llm", f"Running contradiction check against {len(candidates)} candidates (temp=0)…")

    existing_text = "\n".join(
        f"[ID: {c['id']}] {c['content']}" for c in candidates
    )
    prompt = CONTRADICTION_PROMPT.format(
        new_memory=new_memory_content,
        existing_memories=existing_text,
    )

    resp = await _get_client().chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
        temperature=0,  # deterministic
    )

    raw = json.loads(resp.choices[0].message.content)

    if not raw.get("has_contradiction") or raw.get("confidence", 0) < 0.7:
        emit("immune", "Validator", "clear", "No contradiction found — memory is clean")
        return None

    candidates_by_id = {c["id"]: c for c in candidates}

    # Primary: match by the id the LLM returned (robust to paraphrase).
    conflicting_id = raw.get("conflicting_memory_id")
    if conflicting_id not in candidates_by_id:
        conflicting_id = None

    # Fallback: match by content (exact, then prefix) for older prompt behaviour.
    conflicting_content = (raw.get("conflicting_memory_content") or "").strip()
    if not conflicting_id and conflicting_content:
        for c in candidates:
            if c["content"].strip() == conflicting_content:
                conflicting_id = c["id"]
                break
        if not conflicting_id:
            for c in candidates:
                if conflicting_content[:40] and conflicting_content[:40] in c["content"]:
                    conflicting_id = c["id"]
                    break

    if not conflicting_id:
        return None

    return ConflictReport(
        memory_a_id=new_memory_id,
        memory_b_id=conflicting_id,
        memory_a_content=new_memory_content,
        memory_b_content=candidates_by_id[conflicting_id]["content"],
        explanation=raw.get("explanation", ""),
        confidence=raw.get("confidence", 0.0),
    )


@weave.op()
async def process_memory_event(memory_id: str) -> QuarantineProposal | None:
    """
    Full validation pipeline for one memory write event:
    1. Fetch the new memory
    2. Find semantically similar active memories (top-10)
    3. Ask LLM to check for contradictions
    4. If conflict found, build a QuarantineProposal (lower-trust memory is targeted)
    """
    mem = await get_memory(memory_id)
    if not mem or not mem.embedding:
        return None

    short_id = memory_id[:8]
    emit("immune", "Validator", "scan", f"New memory {short_id}… — scanning for conflicts")

    # Only consider genuinely-related memories. Without a distance floor a sparse
    # store hands the validator unrelated text and invites false-positive cards.
    candidates = await search_similar(
        mem.embedding, top_k=10, exclude_id=memory_id, max_distance=MAX_CANDIDATE_DISTANCE,
    )
    active_candidates = [
        {"id": c.id, "content": c.content, "trust_score": c.trust_score}
        for c in candidates
        if c.status == "active"
    ]

    emit("immune", "Validator", "knn", f"Found {len(active_candidates)} semantically similar {'memory' if len(active_candidates) == 1 else 'memories'} within distance {MAX_CANDIDATE_DISTANCE}")

    conflict, call = await check_for_contradiction.call(
        new_memory_id=memory_id,
        new_memory_content=mem.content,
        candidates=active_candidates,
    )

    if not conflict:
        return None

    emit("immune", "Validator", "conflict", f"⚠️ Conflict detected ({int(conflict.confidence * 100)}% confidence) — routing to Curator")

    mem_b = await get_memory(conflict.memory_b_id)
    mem_b_trust = mem_b.trust_score if mem_b else 1.0

    # Tie-break favors the ESTABLISHED memory: a NEW write that contradicts an
    # existing one is the suspect unless it is strictly more trusted. This makes
    # the canonical poison-an-established-fact demo quarantine the poison, not the truth.
    if mem.trust_score > mem_b_trust:
        target_id = conflict.memory_b_id          # new write wins; quarantine the old one
        keep_id = memory_id
        target_trust, keep_trust = mem_b_trust, mem.trust_score
    else:
        target_id = memory_id                     # new write is the suspect
        keep_id = conflict.memory_b_id
        target_trust, keep_trust = mem.trust_score, mem_b_trust

    proposal = QuarantineProposal(
        conflict=conflict,
        target_id=target_id,
        keep_id=keep_id,
        reasoning=(
            f"Memory '{target_id[:8]}...' (trust {target_trust:.2f}) contradicts higher/equal-trust "
            f"memory '{keep_id[:8]}...' (trust {keep_trust:.2f}): {conflict.explanation}"
        ),
        weave_call_id=getattr(call, "id", None),
    )

    await publish_quarantine_proposal({
        "proposal": proposal.model_dump_json(),
        "status": "pending",
    })

    emit("immune", "Curator", "proposal", "Quarantine proposal queued — awaiting human approval")

    return proposal


async def run_validator_loop():
    """Background task: consume memory events and validate each one."""
    print("[validator] Starting immune swarm validator...")
    async for msg_id, fields in consume_memory_events(consumer_name="validator-1"):
        memory_id = fields.get("memory_id")
        if not memory_id:
            continue
        try:
            proposal = await process_memory_event(memory_id)
            if proposal:
                print(f"[validator] ⚠️  Conflict detected: {proposal.conflict.explanation}")
        except Exception as e:
            print(f"[validator] ERROR processing {memory_id}: {e}") # keep loop alive
