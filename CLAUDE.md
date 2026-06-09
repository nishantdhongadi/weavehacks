# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Project: Memory Immune System

A multi-agent memory governance system built for WeaveHacks 2026 (theme: multi-agent orchestration). A swarm of **worker agents** shares one memory store. A second swarm of **immune-system agents** watches that shared memory and keeps it healthy — detecting contradictory, stale, and duplicate memories, then quarantining and consolidating them **live, with human approval.**

**Problem solved**: When a team of agents shares memory, that memory rots. Contradictory facts, duplicates, and stale entries accumulate and silently degrade every agent that reads them. Nobody runs a janitor for shared agent memory. This is the "memory poisoning / memory rot" problem in multi-agent systems.

**The visceral demo**: poison the shared memory on stage → the worker swarm gives a wrong answer → the immune system *reliably* detects the contradiction (temperature-0 reasoning + a 0.7 confidence floor) → human approves the quarantine → memory heals → the same query now works.

### Core design decision (read this before changing the detection logic)

The immune system's trigger is **reasoning-based contradiction-detection** (temperature 0 + a 0.7 confidence floor for high reliability), NOT fuzzy "outcome degradation from traces." A **Validator agent** reads memories and finds two that *logically conflict* (e.g. "the API key rotates daily" vs. "the API key is static"). This fires reliably and genuinely requires a reasoning agent — there is no ground-truth-signal problem and nothing ML-fuzzy to break on stage.

**Weave's role is the audit + trust-history layer**, not a live predictor: every memory's provenance, usage count, which agent vouched for it, and the full immune-response trace tree. This is the "Best Use of Weave" play AND it can't fail live because it reads recorded data, it doesn't predict.

> Do not regress this into trace-based degradation detection. That version was explicitly rejected as too fragile for a live 3-minute demo. See the demo script below.

---

## Hackathon Requirements (non-negotiable)

- **W&B Weave is mandatory** — every submission must use it. Include the Weave project link in the submission.
- **GitHub repo must be public** before submission.
- **Entire project must be built at the hackathon** (Sat–Sun). Commit early and often — git history is a signal to judges that it's hackathon work.
- **DevPost / Cerebral Valley submission** due Sunday June 7 at 1:00 PM. Link posted Sunday morning.
- **Demo is 3 minutes strictly enforced**, heavy on live demo, max 1–2 slides.
- Submission must include: team name, all members, `<2 min` screen recording, and a description listing **every sponsor tool used and how** (critical for both sponsor and grand prizes).

### Judging Criteria (exact wording from organizers)

1. **Creativity** — unique problem or approach?
2. **Multi-agent harness sophistication** — complex, effective agent environment?
3. **Utility** — solves a real problem?
4. **Technical execution** — does it work? reasonable architecture?
5. **Sponsor usage** — meaningful use of sponsor tools?

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router) + CopilotKit (AG-UI) |
| Backend / Agents | Python FastAPI + OpenAI Agents SDK |
| Memory Store + Bus | Redis (Streams, RedisVL vectors, Hash, Sorted Sets) |
| LLM + Embeddings | OpenAI (`gpt-4o-mini`, `text-embedding-3-small`) |
| Observability | W&B Weave (`@weave.op()` on every agent fn) |

---

## Agent Architecture

Two coordinated swarms. The worker swarm does the user's task; the immune swarm governs the shared memory the workers depend on. This two-layer "swarm governing a swarm" is the multi-agent sophistication story.

```
                         User Query
                             │
                ┌────────────▼─────────────┐
                │   WORKER SWARM           │  ── does the actual task,
                │   (Orchestrator +        │     reads/writes shared memory
                │    task agents)          │
                └────────────┬─────────────┘
                             │ read / write
                    ┌────────▼─────────┐
                    │   REDIS          │
                    │  Streams (bus)   │
                    │  RedisVL (vectors)│
                    │  Hash (memory)   │
                    │  ZSet (trust)    │
                    └────────┬─────────┘
                             │ watch (via Stream consumer)
                ┌────────────▼─────────────┐
                │   IMMUNE SWARM           │
                │   Validator → Curator    │  ── detects conflicts,
                │   → Consolidator         │     quarantines, merges
                └────────────┬─────────────┘
                             │ proposes action
                    ┌────────▼─────────┐
                    │  CopilotKit UI   │  ── human approves quarantine
                    │  (human-in-loop) │     (AG-UI shared state)
                    └──────────────────┘

         W&B Weave traces EVERY agent call across BOTH swarms
            (audit trail + trust history + immune-response tree)
```

### Agent Roles

**Worker Swarm** (`backend/agents/workers/`): An Orchestrator + task agents (OpenAI Agents SDK handoffs) that answer the user's query, reading context from and writing new facts to the shared Redis memory.

**Validator** (`backend/agents/immune/validator.py`): Consumes memory-write events off a Redis Stream. For each new/affected memory, retrieves semantically related memories (RedisVL) and uses an LLM to judge whether any **logically contradict** each other. Emits a structured conflict record. This is the deterministic trigger — it fires on real contradictions, not on a fuzzy score.

**Curator** (`backend/agents/immune/curator.py`): Given a conflict, decides the resolution (quarantine the lower-trust memory, prefer the more recent / higher-provenance one). Proposes the action to the human via CopilotKit rather than acting unilaterally.

**Consolidator** (`backend/agents/immune/consolidator.py`): Merges near-duplicate memories (cosine sim > 0.97) into a single canonical memory and updates trust scores.

---

## Directory Structure

```
engram/
├── frontend/                       # Next.js + CopilotKit
│   ├── app/
│   │   ├── page.tsx                # Chat UI + live memory graph
│   │   └── api/copilotkit/         # CopilotKit runtime endpoint
│   └── components/
│       ├── MemoryGraph.tsx          # Live memory nodes; quarantine animation
│       └── ApprovalCard.tsx         # Human-in-the-loop quarantine approval (generative UI)
├── backend/
│   ├── main.py                     # FastAPI app; weave.init() FIRST
│   ├── agents/
│   │   ├── workers/                # Orchestrator + task agents
│   │   └── immune/                 # validator.py, curator.py, consolidator.py
│   ├── memory/
│   │   ├── redis_client.py         # Connection, RedisVL index, Stream setup
│   │   ├── schemas.py              # Memory doc schema (provenance, trust, usage)
│   │   └── bus.py                  # Redis Streams produce/consume helpers
│   └── weave_utils.py              # weave.init() + trace/audit helpers
├── .env                            # API keys (WANDB_API_KEY already set)
└── docker-compose.yml              # Redis + backend + frontend
```

---

## Commands

### Setup

```bash
# Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Frontend
cd frontend
npm install
```

### Run (development)

```bash
# Start Redis Stack locally (includes RedisVL / search module)
docker run -p 6379:6379 redis/redis-stack:latest

uvicorn main:app --reload --port 8000   # backend, from /backend
npm run dev                              # frontend, from /frontend
```

### Run everything via Docker Compose

```bash
docker-compose up --build
```

### Tests

```bash
cd backend && pytest tests/ -v
pytest tests/test_validator.py::test_detects_contradiction -v   # single test
```

---

## Key Integration Details

### W&B Weave (Required — initialize FIRST, before any agent runs)

```python
import weave
weave.init("weavehacks/memory-immune-system")   # call once at app startup

@weave.op()                                       # decorate EVERY agent fn
async def validate_memory(new_mem: Memory) -> ConflictReport:
    ...
```

Weave auto-instruments OpenAI SDK calls once initialized — captures inputs, outputs, latency, token cost for every traced function across both swarms. The audit view reads these recorded traces; nothing in the demo depends on Weave *predicting* anything live.

**Weavify helper skill** (quick setup): `npx add-skill altryne/weavify-skill`

### Redis — the substrate (three load-bearing data structures)

- **Streams** = the agent message bus + memory event log. Worker writes publish to a Stream; the immune swarm is a Stream consumer group. This is the multi-agent coordination mechanism.
- **RedisVL** = long-term vector memory (`text-embedding-3-small`, DIM 1536, COSINE). Used by both retrieval and the Validator's "find related memories" step.
- **Hash** = each memory document (content, provenance, source agent, timestamp, status: active|quarantined, numeric `trust_score`). Pending quarantine proposals are persisted in a Redis Hash too, so a backend reload never drops an in-flight approval. Trust drives the quarantine target: a contradicting write loses unless it is strictly more trusted than the established memory.

Vectors stored as raw bytes: `np.array(embedding, dtype=np.float32).tobytes()`. Normalize before COSINE search.

### CopilotKit / AG-UI (all three primitives are essential)

- **Shared state** keeps the live memory graph in sync with backend memory state.
- **Generative UI + Human-in-the-loop** — the immune swarm renders its own `ApprovalCard` **inline in the chat** via `useCopilotAction({ renderAndWaitForResponse })`, which blocks the agent until the user approves/rejects before the Curator quarantines anything.

Connects via the `/api/copilotkit` Next.js route using `CopilotRuntime`; `useCoAgent` streams agent state to the frontend.

### W&B MCP Server (development/debugging)

Available in this Claude Code session via `mcp__wandb__*` tools — use it to inspect traces, debug agent runs, and generate reports while building. Hosted endpoint: `https://mcp.withwandb.com/mcp` (Bearer `WANDB_API_KEY`).

---

## Environment Variables

```
OPENAI_API_KEY=          # grab from Alex/Anna at hackathon
WANDB_API_KEY=           # already set in .env
REDIS_URL=redis://localhost:6379
NEXT_PUBLIC_COPILOTKIT_PUBLIC_API_KEY=   # from copilotkit.ai dashboard
```

Credits available at hackathon: $50 W&B Inference, $50 OpenAI, $100 Cursor (fill form + talk to Alex/Anna).

---

## Build Order

Integrate early; do not build the two swarms in isolation and merge at the end.

1. Redis: RedisVL vector index + Streams bus + memory schema (`backend/memory/`)
2. `weave.init()` + `@weave.op()` stubs on every agent (do this first — accumulates traces all weekend)
3. Worker swarm: orchestrator + task agents reading/writing shared memory
4. Validator: Stream consumer + contradiction detection (the demo's reliable trigger — build and test this thoroughly)
5. CopilotKit: live memory graph + human-in-the-loop ApprovalCard
6. Curator + Consolidator: quarantine resolution + dedup merge

---

## Demo Script (3 minutes, strictly enforced)

The whole point is showing the system **break and heal while judges watch.** Rehearse the poison step until it's reliable.

1. **(0:00)** Worker swarm answers a question correctly from shared Redis memory; CopilotKit shows the memory graph.
2. **(0:40)** Inject a poisoned/contradictory memory. Re-ask — workers now give a wrong answer. (Tension.)
3. **(1:20)** Validator (Stream consumer) detects the contradiction; UI surfaces an ApprovalCard: "⚠️ Conflicting memory — quarantine?"
4. **(2:00)** Click approve (human-in-the-loop). Curator quarantines, Consolidator merges; graph visibly heals.
5. **(2:30)** Re-ask → correct answer restored. Cut to Weave: full immune-response trace tree + trust history.
6. **(2:50)** "Redis is the shared brain, the immune swarm keeps it honest, Weave is the receipts."
