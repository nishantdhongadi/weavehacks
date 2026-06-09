import asyncio
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from dotenv import load_dotenv

from weave_utils import init_weave
from memory.redis_client import setup_streams, get_index, list_memories
from swarms.immune.validator import run_validator_loop
from swarms.immune.curator import receive_proposals, approve_quarantine, approve_quarantine_swap, reject_quarantine, get_pending_proposals
from swarms.immune.consolidator import run_consolidation_pass
from swarms.workers.orchestrator import answer_query, store_memory

load_dotenv()

# Initialize Weave FIRST, before any @weave.op functions are called
init_weave()


async def _consolidation_loop(interval_seconds: int = 60):
    """Periodically merge near-duplicate memories in the background."""
    while True:
        await asyncio.sleep(interval_seconds)
        try:
            await run_consolidation_pass()
        except Exception as e:
            print(f"[consolidator] background pass error: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await get_index()
    await setup_streams()
    validator_task = asyncio.create_task(run_validator_loop())
    consolidator_task = asyncio.create_task(_consolidation_loop(600))  # every 10 min — don't fire during 3-min demo
    yield
    validator_task.cancel()
    consolidator_task.cancel()


app = FastAPI(title="Memory Immune System", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class QueryRequest(BaseModel):
    query: str
    session_id: str = "default"


class MemoryRequest(BaseModel):
    content: str
    source_agent: str = "user"
    session_id: str = "default"
    trust_score: float = 1.0


@app.post("/query")
async def query(req: QueryRequest):
    answer = await answer_query(req.query, req.session_id)
    return {"answer": answer}


@app.post("/memory")
async def add_memory(req: MemoryRequest):
    from swarms.workers.orchestrator import embed
    embedding = await embed(req.content)
    from memory.schemas import Memory
    mem = Memory(content=req.content, source_agent=req.source_agent,
                 session_id=req.session_id, trust_score=req.trust_score,
                 embedding=embedding)
    from memory.redis_client import write_memory
    mem_id = await write_memory(mem)
    return {"id": mem_id}


@app.get("/memories")
async def get_memories(status: str | None = None):
    """
    List all memories. Optional ?status=active|quarantined filter.
    Used by the frontend MemoryGraph to poll for live state.
    """
    mems = await list_memories(status_filter=status)
    return [m.model_dump(exclude={"embedding"}) for m in mems]


@app.get("/proposals")
async def list_proposals():
    await receive_proposals()
    return [p.model_dump() for p in await get_pending_proposals()]


@app.post("/proposals/{target_id}/approve")
async def approve(target_id: str):
    ok = await approve_quarantine(target_id)
    return {"approved": ok}


@app.post("/proposals/{target_id}/approve-swap")
async def approve_swap(target_id: str):
    """Quarantine the keep_id instead — human chose the other memory."""
    ok = await approve_quarantine_swap(target_id)
    return {"approved_swapped": ok}


@app.post("/proposals/{target_id}/reject")
async def reject(target_id: str):
    ok = await reject_quarantine(target_id)
    return {"rejected": ok}


@app.post("/consolidate")
async def consolidate():
    count = await run_consolidation_pass()
    return {"merged": count}


@app.post("/reset")
async def reset_demo():
    """Delete all mem:* keys and reset the immune stream. Lets you re-run the demo cleanly."""
    from memory.redis_client import get_redis, MEMORY_STREAM, IMMUNE_STREAM, CONSUMER_GROUP
    from swarms.immune.curator import PENDING_KEY
    r = await get_redis()
    keys = await r.keys("mem:*")
    if keys:
        await r.delete(*keys)
    await r.delete(PENDING_KEY)
    for stream in (MEMORY_STREAM, IMMUNE_STREAM):
        await r.delete(stream)
    # Re-create consumer groups so the loops don't break
    for stream in (MEMORY_STREAM, IMMUNE_STREAM):
        try:
            await r.xgroup_create(stream, CONSUMER_GROUP, id="0", mkstream=True)
        except Exception:
            pass
    return {"reset": True, "deleted_memories": len(keys)}


@app.get("/events")
async def sse_events():
    """Server-Sent Events stream of agent activity across both swarms."""
    from events import event_stream
    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/health")
async def health():
    return {"status": "ok"}
