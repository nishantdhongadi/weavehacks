"use client";

import { useState, useEffect, useCallback } from "react";
import { useCopilotAction, useCopilotReadable } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import { MemoryGraph } from "@/components/MemoryGraph";
import { ApprovalCard } from "@/components/ApprovalCard";
import { DemoPanel } from "@/components/DemoPanel";

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

export default function Home() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [sessionId, setSessionId] = useState("default");

  useEffect(() => {
    const stored = sessionStorage.getItem("mis-session-id");
    if (stored) {
      setSessionId(stored);
    } else {
      const id = `session-${Date.now()}`;
      sessionStorage.setItem("mis-session-id", id);
      setSessionId(id);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [memRes, propRes] = await Promise.all([
        fetch(`${API}/memories`),
        fetch(`${API}/proposals`),
      ]);
      if (memRes.ok) setMemories(await memRes.json());
      if (propRes.ok) setProposals(await propRes.json());
    } catch {
      // Backend not yet up — swallow and retry next tick
    }
  }, []);

  // Initial fetch + poll every 3 seconds
  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [refresh]);

  // Expose memory state to CopilotKit so it can reference it in chat
  useCopilotReadable({
    description: "Current active memories in the shared memory store",
    value: memories,
  });

  useCopilotReadable({
    description: "Pending quarantine proposals from the immune swarm",
    value: proposals,
  });

  // Route every factual question through the worker swarm (Redis memory → gpt-4o-mini)
  useCopilotAction({
    name: "queryWithMemory",
    description: "Answer a factual question by retrieving relevant context from the shared Redis memory store. ALWAYS call this for any question the user asks before answering.",
    parameters: [{ name: "question", type: "string", description: "The user's question" }],
    handler: async ({ question }) => {
      const res = await fetch(`${API}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: question, session_id: sessionId }),
      });
      const data = await res.json();
      await refresh(); // new Q&A was stored as a memory — refresh graph
      return data.answer;
    },
  });

  // Human-in-the-loop action: CopilotKit can trigger approvals
  useCopilotAction({
    name: "approveQuarantine",
    description: "Approve a quarantine proposal to remove a conflicting memory",
    parameters: [{ name: "target_id", type: "string", description: "Memory ID to quarantine" }],
    handler: async ({ target_id }) => {
      await fetch(`${API}/proposals/${target_id}/approve`, { method: "POST" });
      await refresh();
      return `Memory ${target_id.slice(0, 8)}... quarantined.`;
    },
  });

  useCopilotAction({
    name: "rejectQuarantine",
    description: "Reject a quarantine proposal and keep both memories as-is",
    parameters: [{ name: "target_id", type: "string", description: "ID of the proposal to reject" }],
    handler: async ({ target_id }) => {
      await fetch(`${API}/proposals/${target_id}/reject`, { method: "POST" });
      await refresh();
      return `Quarantine rejected for ${target_id.slice(0, 8)}...`;
    },
  });

  // TRUE CopilotKit human-in-the-loop generative UI: the immune swarm renders
  // its own ApprovalCard INLINE in the chat and BLOCKS until the human decides.
  useCopilotAction({
    name: "reviewQuarantineProposal",
    description:
      "When the immune swarm has a pending quarantine proposal, call this to render the approval card inline in the chat and wait for the human to approve or reject. Always use this to resolve pending proposals.",
    parameters: [
      {
        name: "target_id",
        type: "string",
        required: false,
        description: "target_id of the proposal to review; omit to review the first pending one",
      },
    ],
    renderAndWaitForResponse: ({ args, status, respond }) => {
      const proposal =
        proposals.find((p) => p.target_id === args?.target_id) ?? proposals[0];
      if (!proposal) {
        return (
          <div className="text-xs text-gray-500 my-2">
            No pending quarantine proposals.
          </div>
        );
      }
      if (status === "complete") {
        return (
          <div className="text-xs text-emerald-400 my-2">
            ✓ Quarantine decision recorded — memory healed.
          </div>
        );
      }
      return (
        <div className="my-2">
          <ApprovalCard
            proposal={proposal}
            onApprove={async () => {
              await fetch(`${API}/proposals/${proposal.target_id}/approve`, { method: "POST" });
              await refresh();
              respond?.(
                "User APPROVED the quarantine. The lower-trust contradicting memory has been quarantined and shared memory is healed.",
              );
            }}
            onReject={async () => {
              await fetch(`${API}/proposals/${proposal.target_id}/reject`, { method: "POST" });
              await refresh();
              respond?.("User REJECTED the quarantine. Both memories remain active.");
            }}
          />
        </div>
      );
    },
  });

  useCopilotAction({
    name: "injectMemory",
    description: "Inject a new fact into the shared memory store (also used to simulate memory poisoning during the demo)",
    parameters: [{ name: "content", type: "string", description: "Fact to store" }],
    handler: async ({ content }) => {
      await fetch(`${API}/memory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, source_agent: "user", session_id: sessionId }),
      });
      await refresh();
      return `Memory stored: "${content}"`;
    },
  });

  const handleApprove = async (targetId: string) => {
    await fetch(`${API}/proposals/${targetId}/approve`, { method: "POST" });
    await refresh();
  };

  const handleReject = async (targetId: string) => {
    await fetch(`${API}/proposals/${targetId}/reject`, { method: "POST" });
    await refresh();
  };

  const activeCount = memories.filter((m) => m.status === "active").length;
  const quarantinedCount = memories.filter((m) => m.status === "quarantined").length;

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Left panel: demo controls + memory graph + proposals */}
      <div className="flex flex-col w-1/2 border-r border-gray-800">
        <DemoPanel sessionId={sessionId} api={API} onMemoryInjected={refresh} />
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
        <div className="p-4 border-b border-gray-800 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-white">Memory Immune System</h1>
            <p className="text-xs text-gray-400">
              Session: {sessionId.slice(-8)} · Multi-agent memory governance
            </p>
          </div>
          <a
            href="https://wandb.ai/nishantorg/memory-immune-system/weave"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors shrink-0"
          >
            Weave traces ↗
          </a>
        </div>
        <div className="flex-1 overflow-hidden">
          <CopilotChat
            className="h-full"
            instructions={`You are an AI assistant backed by a shared multi-agent memory store (session: ${sessionId}).

RULES:
1. For ANY factual question the user asks, ALWAYS call queryWithMemory first. Never answer from your own training data.
2. Present the answer returned by queryWithMemory verbatim — this reflects the current shared memory state.
3. If there are pending quarantine proposals, call reviewQuarantineProposal to render the approval card inline and let the human decide. Do this proactively when proposals exist.
4. You can inject facts with injectMemory.

Current state: ${activeCount} active memories, ${quarantinedCount} quarantined, ${proposals.length} pending proposals.`}
            labels={{ title: "Agent Chat", initial: "Ask me anything — I answer from shared Redis memory." }}
          />
        </div>
      </div>
    </div>
  );
}
