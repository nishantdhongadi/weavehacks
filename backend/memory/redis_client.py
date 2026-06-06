import os
import json
import numpy as np
import redis.asyncio as aioredis
from redisvl.index import AsyncSearchIndex
from redisvl.schema import IndexSchema
from dotenv import load_dotenv
from .schemas import Memory

load_dotenv()

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
MEMORY_STREAM = "memory:events"
IMMUNE_STREAM = "immune:events"
CONSUMER_GROUP = "immune-swarm"

_redis: aioredis.Redis | None = None
_index: AsyncSearchIndex | None = None

SCHEMA = IndexSchema.from_dict({
    "index": {"name": "memory_idx", "prefix": "mem:", "storage_type": "hash"},
    "fields": [
        {"name": "content", "type": "text"},
        {"name": "source_agent", "type": "tag"},
        {"name": "session_id", "type": "tag"},
        {"name": "status", "type": "tag"},
        {"name": "trust_score", "type": "numeric"},
        {"name": "usage_count", "type": "numeric"},
        {"name": "created_at", "type": "tag"},
        {
            "name": "embedding",
            "type": "vector",
            "attrs": {
                "algorithm": "flat",
                "dims": 1536,
                "distance_metric": "cosine",
                "datatype": "float32",
            },
        },
    ],
})


async def get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(REDIS_URL, decode_responses=False)
    return _redis


async def get_index() -> AsyncSearchIndex:
    global _index
    if _index is None:
        r = await get_redis()
        _index = AsyncSearchIndex(schema=SCHEMA, redis_client=r)
        try:
            await _index.create(overwrite=False)
        except Exception:
            pass  # index already exists
    return _index


async def setup_streams():
    r = await get_redis()
    for stream in (MEMORY_STREAM, IMMUNE_STREAM):
        try:
            await r.xgroup_create(stream, CONSUMER_GROUP, id="0", mkstream=True)
        except Exception:
            pass  # group already exists


async def write_memory(mem: Memory) -> str:
    r = await get_redis()
    index = await get_index()

    vec = np.array(mem.embedding, dtype=np.float32).tobytes() if mem.embedding else b""
    doc = {
        "content": mem.content,
        "source_agent": mem.source_agent,
        "session_id": mem.session_id,
        "status": mem.status,
        "trust_score": mem.trust_score,
        "usage_count": mem.usage_count,
        "created_at": mem.created_at,
        "embedding": vec,
    }
    await r.hset(f"mem:{mem.id}", mapping=doc)

    # Publish to stream for the immune swarm to consume
    await r.xadd(MEMORY_STREAM, {"memory_id": mem.id, "action": "write"})

    return mem.id


async def get_memory(memory_id: str) -> Memory | None:
    r = await get_redis()
    raw = await r.hgetall(f"mem:{memory_id}")
    if not raw:
        return None
    decoded = {k.decode(): v.decode() if isinstance(v, bytes) and k != b"embedding" else v
               for k, v in raw.items()}
    decoded.pop("embedding", None)
    return Memory(id=memory_id, **decoded)


async def search_similar(embedding: list[float], top_k: int = 10, exclude_id: str | None = None) -> list[Memory]:
    r = await get_redis()
    vec = np.array(embedding, dtype=np.float32).tobytes()
    query = (
        f"*=>[KNN {top_k} @embedding $vec AS score]"
    )
    results = await r.execute_command(
        "FT.SEARCH", "memory_idx", query,
        "PARAMS", "2", "vec", vec,
        "RETURN", "6", "content", "source_agent", "session_id", "status", "trust_score", "score",
        "SORTBY", "score",
        "DIALECT", "2",
    )

    memories = []
    # results[0] = count, then pairs of (key, fields)
    items = results[1:]
    for i in range(0, len(items), 2):
        key = items[i].decode() if isinstance(items[i], bytes) else items[i]
        mem_id = key.replace("mem:", "")
        if exclude_id and mem_id == exclude_id:
            continue
        fields = items[i + 1]
        field_dict = {}
        for j in range(0, len(fields), 2):
            k = fields[j].decode() if isinstance(fields[j], bytes) else fields[j]
            v = fields[j + 1].decode() if isinstance(fields[j + 1], bytes) else fields[j + 1]
            field_dict[k] = v
        memories.append(Memory(
            id=mem_id,
            content=field_dict.get("content", ""),
            source_agent=field_dict.get("source_agent", ""),
            session_id=field_dict.get("session_id", "unknown"),
            status=field_dict.get("status", "active"),
            trust_score=float(field_dict.get("trust_score", 1.0)),
        ))
    return memories


async def quarantine_memory(memory_id: str):
    r = await get_redis()
    await r.hset(f"mem:{memory_id}", "status", "quarantined")
