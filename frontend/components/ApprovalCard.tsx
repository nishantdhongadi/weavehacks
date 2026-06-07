"use client";

import { Proposal } from "@/app/page";

interface Props {
  proposal: Proposal;
  onApprove: () => void;
  onReject: () => void;
}

export function ApprovalCard({ proposal, onApprove, onReject }: Props) {
  const { conflict, keep_id, target_id } = proposal;

  // Map the keep/quarantine columns to the ACTUAL targeted memories, never a
  // hardcoded a/b position — otherwise the card can tell the opposite story.
  const contentFor = (id: string) =>
    id === conflict.memory_a_id
      ? conflict.memory_a_content
      : id === conflict.memory_b_id
      ? conflict.memory_b_content
      : "(unknown memory)";

  const keepContent = contentFor(keep_id);
  const quarantineContent = contentFor(target_id);

  return (
    <div className="bg-gray-900 border border-yellow-700 rounded-lg p-3 text-sm">
      <p className="text-yellow-300 font-medium mb-1">
        Contradiction detected ({Math.round(conflict.confidence * 100)}% confidence)
      </p>
      <p className="text-gray-400 text-xs mb-2">{conflict.explanation}</p>
      <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
        <div className="bg-emerald-950/50 border border-emerald-800 rounded p-2">
          <p className="text-emerald-400 font-medium mb-1">Keep</p>
          <p className="text-gray-300">{keepContent}</p>
        </div>
        <div className="bg-red-950/50 border border-red-800 rounded p-2">
          <p className="text-red-400 font-medium mb-1">Quarantine</p>
          <p className="text-gray-300">{quarantineContent}</p>
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={onApprove}
          className="flex-1 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-medium transition-colors"
        >
          ✓ Approve Quarantine
        </button>
        <button
          onClick={onReject}
          className="flex-1 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-white text-xs font-medium transition-colors"
        >
          ✗ Reject
        </button>
      </div>
    </div>
  );
}
