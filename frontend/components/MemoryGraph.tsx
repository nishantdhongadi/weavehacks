"use client";

import { Memory } from "@/app/page";

interface Props {
  memories: Memory[];
}

export function MemoryGraph({ memories }: Props) {
  const active = memories.filter((m) => m.status === "active");
  const quarantined = memories.filter((m) => m.status === "quarantined");

  if (memories.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-gray-600 px-8 text-center">
        <div className="text-3xl">🧠</div>
        <p className="text-sm">No memories yet.</p>
        <p className="text-xs text-gray-700">
          Chat with the agent or use <code className="bg-gray-800 px-1 rounded">POST /memory</code> to seed facts.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-2">
      {active.map((m) => (
        <MemoryNode key={m.id} memory={m} />
      ))}
      {quarantined.length > 0 && (
        <>
          <div className="pt-2 pb-1">
            <div className="border-t border-red-900/50 relative">
              <span className="absolute -top-2.5 left-2 bg-gray-950 px-2 text-xs text-red-700 uppercase tracking-wider">
                Quarantined
              </span>
            </div>
          </div>
          {quarantined.map((m) => (
            <MemoryNode key={m.id} memory={m} />
          ))}
        </>
      )}
    </div>
  );
}

function MemoryNode({ memory }: { memory: Memory }) {
  const isQuarantined = memory.status === "quarantined";
  const trustPct = Math.round(memory.trust_score * 100);

  return (
    <div
      className={`rounded-lg border p-3 text-sm transition-all duration-500 ${
        isQuarantined
          ? "border-red-900 bg-red-950/30 opacity-50"
          : "border-emerald-900 bg-emerald-950/20 hover:border-emerald-700"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p
          className={`leading-snug flex-1 ${
            isQuarantined ? "line-through text-gray-500" : "text-gray-200"
          }`}
        >
          {memory.content}
        </p>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {isQuarantined ? (
            <span className="text-xs px-1.5 py-0.5 rounded bg-red-900/60 text-red-300">
              quarantined
            </span>
          ) : (
            <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-900/60 text-emerald-300">
              trust {trustPct}%
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 mt-1.5">
        <span
          className={`text-xs px-1.5 py-0.5 rounded-full font-mono ${
            memory.source_agent === "attacker"
              ? "bg-orange-900/50 text-orange-400"
              : "bg-gray-800 text-gray-500"
          }`}
        >
          {memory.source_agent}
        </span>
        <span className="text-xs text-gray-700 font-mono">{memory.id.slice(0, 8)}</span>
      </div>
    </div>
  );
}
