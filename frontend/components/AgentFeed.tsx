"use client";

import { useEffect, useRef, useState } from "react";

interface AgentEvent {
  swarm: "worker" | "immune";
  agent: string;
  event: string;
  detail: string;
  ts: number;
}

const AGENT_META: Record<string, { color: string; bg: string; border: string }> = {
  Orchestrator: { color: "#60a5fa", bg: "#0d1f35",  border: "#1e3a5f" },
  Retriever:    { color: "#a78bfa", bg: "#1a1035",  border: "#3b2070" },
  Answerer:     { color: "#34d399", bg: "#0a2018",  border: "#1a4a35" },
  Validator:    { color: "#fbbf24", bg: "#1c1000",  border: "#78350f" },
  Curator:      { color: "#f87171", bg: "#200d0d",  border: "#7f1d1d" },
  Consolidator: { color: "#818cf8", bg: "#10102a",  border: "#2e2e6e" },
};

const EVENT_ICON: Record<string, string> = {
  start:       "▶",
  handoff:     "→",
  tool_call:   "⚙",
  tool_result: "↩",
  complete:    "✓",
  store:       "↑",
  stored:      "✓",
  fallback:    "⚠",
  scan:        "◎",
  knn:         "⊕",
  llm:         "◈",
  conflict:    "⚠",
  clear:       "✓",
  proposal:    "⏸",
  approve:     "✓",
  reject:      "✕",
  merge:       "⊗",
  connected:   "◉",
  heartbeat:   "",
};

function formatTs(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

interface Props {
  api: string;
}

export function AgentFeed({ api }: Props) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    function connect() {
      const es = new EventSource(`${api}/events`);
      esRef.current = es;

      es.onopen = () => setConnected(true);

      es.onmessage = (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (payload.event === "heartbeat" || payload.event === "connected") return;
          setEvents((prev) => {
            const next = [...prev, payload as AgentEvent];
            return next.length > 120 ? next.slice(next.length - 120) : next;
          });
        } catch {}
      };

      es.onerror = () => {
        setConnected(false);
        es.close();
        // Reconnect after 2 s
        setTimeout(connect, 2000);
      };
    }

    connect();
    return () => {
      esRef.current?.close();
    };
  }, [api]);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  const swarmLabel = (swarm: "worker" | "immune") =>
    swarm === "worker" ? "Worker" : "Immune";

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div
        className="shrink-0 flex items-center justify-between px-3 py-2 border-b"
        style={{ borderColor: "var(--border)" }}
      >
        <span
          className="text-xs font-medium uppercase tracking-widest"
          style={{ color: "var(--text-muted)" }}
        >
          Agent Activity
        </span>
        <span
          className={`flex items-center gap-1.5 text-xs ${connected ? "text-emerald-400" : "text-[#525252]"}`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-emerald-500 animate-pulse" : "bg-[#404040]"}`}
          />
          {connected ? "live" : "reconnecting…"}
        </span>
      </div>

      {/* Legend */}
      <div
        className="shrink-0 flex flex-wrap gap-x-3 gap-y-1 px-3 py-2 border-b"
        style={{ borderColor: "var(--border)" }}
      >
        {[
          { label: "Worker swarm", color: "#60a5fa" },
          { label: "Immune swarm", color: "#fbbf24" },
        ].map(({ label, color }) => (
          <span key={label} className="flex items-center gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
            {label}
          </span>
        ))}
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
        {events.length === 0 && (
          <p
            className="text-xs text-center mt-8"
            style={{ color: "var(--text-muted)" }}
          >
            Waiting for agent activity…
          </p>
        )}

        {events.map((ev, i) => {
          const meta = AGENT_META[ev.agent] ?? {
            color: "#909090",
            bg: "var(--bg-elevated)",
            border: "var(--border)",
          };
          const icon = EVENT_ICON[ev.event] ?? "·";
          const isImmune = ev.swarm === "immune";

          return (
            <div
              key={i}
              className="fade-in-up flex items-start gap-2 rounded px-2 py-1.5 text-xs border"
              style={{
                background: meta.bg,
                borderColor: meta.border,
                opacity: 0.95,
              }}
            >
              {/* Swarm indicator bar */}
              <div
                className="w-0.5 self-stretch rounded-full shrink-0"
                style={{ background: isImmune ? "#fbbf24" : "#60a5fa", opacity: 0.7 }}
              />

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="font-semibold shrink-0" style={{ color: meta.color }}>
                    {icon} {ev.agent}
                  </span>
                  <span
                    className="text-xs px-1 rounded shrink-0"
                    style={{
                      background: isImmune ? "#78350f44" : "#1e3a5f44",
                      color: isImmune ? "#fbbf2488" : "#60a5fa88",
                    }}
                  >
                    {swarmLabel(ev.swarm)}
                  </span>
                  <span className="ml-auto font-mono shrink-0" style={{ color: "var(--text-muted)" }}>
                    {formatTs(ev.ts)}
                  </span>
                </div>
                {ev.detail && (
                  <p className="leading-snug" style={{ color: "var(--text-secondary)" }}>
                    {ev.detail}
                  </p>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
