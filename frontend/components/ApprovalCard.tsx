"use client";

import { Proposal } from "@/app/page";

interface Props {
  proposal: Proposal;
  onKeepLeft: () => void;   // quarantine target_id  (keep keep_id)  — system's suggestion
  onKeepRight: () => void;  // quarantine keep_id    (keep target_id) — user override
  onKeepBoth: () => void;   // reject — keep both
}

export function ApprovalCard({ proposal, onKeepLeft, onKeepRight, onKeepBoth }: Props) {
  const { conflict, keep_id, target_id } = proposal;

  const contentFor = (id: string) =>
    id === conflict.memory_a_id ? conflict.memory_a_content
    : id === conflict.memory_b_id ? conflict.memory_b_content
    : "(unknown)";

  const keepContent       = contentFor(keep_id);
  const quarantineContent = contentFor(target_id);
  const confidencePct     = Math.round(conflict.confidence * 100);

  return (
    <div
      className="conflict-pulse rounded-lg border overflow-hidden"
      style={{ background: "var(--bg)", borderColor: "#78350f" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: "#78350f66" }}>
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#fbbf24" }}>
            Conflict Detected
          </span>
        </div>
        <span className="text-xs font-mono" style={{ color: "#92400e" }}>{confidencePct}% confidence</span>
      </div>

      {/* Confidence bar */}
      <div className="h-px" style={{ background: "var(--border)" }}>
        <div className="h-px bg-amber-600 transition-all duration-700" style={{ width: `${confidencePct}%` }} />
      </div>

      <div className="p-3 space-y-3">
        {/* Explanation */}
        <p className="text-xs leading-relaxed pl-2 border-l-2" style={{ color: "var(--text-secondary)", borderColor: "#78350f" }}>
          {conflict.explanation}
        </p>

        {/* Prompt */}
        <p className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
          Which memory is correct?
        </p>

        {/* Two memory columns — each with its own Keep button */}
        <div className="grid grid-cols-2 gap-2 text-xs">

          {/* Left — system's suggested keep */}
          <div className="rounded-md border flex flex-col overflow-hidden" style={{ borderColor: "#14532d66" }}>
            <div className="flex items-center gap-1.5 px-2.5 pt-2 pb-1 shrink-0">
              <span className="w-1 h-1 rounded-full bg-emerald-500 shrink-0" />
              <span className="text-xs font-semibold uppercase tracking-wide text-emerald-500">Memory A</span>
              <span className="ml-auto text-xs font-mono" style={{ color: "var(--text-muted)" }}>suggested</span>
            </div>
            <p
              className="px-2.5 pb-2 leading-snug"
              style={{ color: "var(--text-secondary)", maxHeight: "7rem", overflowY: "auto", background: "#0a1f12" }}
            >
              {keepContent}
            </p>
            <button
              onClick={onKeepLeft}
              className="w-full py-1.5 text-xs font-semibold transition-colors focus:outline-none"
              style={{ background: "#166534", color: "#bbf7d0" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#15803d"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "#166534"; }}
            >
              ✓ Keep this
            </button>
          </div>

          {/* Right — system's suggested quarantine */}
          <div className="rounded-md border flex flex-col overflow-hidden" style={{ borderColor: "#7f1d1d66" }}>
            <div className="flex items-center gap-1.5 px-2.5 pt-2 pb-1 shrink-0">
              <span className="w-1 h-1 rounded-full bg-red-400 shrink-0" />
              <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#f87171" }}>Memory B</span>
            </div>
            <p
              className="px-2.5 pb-2 leading-snug"
              style={{ color: "var(--text-secondary)", maxHeight: "7rem", overflowY: "auto", background: "#1a0a0a" }}
            >
              {quarantineContent}
            </p>
            <button
              onClick={onKeepRight}
              className="w-full py-1.5 text-xs font-semibold transition-colors focus:outline-none"
              style={{ background: "#166534", color: "#bbf7d0" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#15803d"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "#166534"; }}
            >
              ✓ Keep this
            </button>
          </div>

        </div>

        {/* Keep both */}
        <button
          onClick={onKeepBoth}
          className="w-full py-1.5 rounded text-xs font-medium transition-colors focus:outline-none"
          style={{ background: "var(--bg-elevated)", color: "var(--text-muted)", border: "1px solid var(--border)" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-secondary)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
        >
          Keep both — dismiss
        </button>
      </div>
    </div>
  );
}
