"use client";

import { Memory } from "@/app/page";

interface Props {
  memories: Memory[];
}

export function MemoryGraph({ memories }: Props) {
  const active      = memories.filter((m) => m.status === "active");
  const quarantined = memories.filter((m) => m.status === "quarantined");

  if (memories.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 px-8 text-center">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center border"
          style={{ background: "var(--bg-elevated)", borderColor: "var(--border)" }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-muted)" }}>
            <ellipse cx="12" cy="5" rx="9" ry="3"/>
            <path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/>
            <path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/>
          </svg>
        </div>
        <div>
          <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>No memories yet</p>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            Use <span style={{ color: "var(--text-secondary)" }}>Seed Truth</span> to load demo facts,
            or ask the agent a question.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-3 space-y-1">
      {active.map((m) => <MemoryNode key={m.id} memory={m} />)}

      {quarantined.length > 0 && (
        <>
          <div className="py-3 flex items-center gap-3">
            <div className="flex-1 h-px" style={{ background: "var(--border)" }} />
            <span className="text-xs font-medium uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
              Quarantined
            </span>
            <div className="flex-1 h-px" style={{ background: "var(--border)" }} />
          </div>
          {quarantined.map((m) => <MemoryNode key={m.id} memory={m} />)}
        </>
      )}
    </div>
  );
}

const AGENT_STYLES: Record<string, { label: string; color: string }> = {
  "attacker":  { label: "attacker",  color: "#ef4444" },
  "demo-seed": { label: "seed",      color: "#d97706" },
  "answerer":  { label: "answerer",  color: "#6366f1" },
  "user":      { label: "user",      color: "#8b5cf6" },
};

function agentStyle(name: string) {
  return AGENT_STYLES[name] ?? { label: name, color: "#737373" };
}

function MemoryNode({ memory }: { memory: Memory }) {
  const isQuarantined = memory.status === "quarantined";
  const agent         = agentStyle(memory.source_agent);
  const trustPct      = Math.round(memory.trust_score * 100);
  const trustColor    = trustPct >= 80 ? "#22c55e" : trustPct >= 50 ? "#d97706" : "#ef4444";

  return (
    <div
      className={`fade-in-up rounded-lg border p-3 transition-all duration-300 ${isQuarantined ? "opacity-35" : ""}`}
      style={{
        background:   isQuarantined ? "var(--bg)"          : "var(--bg-elevated)",
        borderColor:  isQuarantined ? "var(--border-subtle)" : "var(--border)",
      }}
    >
      <p
        className="text-sm leading-snug"
        style={{
          color:           isQuarantined ? "var(--text-muted)" : "var(--text)",
          textDecoration:  isQuarantined ? "line-through"      : "none",
        }}
      >
        {memory.content}
      </p>

      <div className="flex items-center gap-2 mt-2">
        {/* Agent badge */}
        <span
          className="text-xs font-medium px-1.5 py-0.5 rounded"
          style={{ color: agent.color, background: `${agent.color}18` }}
        >
          {agent.label}
        </span>

        {/* Memory ID */}
        <span className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>
          {memory.id.slice(0, 8)}
        </span>

        {isQuarantined && (
          <span className="ml-auto text-xs font-medium" style={{ color: "var(--text-muted)" }}>
            quarantined
          </span>
        )}
      </div>

      {/* Trust bar */}
      {!isQuarantined && (
        <div className="mt-2.5 flex items-center gap-2">
          <div className="flex-1 h-0.5 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
            <div
              className="h-0.5 rounded-full transition-all duration-500"
              style={{ width: `${trustPct}%`, background: trustColor }}
            />
          </div>
          <span className="text-xs font-mono tabular-nums w-8 text-right" style={{ color: "var(--text-muted)" }}>
            {trustPct}%
          </span>
        </div>
      )}
    </div>
  );
}
