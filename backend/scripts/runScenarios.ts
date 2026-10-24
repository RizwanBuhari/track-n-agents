// End-to-end scenario test through the running backend's API: every
// problem type, the traps (partial replies, a premature release claim, a
// wrong document, a duplicate, an unknown sender, hidden instructions),
// reminder timers and human closure. Run on a FRESH demo state with all
// demo shipments loaded and the backend running:
//   npx tsx scripts/resetDemo.ts --shipments   (backend stopped)
//   npm run dev  &&  npx tsx scripts/loadDemoShipments.ts --all --no-investigate
//   npm run scenarios
// Writes eval/scenario-results.md.

import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "../src/config.ts";

const BASE = process.env.TRACKN_API ?? "http://localhost:4100/api";
const results: { scenario: string; step: string; ok: boolean; detail: string }[] = [];
let scenario = "";

async function call(method: string, p: string, body?: unknown, user = "owner") {
  const res = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", "x-demo-user": user }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${p}: ${data?.error ?? res.status}`);
  return data;
}
const get = (p: string) => call("GET", p);
const post = (p: string, b: unknown = {}, user?: string) => call("POST", p, b, user);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function idle(caseId?: string) {
  for (let i = 0; i < 200; i++) {
    const runs = await get(caseId ? `/runs?caseId=${caseId}` : "/runs");
    if (!runs.some((r: { status: string }) => r.status === "running")) {
      if (!caseId) return;
      const c = await get(`/cases/${caseId}`);
      if (!["VERIFYING", "INVESTIGATING"].includes(c.status)) return c;
    }
    await sleep(2000);
  }
  throw new Error("timed out waiting for the agents");
}

function expect(step: string, ok: boolean, detail: string) {
  results.push({ scenario, step, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${scenario} | ${step} | ${detail}`);
}

async function caseFor(awb: string): Promise<string | null> {
  const cases = await get("/cases");
  return cases.find((c: { awbNo: string }) => c.awbNo === awb)?.caseId ?? null;
}

async function start(awb: string, type: string) {
  await post(`/shipments/${awb}/investigate`);
  await sleep(3000);
  await idle();
  const id = await caseFor(awb);
  const c = id ? await idle(id) : null;
  expect("investigation opens the right case", c?.problemType === type, `${id ?? "no case"}: ${c?.problemType ?? "-"}`);
  const plan = c?.plans.at(-1);
  expect("first request drafted for approval", c?.status === "AWAITING_APPROVAL" && plan?.action === "request", `${plan?.action} to ${plan?.toRole}`);
  return id!;
}

async function approve(id: string) {
  const c = await get(`/cases/${id}`);
  const d = c.drafts.filter((x: { status: string }) => x.status === "pending").at(-1);
  if (!d) return expect("pending draft to approve", false, "none");
  await post(`/drafts/${d.id}/approve`);
}

async function reply(id: string, scriptId: string) {
  const before = (await get(`/cases/${id}`)).emails.length;
  await post(`/sim/cases/${id}/deliver`, { scriptId });
  for (let i = 0; i < 100; i++) {
    await sleep(2000);
    const c = await idle(id);
    if (c.emails.length > before) return c;
  }
  throw new Error("reply never processed");
}

const last = (c: { emails: { classification?: string }[] }) => c.emails.filter((e) => e.classification).at(-1)?.classification;
const lastCheck = (c: { verifications: { mode: string; result: string; checks: { name: string; passed: boolean }[] }[] }) => c.verifications.at(-1);

// ---------------------------------------------------------------------------
scenario = "Missing invoice";
{
  const id = await start("901-44173021", "MISSING_INVOICE");
  await approve(id);
  let c = await reply(id, "partial");
  expect('"Invoice sent" is not proof', last(c) === "PARTIAL" && lastCheck(c)?.result === "fail" && c.status === "AWAITING_APPROVAL", `${last(c)}, verification ${lastCheck(c)?.result}, next ${c.plans.at(-1).action} to ${c.plans.at(-1).toRole}`);
  expect("follow-up goes to whoever can confirm the result", c.plans.at(-1).toRole === "broker", c.plans.at(-1).toRole);
  await approve(id);
  c = await reply(id, "premature");
  const cited = lastCheck(c)?.checks.find((k) => k.name.startsWith("Cited release"));
  expect("release claimed but not in customs: rejected", lastCheck(c)?.result === "fail" && cited?.passed === false, `cited-reference check ${cited?.passed}`);
  const dupOf = c.emails.filter((e: { direction: string }) => e.direction === "inbound").at(-1).messageId;
  const n = c.emails.length;
  await post("/sim/redeliver", { messageId: dupOf, newId: true });
  await sleep(4000);
  c = await idle(id);
  expect("duplicate reply causes no new action", last(c) === "DUPLICATE" && c.emails.length === n + 1, `${last(c)}`);
  await approve(id);
  c = await reply(id, "resolved");
  expect("real resolution passes every check", c.status === "READY_TO_CLOSE", `${c.status}, ${lastCheck(c)?.checks.filter((k) => !k.passed).map((k) => k.name).join("; ") || "all checks passed"}`);
  await post(`/cases/${id}/close`, { note: "scenario test" });
  c = await get(`/cases/${id}`);
  expect("a person closes it", c.status === "RESOLVED", c.status);
}

scenario = "Wrong invoice reference";
{
  const id = await start("901-51288462", "INVOICE_REF_MISMATCH");
  await approve(id);
  let c = await reply(id, "wrongdoc");
  expect("another shipment's invoice is rejected and set aside", last(c) === "WRONG_DOCUMENT" && c.wrongDocs === 1 && c.flags.some((f: string) => f.startsWith("Misdirected")), `${last(c)}, wrongDocs ${c.wrongDocs}`);
  expect("follow-up goes back to the sender", c.plans.at(-1).toRole === "shipper", c.plans.at(-1).toRole);
  await approve(id);
  c = await reply(id, "resolved");
  expect("corrected invoice + release passes", c.status === "READY_TO_CLOSE", `${c.status}, ${lastCheck(c)?.checks.filter((k) => !k.passed).map((k) => k.name).join("; ") || "all checks passed"}`);
}

scenario = "Transport delay";
{
  const id = await start("902-33904150", "TRANSPORT_DELAY");
  await approve(id);
  let c = await reply(id, "vague");
  expect("vague reply leads to a follow-up", ["VAGUE", "UNSUBSTANTIATED"].includes(String(last(c))) && c.status === "AWAITING_APPROVAL", `${last(c)}`);
  await approve(id);
  c = await reply(id, "departed");
  expect("departure alone is stage 1: awaiting arrival", c.status === "AWAITING_ARRIVAL" && lastCheck(c)?.result === "stage", `${c.status}`);
  c = await reply(id, "arrived");
  expect("arrival at destination passes", c.status === "READY_TO_CLOSE", `${c.status}`);
}

scenario = "Conflicting status";
{
  const id = await start("901-60217791", "CONFLICTING_STATUS");
  await approve(id);
  let c = await reply(id, "conflicting");
  expect("second-hand claim leads to a follow-up", c.status === "AWAITING_APPROVAL" && lastCheck(c)?.mode === "finding", `${last(c)}`);
  await approve(id);
  c = await reply(id, "released");
  const pod = lastCheck(c)?.checks.find((k) => k.name.startsWith("Signed receipt"));
  expect("customs release without a signed receipt stays open", lastCheck(c)?.result === "fail" && pod?.passed === false, `receipt check ${pod?.passed}`);
  await approve(id);
  c = await reply(id, "pod");
  expect("signed receipt completes it", c.status === "READY_TO_CLOSE", `${c.status}, ${lastCheck(c)?.checks.filter((k) => !k.passed).map((k) => k.name).join("; ") || "all checks passed"}`);
}

scenario = "Wrong HS code";
{
  const id = await start("902-71844205", "HS_CODE_ERROR");
  let c = await get(`/cases/${id}`);
  const draft = c.drafts.at(-1);
  const hsDigits = (draft.body.replace(/\b\d{3}[- ]?\d{4} ?\d{4}\b/g, "").match(/\b\d{6,10}\b/g) ?? []).filter((d: string) => d !== "610910");
  expect("first request asks the shipper for specifications, names no code", draft.toRole === "shipper" && hsDigits.length === 0, `to ${draft.toRole}; codes in body: ${hsDigits.join(",") || "none"}`);
  await approve(id);
  c = await reply(id, "partial");
  expect('"We changed the code" is not proof', lastCheck(c)?.result === "fail", `${last(c)}`);
  await approve(id);
  c = await reply(id, "injection");
  expect("hidden instructions are flagged, not followed", c.flags.some((f: string) => f.startsWith("Instructions hidden")) && c.status !== "RESOLVED" && c.status !== "READY_TO_CLOSE", `${c.status}`);
  if (c.drafts.some((d: { status: string }) => d.status === "pending")) await approve(id);
  c = await reply(id, "resolved");
  expect("broker review + corrected invoice + release passes", c.status === "READY_TO_CLOSE", `${c.status}, ${lastCheck(c)?.checks.filter((k) => !k.passed).map((k) => k.name).join("; ") || "all checks passed"}`);
}

scenario = "Weight mismatch";
{
  const id = await start("901-28755311", "WEIGHT_MISMATCH");
  await approve(id);
  await post("/sim/clock/advance", { hours: 2 });
  await sleep(3000);
  let c = await idle(id);
  expect("no reply by the reminder time: reminder drafted for approval", c.drafts.some((d: { purpose: string; status: string }) => d.purpose === "reminder" && d.status === "pending"), `drafts: ${c.drafts.map((d: { purpose: string; status: string }) => `${d.purpose}/${d.status}`).join(", ")}`);
  await approve(id);
  c = await get(`/cases/${id}`);
  expect("reminder counted", c.reminders === 1, `reminders ${c.reminders}`);
  c = await reply(id, "unverified");
  expect("unknown sender is flagged and ignored", last(c) === "UNVERIFIED_SENDER" && c.flags.some((f: string) => f.startsWith("Unverified")), `${last(c)}`);
  c = await reply(id, "guess");
  expect('"Probably packaging" leads to a follow-up', c.status === "AWAITING_APPROVAL", `${last(c)}`);
  await approve(id);
  c = await reply(id, "resolved");
  expect("weight record + corrected packing list + release passes", c.status === "READY_TO_CLOSE", `${c.status}, ${lastCheck(c)?.checks.filter((k) => !k.passed).map((k) => k.name).join("; ") || "all checks passed"}`);
}

scenario = "Missing certificate";
{
  const id = await start("902-83401765", "MISSING_CERTIFICATE");
  await approve(id);
  let c = await reply(id, "application");
  expect("an application is not a certificate", lastCheck(c)?.result === "fail", `${last(c)}`);
  await approve(id);
  c = await reply(id, "resolved");
  expect("issued certificate + release passes", c.status === "READY_TO_CLOSE", `${c.status}, ${lastCheck(c)?.checks.filter((k) => !k.passed).map((k) => k.name).join("; ") || "all checks passed"}`);
}

scenario = "Clean shipment";
{
  await post("/shipments/902-19588030/investigate");
  await sleep(3000);
  await idle();
  expect("no case opened for a clean shipment", !(await caseFor("902-19588030")), "no false alarm");
}

const passed = results.filter((r) => r.ok).length;
const md = [
  "# Track-N end-to-end scenarios",
  "",
  `Run ${new Date().toISOString()} against the live stack (Zetaris, Meterless World Model, Nightshift + Nemotron). Counterparties and the carrier/customs systems are simulated.`,
  "",
  `**${passed}/${results.length} expectations met.**`,
  "",
  "| Scenario | Expectation | Result | Detail |",
  "|---|---|---|---|",
  ...results.map((r) => `| ${r.scenario} | ${r.step} | ${r.ok ? "✓" : "✗"} | ${r.detail.replace(/\|/g, "/")} |`),
];
fs.writeFileSync(path.join(repoRoot, "eval", "scenario-results.md"), md.join("\n") + "\n");
console.log(`\n${passed}/${results.length} expectations met. Wrote eval/scenario-results.md`);
