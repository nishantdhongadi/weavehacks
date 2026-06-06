import os
import weave
from openai import AsyncOpenAI
from agents import Agent, Runner, tool
from memory.redis_client import write_memory, search_similar
from memory.schemas import Memory
from dotenv import load_dotenv

load_dotenv()
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
async def retrieve_context(query: str, session_id: str) -> list[str]:
    """Retrieve relevant active memories for a query."""
    embedding = await embed(query)
    memories = await search_similar(embedding, top_k=5)
    active = [m for m in memories if m.status == "active"]
    return [m.content for m in active]


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
async def answer_query(query: str, session_id: str) -> str:
    """Main worker entry point: retrieve context, call LLM, store new memories."""
    context = await retrieve_context(query, session_id)
    context_str = "\n".join(f"- {c}" for c in context) if context else "(no prior memories)"

    messages = [
        {"role": "system", "content": (
            "You are a helpful assistant with access to a shared memory store. "
            "Use the context below to answer accurately. If the context contains conflicting facts, "
            "note the conflict explicitly.\n\nContext:\n" + context_str
        )},
        {"role": "user", "content": query},
    ]
    resp = await _get_client().chat.completions.create(model="gpt-4o-mini", messages=messages)
    answer = resp.choices[0].message.content

    # Store the Q&A as a new memory
    await store_memory(f"Q: {query} | A: {answer}", source_agent="orchestrator", session_id=session_id)
    return answer
