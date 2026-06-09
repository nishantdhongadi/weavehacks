import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import OpenAI from "openai";
import { NextRequest } from "next/server";

// Lazy-init: don't instantiate at module load time (fails at build without key)
let _runtime: CopilotRuntime | null = null;

function getRuntime() {
  if (!_runtime) {
    _runtime = new CopilotRuntime({ remoteEndpoints: [] });
  }
  return _runtime;
}

export const POST = async (req: NextRequest) => {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime: getRuntime(),
    serviceAdapter: new OpenAIAdapter({ openai, model: "gpt-4o-mini" }),
    endpoint: "/api/copilotkit",
  });
  return handleRequest(req);
};
