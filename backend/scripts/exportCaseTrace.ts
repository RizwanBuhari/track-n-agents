// Exports one case's full agent trace from the running backend into a
// readable Markdown file, as evidence of how the agents reached their output
// (for reviewers who cannot run the full stack).
//   npx tsx scripts/exportCaseTrace.ts TN-0001  ->  eval/traces/TN-0001.md

import fs from "node:fs";
import path from "node:path";
import { config, repoRoot } from "../src/config.ts";

const caseId = process.argv[2];
if (!caseId) throw new Error("Usage: npx tsx scripts/exportCaseTrace.ts <caseId>");
const base = `http://localhost:${config.port}/api`;
const get = async (p: string) => {
  const r = await fetch(base + p);
  if (!r.ok) throw new Error(`${p}: ${r.status}`);
  return r.json();
};

type Step = { n: number; at: string; agent: string; kind: string; summary: string; ms?: number; detail?: Record<string, unknown> };
const c = await get(`/cases/${caseId}`);
const runs: { runId: string; trigger: string; status: string; steps: number; startedAt: string }[] = (await get(`/runs?caseId=${caseId}`)).slice().reverse();
const integrations = await get("/integrations");

const oneLine = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
const out: string[] = [
  `# Agent trace: ${caseId} (${c.title}, AWB ${c.awbNo})`,
  "",
  `Exported ${new Date().toISOString()} from a ${integrations.mode === "sample" ? "sample-mode" : "live"} run. Final status: **${c.status}**. ${c.closureNote ?? ""}`,
  "",
  "Every model request below went through Meterless Nightshift (the *served by* model is what actually answered); every SQL query went through Zetaris across the four sources. Counterparties and the carrier/customs systems are simulated.",
  "",
  "## Finding",
  "",
  `${c.summary}`,
  "",
  `> ${oneLine(c.explanation)}`,
  "",
  "## Evidence",
  "",
  "| Id | Source | Record | Claim | Added by |",
  "|---|---|---|---|---|",
  ...c.evidence.map((e: Record<string, string>) => `| ${e.id} | \`${e.source}\` | \`${e.recordId}\` | ${oneLine(e.claim).replace(/\|/g, "/").slice(0, 220)} | ${e.addedBy} |`),
  "",
  "## Runs",
  "",
];

for (const run of runs) {
  const steps: Step[] = await get(`/runs/${run.runId}`);
  out.push(`### ${run.trigger}`, "", `\`${run.runId}\` · ${run.status} · ${run.steps} counted steps (cap 25)`, "");
  for (const s of steps) {
    const d = s.detail ?? {};
    let line = `- **${s.agent}** · ${s.kind} · ${oneLine(s.summary)}`;
    if (s.kind === "llm" && d.servedBy) line += ` — served by \`${d.servedBy}\`${s.ms ? ` in ${(s.ms / 1000).toFixed(1)} s` : ""}`;
    if (s.kind === "sql" && s.ms) line += ` (${s.ms} ms, ${d.rows ?? 0} rows)`;
    out.push(line);
    if (s.kind === "sql" && d.sql) out.push(`  \`${oneLine(d.sql).slice(0, 400)}\``);
    if (s.kind === "llm" && d.reply) out.push(`  > ${oneLine(d.reply).slice(0, 400)}`);
  }
  out.push("");
}

out.push("## Verification results", "");
for (const v of c.verifications) {
  out.push(`### ${v.id} · ${v.mode} · **${v.result}** (${v.trigger})`, "");
  for (const k of v.checks) out.push(`- ${k.passed ? "✓" : "✗"} **${k.name}**: ${oneLine(k.detail)}`);
  if (v.critique) out.push("", `Critic: ${oneLine(v.critique)}`);
  out.push("");
}

out.push("## Shared state history (Meterless World Model audit log)", "", "```");
for (const a of c.activity) out.push(`#${a.seq} ${a.actor.padEnd(15)} ${oneLine(a.summary).slice(0, 160)}`);
out.push("```", "");

const dir = path.join(repoRoot, "eval", "traces");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, `${caseId}.md`), out.join("\n"));
console.log(`Wrote eval/traces/${caseId}.md (${runs.length} runs)`);
