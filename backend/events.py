"""
Agent activity event broadcast system.

emit() is called from within agent functions to publish structured events.
The /events SSE endpoint fans these out to all connected frontend clients.
"""
import asyncio
import json
import time
from typing import AsyncGenerator

# All active SSE subscriber queues
_subscribers: list[asyncio.Queue] = []


def emit(swarm: str, agent: str, event: str, detail: str = "") -> None:
    """Fire-and-forget: broadcast an agent activity event to all SSE subscribers."""
    payload = {
        "swarm": swarm,   # "worker" | "immune"
        "agent": agent,   # e.g. "Orchestrator", "Validator"
        "event": event,   # e.g. "handoff", "scan", "conflict"
        "detail": detail,
        "ts": time.time(),
    }
    data = json.dumps(payload)
    dead: list[asyncio.Queue] = []
    for q in _subscribers:
        try:
            q.put_nowait(data)
        except asyncio.QueueFull:
            dead.append(q)
    for q in dead:
        try:
            _subscribers.remove(q)
        except ValueError:
            pass


async def event_stream() -> AsyncGenerator[str, None]:
    """
    Async generator consumed by the /events SSE endpoint.
    Yields raw SSE-formatted strings.
    """
    q: asyncio.Queue = asyncio.Queue(maxsize=200)
    _subscribers.append(q)
    # Send a heartbeat immediately so the client knows the connection is alive
    yield "data: {\"event\": \"connected\"}\n\n"
    try:
        while True:
            try:
                data = await asyncio.wait_for(q.get(), timeout=15.0)
                yield f"data: {data}\n\n"
            except asyncio.TimeoutError:
                # Keep-alive heartbeat every 15 s
                yield "data: {\"event\": \"heartbeat\"}\n\n"
    finally:
        try:
            _subscribers.remove(q)
        except ValueError:
            pass
