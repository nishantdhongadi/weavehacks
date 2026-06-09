"""
Consolidator agent — merges near-duplicate memories and updates trust scores.
"""
import numpy as np
import weave
from memory.redis_client import get_redis, search_similar, write_memory, get_memory
from memory.schemas import Memory
from openai import AsyncOpenAI
from events import emit
from dotenv import load_dotenv

load_dotenv()
_client: AsyncOpenAI | None = None


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI()
    return _client

COSINE_SIM_THRESHOLD = 0.97


async def cosine_similarity(a: list[float], b: list[float]) -> float:
    va, vb = np.array(a), np.array(b)
    return float(np.dot(va, vb) / (np.linalg.norm(va) * np.linalg.norm(vb)))


@weave.op()
async def merge_memories(mem_a: Memory, mem_b: Memory) -> Memory:
    """Ask the LLM to synthesize two near-duplicate memories into one canonical version."""
    resp = await _get_client().chat.completions.create(
        model="gpt-4o-mini",
        messages=[{
            "role": "user",
            "content": (
                "Merge these two near-duplicate memory entries into a single, more precise statement. "
                "Return only the merged text.\n\n"
                f"Memory A: {mem_a.content}\n"
                f"Memory B: {mem_b.content}"
            ),
        }],
        temperature=0,
    )
    merged_content = resp.choices[0].message.content.strip()

    # Embed merged content
    embed_resp = await _get_client().embeddings.create(
        model="text-embedding-3-small", input=merged_content
    )
    embedding = embed_resp.data[0].embedding

    return Memory(
        content=merged_content,
        source_agent="consolidator",
        session_id=mem_a.session_id,
        trust_score=max(mem_a.trust_score, mem_b.trust_score) + 0.1,
        embedding=embedding,
    )


@weave.op()
async def run_consolidation_pass():
    """Scan active memories and merge near-duplicates."""
    r = await get_redis()
    # Fetch all active memory keys
    keys = await r.keys("mem:*")
    merged_count = 0

    if keys:
        emit("immune", "Consolidator", "scan", f"Scanning {len(keys)} memories for near-duplicates (cosine ≥ {COSINE_SIM_THRESHOLD})…")

    for key in keys:
        mem_id = key.decode().replace("mem:", "") if isinstance(key, bytes) else key.replace("mem:", "")
        mem = await get_memory(mem_id)
        if not mem or mem.status != "active" or not mem.embedding:
            continue

        candidates = await search_similar(mem.embedding, top_k=5, exclude_id=mem_id)
        for candidate in candidates:
            if candidate.status != "active" or not candidate.embedding:
                continue
            sim = await cosine_similarity(mem.embedding, candidate.embedding)
            if sim >= COSINE_SIM_THRESHOLD:
                emit("immune", "Consolidator", "merge", f"Merging near-duplicate pair (sim={sim:.3f}) → canonical memory")
                merged = await merge_memories(mem, candidate)
                await write_memory(merged)
                # Quarantine both originals
                await r.hset(f"mem:{mem_id}", "status", "quarantined")
                await r.hset(f"mem:{candidate.id}", "status", "quarantined")
                merged_count += 1
                break  # one merge per memory per pass

    if merged_count:
        emit("immune", "Consolidator", "complete", f"Merged {merged_count} near-duplicate {'pair' if merged_count == 1 else 'pairs'}")
    print(f"[consolidator] Merged {merged_count} near-duplicate pairs.")
    return merged_count
