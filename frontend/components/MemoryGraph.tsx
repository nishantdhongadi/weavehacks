"use client";

import { Memory } from "@/app/page";

interface Props {
  memories: Memory[];
}

export function MemoryGraph({ memories }: Props) {
  const active = memories.filter((m) => m.status === "active");
  const quarantined = memories.filter((m) => m.status === "quarantined");

  return (
    <div className="h-full flex flex-col p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
          Shared Memory
        </h2>
        <div className="flex gap-3 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
            {active.length} active
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
            {quarantined.length} quarantined
          </span>
        </div>
      </div>

      {memories.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">
          No memories yet. Start chatting to build shared memory.
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-2">
          {active.map((m) => (
            <MemoryNode key={m.id} memory={m} />
          ))}
          {quarantined.map((m) => (
            <MemoryNode key={m.id} memory={m} />
          ))}
        </div>
      )}
    </div>
  );
}

function MemoryNode({ memory }: { memory: Memory }) {
  const isQuarantined = memory.status === "quarantined";
  return (
    <div
      className={`rounded-lg border p-3 text-sm transition-all duration-500 ${
        isQuarantined
          ? "border-red-800 bg-red-950/40 opacity-60"
          : "border-emerald-800 bg-emerald-950/30"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className={`leading-snug ${isQuarantined ? "line-through text-gray-500" : "text-gray-200"}`}>
          {memory.content}
        </p>
        <span
          className={`shrink-0 text-xs px-1.5 py-0.5 rounded ${
            isQuarantined ? "bg-red-800 text-red-200" : "bg-emerald-800 text-emerald-200"
          }`}
        >
          {isQuarantined ? "quarantined" : `trust: ${memory.trust_score.toFixed(1)}`}
        </span>
      </div>
      <p className="text-xs text-gray-600 mt-1">
        {memory.source_agent} · {memory.id.slice(0, 8)}
      </p>
    </div>
  );
}
