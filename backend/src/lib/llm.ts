// Meterless Runtime provider (Nightshift). OpenAI-compatible contract:
// Bearer token, meterless-app on every request, meterless-scope: user on
// chat, models discovered from GET /v1/models. Every agent model request
// in Track-N goes through this one function and is served by a pinned
// NVIDIA Nemotron lane.

import { config } from "../config.ts";
import { record } from "./trace.ts";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string | unknown[] };

export class LlmError extends Error {}

export type ChatResult = { text: string; model: string; ms: number };

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${config.meterless.token()}`,
    "Content-Type": "application/json",
    "meterless-app": config.meterless.app,
    "meterless-scope": "user",
  };
}

export async function chat(opts: {
  purpose: string;
  model?: "fast" | "deep" | "vision" | string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}): Promise<ChatResult> {
  // Sample mode never calls Nightshift: every caller has a rule-based path for this error.
  if (config.sampleMode) throw new LlmError("sample mode: no model provider is used, so the rule-based path runs");
  const model =
    opts.model === "deep" ? config.meterless.deepModel :
    opts.model === "vision" ? config.meterless.visionModel :
    opts.model === "fast" || !opts.model ? config.meterless.fastModel : opts.model;
  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(config.meterless.baseUrl.replace(/\/$/, "") + "/chat/completions", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        model,
        messages: opts.messages,
        max_tokens: opts.maxTokens ?? 1500,
        temperature: opts.temperature ?? 0.1,
        // Nemotron otherwise spends the token budget on hidden reasoning and can
        // return an empty reply. Agents state their reasoning in the JSON instead.
        chat_template_kwargs: { enable_thinking: false },
      }),
      signal: AbortSignal.timeout(180_000),
    });
  } catch (err) {
    record("llm", `FAILED ${opts.purpose}`, { model, error: (err as Error).message }, Date.now() - started);
    throw new LlmError(`Meterless Runtime unreachable at ${config.meterless.baseUrl}: ${(err as Error).message}`);
  }
  const body = await response.text();
  if (!response.ok) {
    const error = response.status === 401 ? "unauthorized: check METERLESS_RUNTIME_TOKEN" : body.slice(0, 300);
    record("llm", `FAILED ${opts.purpose}`, { model, status: response.status, error }, Date.now() - started);
    throw new LlmError(`Meterless ${response.status}: ${error}`);
  }
  const json = JSON.parse(body);
  const raw: string = json.choices?.[0]?.message?.content ?? "";
  const text = stripReasoning(raw);
  const ms = Date.now() - started;
  record("llm", opts.purpose, {
    provider: "meterless",
    requestedModel: model,
    servedBy: json.model ?? model,
    usage: json.usage,
    reply: text.slice(0, 1500),
  }, ms);
  return { text, model: json.model ?? model, ms };
}

/** Nemotron reasoning models may put their thinking in the content. Keep only the answer. */
export function stripReasoning(text: string): string {
  let t = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const close = t.lastIndexOf("</think>");
  if (close >= 0) t = t.slice(close + "</think>".length);
  return t.trim();
}

/** Extracts the JSON object from a model reply (tolerates code fences and prose around it). */
export function parseJsonReply<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new LlmError("The model reply contained no JSON object");
  return JSON.parse(candidate.slice(start, end + 1)) as T;
}

/**
 * Ask for JSON, validate it, and give the model one chance to fix a reply
 * that does not parse or fails validation (self-correction step).
 */
export async function chatJson<T>(opts: {
  purpose: string;
  model?: "fast" | "deep" | string;
  system: string;
  user: string;
  maxTokens?: number;
  validate?: (value: T) => string | null;
}): Promise<T> {
  const messages: ChatMessage[] = [
    { role: "system", content: opts.system + "\n\nReply with one JSON object only. No prose, no code fences." },
    { role: "user", content: opts.user },
  ];
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await chat({ purpose: attempt ? `${opts.purpose} (corrected)` : opts.purpose, model: opts.model, messages, maxTokens: opts.maxTokens });
    try {
      const value = parseJsonReply<T>(result.text);
      const problem = opts.validate?.(value) ?? null;
      if (!problem) return value;
      lastError = problem;
    } catch (err) {
      lastError = (err as Error).message;
    }
    messages.push({ role: "assistant", content: result.text });
    messages.push({ role: "user", content: `Your reply was rejected: ${lastError}. Reply again with one corrected JSON object only.` });
    record("decision", `Rejected model output: ${lastError}`);
  }
  throw new LlmError(`${opts.purpose}: no valid reply after a correction (${lastError})`);
}

export async function listModels(): Promise<string[]> {
  if (config.sampleMode) return [];
  const response = await fetch(config.meterless.baseUrl.replace(/\/$/, "") + "/models", { headers: headers(), signal: AbortSignal.timeout(15_000) });
  if (response.status === 401) throw new LlmError("unauthorized");
  if (!response.ok) throw new LlmError(`offline (${response.status})`);
  const json = await response.json();
  return (json.data ?? []).map((m: { id: string }) => m.id);
}
