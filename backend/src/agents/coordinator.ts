// Coordinator (plain code, not an AI agent). Routes each event to the
// agents that should act on it, enforces the operating-rule limits (2 reminders,
// 2 wrong documents, 3 send-backs, 25 steps per run), runs the demo-clock
// timers, and holds the human gates: no email is sent and no case is
// closed without a person's approval.

import { PROBLEM_TYPES } from "../domain.ts";
import { addHours, clock } from "../lib/clock.ts";
import type { MailRow } from "../lib/db.ts";
import { asAgent, record, setRunCase, StepCapReached, withRun } from "../lib/trace.ts";
import { DEMO_USERS, type DemoUser } from "../services/users.ts";
import { finance, ops } from "../lib/db.ts";
import {
  addEvidence, caseFacts, findOpenCase, getCase, getDraft, linkEmail, listCaseIds, listDrafts, OPEN_STATUSES, setFacts, updateDraft,
  type CaseStatus, type Draft,
} from "../state/caseState.ts";
import { draftEscalation, draftFromPlan, draftReminder, matchCase, readReply, sendDraft } from "./communication.ts";
import { applyFinding, investigate } from "./investigation.ts";
import { plan, timersFor, type PlanContext } from "./planning.ts";
import { procedureFor } from "./sources.ts";
import { attachmentBelongs, reviewFinding, verifyResolution } from "./verification.ts";
import { config } from "../config.ts";

// One run at a time per case (and per shipment before a case exists).
const locks = new Map<string, Promise<unknown>>();
function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(key, next.catch(() => undefined));
  return next;
}

async function setStatus(caseId: string, status: CaseStatus, by: string) {
  const f = caseFacts(caseId);
  if (f?.status !== status) await setFacts(caseId, { status }, by);
}

async function addFlag(caseId: string, flag: string, by: string) {
  const f = caseFacts(caseId)!;
  if (!f.flags.includes(flag)) await setFacts(caseId, { flags: [...f.flags, flag] }, by);
}

async function pausedOk<T>(caseId: string | undefined, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof StepCapReached) {
      if (caseId) await addFlag(caseId, `Run paused at the ${config.limits.stepsPerRun}-step cap: the case owner can resume it`, "coordinator");
      return null;
    }
    throw err;
  }
}

// ---------------------------------------------------------------- planning

async function planNext(caseId: string, ctx: PlanContext) {
  const { plan: p, recipient } = await asAgent("planning", () => plan(caseId, ctx));
  const draft = p.action === "escalate"
    ? await asAgent("communication", () => draftEscalation(caseId, p.reason))
    : await asAgent("communication", () => draftFromPlan(caseId, p, recipient));
  await setStatus(caseId, "AWAITING_APPROVAL", "coordinator");
  return draft;
}

async function escalate(caseId: string, why: string) {
  record("decision", `Escalating to the operations manager: ${why}`);
  await setFacts(caseId, { escalated: true }, "coordinator");
  await asAgent("communication", () => draftEscalation(caseId, why));
  await setStatus(caseId, "AWAITING_APPROVAL", "coordinator");
}

// ------------------------------------------------------------ investigation

export function investigateShipment(awb: string, owner: string, trigger: string): Promise<string | null> {
  return serial(`awb:${awb}`, () =>
    withRun(`investigate ${awb}: ${trigger}`, undefined, () =>
      pausedOk(undefined, async () => {
        let critique: string | undefined;
        let caseId: string | null = findOpenCase(awb);
        for (let attempt = 0; attempt < 2; attempt++) {
          const result = await asAgent("investigation", () => investigate(awb, { trigger, critique }));
          if (!result || result.finding.problemType === "NONE") {
            record("decision", `No case opened for ${awb}: ${result?.finding.summary ?? "shipment not found"}`);
            return caseId;
          }
          caseId = await asAgent("investigation", () => applyFinding(awb, owner, result, caseId ?? undefined));
          if (!caseId) return null;
          setRunCase(caseId);
          const review = await asAgent("verification", () => reviewFinding(caseId!));
          if (review.result === "pass") {
            await planNext(caseId, { reason: "new_case", detail: `New ${PROBLEM_TYPES[result.finding.problemType as keyof typeof PROBLEM_TYPES]} case` });
            return caseId;
          }
          critique = review.critique;
          record("decision", `Verification sent the finding back to Investigation (attempt ${attempt + 1})`);
        }
        await addFlag(caseId!, "Investigation and Verification disagree: a person should review the finding", "coordinator");
        await setStatus(caseId!, "ESCALATED", "coordinator");
        return caseId;
      }),
    ),
  );
}

// ----------------------------------------------------------------- drafts

export function approveDraft(draftId: string, user: DemoUser, edits?: { subject?: string; body?: string }) {
  const draft = getDraft(draftId);
  if (!draft) throw new Error(`Unknown draft ${draftId}`);
  return serial(`case:${draft.caseId}`, () =>
    withRun(`approve ${draftId}`, draft.caseId, async () => {
      if (draft.status !== "pending") throw new Error(`Draft ${draftId} is already ${draft.status}`);
      const c = getCase(draft.caseId)!;
      if (draft.purpose === "escalation" && user.role !== "operations_manager" && user.role !== "case_owner") throw new Error("Not allowed");
      const approved = await updateDraft(draftId, { ...edits, status: "approved", decidedBy: user.name, decidedAt: clock.now().toISOString() }, `user:${user.id}`);
      const mail = await asAgent("communication", () => sendDraft(approved));
      await updateDraft(draftId, { status: "sent", messageId: mail.message_id }, "communication");
      record("tool", `Sent ${draft.purpose} to ${draft.to} after approval by ${user.name}`, { messageId: mail.message_id });

      const sentAt = mail.sent_at;
      const proc = await procedureFor(c.problemType);
      if (draft.purpose === "escalation") {
        await setFacts(draft.caseId, { escalated: true, escalateAt: addHours(sentAt, 4), nextReminderAt: null }, "coordinator");
        await setStatus(draft.caseId, "ESCALATED", "coordinator");
        return;
      }
      if (draft.purpose === "reminder") {
        const n = c.reminders + 1;
        const t = timersFor(proc, c.requestSentAt ?? sentAt);
        await setFacts(draft.caseId, { reminders: n, nextReminderAt: n >= config.limits.reminders ? null : t.secondReminderAt }, "coordinator");
      } else {
        // A new request or follow-up restarts the timers from the moment it is actually sent.
        const t = timersFor(proc, sentAt);
        await setFacts(draft.caseId, {
          requestSentAt: c.requestSentAt ?? sentAt,
          nextReminderAt: t.firstReminderAt,
          escalateAt: t.escalateAt,
          reminders: 0,
        }, "coordinator");
      }
      await setStatus(draft.caseId, c.stage === "departed" ? "AWAITING_ARRIVAL" : "WAITING_REPLY", "coordinator");
    }),
  );
}

export function rejectDraft(draftId: string, user: DemoUser, note: string) {
  const draft = getDraft(draftId);
  if (!draft) throw new Error(`Unknown draft ${draftId}`);
  return serial(`case:${draft.caseId}`, () =>
    withRun(`reject ${draftId}`, draft.caseId, () =>
      pausedOk(draft.caseId, async () => {
        await updateDraft(draftId, { status: "rejected", decidedBy: user.name, decidedAt: clock.now().toISOString() }, `user:${user.id}`);
        record("decision", `${user.name} rejected ${draftId}: ${note || "no reason given"}`);
        if (draft.purpose === "reminder" || draft.purpose === "escalation") return;
        await planNext(draft.caseId, { reason: "sent_back", detail: `A person rejected the previous draft${note ? `: ${note}` : ""}` });
      }),
    ),
  );
}

// ----------------------------------------------------------------- replies

export async function receiveEmail(mail: MailRow): Promise<unknown> {
  const open = listCaseIds().map((id) => ({ caseId: id, ...caseFacts(id)! })).filter((c) => OPEN_STATUSES.includes(c.status));
  const caseId = matchCase(mail, open);
  if (!caseId) {
    const awbs = (await ops.query("SELECT awb_no FROM shipments")).rows.map((r) => r.awb_no as string);
    const text = `${mail.subject} ${mail.body}`.replace(/\D/g, "");
    const awb = awbs.find((a) => text.includes(a.replace(/\D/g, "")));
    if (awb) return investigateShipment(awb, DEMO_USERS.owner.name, `new email ${mail.message_id} mentions this shipment`);
    return null;
  }
  await ops.query("UPDATE mailbox SET case_id = $2 WHERE message_id = $1 AND case_id IS NULL", [mail.message_id, caseId]);
  return serial(`case:${caseId}`, () =>
    withRun(`reply ${mail.message_id}`, caseId, () =>
      pausedOk(caseId, async () => {
        const reading = await asAgent("communication", () => readReply(caseId, mail));
        record("decision", `Reply ${mail.message_id} from ${mail.from_addr}: ${reading.replyType} - ${reading.meaning}`, reading);
        if (reading.replyType === "DUPLICATE") {
          await linkEmail(caseId, { messageId: `${mail.message_id}`, direction: "inbound", from: mail.from_addr, subject: mail.subject, sentAt: mail.sent_at, classification: "DUPLICATE", meaning: reading.meaning, duplicateOf: reading.duplicateOf }, "communication");
          return;
        }
        await linkEmail(caseId, { messageId: mail.message_id, direction: "inbound", from: mail.from_addr, subject: mail.subject, sentAt: mail.sent_at, classification: reading.replyType, meaning: reading.meaning }, "communication");
        for (const flag of reading.flags) await addFlag(caseId, flag, "communication");
        if (reading.replyType === "UNVERIFIED_SENDER") return;
        await addEvidence(caseId, { source: "trackn_ops.mailbox", recordId: mail.message_id, claim: `${mail.from_addr}: ${reading.meaning}`, kind: "reply", addedBy: "communication" });

        // Attachments from another shipment are rejected before anything else.
        for (const att of reading.attachments) {
          const check = await asAgent("verification", () => attachmentBelongs(caseId, att));
          if (!check.belongs) reading.replyType = "WRONG_DOCUMENT";
          if (!check.belongs) {
            record("decision", `Wrong document: ${check.detail}`);
            await ops.query("UPDATE documents SET status = 'set_aside' WHERE file_name = $1", [att]);
            await finance.query("UPDATE invoices SET status = 'set_aside' WHERE file_name = ?", [att]);
            await addFlag(caseId, `Misdirected document set aside: ${check.detail}`, "verification");
          }
        }

        const c = caseFacts(caseId)!;
        await setStatus(caseId, "VERIFYING", "coordinator");
        switch (reading.replyType) {
          case "WRONG_DOCUMENT": {
            const n = c.wrongDocs + 1;
            await setFacts(caseId, { wrongDocs: n }, "coordinator");
            if (n >= config.limits.wrongDocuments) return escalate(caseId, `${n} wrong documents received (limit ${config.limits.wrongDocuments}).`);
            await planNext(caseId, { reason: "wrong_document", detail: `The attachment from ${mail.from_addr} belongs to another shipment.`, fromRole: reading.senderRole ?? undefined });
            return;
          }
          case "VAGUE":
          case "UNSUBSTANTIATED":
          case "CONFLICTING":
            await planNext(caseId, { reason: reading.replyType.toLowerCase() as PlanContext["reason"], detail: reading.meaning, fromRole: reading.senderRole ?? undefined });
            return;
        }
        // PARTIAL, PROGRESS_UPDATE and RESOLUTION_EVIDENCE all go to Verification.
        const v = await asAgent("verification", () => verifyResolution(caseId, reading, mail));
        if (v.result === "pass") {
          await setFacts(caseId, { nextReminderAt: null, escalateAt: null, stage: "" }, "coordinator");
          await setStatus(caseId, "READY_TO_CLOSE", "coordinator");
          record("decision", `${caseId} is ready to close: waiting for ${c.escalated ? "the operations manager" : "the case owner"} to approve`);
          return;
        }
        if (v.result === "stage") {
          await setFacts(caseId, { stage: "departed", nextReminderAt: addHours(clock.now().toISOString(), 3), escalateAt: addHours(clock.now().toISOString(), 6) }, "coordinator");
          await setStatus(caseId, "AWAITING_ARRIVAL", "coordinator");
          return;
        }
        const n = c.sendBacks + 1;
        await setFacts(caseId, { sendBacks: n }, "coordinator");
        if (n >= config.limits.sendBacks) return escalate(caseId, `Verification sent the case back ${n} times (limit ${config.limits.sendBacks}).`);
        const failed = v.checks.filter((k) => !k.passed).map((k) => `${k.name} (${k.detail})`).join("; ");
        await planNext(caseId, { reason: "sent_back", detail: `Verification rejected closing: ${failed}`, fromRole: reading.senderRole ?? undefined });
      }),
    ),
  );
}

// ---------------------------------------------------------------- closure

export function approveClosure(caseId: string, user: DemoUser, note: string) {
  return serial(`case:${caseId}`, () =>
    withRun(`close ${caseId}`, caseId, async () => {
      const c = getCase(caseId);
      if (!c) throw new Error(`Unknown case ${caseId}`);
      if (c.status !== "READY_TO_CLOSE") throw new Error("Verification has not passed this case yet");
      if (c.escalated && user.role !== "operations_manager") throw new Error("This case was escalated: the operations manager approves its closure");
      if (c.verifications.at(-1)?.result !== "pass") throw new Error("The latest verification did not pass");
      await setFacts(caseId, { status: "RESOLVED", closedAt: clock.now().toISOString(), closureNote: `Closed by ${user.name}${note ? `: ${note}` : ""}` }, `user:${user.id}`);
      record("decision", `${user.name} approved closing ${caseId}`);
    }),
  );
}

export function managerDecision(caseId: string, user: DemoUser, decision: "extend" | "close_unresolved" | "reassign" | "resume", note: string) {
  return serial(`case:${caseId}`, () =>
    withRun(`manager ${decision} ${caseId}`, caseId, () =>
      pausedOk(caseId, async () => {
        if (user.role !== "operations_manager" && decision !== "resume") throw new Error("Only the operations manager can do this");
        const c = caseFacts(caseId)!;
        record("decision", `${user.name}: ${decision}${note ? ` (${note})` : ""}`);
        if (decision === "close_unresolved") {
          await setFacts(caseId, { status: "CLOSED_UNRESOLVED", closedAt: clock.now().toISOString(), closureNote: `Closed unresolved by ${user.name}${note ? `: ${note}` : ""}` }, `user:${user.id}`);
          return;
        }
        if (decision === "reassign") {
          await setFacts(caseId, { owner: note || DEMO_USERS.owner.name }, `user:${user.id}`);
          return;
        }
        // extend / resume: clear the limits that stopped the agents and plan again.
        await setFacts(caseId, { reminders: 0, sendBacks: 0, wrongDocs: 0, escalated: decision === "extend" ? c.escalated : c.escalated, flags: c.flags.filter((f) => !f.startsWith("Run paused")) }, `user:${user.id}`);
        await planNext(caseId, { reason: "sent_back", detail: `${user.name} ${decision === "extend" ? "extended the deadline" : "resumed the run"}${note ? `: ${note}` : ""}` });
      }),
    ),
  );
}

export function reinvestigate(caseId: string, user: DemoUser) {
  const c = caseFacts(caseId)!;
  return investigateShipment(c.awbNo, c.owner || user.name, `${user.name} asked for a fresh investigation`);
}

// ------------------------------------------------------------------ timers

export async function tick(): Promise<void> {
  const now = clock.now().toISOString();
  for (const caseId of listCaseIds()) {
    const c = caseFacts(caseId);
    if (!c || !OPEN_STATUSES.includes(c.status)) continue;
    const pending = listDrafts(caseId).filter((d) => d.status === "pending");
    // Drafts waiting more than 1 hour for approval (Team Demo Rule).
    for (const d of pending) {
      if (addHours(d.createdAt, 1) <= now) await addFlag(caseId, `Waiting for approval: ${d.id}`, "coordinator");
    }
    if (pending.length) continue;
    if (c.status === "ESCALATED" && c.escalateAt && c.escalateAt <= now) {
      await serial(`case:${caseId}`, () => withRun(`timer ${caseId}`, caseId, async () => {
        record("decision", "No response from the operations manager within 4 hours: case marked Stalled; nothing more is sent automatically");
        await setStatus(caseId, "STALLED", "coordinator");
      }));
      continue;
    }
    if (!["WAITING_REPLY", "AWAITING_ARRIVAL", "WAITING_ON_ISSUER"].includes(c.status)) continue;
    if (c.escalateAt && c.escalateAt <= now) {
      await serial(`case:${caseId}`, () => withRun(`timer ${caseId}`, caseId, () => escalate(caseId, `No resolution by the escalation time (${c.escalateAt!.slice(11, 16)} demo clock).`)));
      continue;
    }
    if (c.nextReminderAt && c.nextReminderAt <= now && c.reminders < config.limits.reminders) {
      await serial(`case:${caseId}`, () => withRun(`timer ${caseId}`, caseId, async () => {
        record("decision", `No reply by the reminder time: drafting reminder ${c.reminders + 1} of ${config.limits.reminders}`);
        await asAgent("communication", () => draftReminder(caseId, c.reminders + 1));
        await setFacts(caseId, { nextReminderAt: null }, "coordinator");
      }));
    }
  }
}

export function pendingApprovals(): Draft[] {
  return listDrafts().filter((d) => d.status === "pending").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
