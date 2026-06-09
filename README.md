# Memory Immune System

> **WeaveHacks 2026** — a multi-agent memory governance system built in one weekend.

A swarm of worker agents shares one Redis memory store. A second "immune" swarm watches that shared memory and keeps it honest — detecting contradictory writes, quarantining the untrusted memory with human approval, and healing the shared brain live while you watch.

---

## The Problem

When a team of agents shares memory, that memory rots. One bad write silently poisons every agent that reads it:

```
"The API key rotates daily"     ← established truth
"The API key is static"         ← poison injected later
```

Both live in the store. Every agent that reads either one now has a corrupted view. Nobody runs a janitor for shared agent memory — until now.

---

## Live Demo (3 minutes)

1. **Seed truth** — inject trusted facts into shared Redis memory; worker swarm answers correctly
2. **Inject poison** — write a contradicting fact; re-ask the worker swarm → wrong answer
3. **Immune response** — the Validator detects the contradiction; an `ApprovalCard` appears inline in the chat
4. **Human approves** — the poison is quarantined, memory heals, graph updates live
5. **Re-ask** — correct answer restored
6. **Cut to Weave** — full immune-response trace tree, trust history, and human feedback on the exact detection call

---

## Architecture

Two coordinated swarms. The worker swarm does the user's task; the immune swarm governs the shared memory the workers depend on.

```
                         User Query
                             │
                ┌────────────▼─────────────┐
                │   WORKER SWARM           │  — answers queries,
                │   Orchestrator           │    reads/writes shared memory
                │   → Retriever            │    (OpenAI Agents SDK handoffs)
                │   → Answerer             │
                └────────────┬─────────────┘
                             │ read / write
                    ┌────────▼─────────┐
                    │   REDIS          │
                    │  Streams (bus)   │
                    │  RedisVL (KNN)   │
                    │  Hash (docs)     │
                    └────────┬─────────┘
                             │ watch (Stream consumer group)
                ┌────────────▼─────────────┐
                │   IMMUNE SWARM           │
                │   Validator              │  — detects conflicts,
                │   → Curator              │    quarantines on approval,
                │   → Consolidator         │    merges near-duplicates
                └────────────┬─────────────┘
                             │ proposes
                    ┌────────▼─────────┐
                    │  CopilotKit UI   │  — human approves/rejects
                    │  (inline in chat)│    before anything is quarantined
                    └──────────────────┘

         W&B Weave traces EVERY agent call across BOTH swarms
            (audit trail · trust history · human feedback loop)
```

### Agent Roles

| Agent | Swarm | What it does |
|---|---|---|
| **Orchestrator** | Worker | Entry point; hands off to Retriever |
| **Retriever** | Worker | Calls `search_shared_memory` tool → hands off to Answerer |
| **Answerer** | Worker | Writes the final answer using only retrieved memory facts |
| **Validator** | Immune | Consumes memory write events; uses LLM (temp=0, 0.7 confidence floor) to find contradictions |
| **Curator** | Immune | Receives conflict reports; persists proposals; applies approve/reject decisions |
| **Consolidator** | Immune | Merges near-duplicate memories (cosine ≥ 0.97) in a background pass |

### Why contradiction-detection, not trace-based degradation

The Validator finds logical conflicts by *reasoning*: it asks an LLM "do any of these existing memories directly contradict this new one?" at temperature 0 with a 0.7 confidence floor. This fires reliably on real contradictions and doesn't require any ML-fuzzy outcome signal that could fail on a sparse store or during a live demo. No ground-truth degradation required — two memories either conflict or they don't.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router) + CopilotKit (AG-UI) + Tailwind CSS |
| Backend | Python FastAPI + OpenAI Agents SDK |
| Memory store + event bus | Redis Stack (Streams, RedisVL/KNN, Hash) |
| LLM + Embeddings | OpenAI `gpt-4o-mini` + `text-embedding-3-small` |
| Observability | W&B Weave (`@weave.op()` on every agent function) |

---

## Sponsor Integration Details

### Redis (three load-bearing data structures)

- **Streams** — the agent message bus. A worker `XADD`s to `memory:events`; the Validator consumes via `XREADGROUP`/`XACK`, then `XADD`s a quarantine proposal to `immune:events` for the Curator. Two-stage, real event-driven coordination between the swarms.
- **RedisVL** — long-term vector memory. A 1536-dim COSINE KNN index (`text-embedding-3-small`), queried by both the worker Retriever and the Validator's candidate-finding step, with a distance floor (`≤1.2`) to suppress false positives on a sparse store.
- **Hash** — each memory document (content, source agent, trust score, status: `active|quarantined`). Pending proposals are also persisted in a Hash so a backend restart never drops an in-flight approval.

### OpenAI Agents SDK

A real multi-agent handoff chain — not a single-LLM call with a multi-agent label:

```
Orchestrator ──handoff──▶ Retriever (calls search_shared_memory tool)
                              └──handoff──▶ Answerer (writes final answer)
```

Every handoff shows up as a nested span in the Weave trace. A defensive single-call RAG fallback ensures the demo never hard-fails on a transient handoff error.

### CopilotKit / AG-UI

All three primitives in use:

- **Shared state** — `useCopilotReadable` keeps the live proposal list in sync with backend state
- **Generative UI** — inline `MemoryRetrievalCard` and `MemoryStoredCard` components rendered per tool call
- **Human-in-the-loop** — `useCopilotAction` renders `ApprovalCard` **inline in the chat** and blocks the immune swarm until the human makes a decision (approve / swap / keep both)

### W&B Weave

Every agent function across both swarms is decorated with `@weave.op()`:

```python
@weave.op()
async def check_for_contradiction(new_memory_id, new_memory_content, candidates):
    ...

@weave.op()
async def approve_quarantine(target_id):
    ...
```

**Beyond baseline:**
- Human approve/reject decisions are attached as Weave **feedback** on the exact contradiction-detection call that produced them — a recorded trust signal in the audit trail
- `backend/weave_eval.py` runs a **Weave Evaluation** over a labelled dataset of contradicting/compatible memory pairs, producing a reproducible eval dashboard

---

## Project Structure

```
weavehacks/
├── backend/
│   ├── main.py                     # FastAPI app; weave.init() first
│   ├── weave_utils.py              # weave.init() + feedback helpers
│   ├── weave_eval.py               # Weave Evaluation over labelled pairs
│   ├── events.py                   # SSE event bus for the frontend feed
│   ├── memory/
│   │   ├── redis_client.py         # Connection, RedisVL index, Stream setup
│   │   ├── schemas.py              # Memory / ConflictReport / QuarantineProposal
│   │   └── bus.py                  # Redis Streams produce/consume helpers
│   ├── swarms/
│   │   ├── workers/
│   │   │   └── orchestrator.py     # Orchestrator + Retriever + Answerer agents
│   │   └── immune/
│   │       ├── validator.py        # Contradiction detection (the demo trigger)
│   │       ├── curator.py          # Quarantine proposals + human approval
│   │       └── consolidator.py     # Near-duplicate merge (background)
│   └── tests/
│       └── test_validator.py
├── frontend/
│   ├── app/
│   │   ├── page.tsx                # Chat UI + layout + CopilotKit actions
│   │   └── api/copilotkit/         # CopilotKit runtime endpoint
│   └── components/
│       ├── MemoryGraph.tsx          # Live memory node list (active/quarantined)
│       ├── ApprovalCard.tsx         # HITL quarantine approval card
│       ├── AgentFeed.tsx            # Live agent activity SSE feed
│       └── DemoPanel.tsx            # Demo controls (seed / poison / ask / reset)
├── docker-compose.yml
└── .env                            # API keys
```

---

## Setup

### Environment variables

Create `.env` at the repo root:

```env
OPENAI_API_KEY=sk-...
WANDB_API_KEY=...
REDIS_URL=redis://localhost:6379
NEXT_PUBLIC_COPILOTKIT_PUBLIC_API_KEY=...
NEXT_PUBLIC_API_URL=http://localhost:8000
```

### Run with Docker Compose (recommended)

```bash
docker-compose up --build
# Frontend: http://localhost:3000
# Backend:  http://localhost:8000
# RedisInsight: http://localhost:8001
```

### Run locally

```bash
# 1. Redis Stack (required for RedisVL search module)
docker run -p 6379:6379 -p 8001:8001 redis/redis-stack:latest

# 2. Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# 3. Frontend
cd frontend
npm install
npm run dev       # http://localhost:3000
```

### Run the Weave Evaluation

```bash
cd backend
source .venv/bin/activate
python weave_eval.py
# Opens eval dashboard at https://wandb.ai/<entity>/memory-immune-system/weave
```

### Tests

```bash
cd backend
pytest tests/ -v
pytest tests/test_validator.py::test_detects_contradiction -v
```

---

## API Reference

| Method | Path | Description |
|---|---|---|
| `POST` | `/query` | Answer a question using the worker swarm |
| `POST` | `/memory` | Inject a new memory directly |
| `GET` | `/memories` | List all memories (`?status=active\|quarantined`) |
| `GET` | `/proposals` | List pending quarantine proposals |
| `POST` | `/proposals/{id}/approve` | Human approves — quarantine target |
| `POST` | `/proposals/{id}/approve-swap` | Human overrides — quarantine keep instead |
| `POST` | `/proposals/{id}/reject` | Human rejects — keep both |
| `POST` | `/consolidate` | Trigger a manual consolidation pass |
| `POST` | `/reset` | Wipe all memories + proposals (demo reset) |
| `GET` | `/events` | Server-Sent Events stream of agent activity |
| `GET` | `/health` | Health check |

---

## Demo Controls

The **Demo Controls** panel (left sidebar) provides one-click actions:

1. **Seed Truth** — injects a set of consistent, trusted facts about a topic
2. **Inject Poison** — writes a contradicting memory at lower trust
3. **Ask** — queries the worker swarm to show the corrupted answer
4. **Reset** — wipes all memories and proposals for a clean run

After injecting poison, the Validator (running as a background Stream consumer) detects the contradiction within seconds. The `ApprovalCard` appears in both the conflict banner and inline in the chat. Click **Keep this** on the correct memory to quarantine the poison.

---

## Memory Trust Model

Each memory carries a `trust_score` (0–2, default 1.0). When the Validator detects a contradiction:

- The **new write** is the suspect by default (an established memory beats an incoming one at equal trust)
- A new write only displaces an existing memory if its `trust_score` is **strictly higher**
- Human-injected facts default to `trust_score=1.0`; worker-generated Q&A memories default to `0.3` so they never beat user-seeded facts in a tie-break
- Merged (consolidated) memories get `max(trust_a, trust_b) + 0.1`

---

## Weave Traces

Every agent operation is recorded. The immune response tree looks like:

```
answer_query
  └─ embed (query)
  └─ [Runner.run — Orchestrator → Retriever → Answerer]

process_memory_event
  └─ search_similar (KNN)
  └─ check_for_contradiction (temp=0)
       └─ human_review feedback: { decision: "approved", confidence: 0.92 }

approve_quarantine
merge_memories
```

View traces at: `https://wandb.ai/<entity>/memory-immune-system/weave`
