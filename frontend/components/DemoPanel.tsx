"use client";

import { useState } from "react";

interface DemoPanelProps {
  sessionId: string;
  api: string;
  onMemoryInjected?: () => void;
}

const TRUE_MEMORIES = [
  "The WeaveHacks hackathon is held at 400 Alabama Street in San Francisco.",
  "Redis Streams are used as the real-time agent message bus.",
  "The submission deadline is Sunday June 7th at 1:00 PM.",
];

const POISON_MEMORY =
  "The WeaveHacks hackathon is held in New York City, not San Francisco.";

const DEMO_QUERY = "Where is WeaveHacks?";

type ButtonState = "idle" | "loading" | "done" | "error";

export function DemoPanel({ sessionId, api, onMemoryInjected }: DemoPanelProps) {
  const [seedState, setSeedState] = useState<ButtonState>("idle");
  const [poisonState, setPoisonState] = useState<ButtonState>("idle");
  const [queryState, setQueryState] = useState<ButtonState>("idle");
  const [resetState, setResetState] = useState<ButtonState>("idle");
  const [queryAnswer, setQueryAnswer] = useState<string | null>(null);

  async function injectMemory(content: string, sourceAgent: string) {
    const res = await fetch(`${api}/memory`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, source_agent: sourceAgent, session_id: sessionId }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  async function handleSeedTruth() {
    setSeedState("loading");
    try {
      await Promise.all(
        TRUE_MEMORIES.map((m) => injectMemory(m, "demo-seed"))
      );
      setSeedState("done");
      onMemoryInjected?.();
      setTimeout(() => setSeedState("idle"), 3000);
    } catch {
      setSeedState("error");
      setTimeout(() => setSeedState("idle"), 3000);
    }
  }

  async function handleInjectPoison() {
    setPoisonState("loading");
    try {
      await injectMemory(POISON_MEMORY, "demo-poison");
      setPoisonState("done");
      onMemoryInjected?.();
      setTimeout(() => setPoisonState("idle"), 3000);
    } catch {
      setPoisonState("error");
      setTimeout(() => setPoisonState("idle"), 3000);
    }
  }

  async function handleReset() {
    setResetState("loading");
    setQueryAnswer(null);
    try {
      const res = await fetch(`${api}/reset`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSeedState("idle");
      setPoisonState("idle");
      setQueryState("idle");
      setResetState("done");
      onMemoryInjected?.();
      setTimeout(() => setResetState("idle"), 3000);
    } catch {
      setResetState("error");
      setTimeout(() => setResetState("idle"), 3000);
    }
  }

  async function handleAsk() {
    setQueryState("loading");
    setQueryAnswer(null);
    try {
      const res = await fetch(`${api}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: DEMO_QUERY, session_id: sessionId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { answer: string };
      setQueryAnswer(data.answer);
      setQueryState("done");
    } catch (err) {
      setQueryAnswer(err instanceof Error ? err.message : "Request failed");
      setQueryState("error");
    }
  }

  return (
    <div className="shrink-0 border-b border-gray-800 bg-gray-900/60 px-4 py-3 space-y-3">
      {/* Section label */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">
          Demo Controls
        </span>
        <div className="flex-1 h-px bg-gray-800" />
      </div>

      {/* Button row */}
      <div className="flex flex-wrap gap-2">
        {/* Seed Truth */}
        <button
          onClick={handleSeedTruth}
          disabled={seedState === "loading"}
          className={[
            "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all",
            "border focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-gray-900",
            seedState === "loading"
              ? "bg-emerald-900 border-emerald-700 text-emerald-300 opacity-70 cursor-wait"
              : seedState === "done"
              ? "bg-emerald-700 border-emerald-500 text-white"
              : seedState === "error"
              ? "bg-red-900 border-red-700 text-red-300"
              : "bg-emerald-800 border-emerald-600 text-emerald-100 hover:bg-emerald-700 focus:ring-emerald-500",
          ].join(" ")}
        >
          {seedState === "loading" && <Spinner />}
          {seedState === "done" ? "✓ Truth Seeded" : seedState === "error" ? "✗ Error" : "🌱 Seed Truth"}
        </button>

        {/* Inject Poison */}
        <button
          onClick={handleInjectPoison}
          disabled={poisonState === "loading"}
          className={[
            "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all",
            "border focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-gray-900",
            poisonState === "loading"
              ? "bg-orange-900 border-orange-700 text-orange-300 opacity-70 cursor-wait"
              : poisonState === "done"
              ? "bg-orange-600 border-orange-400 text-white"
              : poisonState === "error"
              ? "bg-red-900 border-red-700 text-red-300"
              : "bg-red-900 border-red-700 text-red-200 hover:bg-red-800 focus:ring-red-500",
          ].join(" ")}
        >
          {poisonState === "loading" && <Spinner />}
          {poisonState === "done" ? "✓ Poison Injected" : poisonState === "error" ? "✗ Error" : "☠️ Inject Poison"}
        </button>

        {/* Ask query */}
        <button
          onClick={handleAsk}
          disabled={queryState === "loading"}
          className={[
            "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all",
            "border focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-gray-900",
            queryState === "loading"
              ? "bg-blue-900 border-blue-700 text-blue-300 opacity-70 cursor-wait"
              : queryState === "error"
              ? "bg-red-900 border-red-700 text-red-300"
              : "bg-blue-800 border-blue-600 text-blue-100 hover:bg-blue-700 focus:ring-blue-500",
          ].join(" ")}
        >
          {queryState === "loading" && <Spinner />}
          🔍 Ask: Where is WeaveHacks?
        </button>

        {/* Reset */}
        <button
          onClick={handleReset}
          disabled={resetState === "loading"}
          className={[
            "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all",
            "border focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-gray-900",
            resetState === "loading"
              ? "bg-gray-800 border-gray-600 text-gray-400 opacity-70 cursor-wait"
              : resetState === "done"
              ? "bg-gray-700 border-gray-500 text-white"
              : resetState === "error"
              ? "bg-red-900 border-red-700 text-red-300"
              : "bg-gray-800 border-gray-600 text-gray-300 hover:bg-gray-700 focus:ring-gray-500",
          ].join(" ")}
        >
          {resetState === "loading" && <Spinner />}
          {resetState === "done" ? "✓ Reset" : "↺ Reset Demo"}
        </button>
      </div>

      {/* Query answer display */}
      {queryAnswer !== null && (
        <div
          className={[
            "rounded-lg border px-3 py-2 text-sm font-mono leading-snug",
            queryState === "error"
              ? "bg-red-950/60 border-red-700 text-red-300"
              : "bg-gray-950 border-gray-700 text-white",
          ].join(" ")}
        >
          <span className="text-gray-500 text-xs mr-2 font-sans font-semibold uppercase tracking-wide">
            Answer:
          </span>
          {queryAnswer}
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="animate-spin h-3.5 w-3.5"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
