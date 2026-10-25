// Case priority. Severity (how bad the problem is) is read from the case
// content once per finding: Nemotron rates it, with a rule-based fallback.
// Urgency (how soon a person must act) is computed on every request from
// the demo clock, the timers and the loop counters, so the ranking moves
// as the case does.

import { PROBLEM_TYPES } from "../domain.ts";
import { clock } from "../lib/clock.ts";
import { chatJson, LlmError } from "../lib/llm.ts";
import { asAgent, record, withRun } from "../lib/trace.ts";
import { getShipment } from "../services/shipments.ts";
import { customsFor } from "./sources.ts";
import { caseFacts, listCaseIds, setFacts, type CaseFacts } from "../state/caseState.ts";

export type Priority = { score: number; level: "Critical" | "High" | "Medium" | "Low"; severity: number; urgency: number; reasons: string[] };

// Typical severity when the customs status is unknown. When the customs record is
// available, whether customs actually holds the goods decides the base instead.
const BASE_SEVERITY: Record<string, number> = {
  MISSING_INVOICE: 4,
  INVOICE_REF_MISMATCH: 4,
  HS_CODE_ERROR: 4,
  MISSING_CERTIFICATE: 4,
  CONFLICTING_STATUS: 3,
  WEIGHT_MISMATCH: 3,
  TRANSPORT_DELAY: 3,
};

const SENSITIVE_GOODS = /\b(food|foodstuff|fruit|nut|fresh|frozen|chilled|meat|fish|dairy|perishable|medical|medicine|pharma\w*|vaccine|glove|surgical|diagnostic|health)s?\b/i;
const HIGH_VALUE = 50_000;

type ShipmentRow = { goods?: string | null; declared_value?: string | number | null; currency?: string | null; origin?: string | null; destination?: string | null } | null;

export function severityByRules(problemType: string, shipment: ShipmentRow, customsHeld: boolean | null = null): { severity: number; reason: string } {
  const reasons: string[] = [];
  let severity = customsHeld === null ? BASE_SEVERITY[problemType] ?? 3 : customsHeld ? 4 : 3;
  const held = customsHeld ?? severity >= 4;
  reasons.push(held ? `the goods are held at customs until this is fixed${customsHeld === null ? "" : " (customs record)"}` : `the problem delays the shipment but does not hold it at customs${customsHeld === null ? "" : " (customs record)"}`);
  if (shipment?.goods && SENSITIVE_GOODS.test(shipment.goods)) {
    severity += 1;
    reasons.push(`the goods (${shipment.goods.toLowerCase()}) are perishable or medical`);
  }
  const value = Number(shipment?.declared_value ?? 0);
  if (value >= HIGH_VALUE) {
    severity += 1;
    reasons.push(`high declared value (${value.toLocaleString("en-US")} ${shipment?.currency ?? ""})`.trim());
  }
  severity = Math.max(1, Math.min(5, severity));
  return { severity, reason: `Rated by rules: ${reasons.join("; ")}.` };
}

const SEVERITY_SYSTEM = `You are the Investigation agent in Track-N rating how severe a shipment exception case is.
Rate severity from 1 (minor, no business impact) to 5 (critical: goods stuck, spoiling, safety or large financial loss).
Consider: whether customs holds the goods, whether the goods are perishable, medical or time-critical, the declared value, and how hard the fix is.
Use only the facts given. Do not invent facts.
Return JSON: {"severity": <1-5>, "reason": "<one plain sentence naming the facts that decided the rating>"}`;

/** Rates the case's severity from its content and stores it on the case. */
export async function assessSeverity(caseId: string): Promise<number> {
  const f = caseFacts(caseId);
  if (!f) throw new Error(`Unknown case ${caseId}`);
  const shipment: ShipmentRow = await getShipment(f.awbNo);
  // The customs record (through Zetaris) says whether the goods are actually held.
  let customs: { status: string } | null = null;
  try {
    const row = (await customsFor(f.awbNo))[0]?.row;
    customs = row ? { status: String(row.status) } : null;
  } catch {
    customs = null;
  }
  const customsHeld = customs ? /^held/i.test(customs.status) : null;
  let severity: number;
  let reason: string;
  let method: string;
  try {
    const reply = await chatJson<{ severity: number; reason: string }>({
      purpose: "Rate case severity",
      model: "fast",
      system: SEVERITY_SYSTEM,
      user: [
        `Problem: ${PROBLEM_TYPES[f.problemType as keyof typeof PROBLEM_TYPES] ?? f.problemType} for AWB ${f.awbNo}.`,
        `Summary: ${f.summary}`,
        f.explanation ? `Explanation: ${f.explanation.replace(/\[[A-Z0-9-]+\]/g, "")}` : "",
        shipment ? `Shipment: ${shipment.goods ?? "goods not stated"}, declared value ${shipment.declared_value ?? "?"} ${shipment.currency ?? ""}, ${shipment.origin ?? "?"} to ${shipment.destination ?? "?"}.` : "",
        `Customs record: ${customs ? customs.status : "no customs entry"}.`,
      ].filter(Boolean).join("\n"),
      maxTokens: 300,
      validate: (v) => (!Number.isInteger(v.severity) || v.severity < 1 || v.severity > 5 ? "severity must be an integer from 1 to 5" : !v.reason ? "give a reason" : null),
    });
    severity = reply.severity;
    reason = reply.reason.trim();
    method = "model";
  } catch (err) {
    if (!(err instanceof LlmError)) throw err;
    ({ severity, reason } = severityByRules(f.problemType, shipment, customsHeld));
    method = "rules";
    record("decision", `No model to rate severity (${(err as Error).message.slice(0, 100)}); rated by rules`);
  }
  await setFacts(caseId, { severity, severityReason: reason, severityMethod: method }, "investigation");
  record("decision", `Severity ${severity}/5 (${method}): ${reason}`);
  return severity;
}

/** Rates every case that has no severity yet (cases created before priority existed). One at a time. */
export async function backfillSeverity(): Promise<number> {
  let n = 0;
  for (const caseId of listCaseIds()) {
    if (caseFacts(caseId)?.severity) continue;
    try {
      await withRun("rate priority", caseId, () => asAgent("investigation", () => assessSeverity(caseId)));
      n++;
    } catch (err) {
      console.error(`rate priority ${caseId}:`, err);
    }
  }
  return n;
}

/** How fast the reminder and escalation timers run: Critical cases at half time, High at three quarters. */
export function timerFactor(level: Priority["level"]): number {
  return level === "Critical" ? 0.5 : level === "High" ? 0.75 : 1;
}

const hoursUntil =(iso: string | null, now: Date) => (iso ? (new Date(iso).getTime() - now.getTime()) / 3_600_000 : null);

/** Severity and urgency combined into one ranking score. */
export function priorityOf(f: CaseFacts, now: Date = clock.now()): Priority {
  const reasons: string[] = [];
  const severity = f.severity ?? severityByRules(f.problemType, null).severity;
  reasons.push(`Severity ${severity}/5${f.severityReason ? `: ${f.severityReason}` : " (problem type only, not yet rated)"}`);

  let urgency = 0;
  const due = [f.escalateAt, f.nextReminderAt].map((t) => hoursUntil(t, now)).filter((h): h is number => h !== null);
  const soonest = due.length ? Math.min(...due) : null;
  if (soonest !== null) {
    if (soonest <= 0) { urgency += 2; reasons.push("A reminder or escalation time has passed"); }
    else if (soonest <= 1) { urgency += 1.5; reasons.push(`Next deadline in under an hour`); }
    else if (soonest <= 3) { urgency += 1; reasons.push(`Next deadline in ${Math.round(soonest)} h`); }
  }
  if (f.status === "ESCALATED" || f.status === "STALLED") { urgency += 2; reasons.push(`Case is ${f.status.toLowerCase()}`); }
  else if (f.status === "AWAITING_APPROVAL" || f.status === "READY_TO_CLOSE") { urgency += 1; reasons.push("Waiting for a person to act"); }
  const loops = (f.sendBacks ?? 0) + (f.reminders ?? 0) + (f.wrongDocs ?? 0);
  if (loops) { urgency += Math.min(1.5, loops * 0.5); reasons.push(`${loops} loop${loops > 1 ? "s" : ""} so far (send-backs, reminders, wrong documents)`); }
  if (f.flags?.length) { urgency += 0.5; reasons.push("Flagged for a person"); }
  const ageHours = f.openedAt ? (now.getTime() - new Date(f.openedAt).getTime()) / 3_600_000 : 0;
  if (ageHours >= 24) { urgency += 1; reasons.push(`Open for ${Math.round(ageHours)} h`); }
  else if (ageHours >= 8) { urgency += 0.5; reasons.push(`Open for ${Math.round(ageHours)} h`); }
  urgency = Math.min(5, Math.round(urgency * 2) / 2);

  const score = severity * 2 + urgency;
  const level = score >= 12 ? "Critical" : score >= 9 ? "High" : score >= 6 ? "Medium" : "Low";
  return { score, level, severity, urgency, reasons };
}
