"use client";

import { useState, useEffect, useCallback } from "react";
import { useCopilotAction, useCopilotReadable } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import { MemoryGraph } from "@/components/MemoryGraph";
import { ApprovalCard } from "@/components/ApprovalCard";
import { DemoPanel } from "@/components/DemoPanel";
import { AgentFeed } from "@/components/AgentFeed";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface Memory {
  id: string;
  content: string;
  source_agent: string;
  status: "active" | "quarantined";
  trust_score: number;
}

export interface Proposal {
  target_id: string;
  keep_id: string;
  reasoning: string;
  conflict: {
    memory_a_id: string;
    memory_b_id: string;
    memory_a_content: string;
    memory_b_content: string;
    explanation: string;
    confidence: number;
  };
}

function Dot({ variant = "neutral" }: { variant?: "neutral" | "success" | "warning" | "danger" }) {
  const colors = { neutral: "bg-[#404040]", success: "bg-emerald-500", warning: "bg-amber-500", danger: "bg-red-500" };
  return <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${colors[variant]} ${variant === "success" ? "animate-pulse" : ""}`} />;
}

function Chip({ children, variant = "neutral" }: { children: React.ReactNode; variant?: "neutral" | "success" | "warning" | "danger" }) {
  const styles = { neutral: "text-[#909090] border-[#2e2e2e]", success: "text-emerald-400 border-emerald-900", warning: "text-amber-400 border-amber-900", danger: "text-red-400 border-red-900" };
  return <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-xs font-medium ${styles[variant]}`}>{children}</span>;
}

/* ── Inline chat cards for queryWithMemory and injectMemory ────────────────── */

function MemoryRetrievalCard({ question, status, answer }: { question: string; status: string; answer?: string }) {
  return (
    <div className="rounded-lg border my-1 overflow-hidden text-xs" style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}>
      <div className="flex items-center gap-2 px-3 py-2 border-b" style={{ borderColor: "var(--border)" }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-muted)" }}>
          <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/>
        </svg>
        <span className="font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Memory Retrieval</span>
        <span className="ml-auto px-1.5 py-0.5 rounded text-xs" style={{ background: status === "complete" ? "#14532d44" : "var(--bg)", color: status === "complete" ? "#4ade80" : "var(--text-muted)", border: `1px solid ${status === "complete" ? "#14532d" : "var(--border)"}` }}>
          {status === "inProgress" ? "searching…" : status}
        </span>
      </div>
      <div className="px-3 py-2 space-y-2">
        <p style={{ color: "var(--text-secondary)" }}>
          <span style={{ color: "var(--text-muted)" }}>Query </span>"{question}"
        </p>
        {status === "inProgress" && (
          <div className="flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
            <svg className="animate-spin w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            Searching Redis vector store…
          </div>
        )}
        {status === "complete" && answer && (
          <p className="font-mono leading-relaxed" style={{ color: "var(--text)" }}>{answer}</p>
        )}
      </div>
    </div>
  );
}

function MemoryStoredCard({ content, status }: { content: string; status: string }) {
  return (
    <div className="rounded-lg border my-1 overflow-hidden text-xs" style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}>
      <div className="flex items-center gap-2 px-3 py-2 border-b" style={{ borderColor: "var(--border)" }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-muted)" }}>
          <path d="M12 5v14M5 12h14"/>
        </svg>
        <span className="font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Memory Write</span>
        <span className="ml-auto px-1.5 py-0.5 rounded text-xs" style={{ background: status === "complete" ? "#14532d44" : "var(--bg)", color: status === "complete" ? "#4ade80" : "var(--text-muted)", border: `1px solid ${status === "complete" ? "#14532d" : "var(--border)"}` }}>
          {status === "inProgress" ? "writing…" : "stored"}
        </span>
      </div>
      <div className="px-3 py-2 flex items-start gap-2">
        {status === "inProgress" ? (
          <svg className="animate-spin w-3 h-3 mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
        ) : (
          <span className="w-3 h-3 mt-0.5 shrink-0 text-emerald-500">✓</span>
        )}
        <p style={{ color: "var(--text-secondary)" }} className="leading-relaxed">{content}</p>
      </div>
    </div>
  );
}

export default function Home() {
  const [memories, setMemories]   = useState<Memory[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [sessionId, setSessionId] = useState("default");
  const [backendOk, setBackendOk] = useState(false);
  const [mounted, setMounted]     = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored = sessionStorage.getItem("mis-session-id");
    if (stored) { setSessionId(stored); }
    else {
      const id = `session-${Date.now()}`;
      sessionStorage.setItem("mis-session-id", id);
      setSessionId(id);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [memRes, propRes] = await Promise.all([fetch(`${API}/memories`), fetch(`${API}/proposals`)]);
      if (memRes.ok)  { setMemories(await memRes.json()); setBackendOk(true); }
      if (propRes.ok) { setProposals(await propRes.json()); }
    } catch { setBackendOk(false); }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [refresh]);

  useCopilotReadable({ description: "Pending quarantine proposals from the immune swarm", value: proposals });

  useCopilotAction({
    name: "queryWithMemory",
    description: "Answer a factual question by retrieving relevant context from the shared Redis memory store. ALWAYS call this for any question the user asks before answering.",
    parameters: [{ name: "question", type: "string", description: "The user's question" }],
    handler: async ({ question }) => {
      const res  = await fetch(`${API}/query`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: question, session_id: sessionId }) });
      const data = await res.json();
      await refresh();
      return data.answer;
    },
    render: ({ args, status, result }) => (
      <MemoryRetrievalCard question={args.question ?? ""} status={status} answer={result} />
    ),
  });

  useCopilotAction({
    name: "injectMemory",
    description: "Inject a new fact into the shared memory store",
    followUp: false,
    parameters: [{ name: "content", type: "string", description: "Fact to store" }],
    handler: async ({ content }) => {
      await fetch(`${API}/memory`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content, source_agent: "user", session_id: sessionId }) });
      await refresh();
      return `Stored.`;
    },
    render: ({ args, status }) => (
      <MemoryStoredCard content={args.content ?? ""} status={status} />
    ),
  });

  useCopilotAction({
    name: "reviewQuarantineProposal",
    description: "Show any pending quarantine proposals from the immune swarm inline in the chat.",
    parameters: [{ name: "target_id", type: "string", required: false, description: "target_id of the proposal to review; omit to review the first pending one" }],
    handler: async () => "done",
    render: ({ args }) => {
      const proposal = proposals.find((p) => p.target_id === args?.target_id) ?? proposals[0];
      if (!proposal) return <></>;
      return (
        <div className="my-2">
          <ApprovalCard
            proposal={proposal}
            onKeepLeft={async ()  => { await fetch(`${API}/proposals/${proposal.target_id}/approve`,      { method: "POST" }); await refresh(); }}
            onKeepRight={async () => { await fetch(`${API}/proposals/${proposal.target_id}/approve-swap`, { method: "POST" }); await refresh(); }}
            onKeepBoth={async ()  => { await fetch(`${API}/proposals/${proposal.target_id}/reject`,       { method: "POST" }); await refresh(); }}
          />
        </div>
      );
    },
  });

  const activeCount      = memories.filter((m) => m.status === "active").length;
  const quarantinedCount = memories.filter((m) => m.status === "quarantined").length;

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: "var(--bg)", color: "var(--text)" }}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="shrink-0 flex items-center justify-between px-5 h-12 border-b" style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-2.5">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500">
              <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"/>
              <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"/>
            </svg>
            <span className="text-sm font-semibold tracking-tight">Memory Immune System</span>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>WeaveHacks 2026</span>
          </div>
          <div className="flex items-center gap-2">
            <Chip variant={backendOk ? "success" : "neutral"}><Dot variant={backendOk ? "success" : "neutral"} />{backendOk ? "Validator running" : "Connecting"}</Chip>
            {activeCount > 0      && <Chip>{activeCount} {activeCount === 1 ? "memory" : "memories"}</Chip>}
            {quarantinedCount > 0 && <Chip variant="danger"><Dot variant="danger" />{quarantinedCount} quarantined</Chip>}
            {proposals.length > 0 && <Chip variant="warning"><Dot variant="warning" />{proposals.length} pending</Chip>}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>{sessionId.slice(-8)}</span>
          <a href="https://wandb.ai/nishantorg/memory-immune-system/weave" target="_blank" rel="noreferrer"
            className="text-xs font-medium flex items-center gap-1 transition-colors"
            style={{ color: "var(--text-secondary)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-secondary)")}
          >
            Weave traces
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 7h10v10M7 17 17 7"/></svg>
          </a>
        </div>
      </header>

      {/* ── Body ───────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left panel — demo controls + memory store */}
        <div className="flex flex-col w-[380px] shrink-0 border-r overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
          <DemoPanel sessionId={sessionId} api={API} onMemoryInjected={refresh} />
          <div className="flex items-center justify-between px-4 py-2.5 border-b shrink-0" style={{ borderColor: "var(--border)" }}>
            <span className="text-xs font-medium uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Shared Memory</span>
            <span className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>
              {activeCount} active{quarantinedCount > 0 ? ` · ${quarantinedCount} quarantined` : ""}
            </span>
          </div>
          <div className="flex-1 overflow-hidden">
            <MemoryGraph memories={memories} />
          </div>
        </div>

        {/* Middle panel — live agent activity feed */}
        <div className="flex flex-col w-[260px] shrink-0 border-r overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>
          <AgentFeed api={API} />
        </div>

        {/* Right panel — conflict banner (auto) + chat */}
        <div className="flex-1 flex flex-col overflow-hidden min-h-0" style={{ background: "var(--bg)" }}>

          {/* Conflict banner: capped height so it never crowds the chat input */}
          {proposals.length > 0 && (
            <div className="shrink-0 border-b p-3 space-y-2" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
              <div className="flex items-center gap-2 px-1">
                <Dot variant="warning" />
                <span className="text-xs font-medium uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>
                  Immune Swarm — Conflict Detected
                </span>
              </div>
              {proposals.map((p) => (
                <ApprovalCard
                  key={p.target_id}
                  proposal={p}
                  onKeepLeft={async ()  => { await fetch(`${API}/proposals/${p.target_id}/approve`,      { method: "POST" }); await refresh(); }}
                  onKeepRight={async () => { await fetch(`${API}/proposals/${p.target_id}/approve-swap`, { method: "POST" }); await refresh(); }}
                  onKeepBoth={async ()  => { await fetch(`${API}/proposals/${p.target_id}/reject`,       { method: "POST" }); await refresh(); }}
                />
              ))}
            </div>
          )}

          {/* flex-1 min-h-0 lets the chat shrink when the banner is present */}
          <div className="flex-1 min-h-0 overflow-hidden">
          {mounted && (
            <CopilotChat
              className="h-full copilotKitChat"
              instructions={`You are the Memory Immune System assistant — an AI backed by a shared multi-agent Redis memory store (session: ${sessionId}).

You are a stateless memory proxy. You have exactly two behaviours:

BEHAVIOUR A — STORE (triggers: user makes a statement, assertion, or correction about a fact):
  • Examples: "X is Y", "X is actually Y", "X is now Y", "use X not Y", "the location is Z"
  • Action: call injectMemory with the stated fact. Nothing else.
  • Response: the single word "Stored." and nothing more. No "Got it", no summary, no elaboration.

BEHAVIOUR B — QUERY (triggers: user asks a question):
  • Examples: "what is X?", "where is X?", "tell me about X"
  • Action: call queryWithMemory. Return the tool result verbatim. No added commentary.

STRICT RULES:
- NEVER call both tools in the same turn.
- NEVER answer from conversation history or context — ALWAYS use the tools.
- NEVER reason about conflicts. You cannot see the memory store directly.
- NEVER approve or reject quarantines.
- After STORE: "Stored." is your complete response. One word.
- After QUERY: return only what queryWithMemory returned.

Current state: ${activeCount} active memories, ${quarantinedCount} quarantined, ${proposals.length} pending proposals.`}
              labels={{
                title: "Agent Chat",
                initial: "Ask me anything — I answer from shared Redis memory. Use the panel on the left to run the demo.",
              }}
            />
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
