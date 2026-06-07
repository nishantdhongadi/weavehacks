"""
Worker swarm — the agents that actually answer the user's query.

This is a REAL multi-agent system built on the OpenAI Agents SDK with handoffs:

    Orchestrator ──handoff──▶ Retriever ──(search_shared_memory tool)
                                   │
                                   └──handoff──▶ Answerer ──▶ final answer

Each agent is a distinct OpenAI Agents SDK `Agent`, control is transferred via
real `handoff`s, and the Retriever reads the shared Redis/RedisVL memory through
a function tool. Every step shows up as nested spans in the Weave trace, so the
"swarm" is visible, not just claimed.

A defensive single-call fallback guarantees the demo still answers if a handoff
run ever fails live.
"""
import weave
from openai import AsyncOpenAI
from agents import Agent, Runner, function_tool, set_tracing_disabled
from memory.redis_client import write_memory, search_similar
from memory.schemas import Memory
from dotenv import load_dotenv

load_dotenv()

# Rely on Weave for tracing; skip the Agents SDK's own OpenAI-platform exporter
# so there is no extra external dependency that could hang during a live demo.
set_tracing_disabled(True)

_client: AsyncOpenAI | None = None


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI()
    return _client


@weave.op()
async def embed(text: str) -> list[float]:
    resp = await _get_client().embeddings.create(model="text-embedding-3-small", input=text)
    return resp.data[0].embedding


@weave.op()
async def store_memory(content: str, source_agent: str, session_id: str) -> str:
    """Encode and store a new memory, publishing to the immune swarm stream."""
    embedding = await embed(content)
    mem = Memory(
        content=content,
        source_agent=source_agent,
        session_id=session_id,
        embedding=embedding,
    )
    return await write_memory(mem)


@weave.op()
async def retrieve_context(query: str, session_id: str = "default") -> list[str]:
    """Retrieve relevant ACTIVE memories for a query (quarantined ones are excluded)."""
    embedding = await embed(query)
    memories = await search_similar(embedding, top_k=5)
    active = [m for m in memories if m.status == "active"]
    return [m.content for m in active]


# --- Function tool the Retriever agent calls to read shared memory ------------

@function_tool
async def search_shared_memory(query: str) -> str:
    """Search the shared multi-agent memory for facts relevant to the query.

    Returns the ACTIVE (non-quarantined) memories most semantically similar to
    the query. Quarantined memories are never returned.
    """
    facts = await retrieve_context(query)
    if not facts:
        return "No relevant memories found in shared memory."
    return "\n".join(f"- {f}" for f in facts)


# --- The swarm ----------------------------------------------------------------

def _build_swarm() -> Agent:
    """Construct the worker swarm with real handoffs. Cheap to build per request."""
    answerer = Agent(
        name="Answerer",
        model="gpt-4o-mini",
        instructions=(
            "You write the final answer for the user using ONLY the facts the "
            "Retriever gathered from shared memory (they appear earlier in this "
            "conversation). Answer concisely. If the gathered facts contradict "
            "each other, say so explicitly and name the conflicting claims — do "
            "not silently pick one. Never invent facts that are not in memory."
        ),
    )
    retriever = Agent(
        name="Retriever",
        model="gpt-4o-mini",
        instructions=(
            "You gather context. Call search_shared_memory with the user's "
            "question to pull relevant facts from shared memory, then hand off to "
            "the Answerer agent so it can write the final answer. Do not answer "
            "the user yourself."
        ),
        tools=[search_shared_memory],
        handoffs=[answerer],
    )
    orchestrator = Agent(
        name="Orchestrator",
        model="gpt-4o-mini",
        instructions=(
            "You are the entry point of a worker swarm. Immediately hand off to "
            "the Retriever agent to gather memory context for the user's request. "
            "Do not answer directly."
        ),
        handoffs=[retriever],
    )
    return orchestrator


async def _fallback_answer(query: str) -> str:
    """Single-call RAG fallback so the demo never hard-fails on a handoff error."""
    facts = await retrieve_context(query)
    context_str = "\n".join(f"- {f}" for f in facts) if facts else "(no prior memories)"
    messages = [
        {"role": "system", "content": (
            "You are a helpful assistant with access to a shared memory store. "
            "Answer using the context below. If it contains conflicting facts, "
            "note the conflict explicitly.\n\nContext:\n" + context_str
        )},
        {"role": "user", "content": query},
    ]
    resp = await _get_client().chat.completions.create(model="gpt-4o-mini", messages=messages)
    return resp.choices[0].message.content


@weave.op()
async def answer_query(query: str, session_id: str) -> str:
    """Main worker entry point: run the agent swarm, then store the Q&A as memory."""
    orchestrator = _build_swarm()
    try:
        result = await Runner.run(orchestrator, query, max_turns=8)
        answer = result.final_output
    except Exception as e:  # never let a handoff hiccup break the live demo
        print(f"[worker-swarm] handoff run failed ({e}); using fallback")
        answer = await _fallback_answer(query)

    # Store the Q&A as a new memory, authored by the Answerer worker.
    await store_memory(f"Q: {query} | A: {answer}", source_agent="answerer", session_id=session_id)
    return answer
