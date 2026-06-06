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
from dotenv import load_dotenv

load_dotenv()

# Lazy-initialized — avoids crash at import time when OPENAI_API_KEY is absent
_client: AsyncOpenAI | None = None


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI()
    return _client


CONTRADICTION_PROMPT = """You are a memory auditor for a multi-agent system.

You will be given a NEW memory and a list of EXISTING memories. Your job is to
determine if any existing memory directly CONTRADICTS the new one — meaning they
make mutually exclusive factual claims that cannot both be true.

Do NOT flag:
- Memories that are merely different topics
- Memories that are complementary or additive
- Memories that are vague and could be reconciled

Only flag clear, direct logical contradictions.

New memory:
{new_memory}

Existing memories:
{existing_memories}

Respond in JSON only:
{{
  "has_contradiction": true | false,
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
        return None

    # Find which candidate matched
    conflicting_content = raw.get("conflicting_memory_content", "")
    conflicting_id = None
    for c in candidates:
        if c["content"].strip() == conflicting_content.strip():
            conflicting_id = c["id"]
            break
    # Fuzzy fallback — first partial match
    if not conflicting_id:
        for c in candidates:
            if conflicting_content[:40] in c["content"]:
                conflicting_id = c["id"]
                break

    if not conflicting_id:
        return None

    return ConflictReport(
        memory_a_id=new_memory_id,
        memory_b_id=conflicting_id,
        memory_a_content=new_memory_content,
        memory_b_content=conflicting_content,
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

    candidates = await search_similar(mem.embedding, top_k=10, exclude_id=memory_id)
    active_candidates = [
        {"id": c.id, "content": c.content, "trust_score": c.trust_score}
        for c in candidates
        if c.status == "active"
    ]

    conflict = await check_for_contradiction(
        new_memory_id=memory_id,
        new_memory_content=mem.content,
        candidates=active_candidates,
    )

    if not conflict:
        return None

    mem_b = await get_memory(conflict.memory_b_id)
    mem_b_trust = mem_b.trust_score if mem_b else 0.5

    if mem.trust_score >= mem_b_trust:
        target_id = conflict.memory_b_id
        keep_id = memory_id
    else:
        target_id = memory_id
        keep_id = conflict.memory_b_id

    proposal = QuarantineProposal(
        conflict=conflict,
        target_id=target_id,
        keep_id=keep_id,
        reasoning=(
            f"Memory '{target_id[:8]}...' has lower trust ({min(mem.trust_score, mem_b_trust):.2f}) "
            f"and contradicts '{keep_id[:8]}...': {conflict.explanation}"
        ),
    )

    await publish_quarantine_proposal({
        "proposal": proposal.model_dump_json(),
        "status": "pending",
    })

    return proposal


async def run_validator_loop():
    """Background task: consume memory events and validate each one."""
    print("[validator] Starting immune swarm validator...")
    async for msg_id, fields in consume_memory_events(consumer_name="validator-1"):
        memory_id = fields.get("memory_id")
        if not memory_id:
            continue
        proposal = await process_memory_event(memory_id)
        if proposal:
            print(f"[validator] ⚠️  Conflict detected: {proposal.conflict.explanation}")
