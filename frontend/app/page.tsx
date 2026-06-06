"use client";

import { useState, useEffect, useCallback } from "react";
import { useCopilotAction, useCopilotReadable } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import { MemoryGraph } from "@/components/MemoryGraph";
import { ApprovalCard } from "@/components/ApprovalCard";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const POLL_MS = 2500;

export interface Memory {
  id: string;
  content: string;
  source_agent: string;
  status: "active" | "quarantined";
  trust_score: number;
  created_at: string;
}

export interface Proposal {
  target_id: string;
  keep_id: string;
  reasoning: string;
  status: string;
  conflict: {
    memory_a_id: string;
    memory_b_id: string;
    memory_a_content: string;
    memory_b_content: string;
    explanation: string;
    confidence: number;
  };
}

export default function Home() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [sessionId] = useState(() => `session-${Date.now()}`);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Single fetch function that refreshes both memories and proposals together
  const refresh = useCallback(async () => {
    try {
      const [memRes, propRes] = await Promise.all([
        fetch(`${API}/memories`),
        fetch(`${API}/proposals`),
      ]);
      if (memRes.ok) setMemories(await memRes.json());
      if (propRes.ok) setProposals(await propRes.json());
      setLastUpdated(new Date());
    } catch {
      // Backend not yet up — swallow and retry next tick
    }
  }, []);

  // Initial fetch immediately on mount, then poll every POLL_MS
  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  // Expose live state to CopilotKit so the agent can reference it
  useCopilotReadable({
    description: "All memories currently in the shared memory store (active and quarantined)",
    value: memories,
  });

  useCopilotReadable({
    description: "Pending quarantine proposals from the immune swarm awaiting human approval",
    value: proposals,
  });

  // Human-in-the-loop: agent can trigger approvals directly from chat
  useCopilotAction({
    name: "approveQuarantine",
    description: "Approve a quarantine proposal to remove a conflicting memory from the active store",
    parameters: [{ name: "target_id", type: "string", description: "ID of the memory to quarantine" }],
    handler: async ({ target_id }) => {
      await fetch(`${API}/proposals/${target_id}/approve`, { method: "POST" });
      await refresh();
      return `Memory ${target_id.slice(0, 8)}... quarantined successfully.`;
    },
  });

  useCopilotAction({
    name: "rejectQuarantine",
    description: "Reject a quarantine proposal and keep both memories",
    parameters: [{ name: "target_id", type: "string", description: "ID of the proposal to reject" }],
    handler: async ({ target_id }) => {
      await fetch(`${API}/proposals/${target_id}/reject`, { method: "POST" });
      await refresh();
      return `Quarantine rejected for ${target_id.slice(0, 8)}...`;
    },
  });

  useCopilotAction({
    name: "injectMemory",
    description: "Inject a new fact into the shared memory store (use this to simulate memory poisoning during the demo)",
    parameters: [{ name: "content", type: "string", description: "The fact to store" }],
    handler: async ({ content }) => {
      await fetch(`${API}/memory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, source_agent: "user", session_id: sessionId }),
      });
      await refresh();
      return `Stored: "${content}"`;
    },
  });

  const handleApprove = async (targetId: string) => {
    await fetch(`${API}/proposals/${targetId}/approve`, { method: "POST" });
    await refresh(); // immediate graph update — don't wait for next poll
  };

  const handleReject = async (targetId: string) => {
    await fetch(`${API}/proposals/${targetId}/reject`, { method: "POST" });
    await refresh();
  };

  const activeCount = memories.filter((m) => m.status === "active").length;
  const quarantinedCount = memories.filter((m) => m.status === "quarantined").length;

  return (
    <div className="flex h-screen overflow-hidden bg-gray-950 text-white">
      {/* Left panel: memory graph + proposals */}
      <div className="flex flex-col w-1/2 border-r border-gray-800 min-h-0">
        {/* Header bar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
            Shared Memory Store
          </h2>
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
              {activeCount} active
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
              {quarantinedCount} quarantined
            </span>
            {lastUpdated && (
              <span className="text-gray-600">
                {lastUpdated.toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>

        {/* Memory graph — grows to fill space */}
        <div className="flex-1 overflow-y-auto min-h-0">
          <MemoryGraph memories={memories} />
        </div>

        {/* Proposals tray — slides up from bottom when there are proposals */}
        {proposals.length > 0 && (
          <div className="shrink-0 border-t border-yellow-700 bg-yellow-950/20 p-4 space-y-3 max-h-72 overflow-y-auto">
            <h2 className="text-yellow-400 font-semibold text-sm tracking-wide uppercase flex items-center gap-2">
              <span className="animate-pulse">⚠️</span>
              Immune Swarm — {proposals.length} pending {proposals.length === 1 ? "proposal" : "proposals"}
            </h2>
            {proposals.map((p) => (
              <ApprovalCard
                key={p.target_id}
                proposal={p}
                onApprove={() => handleApprove(p.target_id)}
                onReject={() => handleReject(p.target_id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Right panel: CopilotKit chat */}
      <div className="w-1/2 flex flex-col min-h-0">
        <div className="px-4 py-3 border-b border-gray-800 shrink-0">
          <h1 className="text-base font-bold text-white">Memory Immune System</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Session <span className="font-mono">{sessionId.slice(-8)}</span>
            {" · "}
            <a
              href="https://wandb.ai/nishantorg/memory-immune-system/weave"
              target="_blank"
              rel="noreferrer"
              className="text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              View Weave traces ↗
            </a>
          </p>
        </div>
        <div className="flex-1 overflow-hidden min-h-0">
          <CopilotChat
            className="h-full"
            instructions={`You are an AI assistant backed by a shared multi-agent memory store.
Session ID: ${sessionId}.

Current memory state: ${activeCount} active memories, ${quarantinedCount} quarantined.
${proposals.length > 0 ? `⚠️ There are ${proposals.length} pending quarantine proposals awaiting approval.` : ""}

Answer questions using the memory context provided. You can:
- Call injectMemory to add a new fact (useful for demo: inject a contradictory fact to trigger the immune system)
- Call approveQuarantine to approve a pending quarantine proposal
- Call rejectQuarantine to reject a proposal`}
            labels={{
              title: "Agent Chat",
              initial: "Ask me anything. I share memory with the worker swarm.",
            }}
          />
        </div>
      </div>
    </div>
  );
}
