// Setup check for a new machine: `npm run doctor`. Prints PASS/FAIL for
// every prerequisite with the fix for each failure. Never prints secrets.

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { config, repoRoot } from "../src/config.ts";

const results: { ok: boolean; name: string; fix?: string; info?: string }[] = [];
const check = async (name: string, fn: () => Promise<string | void> | string | void, fix: string) => {
  try {
    const info = await fn();
    results.push({ ok: true, name, info: info || undefined });
  } catch (err) {
    results.push({ ok: false, name, fix: `${fix} (${(err as Error).message.slice(0, 140)})` });
  }
};
const must = (cond: boolean, msg: string) => {
  if (!cond) throw new Error(msg);
};

await check(".env file present", () => must(fs.existsSync(path.join(repoRoot, ".env")), ".env not found"), "Copy .env.example to .env in the repository root and fill in your own values");
for (const name of ["ZETARIS_API_KEY", "METERLESS_RUNTIME_TOKEN"]) {
  await check(`${name} set`, () => must(!!process.env[name] && !/^your-/.test(process.env[name]!), "missing or still the placeholder"), `Put your own ${name} in .env`);
}

await check("Docker running", () => {
  execSync("docker info", { stdio: "ignore" });
}, "Start Docker Desktop");
await check("Zetaris containers running", () => {
  const out = execSync('docker ps --format "{{.Names}}"').toString();
  must(/zetaris.*api/.test(out) && /zetaris.*driver/.test(out), "zetaris api/driver containers not running");
}, "Start Zetaris: in WSL, cd ~/zetaris-platform && docker compose start");
await check("Zetaris network is zetaris_default", () => {
  const out = execSync('docker network ls --format "{{.Name}}"').toString();
  must(out.split(/\r?\n/).includes("zetaris_default"), "network zetaris_default not found");
}, "If your Zetaris network has another name, change the networks.zetaris.name in infra/docker-compose.yml to match (docker network ls)");
await check("Track-N databases running", () => {
  const out = execSync('docker ps --format "{{.Names}}"').toString();
  must(out.includes("trackn-ops-db") && out.includes("trackn-finance-db"), "trackn-ops-db / trackn-finance-db not running");
}, "cd infra && docker compose up -d");

await check("Backend reachable on :4100", async () => {
  const r = await fetch(`http://localhost:${config.port}/health`, { signal: AbortSignal.timeout(3000) });
  must(r.ok, `status ${r.status}`);
}, "Start it in another terminal: cd backend && npm run dev");

await check("Zetaris SQL over REST", async () => {
  const { runSql } = await import("../src/lib/zetaris.ts");
  const rows = await runSql("SELECT 1 AS one", { trace: false });
  must(String(rows[0]?.one) === "1", "unexpected reply");
}, "Check ZETARIS_REST_URL and ZETARIS_API_KEY; Zetaris must pass ./verify.sh");
await check("Track-N sources registered in Zetaris", async () => {
  const { runSql } = await import("../src/lib/zetaris.ts");
  const rows = await runSql("SELECT count(*) AS n FROM trackn_ops.procedures UNION ALL SELECT count(*) FROM trackn_finance.invoices UNION ALL SELECT count(*) FROM trackn_customs.customs_entries", { trace: false });
  return `${rows.length} sources answer`;
}, "With the backend running: npm run setup:zetaris");

await check("Nightshift Runtime and Nemotron lanes", async () => {
  const { listModels } = await import("../src/lib/llm.ts");
  const models = await listModels();
  for (const m of [config.meterless.fastModel, config.meterless.deepModel]) must(models.includes(m), `${m} not offered by Nightshift`);
  return `${config.meterless.fastModel}, ${config.meterless.deepModel}`;
}, "Open Nightshift, connect NVIDIA in Setup > Providers, put Nemotron models in a lane; or set METERLESS_FAST_MODEL / METERLESS_DEEP_MODEL to models your account offers");
await check("Nemotron answers", async () => {
  const { chat } = await import("../src/lib/llm.ts");
  const r = await chat({ purpose: "doctor", messages: [{ role: "user", content: "Reply with the single word: ready" }], maxTokens: 20 });
  return `served by ${r.model}`;
}, "Check METERLESS_RUNTIME_TOKEN and that the NVIDIA key in Nightshift works");

await check("World Model engine conformance", () => {
  const out = execSync("npx tsx scripts/conformance.ts", { cwd: path.join(repoRoot, "backend") }).toString();
  must(/8\/8 checks passed/.test(out), "conformance did not pass");
  return "8/8";
}, "Run npm run conformance to see the failing check");

for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.info ? `  (${r.info})` : ""}${r.fix ? `\n      fix: ${r.fix}` : ""}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} check(s) failed.` : "\nEverything is ready.");
process.exit(failed ? 1 : 0);
