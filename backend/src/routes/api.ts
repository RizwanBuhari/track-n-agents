import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { backendRoot, config } from "../config.ts";
import { ask } from "../agents/assistant.ts";
import { translateDraft } from "../agents/communication.ts";
import { detectPatterns, patternsFor } from "../agents/patterns.ts";
import { assessSeverity, priorityOf } from "../agents/priority.ts";
import { suggestLanguages } from "../lib/locale.ts";
import { approveClosure, approveDraft, investigateShipment, managerDecision, pendingApprovals, receiveEmail, reinvestigate, rejectDraft, tick } from "../agents/coordinator.ts";
import { partiesFor, customsFor, documentsFor, invoicesFor, trackingFor } from "../agents/sources.ts";
import { extractAwb } from "../extraction/extractAwb.ts";
import { clock } from "../lib/clock.ts";
import { ops } from "../lib/db.ts";
import { listModels } from "../lib/llm.ts";
import { asAgent, listRuns, readTrace, withRun } from "../lib/trace.ts";
import { runSql } from "../lib/zetaris.ts";
import { confirmShipment, getShipment, listShipments } from "../services/shipments.ts";
import { DEMO_USERS, userById } from "../services/users.ts";
import { contextFor, deliver, redeliver, scriptsFor } from "../sim/scenarios.ts";
import { caseActivity, caseFacts, factHistory, getCase, getDraft, listCaseIds, OPEN_STATUSES, world } from "../state/caseState.ts";
import { broadcast } from "./events.ts";

export const api = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const uploadsDir = path.join(config.dataDir, "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });

const user = (req: Request) => userById(req.header("x-demo-user") ?? undefined);
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

/** Long agent runs continue in the background; the dashboard follows them over /api/events. */
function background(label: string, p: Promise<unknown>) {
  p.catch((err) => {
    console.error(`${label}:`, err);
    broadcast("error", { label, message: (err as Error).message });
  });
}

const caseSummary = (id: string) => {
  const f = caseFacts(id)!;
  return { caseId: id, status: f.status, problemType: f.problemType, title: f.title, awbNo: f.awbNo, owner: f.owner, summary: f.summary, nextAction: f.nextAction, awaitingRole: f.awaitingRole, openedAt: f.openedAt, closedAt: f.closedAt, escalated: f.escalated, flags: f.flags, reminders: f.reminders, sendBacks: f.sendBacks, wrongDocs: f.wrongDocs, nextReminderAt: f.nextReminderAt, escalateAt: f.escalateAt, priority: priorityOf(f), severityMethod: f.severityMethod ?? null, timerFactor: f.timerFactor ?? 1, criticalAlertedAt: f.criticalAlertedAt ?? null, criticalReasons: f.criticalReasons ?? [] };
};

/** Open cases by priority (highest first), then closed cases newest first. */
const byPriority = (a: ReturnType<typeof caseSummary>, b: ReturnType<typeof caseSummary>) => {
  const openA = OPEN_STATUSES.includes(a.status), openB = OPEN_STATUSES.includes(b.status);
  if (openA !== openB) return openA ? -1 : 1;
  return (openA ? b.priority.score - a.priority.score : 0) || b.openedAt.localeCompare(a.openedAt);
};

// ----------------------------------------------------------------- users

api.get("/users", (_req, res) => {
  res.json(Object.values(DEMO_USERS));
});

// ------------------------------------------------------------------- AWB

api.post("/awb/extract", upload.single("file"), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Attach a PDF file" });
  const uploadId = randomUUID();
  fs.writeFileSync(path.join(uploadsDir, `${uploadId}.pdf`), req.file.buffer);
  fs.writeFileSync(path.join(uploadsDir, `${uploadId}.json`), JSON.stringify({ fileName: req.file.originalname }));
  const extraction = await withRun(`extract ${req.file.originalname}`, undefined, () => extractAwb(new Uint8Array(req.file!.buffer), req.file!.originalname));
  res.json({ uploadId, fileName: req.file.originalname, extraction });
}));

api.get("/awb/uploads/:id/file", (req, res) => {
  const file = path.join(uploadsDir, `${path.basename(String(req.params.id))}.pdf`);
  if (!fs.existsSync(file)) return res.status(404).end();
  res.type("application/pdf").sendFile(file);
});

api.post("/awb/confirm", wrap(async (req, res) => {
  const { uploadId, fields } = req.body ?? {};
  const meta = uploadId && fs.existsSync(path.join(uploadsDir, `${path.basename(uploadId)}.json`)) ? JSON.parse(fs.readFileSync(path.join(uploadsDir, `${path.basename(uploadId)}.json`), "utf-8")) : { fileName: "manual entry" };
  const u = user(req);
  const saved = await confirmShipment(fields, u.name, meta.fileName);
  if (uploadId) await ops.query("UPDATE shipments SET source_file = $2 WHERE awb_no = $1", [saved.awbNo, `${uploadId}.pdf|${meta.fileName}`]);
  background("investigate", investigateShipment(saved.awbNo, u.name, saved.created ? "AWB uploaded and confirmed" : "AWB re-uploaded"));
  res.json(saved);
}));

// ------------------------------------------------------------- shipments

api.get("/shipments", wrap(async (_req, res) => {
  const shipments = await listShipments();
  const cases = listCaseIds().map(caseSummary);
  res.json(shipments.map((s) => ({ ...s, cases: cases.filter((c) => c.awbNo === s.awb_no) })));
}));

api.get("/shipments/:awb", wrap(async (req, res) => {
  const awb = String(req.params.awb);
  const shipment = await getShipment(awb);
  if (!shipment) return res.status(404).json({ error: "Not found" });
  // Related records from every source, read through Zetaris.
  const [tracking, customs, invoices, documents, parties] = await Promise.all([
    trackingFor(awb), customsFor(awb), invoicesFor(awb, shipment.invoice_ref), documentsFor(awb), partiesFor(awb),
  ]);
  res.json({
    shipment,
    tracking: tracking.map((r) => r.row),
    customs: customs.map((r) => r.row),
    invoices: invoices.map((r) => r.row),
    documents: documents.map((r) => r.row),
    parties,
    cases: listCaseIds().map(caseSummary).filter((c) => c.awbNo === awb),
  });
}));

api.post("/shipments/:awb/investigate", (req, res) => {
  background("investigate", investigateShipment(String(req.params.awb), user(req).name, `${user(req).name} asked for an investigation`));
  res.status(202).json({ ok: true });
});

// ----------------------------------------------------------------- cases

api.get("/cases", (_req, res) => {
  res.json(listCaseIds().map(caseSummary).sort(byPriority));
});

api.get("/cases/:id", (req, res) => {
  const id = String(req.params.id);
  const c = getCase(id);
  if (!c) return res.status(404).json({ error: "Not found" });
  res.json({ ...c, priority: priorityOf(caseFacts(id)!), activity: caseActivity(id), runs: listRuns(id), factHistory: factHistory(id).map((f) => ({ predicate: f.predicate, value: f.value, at: f.assertedAt, by: f.source.by })) });
});

api.post("/cases/:id/close", wrap(async (req, res) => {
  await approveClosure(String(req.params.id), user(req), req.body?.note ?? "");
  res.json({ ok: true });
}));

api.post("/cases/:id/manager", (req, res) => {
  background("manager", managerDecision(String(req.params.id), user(req), req.body?.decision, req.body?.note ?? ""));
  res.status(202).json({ ok: true });
});

// --------------------------------------------------------------- patterns

api.get("/patterns", wrap(async (req, res) => {
  const all = await detectPatterns();
  if (!req.query.caseId) return res.json(all);
  const f = caseFacts(String(req.query.caseId));
  if (!f) return res.status(404).json({ error: "Not found" });
  const parties = await partiesFor(f.awbNo);
  res.json(patternsFor(all, parties.map((p) => p.email), String(req.query.caseId)));
}));

api.post("/cases/:id/priority", wrap(async (req, res) => {
  const id = String(req.params.id);
  if (!caseFacts(id)) return res.status(404).json({ error: "Not found" });
  await withRun("rate priority", id, () => asAgent("investigation", () => assessSeverity(id)));
  res.json(priorityOf(caseFacts(id)!));
}));

api.post("/cases/:id/reinvestigate", (req, res) => {
  background("reinvestigate", reinvestigate(String(req.params.id), user(req)));
  res.status(202).json({ ok: true });
});

// ------------------------------------------------------------- approvals

api.get("/approvals", (_req, res) => {
  const ready = listCaseIds().map(caseSummary).filter((c) => c.status === "READY_TO_CLOSE").sort(byPriority);
  res.json({ drafts: pendingApprovals().map((d) => ({ ...d, priority: priorityOf(caseFacts(d.caseId)!) })), closures: ready });
});

api.get("/drafts/:id/languages", wrap(async (req, res) => {
  const draft = getDraft(String(req.params.id));
  if (!draft) return res.status(404).json({ error: "Not found" });
  const f = caseFacts(draft.caseId)!;
  const [shipment, parties] = await Promise.all([getShipment(f.awbNo), partiesFor(f.awbNo)]);
  const party = parties.find((p) => p.email.toLowerCase() === draft.to.toLowerCase()) ?? parties.find((p) => p.role === draft.toRole);
  const role = party?.role ?? draft.toRole;
  res.json({ recipient: { role, name: party?.name ?? draft.to }, suggested: suggestLanguages(role, shipment, party?.name) });
}));

api.post("/drafts/:id/translate", wrap(async (req, res) => {
  const draft = getDraft(String(req.params.id));
  if (!draft) return res.status(404).json({ error: "Not found" });
  const language = String(req.body?.language ?? "").trim();
  if (!language || language.length > 60) return res.status(400).json({ error: "Choose a language" });
  const text = { subject: String(req.body?.subject ?? draft.subject), body: String(req.body?.body ?? draft.body) };
  const result = await withRun(`translate ${draft.id} to ${language}`, draft.caseId, () =>
    asAgent("communication", () => translateDraft(draft, language, text, req.body?.includeOriginal !== false)));
  res.json(result);
}));

api.post("/drafts/:id/approve", wrap(async (req, res) => {
  await approveDraft(String(req.params.id), user(req), { subject: req.body?.subject, body: req.body?.body, language: req.body?.language || undefined });
  res.json({ ok: true });
}));

api.post("/drafts/:id/reject", (req, res) => {
  background("reject", rejectDraft(String(req.params.id), user(req), req.body?.note ?? ""));
  res.status(202).json({ ok: true });
});

// ------------------------------------------------------------ runs/trace

api.get("/runs", (req, res) => {
  res.json(listRuns(req.query.caseId ? String(req.query.caseId) : undefined).slice(0, 100));
});

api.get("/runs/:id", (req, res) => {
  res.json(readTrace(String(req.params.id)));
});

// --------------------------------------------------------------- mailbox

api.get("/mailbox", wrap(async (req, res) => {
  const { rows } = req.query.caseId
    ? await ops.query("SELECT * FROM mailbox WHERE case_id = $1 ORDER BY sent_at", [String(req.query.caseId)])
    : await ops.query("SELECT * FROM mailbox ORDER BY sent_at DESC LIMIT 100");
  res.json(rows);
}));

// -------------------------------------------------------------- simulator

api.get("/sim/clock", (_req, res) => {
  res.json({ now: clock.now().toISOString(), offsetHours: clock.offsetHours() });
});

api.post("/sim/clock/advance", wrap(async (req, res) => {
  const now = clock.advanceHours(Number(req.body?.hours ?? 1));
  await tick();
  broadcast("clock", { now: now.toISOString() });
  res.json({ now: now.toISOString(), offsetHours: clock.offsetHours() });
}));

api.get("/sim/cases/:id/scripts", (req, res) => {
  const f = caseFacts(String(req.params.id));
  if (!f) return res.status(404).json({ error: "Not found" });
  res.json(scriptsFor(f.problemType).map((s) => ({ id: s.id, label: s.label, expect: s.expect, fromRole: s.fromRole })));
});

api.post("/sim/cases/:id/deliver", wrap(async (req, res) => {
  const caseId = String(req.params.id);
  const f = caseFacts(caseId);
  if (!f) return res.status(404).json({ error: "Not found" });
  const script = scriptsFor(f.problemType).find((s) => s.id === req.body?.scriptId);
  if (!script) return res.status(400).json({ error: "Unknown script" });
  const shipment = await getShipment(f.awbNo);
  const parties = await partiesFor(f.awbNo);
  const ctx = contextFor(caseId, f.awbNo, shipment, parties);
  const lastTo = getCase(caseId)!.drafts.filter((d) => d.status === "sent").at(-1)?.to;
  const mail = await deliver(script, ctx, script.fromRole === "__expected" ? lastTo ?? ctx.parties.broker?.email : undefined);
  broadcast("mail", { caseId, messageId: mail.message_id });
  background("reply", receiveEmail(mail));
  res.json(mail);
}));

api.post("/sim/redeliver", wrap(async (req, res) => {
  const mail = await redeliver(String(req.body?.messageId), Boolean(req.body?.newId));
  background("reply", receiveEmail(mail));
  res.json(mail);
}));

// ------------------------------------------------------------------- chat

api.post("/chat", wrap(async (req, res) => {
  const { question, caseId, awb } = req.body ?? {};
  const result = await withRun(`chat: ${String(question).slice(0, 60)}`, caseId, () => ask(String(question ?? ""), { caseId, awb }));
  res.json(result);
}));

// ---------------------------------------------------------- integrations

api.get("/integrations", wrap(async (_req, res) => {
  const out: Record<string, unknown> = { mode: config.sampleMode ? "sample" : "live" };
  try {
    const t0 = Date.now();
    const sources = await runSql(
      `SELECT 'trackn_ops.shipments' AS source, count(*) AS records FROM trackn_ops.shipments
       UNION ALL SELECT 'trackn_ops.documents', count(*) FROM trackn_ops.documents
       UNION ALL SELECT 'trackn_ops.mailbox', count(*) FROM trackn_ops.mailbox
       UNION ALL SELECT 'trackn_finance.invoices', count(*) FROM trackn_finance.invoices
       UNION ALL SELECT 'trackn_carrier.tracking_events', count(*) FROM trackn_carrier.tracking_events
       UNION ALL SELECT 'trackn_customs.customs_entries', count(*) FROM trackn_customs.customs_entries`,
      { trace: false },
    );
    out.zetaris = config.sampleMode
      ? { ok: true, sample: true, url: "embedded Postgres (sample mode)", ms: Date.now() - t0, sources }
      : { ok: true, url: config.zetaris.restUrl, ms: Date.now() - t0, sources };
  } catch (err) {
    out.zetaris = { ok: false, error: (err as Error).message };
  }
  if (config.sampleMode) {
    out.meterless = { ok: false, sample: true, error: "Not used in sample mode: the agents run their rule-based paths. Live mode serves every agent request with NVIDIA Nemotron through Nightshift." };
  } else try {
    const models = await listModels();
    out.meterless = { ok: true, url: config.meterless.baseUrl, fastModel: config.meterless.fastModel, deepModel: config.meterless.deepModel, nemotronAvailable: models.filter((m) => m.includes("nemotron")) };
  } catch (err) {
    out.meterless = { ok: false, error: (err as Error).message };
  }
  const events = world.events();
  out.worldModel = {
    engine: "Meterless World Model (reference implementation, vendored)",
    events: events.length,
    entities: world.view("graph").query({}).length,
    byType: Object.entries(world.view("graph").query({}).reduce((m, e) => ({ ...m, [e.type]: (m[e.type as keyof typeof m] ?? 0) + 1 }), {} as Record<string, number>)),
    auditEntries: world.audit().length,
    lastEvents: events.slice(-12).reverse().map((e) => ({ seq: e.seq, kind: e.kind, at: e.at, by: (e.payload as { source?: { by?: string } }).source?.by })),
  };
  const conformanceFile = path.join(config.dataDir, "conformance.txt");
  out.conformance = fs.existsSync(conformanceFile) ? { output: fs.readFileSync(conformanceFile, "utf-8"), at: fs.statSync(conformanceFile).mtime } : null;
  res.json(out);
}));

api.post("/integrations/conformance", (_req, res) => {
  const child = spawn(process.execPath, ["--import", "tsx", path.join(backendRoot, "scripts", "conformance.ts")], { cwd: backendRoot });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  child.on("close", (code) => {
    fs.writeFileSync(path.join(config.dataDir, "conformance.txt"), output);
    res.json({ code, output });
  });
});
