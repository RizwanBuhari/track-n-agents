// Resolution Planning agent. Reads the case from shared state, the
// operating procedure and the shipment's parties (both through Zetaris),
// and any Verification feedback, then decides the next action: who to ask,
// what to ask for and what proof will close the case. When Verification
// sends a case back, the plan is revised to address the failed checks.

import { ROLE_LABELS } from "../domain.ts";
import { chatJson, LlmError } from "../lib/llm.ts";
import { record } from "../lib/trace.ts";
import { caseFacts, getCase, listPlans, savePlan, type Plan } from "../state/caseState.ts";
import { partiesFor, procedureFor, type Procedure } from "./sources.ts";

export type PlanContext = {
  reason: "new_case" | "person_feedback" | "sent_back" | "vague" | "wrong_document" | "conflicting" | "unsubstantiated" | "progress";
  detail: string;
  fromRole?: string;
};

const SYSTEM = `You are the Resolution Planning agent in Track-N, an air freight exception system.
Given a case, its operating procedure and what has happened so far, decide the ONE next action.
- "request": first request to the party who can fix it.
- "follow_up": answer to a reply that was incomplete, vague, wrong or contradicted by our records; ask the party who can confirm the RESULT (usually the customs broker for anything clearance-related, the carrier for movement).
- "escalate": only if the procedure cannot move forward without a manager.
Rules: follow the procedure's recipients; never ask for or suggest an HS code; a reply claiming an action is not proof of the result; ask for specific documents and references; name the exact mistake when a wrong document arrived.
Return JSON: {"action": "request|follow_up|escalate", "toRole": "<one of the allowed roles>", "goal": "<what this step achieves>", "ask": "<what exactly we ask for, one or two sentences>", "proofNeeded": ["<evidence that will close the case>"], "reason": "<why this party and this ask, referring to the evidence>"}`;

function fallbackPlan(proc: Procedure, ctx: PlanContext): Omit<Plan, "id" | "caseId" | "at"> {
  if (ctx.reason === "new_case" || ctx.reason === "person_feedback") {
    return { goal: `Resolve: ${proc.title}`, action: "request", toRole: proc.request_to_role, ask: proc.request_items, proofNeeded: [proc.closing_evidence], reason: "Procedure default recipient (rule-based fallback)." };
  }
  const toRole = ctx.reason === "wrong_document" || ctx.reason === "vague" ? ctx.fromRole ?? proc.request_to_role : proc.confirm_with_role;
  return { goal: "Get proof of the result", action: "follow_up", toRole, ask: `${ctx.detail} Please send the evidence listed in the procedure: ${proc.closing_evidence}`, proofNeeded: [proc.closing_evidence], reason: "Rule-based fallback after a reply that did not prove the result." };
}

export async function plan(caseId: string, ctx: PlanContext): Promise<{ plan: Plan; recipient: { role: string; name: string; email: string } }> {
  const c = getCase(caseId);
  if (!c) throw new Error(`Unknown case ${caseId}`);
  const proc = await procedureFor(c.problemType);
  const parties = await partiesFor(c.awbNo);
  const allowed = parties.filter((p) => p.role !== "operations");
  const previous = listPlans(caseId);
  const failedChecks = c.verifications.at(-1)?.checks.filter((k) => !k.passed).map((k) => `${k.name}: ${k.detail}`) ?? [];

  let proposal: Omit<Plan, "id" | "caseId" | "at">;
  try {
    const user = [
      `Case ${caseId}: ${c.title} for AWB ${c.awbNo}. Status ${c.status}.`,
      `Finding: ${c.summary}`,
      `Procedure: request to ${proc.request_to_role}; confirm with ${proc.confirm_with_role}. Request items: ${proc.request_items}`,
      `Closing evidence: ${proc.closing_evidence}`,
      `Not enough: ${proc.not_enough}`,
      `Allowed roles: ${allowed.map((p) => `${p.role} (${p.name})`).join(", ")}`,
      `Why we are planning now: ${ctx.reason} - ${ctx.detail}`,
      failedChecks.length ? `Verification failed checks: ${failedChecks.join(" | ")}` : "",
      previous.length ? `Previous plans: ${previous.map((p) => `${p.action} to ${p.toRole}: ${p.ask}`).join(" || ")}` : "",
      c.emails.length ? `Email history: ${c.emails.map((e) => `${e.direction} ${e.from} "${e.subject}" ${e.classification ? `[${e.classification}]` : ""} ${e.meaning ?? ""}`).join(" || ")}` : "",
    ].filter(Boolean).join("\n");
    proposal = await chatJson<Omit<Plan, "id" | "caseId" | "at">>({
      purpose: ctx.reason === "new_case" ? "Plan the first action" : "Revise the plan",
      model: "fast",
      system: SYSTEM,
      user,
      maxTokens: 700,
      validate: (v) => {
        if (!["request", "follow_up", "escalate"].includes(v.action)) return "action must be request, follow_up or escalate";
        if (v.action !== "escalate" && !allowed.some((p) => p.role === v.toRole)) return `toRole must be one of ${allowed.map((p) => p.role).join(", ")}`;
        if (!v.ask || v.ask.length < 15) return "ask must say exactly what we need";
        if (ctx.reason === "wrong_document" && ctx.fromRole && v.toRole !== ctx.fromRole) return `a wrong document goes back to its sender (${ctx.fromRole}) naming the mistake`;
        if (ctx.reason === "new_case" && (v.action !== "request" || v.toRole !== proc.request_to_role)) return `a new case starts with action "request" to the ${proc.request_to_role}, as the procedure says`;
        const withoutAwbs = `${v.ask} ${v.goal}`.replace(/\b\d{3}[- ]?\d{4} ?\d{4}\b/g, "");
        if (c.problemType === "HS_CODE_ERROR" && /\b\d{6,10}\b/.test(withoutAwbs)) return "never name or suggest an HS code; ask for specifications and let the broker decide the code";
        return null;
      },
    });
    proposal.proofNeeded = proposal.proofNeeded?.length ? proposal.proofNeeded : [proc.closing_evidence];
  } catch (err) {
    if (!(err instanceof LlmError)) throw err;
    record("decision", `No valid model plan (${(err as Error).message.slice(0, 120)}); using the procedure default plan`);
    proposal = fallbackPlan(proc, ctx);
  }
  if (ctx.reason !== "new_case" && previous.length) proposal.revisedBecause = ctx.detail;

  const recipient = proposal.action === "escalate"
    ? { role: "operations_manager", name: "Operations Manager", email: "ops.manager@example.com" }
    : allowed.find((p) => p.role === proposal.toRole)!;
  const saved = await savePlan(caseId, proposal, "planning", recipient.email);
  record("decision", `Plan: ${saved.action} to ${ROLE_LABELS[saved.toRole] ?? saved.toRole} (${recipient.email}) - ${saved.ask}`, saved);
  return { plan: saved, recipient };
}

export function timersFor(proc: Procedure, sentAt: string, urgent = false) {
  const f = urgent ? 0.5 : 1;
  const at = (h: number) => new Date(new Date(sentAt).getTime() + h * f * 3_600_000).toISOString();
  return { firstReminderAt: at(proc.reminder1_hours), secondReminderAt: at(proc.reminder2_hours), escalateAt: at(proc.escalate_hours) };
}

export { caseFacts };
