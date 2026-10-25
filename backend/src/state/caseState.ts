// Track-N's shared case state, held in the Meterless World Model engine.
//
// Every agent reads and writes cases through this module, so they all see
// the same evidence, plan, emails and verification results. The engine's
// event log is the case history; its audit log is the activity feed.
//
//   entities   case, shipment, party, evidence, email, draft, plan, check
//   facts      case status / problem / counters / timers (most recent wins)
//   relations  case -concerns-> shipment, evidence -supports-> case,
//              email -part-of-> case, case -awaiting-> party (bitemporal:
//              a revised plan closes the old edge, so history is kept)

import { WorldModel, type Entity, type Fact, type Provenance } from "../engines/world-model/index.ts";
import { config } from "../config.ts";
import { clock } from "../lib/clock.ts";
import { currentRun } from "../lib/trace.ts";

export const world = new WorldModel({
  storage: "local",
  namespace: "track-n",
  directory: config.dataDir,
  conflictPolicy: "most-recent-wins",
});

export type CaseStatus =
  | "INVESTIGATING"
  | "AWAITING_APPROVAL"
  | "WAITING_REPLY"
  | "AWAITING_ARRIVAL"
  | "WAITING_ON_ISSUER"
  | "VERIFYING"
  | "READY_TO_CLOSE"
  | "ESCALATED"
  | "STALLED"
  | "RESOLVED"
  | "CLOSED_UNRESOLVED";

export const OPEN_STATUSES: CaseStatus[] = ["INVESTIGATING", "AWAITING_APPROVAL", "WAITING_REPLY", "AWAITING_ARRIVAL", "WAITING_ON_ISSUER", "VERIFYING", "READY_TO_CLOSE", "ESCALATED", "STALLED"];

export type CaseFacts = {
  status: CaseStatus;
  problemType: string;
  title: string;
  awbNo: string;
  owner: string;
  summary: string;
  explanation: string;
  confidence: number;
  nextAction: string;
  awaitingRole: string;
  requestSentAt: string | null;
  nextReminderAt: string | null;
  escalateAt: string | null;
  reminders: number;
  wrongDocs: number;
  sendBacks: number;
  stage: string;
  escalated: boolean;
  openedAt: string;
  closedAt: string | null;
  closureNote: string;
  flags: string[];
  investigationRun: string;
  severity?: number;
  severityReason?: string;
  severityMethod?: string;
};

export type Evidence = {
  id: string;
  source: string;
  recordId: string;
  claim: string;
  value?: unknown;
  observedAt?: string;
  addedBy: string;
  kind: "finding" | "record" | "reply" | "document" | "check";
};

export type Draft = {
  id: string;
  caseId: string;
  purpose: "request" | "follow_up" | "reminder" | "escalation" | "notify";
  toRole: string;
  to: string;
  cc: string;
  subject: string;
  body: string;
  rationale: string;
  status: "pending" | "approved" | "rejected" | "sent";
  createdBy: string;
  createdAt: string;
  decidedBy?: string;
  decidedAt?: string;
  messageId?: string;
  language?: string;
};

export type Check = { name: string; passed: boolean; detail: string; evidenceIds?: string[] };

export type VerificationResult = {
  id: string;
  caseId: string;
  mode: "finding" | "resolution";
  result: "pass" | "fail" | "stage";
  checks: Check[];
  critique: string;
  trigger: string;
  at: string;
};

export type Plan = {
  id: string;
  caseId: string;
  goal: string;
  action: "request" | "follow_up" | "reminder" | "escalate" | "wait" | "close";
  toRole: string;
  ask: string;
  proofNeeded: string[];
  reason: string;
  revisedBecause?: string;
  at: string;
};

const SYS = "trackn";
export const ids = {
  case: (caseId: string) => `case:${SYS}:${caseId}`,
  shipment: (awb: string) => `shipment:${SYS}:${awb}`,
  party: (email: string) => `party:${SYS}:${email.toLowerCase()}`,
  evidence: (id: string) => `evidence:${SYS}:${id}`,
  email: (messageId: string) => `email:${SYS}:${messageId}`,
  draft: (id: string) => `draft:${SYS}:${id}`,
  plan: (id: string) => `plan:${SYS}:${id}`,
  check: (id: string) => `check:${SYS}:${id}`,
};

function src(by: string): Provenance {
  return { kind: by === "person" || by.startsWith("user:") ? "manual" : "agent", by, at: clock.now().toISOString(), runId: currentRun()?.runId };
}

function key(id: string) {
  return { system: SYS, id };
}

// ------------------------------------------------------------------ cases

export async function openCase(input: { awbNo: string; problemType: string; title: string; owner: string; summary: string; explanation: string; confidence: number; by: string }): Promise<string> {
  const n = world.view("graph").query({ type: "case" }).length + 1;
  const caseId = `TN-${String(n).padStart(4, "0")}`;
  const at = clock.now().toISOString();
  await world.upsertEntity({ type: "case", externalKey: key(caseId), attrs: { caseId, awbNo: input.awbNo }, source: src(input.by) });
  await world.upsertEntity({ type: "shipment", externalKey: key(input.awbNo), attrs: { awbNo: input.awbNo }, source: src(input.by) });
  await world.relate({ from: ids.case(caseId), type: "concerns", to: ids.shipment(input.awbNo), source: src(input.by) });
  await setFacts(caseId, {
    status: "INVESTIGATING",
    problemType: input.problemType,
    title: input.title,
    awbNo: input.awbNo,
    owner: input.owner,
    summary: input.summary,
    explanation: input.explanation,
    confidence: input.confidence,
    openedAt: at,
    reminders: 0,
    wrongDocs: 0,
    sendBacks: 0,
    escalated: false,
    flags: [],
    stage: "",
    requestSentAt: null,
    nextReminderAt: null,
    escalateAt: null,
    closedAt: null,
  }, input.by);
  return caseId;
}

export async function setFacts(caseId: string, patch: Partial<CaseFacts>, by: string): Promise<void> {
  for (const [predicate, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    await world.assertFact({ about: ids.case(caseId), predicate, value, confidence: 1, source: src(by) });
  }
}

/** Current case attributes: the latest asserted value per predicate (fold over the fact log). */
export function caseFacts(caseId: string): CaseFacts | null {
  const facts = world.view("facts").about(ids.case(caseId));
  if (!facts.length) return null;
  const out: Record<string, unknown> = {};
  for (const f of facts) out[f.predicate] = f.value; // facts are ordered by assertedAt, then append order
  return out as CaseFacts;
}

export function factHistory(caseId: string): Fact[] {
  return world.view("facts").about(ids.case(caseId));
}

export function listCaseIds(): string[] {
  return world.view("graph").query({ type: "case" }).map((e) => String(e.attrs.caseId)).sort();
}

export function findOpenCase(awbNo: string, problemType?: string): string | null {
  for (const caseId of listCaseIds()) {
    const f = caseFacts(caseId);
    if (f && f.awbNo === awbNo && OPEN_STATUSES.includes(f.status) && (!problemType || f.problemType === problemType)) return caseId;
  }
  return null;
}

// --------------------------------------------------------------- evidence

function related(caseId: string, type: string, via: string): Entity[] {
  return world.view("graph").incoming(ids.case(caseId), { via }).filter((e) => e.type === type);
}

export async function addEvidence(caseId: string, ev: Omit<Evidence, "id">): Promise<Evidence> {
  // Content-addressed: the same source record and claim is stored once.
  const existing = listEvidence(caseId).find((e) => e.source === ev.source && e.recordId === ev.recordId && e.claim === ev.claim);
  if (existing) return existing;
  const id = `${caseId}-E${String(listEvidence(caseId).length + 1).padStart(2, "0")}`;
  const evidence: Evidence = { id, ...ev };
  await world.upsertEntity({ type: "evidence", externalKey: key(id), attrs: evidence as unknown as Record<string, unknown>, source: src(ev.addedBy) });
  await world.relate({ from: ids.evidence(id), type: "supports", to: ids.case(caseId), source: src(ev.addedBy) });
  return evidence;
}

export function listEvidence(caseId: string): Evidence[] {
  return related(caseId, "evidence", "supports").map((e) => e.attrs as unknown as Evidence).sort((a, b) => a.id.localeCompare(b.id));
}

// ------------------------------------------------------------------ plans

export async function savePlan(caseId: string, plan: Omit<Plan, "id" | "caseId" | "at">, by: string, awaitingEmail?: string): Promise<Plan> {
  const id = `${caseId}-P${String(listPlans(caseId).length + 1).padStart(2, "0")}`;
  const full: Plan = { ...plan, id, caseId, at: clock.now().toISOString() };
  await world.upsertEntity({ type: "plan", externalKey: key(id), attrs: full as unknown as Record<string, unknown>, source: src(by) });
  await world.relate({ from: ids.plan(id), type: "plan-for", to: ids.case(caseId), source: src(by) });
  if (awaitingEmail) {
    await world.upsertEntity({ type: "party", externalKey: key(awaitingEmail.toLowerCase()), attrs: { email: awaitingEmail, role: plan.toRole }, source: src(by) });
    // Bitemporal: re-pointing "awaiting" closes the previous edge instead of deleting it.
    const current = world.view("graph").neighborsOf(ids.case(caseId), { via: "awaiting" }).map((e) => e.id);
    if (!current.includes(ids.party(awaitingEmail))) {
      await world.relate({ from: ids.case(caseId), type: "awaiting", to: ids.party(awaitingEmail), validFrom: full.at, source: src(by) });
    }
  }
  await setFacts(caseId, { nextAction: plan.ask, awaitingRole: plan.toRole }, by);
  return full;
}

export function listPlans(caseId: string): Plan[] {
  return related(caseId, "plan", "plan-for").map((e) => e.attrs as unknown as Plan).sort((a, b) => a.id.localeCompare(b.id));
}

export function awaitingHistory(caseId: string) {
  const rels = [...world.events()]
    .filter((e) => e.kind === "relate")
    .map((e) => e.payload as { from: string; type: string; to: string; validFrom?: string; id: string })
    .filter((r) => r.from === ids.case(caseId) && r.type === "awaiting");
  const current = world.view("graph").neighborsOf(ids.case(caseId), { via: "awaiting" }).map((e) => e.id);
  return rels.map((r) => ({ party: r.to.replace(`party:${SYS}:`, ""), from: r.validFrom, current: current.includes(r.to) }));
}

// ----------------------------------------------------------------- drafts

export async function saveDraft(caseId: string, draft: Omit<Draft, "id" | "caseId" | "status" | "createdAt">): Promise<Draft> {
  const id = `${caseId}-D${String(listDrafts(caseId).length + 1).padStart(2, "0")}`;
  const full: Draft = { ...draft, id, caseId, status: "pending", createdAt: clock.now().toISOString() };
  await world.upsertEntity({ type: "draft", externalKey: key(id), attrs: full as unknown as Record<string, unknown>, source: src(draft.createdBy) });
  await world.relate({ from: ids.draft(id), type: "draft-for", to: ids.case(caseId), source: src(draft.createdBy) });
  return full;
}

export async function updateDraft(id: string, patch: Partial<Draft>, by: string): Promise<Draft> {
  const attrs = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined && v !== ""));
  await world.upsertEntity({ type: "draft", externalKey: key(id), attrs, source: src(by) });
  return getDraft(id)!;
}

export function getDraft(id: string): Draft | null {
  const e = world.view("graph").entity(ids.draft(id));
  return e ? (e.attrs as unknown as Draft) : null;
}

export function listDrafts(caseId?: string): Draft[] {
  if (caseId) return related(caseId, "draft", "draft-for").map((e) => e.attrs as unknown as Draft).sort((a, b) => a.id.localeCompare(b.id));
  return world.view("graph").query({ type: "draft" }).map((e) => e.attrs as unknown as Draft);
}

// ----------------------------------------------------------------- emails

export async function linkEmail(caseId: string, email: { messageId: string; direction: string; from: string; subject: string; sentAt: string; classification?: string; meaning?: string; duplicateOf?: string }, by: string): Promise<void> {
  await world.upsertEntity({ type: "email", externalKey: key(email.messageId), attrs: { ...email, caseId }, source: src(by) });
  await world.relate({ from: ids.email(email.messageId), type: "part-of", to: ids.case(caseId), source: src(by) });
}

export function listEmails(caseId: string) {
  return related(caseId, "email", "part-of").map((e) => e.attrs as Record<string, unknown>).sort((a, b) => String(a.sentAt).localeCompare(String(b.sentAt)));
}

export function emailEntity(messageId: string) {
  return world.view("graph").entity(ids.email(messageId))?.attrs ?? null;
}

// ----------------------------------------------------------- verification

export async function saveVerification(caseId: string, v: Omit<VerificationResult, "id" | "caseId" | "at">): Promise<VerificationResult> {
  const id = `${caseId}-V${String(listVerifications(caseId).length + 1).padStart(2, "0")}`;
  const full: VerificationResult = { ...v, id, caseId, at: clock.now().toISOString() };
  await world.upsertEntity({ type: "check", externalKey: key(id), attrs: full as unknown as Record<string, unknown>, source: src("verification") });
  await world.relate({ from: ids.check(id), type: "verifies", to: ids.case(caseId), source: src("verification") });
  return full;
}

export function listVerifications(caseId: string): VerificationResult[] {
  return related(caseId, "check", "verifies").map((e) => e.attrs as unknown as VerificationResult).sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------- reading

export function getCase(caseId: string) {
  const facts = caseFacts(caseId);
  if (!facts) return null;
  return {
    caseId,
    ...facts,
    evidence: listEvidence(caseId),
    plans: listPlans(caseId),
    drafts: listDrafts(caseId),
    emails: listEmails(caseId),
    verifications: listVerifications(caseId),
    awaiting: awaitingHistory(caseId),
  };
}

export type CaseView = NonNullable<ReturnType<typeof getCase>>;

export function caseActivity(caseId: string) {
  const caseEntityIds = new Set([ids.case(caseId)]);
  for (const t of ["evidence", "plan", "draft", "email", "check"]) {
    for (const e of world.view("graph").incoming(ids.case(caseId))) if (e.type === t) caseEntityIds.add(e.id);
  }
  return world
    .audit()
    .filter((a) => [...caseEntityIds].some((id) => a.summary.includes(id)))
    .map((a) => ({ seq: a.seq, at: a.at, kind: a.kind, actor: a.actor, summary: a.summary.replaceAll(`:${SYS}:`, ":"), runId: a.runId }));
}
