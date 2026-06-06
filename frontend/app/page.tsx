"use client";

import { useState, useEffect, useCallback } from "react";
import { useCopilotAction, useCopilotReadable } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import { MemoryGraph } from "@/components/MemoryGraph";
import { ApprovalCard } from "@/components/ApprovalCard";

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

  const fetchProposals = useCallback(async () => {
    const res = await fetch(`${API}/proposals`);
    if (res.ok) setProposals(await res.json());
  }, []);

  // Poll for new quarantine proposals every 3 seconds
  useEffect(() => {
    const interval = setInterval(fetchProposals, 3000);
    return () => clearInterval(interval);
  }, [fetchProposals]);

  // Expose memory state to CopilotKit so it can reference it in chat
  useCopilotReadable({
    description: "Current active memories in the shared memory store",
    value: memories,
  });

  useCopilotReadable({
    description: "Pending quarantine proposals from the immune swarm",
    value: proposals,
  });

  // Human-in-the-loop action: CopilotKit can trigger approvals
  useCopilotAction({
    name: "approveQuarantine",
    description: "Approve a quarantine proposal to remove a conflicting memory",
    parameters: [{ name: "target_id", type: "string", description: "Memory ID to quarantine" }],
    handler: async ({ target_id }) => {
      await fetch(`${API}/proposals/${target_id}/approve`, { method: "POST" });
      setProposals((prev) => prev.filter((p) => p.target_id !== target_id));
      return `Memory ${target_id.slice(0, 8)}... quarantined.`;
    },
  });

  useCopilotAction({
    name: "injectMemory",
    description: "Inject a new fact into the shared memory store",
    parameters: [{ name: "content", type: "string", description: "Fact to store" }],
    handler: async ({ content }) => {
      await fetch(`${API}/memory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, source_agent: "user", session_id: sessionId }),
      });
      return `Memory stored: "${content}"`;
    },
  });

  const handleApprove = async (targetId: string) => {
    await fetch(`${API}/proposals/${targetId}/approve`, { method: "POST" });
    setProposals((prev) => prev.filter((p) => p.target_id !== targetId));
  };

  const handleReject = async (targetId: string) => {
    await fetch(`${API}/proposals/${targetId}/reject`, { method: "POST" });
    setProposals((prev) => prev.filter((p) => p.target_id !== targetId));
  };

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Left panel: memory graph + proposals */}
      <div className="flex flex-col w-1/2 border-r border-gray-800">
        <div className="flex-1 overflow-hidden">
          <MemoryGraph memories={memories} />
        </div>

        {proposals.length > 0 && (
          <div className="border-t border-yellow-700 bg-yellow-950/30 p-4 space-y-3 max-h-64 overflow-y-auto">
            <h2 className="text-yellow-400 font-semibold text-sm tracking-wide uppercase">
              ⚠️ Immune Swarm Proposals ({proposals.length})
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
      <div className="w-1/2 flex flex-col">
        <div className="p-4 border-b border-gray-800">
          <h1 className="text-lg font-bold text-white">Memory Immune System</h1>
          <p className="text-xs text-gray-400">
            Session: {sessionId.slice(-8)} · Multi-agent memory governance
          </p>
        </div>
        <div className="flex-1 overflow-hidden">
          <CopilotChat
            className="h-full"
            instructions={`You are an AI assistant with access to a shared memory store.
Session: ${sessionId}.
When the user asks something, answer using any context you have.
You can inject memories with injectMemory and approve quarantines with approveQuarantine.`}
            labels={{ title: "Agent Chat", initial: "Ask me anything — I remember across turns." }}
          />
        </div>
      </div>
    </div>
  );
}
