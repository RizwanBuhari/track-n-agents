// Agent run traces. Every model request and tool call made inside a run is
// recorded (and counted against the 25-step cap) through AsyncLocalStorage,
// so agents don't pass a tracer around by hand. Traces are written to
// data/traces/<runId>.jsonl and served to the dashboard.

import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.ts";
import { clock } from "./clock.ts";

export type TraceStep = {
  runId: string;
  n: number;
  at: string;
  agent: string;
  kind: "llm" | "sql" | "tool" | "decision" | "note" | "error";
  summary: string;
  detail?: unknown;
  ms?: number;
};

export type RunInfo = {
  runId: string;
  caseId?: string;
  trigger: string;
  startedAt: string;
  endedAt?: string;
  status: "running" | "completed" | "paused" | "failed";
  steps: number;
  pauseReason?: string;
};

export class StepCapReached extends Error {
  constructor() {
    super(`Run paused: the ${config.limits.stepsPerRun}-step cap was reached`);
  }
}

type RunContext = { info: RunInfo; agent: string; stepsCounted: number };

const storage = new AsyncLocalStorage<RunContext>();
const tracesDir = path.join(config.dataDir, "traces");
const runsFile = path.join(config.dataDir, "runs.json");
fs.mkdirSync(tracesDir, { recursive: true });

const runs: RunInfo[] = fs.existsSync(runsFile) ? JSON.parse(fs.readFileSync(runsFile, "utf-8")) : [];
// A run still "running" at startup was cut off by a restart: record that instead of leaving it hanging.
for (const r of runs) {
  if (r.status === "running") {
    r.status = "failed";
    r.pauseReason = "Interrupted by a backend restart";
  }
}
const listeners = new Set<(step: TraceStep) => void>();

function saveRuns() {
  fs.writeFileSync(runsFile, JSON.stringify(runs.slice(-500), null, 2));
}

export function onTraceStep(fn: (step: TraceStep) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let counter = runs.length;

export async function withRun<T>(trigger: string, caseId: string | undefined, fn: () => Promise<T>): Promise<T> {
  const info: RunInfo = {
    runId: `run-${clock.now().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${++counter}`,
    caseId,
    trigger,
    startedAt: clock.now().toISOString(),
    status: "running",
    steps: 0,
  };
  runs.push(info);
  saveRuns();
  try {
    const result = await storage.run({ info, agent: "coordinator", stepsCounted: 0 }, fn);
    info.status = "completed";
    return result;
  } catch (err) {
    if (err instanceof StepCapReached) {
      info.status = "paused";
      info.pauseReason = err.message;
    } else {
      info.status = "failed";
      record("error", (err as Error).message);
    }
    throw err;
  } finally {
    info.endedAt = clock.now().toISOString();
    saveRuns();
  }
}

/** Run fn with a different agent name attached to the steps it records. */
export async function asAgent<T>(agent: string, fn: () => Promise<T>): Promise<T> {
  const ctx = storage.getStore();
  if (!ctx) return fn();
  return storage.run({ ...ctx, agent }, async () => {
    try {
      return await fn();
    } finally {
      // steps counted on the shared info object, nothing to merge back
    }
  });
}

export function currentRun(): RunInfo | undefined {
  return storage.getStore()?.info;
}

/** Records a step. Model requests and tool calls count toward the step cap. */
export function record(kind: TraceStep["kind"], summary: string, detail?: unknown, ms?: number): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  const counts = kind === "llm" || kind === "sql" || kind === "tool";
  if (counts) {
    if (ctx.info.steps >= config.limits.stepsPerRun) throw new StepCapReached();
    ctx.info.steps += 1;
  }
  const step: TraceStep = {
    runId: ctx.info.runId,
    n: ctx.info.steps,
    at: clock.now().toISOString(),
    agent: ctx.agent,
    kind,
    summary,
    detail,
    ms,
  };
  fs.appendFileSync(path.join(tracesDir, `${ctx.info.runId}.jsonl`), JSON.stringify(step) + "\n");
  for (const fn of listeners) fn(step);
}

export function listRuns(caseId?: string): RunInfo[] {
  return runs.filter((r) => !caseId || r.caseId === caseId).slice().reverse();
}

export function readTrace(runId: string): TraceStep[] {
  const file = path.join(tracesDir, `${path.basename(runId)}.jsonl`);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf-8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

export function setRunCase(caseId: string): void {
  const ctx = storage.getStore();
  if (ctx && !ctx.info.caseId) {
    ctx.info.caseId = caseId;
    saveRuns();
  }
}
