// Scores Track-N against the hidden answer sheet (eval/answer_sheet/).
// Only this script reads the answer sheet; agent code never does.
//   1. AWB extraction vs documents_truth.csv (field accuracy)
//   2. Investigation vs answer_sheet.csv (problem type, no false alarm on
//      the clean shipment)
//   3. First request recipient (procedure via Zetaris) vs the answer sheet
// Writes eval/results.md. Run it on a FRESH demo state (scripts/resetDemo.ts, then
// scripts/loadDemoShipments.ts --all): once cases are resolved in the simulated world
// the shipments are no longer broken, and "no problem" becomes the right answer.

import fs from "node:fs";
import path from "node:path";
import { config, repoRoot } from "../src/config.ts";
import { investigate } from "../src/agents/investigation.ts";
import { procedureFor } from "../src/agents/sources.ts";
import { extractAwb } from "../src/extraction/extractAwb.ts";
import { digitsOnly, normalizeCompany } from "../src/lib/refs.ts";
import { withRun } from "../src/lib/trace.ts";

function csv(file: string): Record<string, string>[] {
  const lines = fs.readFileSync(file, "utf-8").trim().split(/\r?\n/);
  const split = (l: string) => [...l.matchAll(/("([^"]|"")*"|[^,]*)(,|$)/g)].map((m) => m[1].replace(/^"|"$/g, "").replace(/""/g, '"')).slice(0, -1);
  const head = split(lines[0]);
  return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [head[i], v])));
}

const sheetDir = path.join(repoRoot, "eval", "answer_sheet");
const answers = csv(path.join(sheetDir, "answer_sheet.csv"));
const truth = csv(path.join(sheetDir, "documents_truth.csv"));
const out: string[] = [`# Track-N evaluation`, ``, `Run ${new Date().toISOString()} · models: ${config.meterless.deepModel} (investigation), ${config.meterless.fastModel} (extraction)`, ``];

// ---------------------------------------------------------------- 1. extraction
const FIELD_MAP: Record<string, (f: Record<string, unknown>) => string> = {
  awb_no: (f) => String(f.awbNumber),
  shipper: (f) => String(f.shipper),
  consignee: (f) => String(f.consignee),
  origin: (f) => String(f.origin),
  destination: (f) => String(f.destination),
  flight: (f) => String(f.flightNumber),
  flight_date: (f) => String(f.flightDate),
  pieces: (f) => String(f.pieces),
  gross_weight_kg: (f) => String(f.weightKg),
  goods: (f) => String(f.cargoDescription),
};
const same = (field: string, a: string, b: string) => {
  if (field === "awb_no") return digitsOnly(a) === digitsOnly(b);
  if (field === "pieces" || field === "gross_weight_kg") return Number(a) === Number(b);
  if (field === "shipper" || field === "consignee" || field === "goods") return normalizeCompany(a) === normalizeCompany(b);
  if (field === "flight") return a.replace(/\s/g, "").toUpperCase() === b.replace(/\s/g, "").toUpperCase();
  return a.trim().toUpperCase() === b.trim().toUpperCase();
};

out.push("## 1. AWB extraction (text PDFs)", "", "| Document | Correct | Wrong fields |", "|---|---|---|");
let ok = 0;
let total = 0;
for (const doc of [...new Set(truth.filter((t) => t.doc_file.endsWith("_AWB.pdf")).map((t) => t.doc_file))]) {
  const file = path.join(repoRoot, "demo-data", "cases", doc.slice(0, 8), doc);
  const r = await withRun(`eval extract ${doc}`, undefined, () => extractAwb(new Uint8Array(fs.readFileSync(file)), doc));
  const rows = truth.filter((t) => t.doc_file === doc && FIELD_MAP[t.field]);
  const wrong = rows.filter((t) => !same(t.field, FIELD_MAP[t.field](r.fields as unknown as Record<string, unknown>), t.correct_value));
  ok += rows.length - wrong.length;
  total += rows.length;
  out.push(`| ${doc} | ${rows.length - wrong.length}/${rows.length} | ${wrong.map((w) => `${w.field}: got "${FIELD_MAP[w.field](r.fields as unknown as Record<string, unknown>)}", expected "${w.correct_value}"`).join("; ") || "—"} |`);
  console.log(`extraction ${doc}: ${rows.length - wrong.length}/${rows.length}`);
}
out.push("", `**Field accuracy: ${ok}/${total} (${((ok / total) * 100).toFixed(1)}%).** Scanned copies are not scored: without a vision lane they go to manual entry by design.`, "");

// ------------------------------------------------------------- 2+3. investigation
out.push("## 2. Investigation and first action", "", "| Case | Expected | Found | Type | Expected first contact | Procedure sends first request to | Recipient |", "|---|---|---|---|---|---|---|");
let typeOk = 0;
let falseAlarms = 0;
let recipientOk = 0;
let recipientTotal = 0;
for (const a of answers) {
  const r = await withRun(`eval investigate ${a.case_id}`, undefined, () => investigate(a.awb_no, { trigger: "evaluation" }));
  const found = r?.finding.problemType ?? "NONE";
  const expected = a.problem_type === "CLEAN" ? "NONE" : a.problem_type;
  const typeMatch = found === expected;
  if (typeMatch) typeOk++;
  if (expected === "NONE" && found !== "NONE") falseAlarms++;
  let procRole = "—";
  let recip = "n/a";
  if (expected !== "NONE") {
    procRole = (await withRun(`eval procedure ${a.case_id}`, undefined, () => procedureFor(expected))).request_to_role;
    const roles = a.action_to.toLowerCase();
    const match = roles.includes(procRole === "broker" ? "broker" : procRole);
    recipientTotal++;
    if (match) recipientOk++;
    recip = match ? "✓" : "✗";
  }
  out.push(`| ${a.case_id} | ${expected} | ${found} | ${typeMatch ? "✓" : "✗"} | ${a.action_to} | ${procRole} | ${recip} |`);
  console.log(`investigation ${a.case_id}: expected ${expected}, found ${found}`);
}
out.push(
  "",
  `**Problem type: ${typeOk}/${answers.length}.** False alarms on clean shipments: ${falseAlarms}. First recipient matches the answer sheet: ${recipientOk}/${recipientTotal}.`,
  "",
  "Notes: the answer sheet lists some cases with two parties (for example \"Shipper and carrier\"); a match on either counts. Closing behaviour (no early closure on \"invoice sent\", wrong documents, premature release claims, duplicates, unknown senders) is exercised by `npm run scenarios`.",
);

fs.writeFileSync(path.join(repoRoot, "eval", "results.md"), out.join("\n") + "\n");
console.log(`\nWrote eval/results.md`);
process.exit(0);
