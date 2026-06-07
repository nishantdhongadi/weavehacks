# Memory Immune System — WeaveHacks 2026 Submission

**One line:** A swarm of worker agents shares one Redis memory store; a second
"immune" swarm watches that memory and keeps it honest — detecting contradictory
writes, quarantining the untrusted one with a human in the loop, and healing the
shared brain live.

**Problem:** When a team of agents shares memory, that memory rots. One bad write
("the API key rotates daily" landing next to "the API key is static") silently
poisons every agent that reads it. Nobody runs a janitor for shared agent memory.

**Demo arc (3 min):** seed trusted facts → inject a contradicting poison →
worker swarm's answer is now unreliable → immune swarm detects the contradiction
and surfaces an approval card *inline in chat* → human approves → poison is
quarantined → re-ask → correct answer restored. Then cut to Weave for the receipts.

---

## Sponsor usage (every claim here is verifiable in the running system)

### Redis — the shared substrate (three load-bearing data structures)
- **Streams** are the agent message bus. A worker write `XADD`s to `memory:events`;
  the validator consumes it via a consumer group (`XREADGROUP`/`XACK`), then
  `XADD`s a proposal to `immune:events`, which the curator consumes. Two-stage,
  real event-driven coordination between the swarms.
- **RedisVL** is the long-term vector memory: a 1536-dim COSINE KNN index
  (`text-embedding-3-small`), queried by both the worker retriever and the
  validator's "find related memories" step, with a distance floor to suppress
  false positives on a sparse store.
- **Hash** holds each memory document (content, provenance, trust, status). The
  `active|quarantined` status field is what the heal toggles. Trust is a numeric
  field on this hash; pending proposals are persisted in a Redis hash too, so a
  backend reload never drops an in-flight approval.

### OpenAI — the reasoning + the swarm
- **gpt-4o-mini** powers the contradiction detector (temperature 0 + a 0.7
  confidence floor for high-reliability detection) and the worker answers;
  **text-embedding-3-small** powers all retrieval.
- **OpenAI Agents SDK** builds the worker swarm for real: an `Orchestrator` agent
  hands off to a `Retriever` agent (which reads shared memory through a function
  tool) which hands off to an `Answerer` agent. Real `Agent`s, real `handoff`s —
  the agent tree shows up in the Weave trace.

### CopilotKit (AG-UI) — genuine human-in-the-loop generative UI
- The immune swarm's `ApprovalCard` is rendered **inline in the chat** via
  `useCopilotAction({ renderAndWaitForResponse })`, which **blocks the agent**
  until the human approves or rejects. That is the real generative-UI + HITL
  primitive, not a side-panel poll. A live memory graph mirrors backend state.

### W&B Weave — the audit + trust layer (beyond baseline)
- Every agent function across both swarms is `@weave.op()`, so the immune-response
  trace (detect → propose → quarantine) and the worker handoff tree are recorded
  with inputs/outputs/latency/token cost.
- **Human decisions become Weave feedback:** each approve/reject is attached as
  feedback on the exact contradiction-detection call that produced it — a real
  human-in-the-loop trust signal, not just decorators.
- **A Weave Evaluation** (`backend/weave_eval.py`) scores the detector over a
  labelled dataset of contradicting/compatible pairs (currently 5/5 correct,
  0 false positives) — a reproducible eval dashboard, not a one-off run.

---

## Run it

```bash
docker run -p 6379:6379 redis/redis-stack:latest         # Redis Stack
cd backend && source .venv/bin/activate && uvicorn main:app --port 8000
cd frontend && npm run dev                                # http://localhost:3000
python backend/weave_eval.py                              # the Weave eval dashboard
```

Use the **Demo Controls** panel: **Seed Truth** → **Inject Poison** →
**Ask** → approve the card → **Ask** again. **Reset Demo** between runs.
