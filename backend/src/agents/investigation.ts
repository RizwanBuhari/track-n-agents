// Investigation agent. Connects the fragmented sources for one shipment,
// screens them with explicit rules, then asks Nemotron to decide what (if
// anything) is wrong, citing evidence. Every claim must point at a real
// source record; uncited or invented conclusions are rejected and the model
// gets one chance to correct itself. It may also request one extra
// read-only lookup through Zetaris when the evidence is not enough.

import { PROBLEM_TYPES, PROBLEM_TYPE_IDS, type ProblemType } from "../domain.ts";
import { chatJson, LlmError } from "../lib/llm.ts";
import { digitsOnly, similarCompany } from "../lib/refs.ts";
import { record } from "../lib/trace.ts";
import { assertReadOnly, num, str, ZetarisError } from "../lib/zetaris.ts";
import { addEvidence, caseFacts, findOpenCase, openCase, setFacts, type Evidence } from "../state/caseState.ts";
import { customsFor, documentsFor, freeQuery, invoicesFor, mailFor, shipmentByAwb, trackingFor, type SourceRow } from "./sources.ts";

export type Bundle = {
  awb: string;
  shipment: SourceRow;
  invoices: SourceRow[];
  documents: SourceRow[];
  tracking: SourceRow[];
  customs: SourceRow[];
  mail: SourceRow[];
};

export type Candidate = { type: ProblemType; reasons: string[]; keys: string[] };

export type Finding = {
  problemType: ProblemType | "NONE";
  confidence: number;
  summary: string;
  explanation: string;
  cited: string[];
  dismissed: { candidate: string; reason: string }[];
  notes: string[];
  method: "nemotron" | "rules-fallback";
};

type EvidenceItem = { key: string; source: string; recordId: string; text: string };

export async function gather(awb: string): Promise<Bundle | null> {
  const shipment = await shipmentByAwb(awb);
  if (!shipment) return null;
  const invoiceRef = str(shipment.row.invoice_ref) || null;
  const [invoices, documents, tracking, customs, mail] = await Promise.all([
    invoicesFor(awb, invoiceRef),
    documentsFor(awb),
    trackingFor(awb),
    customsFor(awb),
    mailFor(awb),
  ]);
  return { awb, shipment, invoices, documents, tracking, customs, mail };
}

const kg = (v: unknown) => (num(v) === null ? "?" : `${num(v)!.toFixed(1)} kg`);
const day = (v: unknown) => str(v).replace("T", " ").slice(0, 16);

export function evidenceItems(b: Bundle): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  const s = b.shipment.row;
  items.push({ key: "X1", source: b.shipment.source, recordId: b.shipment.recordId, text: `Shipment from the confirmed AWB ${s.awb_no}: carrier ${s.carrier}, ${s.origin} to ${s.destination}, flight ${s.flight_no} on ${str(s.flight_date).slice(0, 10)}. Shipper ${s.shipper}; consignee ${s.consignee}. Goods: ${s.goods}. ${s.pieces} pieces, gross ${kg(s.gross_weight_kg)}. HS code on AWB: ${s.hs_code || "none"}. Invoice named on the AWB: ${s.invoice_ref || "none"}.` });
  for (const r of b.invoices) {
    const i = r.row;
    items.push({ key: `X${items.length + 1}`, source: r.source, recordId: r.recordId, text: `Invoice ${i.invoice_no} version ${i.version}${i.supersedes ? ` (replaces ${i.supersedes})` : ""} quotes shipment reference "${i.shipment_ref_as_written}". Consignee "${i.consignee_as_written}". Goods ${i.goods}, HS code ${i.hs_code}, ${i.packages} packages, gross ${kg(i.gross_weight_kg)}, value ${i.total_value} ${i.currency}.${i.notes ? ` Note: ${i.notes}` : ""} Status: ${i.status}.` });
  }
  for (const r of b.documents) {
    const d = r.row;
    items.push({ key: `X${items.length + 1}`, source: r.source, recordId: r.recordId, text: `${str(d.doc_type).replace(/_/g, " ").toLowerCase()} ${d.ref_no} version ${d.version}: AWB written "${d.awb_as_written}", consignee "${d.consignee_as_written}", ${d.pieces ?? "?"} pieces, gross ${kg(d.gross_weight_kg)}${d.issuer ? `, issuer ${d.issuer}` : ""}${d.issued_on ? `, issued ${str(d.issued_on).slice(0, 10)}` : ""}. Status: ${d.status}.` });
  }
  for (const r of b.tracking) {
    const t = r.row;
    items.push({ key: `X${items.length + 1}`, source: r.source, recordId: r.recordId, text: `Carrier tracking ${day(t.event_time)} ${t.code}: ${t.description} at ${t.location}.` });
  }
  for (const r of b.customs) {
    const c = r.row;
    items.push({ key: `X${items.length + 1}`, source: r.source, recordId: r.recordId, text: `Customs entry ${c.entry_no} (AWB written "${c.awb_reference}", importer "${c.importer}"): status ${c.status} as of ${day(c.status_at)}. Documents missing: ${c.documents_missing}. Remarks: ${c.remarks}${c.release_ref ? ` Release reference ${c.release_ref}.` : ""}` });
  }
  for (const r of b.mail) {
    const m = r.row;
    items.push({ key: `X${items.length + 1}`, source: r.source, recordId: r.recordId, text: `Email ${m.direction} ${day(m.sent_at)} from ${m.from_addr}: "${m.subject}" ${str(m.body).slice(0, 280)}` });
  }
  return items;
}

/** Rule-based screening. These are hints for the agent, not the decision. */
export function screen(b: Bundle, items: EvidenceItem[]): Candidate[] {
  const s = b.shipment.row;
  const awbDigits = digitsOnly(b.awb);
  const keyOf = (r: SourceRow) => items.find((i) => i.source === r.source && i.recordId === r.recordId)?.key ?? "";
  const out: Candidate[] = [];
  const latest = (rows: SourceRow[]) => {
    const byNo = new Map<string, SourceRow>();
    for (const r of rows) {
      const k = str(r.row.invoice_no ?? r.row.ref_no ?? r.row.doc_type);
      const cur = byNo.get(k);
      if (!cur || (num(r.row.version) ?? 1) > (num(cur.row.version) ?? 1)) byNo.set(k, r);
    }
    return [...byNo.values()];
  };
  const invoices = latest(b.invoices);
  const ownInvoices = invoices.filter((r) => digitsOnly(str(r.row.shipment_ref_as_written)) === awbDigits && similarCompany(str(r.row.consignee_as_written), str(s.consignee)));
  const named = invoices.filter((r) => s.invoice_ref && r.row.invoice_no === s.invoice_ref);
  const customs = b.customs[0];
  const missing = str(customs?.row.documents_missing).toLowerCase();
  const held = /^held/i.test(str(customs?.row.status));
  const codes = b.tracking.map((t) => str(t.row.code));

  // Conflicting status: carrier says delivered/cleared while customs still holds it.
  const dlv = b.tracking.find((t) => ["DLV", "CLR"].includes(str(t.row.code)));
  if (dlv && customs && held) {
    out.push({ type: "CONFLICTING_STATUS", reasons: [`Carrier shows ${dlv.row.code} but customs status is ${customs.row.status}`], keys: [keyOf(dlv), keyOf(customs)] });
  }

  // Invoice named on the AWB quotes a different AWB.
  const wrongRef = named.filter((r) => digitsOnly(str(r.row.shipment_ref_as_written)) !== awbDigits);
  if (wrongRef.length && !ownInvoices.length) {
    out.push({ type: "INVOICE_REF_MISMATCH", reasons: [`Invoice ${wrongRef[0].row.invoice_no} (named on the AWB) quotes ${wrongRef[0].row.shipment_ref_as_written}`], keys: [keyOf(b.shipment), keyOf(wrongRef[0])] });
  } else if (!ownInvoices.length && !named.length) {
    const reasons = ["No invoice in the finance system quotes this AWB"];
    const keys = [keyOf(b.shipment)];
    if (missing.includes("invoice") && customs) {
      reasons.push(`Customs lists missing: ${customs.row.documents_missing}`);
      keys.push(keyOf(customs));
    }
    out.push({ type: "MISSING_INVOICE", reasons, keys });
  }

  // HS code on the invoice differs from the AWB.
  const inv = ownInvoices[0];
  if (inv && s.hs_code && inv.row.hs_code && str(inv.row.hs_code) !== str(s.hs_code)) {
    out.push({ type: "HS_CODE_ERROR", reasons: [`Invoice HS ${inv.row.hs_code} vs AWB HS ${s.hs_code} for goods "${s.goods}"`], keys: [keyOf(b.shipment), keyOf(inv), ...(customs ? [keyOf(customs)] : [])] });
  }

  // Weight: AWB gross vs packing list gross (operating rules: 2% or less is "minor").
  const pl = latest(b.documents.filter((d) => d.row.doc_type === "PACKING_LIST"))[0];
  const awbKg = num(s.gross_weight_kg);
  const plKg = pl ? num(pl.row.gross_weight_kg) : null;
  if (awbKg !== null && plKg !== null && awbKg !== plKg) {
    const gap = Math.abs(awbKg - plKg) / Math.max(awbKg, plKg);
    if (gap > 0.02) out.push({ type: "WEIGHT_MISMATCH", reasons: [`AWB gross ${awbKg} kg vs packing list ${plKg} kg (${(gap * 100).toFixed(1)}%)`], keys: [keyOf(b.shipment), keyOf(pl), ...b.tracking.filter((t) => t.row.code === "DIS").map(keyOf)] });
  }

  // Certificate required but none on file.
  const certNeeded = missing.includes("certificate") || ownInvoices.some((r) => /certificate of origin/i.test(str(r.row.notes)));
  const hasCert = b.documents.some((d) => d.row.doc_type === "CERTIFICATE_OF_ORIGIN" && d.row.status === "received");
  if (certNeeded && !hasCert) {
    out.push({ type: "MISSING_CERTIFICATE", reasons: ["A certificate of origin is required and none is on file"], keys: [...(customs ? [keyOf(customs)] : []), ...ownInvoices.map(keyOf)] });
  }

  // Transport: offloaded with no departure since, or no departure long after the planned flight.
  const ofld = b.tracking.filter((t) => t.row.code === "OFLD").pop();
  const depAfter = ofld && b.tracking.some((t) => t.row.code === "DEP" && str(t.row.event_time) > str(ofld.row.event_time));
  if (ofld && !depAfter) {
    out.push({ type: "TRANSPORT_DELAY", reasons: [`Offloaded: ${ofld.row.description}`], keys: [keyOf(ofld), ...b.tracking.filter((t) => t.row.code === "BKD").map(keyOf)] });
  } else if (!codes.includes("DEP") && s.flight_date && Date.parse(str(s.flight_date)) + 36 * 3_600_000 < Date.now()) {
    out.push({ type: "TRANSPORT_DELAY", reasons: ["No departure recorded well after the planned flight"], keys: [keyOf(b.shipment)] });
  }
  return out;
}

const SYSTEM = `You are the Investigation agent in Track-N, a logistics exception system for an air freight operations team.
You connect evidence from separate systems (shipment record from the confirmed AWB, finance invoices, documents, carrier tracking, customs broker portal, shared mailbox) and decide whether this shipment has a real problem.

Problem types:
${PROBLEM_TYPE_IDS.map((t) => `- ${t}: ${PROBLEM_TYPES[t]}`).join("\n")}
- NONE: the sources agree and nothing blocks the shipment.

Rules you must follow:
- Formatting differences are not problems: "901 4417 3021", "90144173021" and "901-44173021" are the same AWB.
- Small company spelling differences are not problems ("Blue Dune Trdg L.L.C" = "Blue Dune Trading LLC").
- Before calling an invoice missing, check whether the invoice named on the AWB exists under another AWB; if it does, that is INVOICE_REF_MISMATCH.
- Customs status comes from the customs record, movement from carrier tracking, delivery from a signed receipt. Emails are only claims.
- Weight gaps of 2% or less with equal piece counts are minor, not a case.
- Never suggest or choose an HS code.
- Never guess. Every statement in your explanation must cite evidence keys like [X3].
- An invoice that quotes this AWB but names another consignee belongs to someone else: mention it as a note, never use it as this shipment's invoice.
- The screening hints are produced by simple rules and can be wrong or incomplete; decide from the evidence.

Return JSON:
{"problemType": "<one type or NONE>", "confidence": <0..1>, "summary": "<one sentence for the case list>", "explanation": "<2-4 sentences citing [X#]>", "cited": ["X1", ...], "dismissed": [{"candidate": "<type>", "reason": "<why not>"}], "notes": ["<secondary observations>"], "lookupSql": "<optional: ONE read-only SELECT through Zetaris if you truly need more data, else omit>"}`;

const SCHEMA_HINT = `Tables you may query (Lightning SQL, qualified names): trackn_ops.shipments, trackn_ops.documents, trackn_ops.mailbox, trackn_ops.parties, trackn_finance.invoices, trackn_carrier.tracking_events, trackn_customs.customs_entries. Match AWBs with regexp_replace(col, '[^0-9]', '').`;

export async function investigate(awb: string, opts: { trigger: string; critique?: string } = { trigger: "manual" }): Promise<{ finding: Finding; bundle: Bundle; items: EvidenceItem[]; candidates: Candidate[] } | null> {
  const bundle = await gather(awb);
  if (!bundle) {
    record("decision", `No confirmed shipment ${awb}; nothing to investigate`);
    return null;
  }
  const items = evidenceItems(bundle);
  const candidates = screen(bundle, items);
  record("decision", candidates.length ? `Screening hints: ${candidates.map((c) => c.type).join(", ")}` : "Screening found no rule-based problem", candidates);

  const validKeys = () => new Set(items.map((i) => i.key));
  let lookups = 0;
  let finding: Finding | null = null;
  try {
    for (let round = 0; round < 2 && !finding; round++) {
      const user = [
        `Shipment AWB ${awb}. Trigger: ${opts.trigger}.`,
        opts.critique ? `Verification rejected your previous conclusion: ${opts.critique}. Re-examine the evidence.` : "",
        "Evidence:",
        ...items.map((i) => `[${i.key}] (${i.source} ${i.recordId}) ${i.text}`),
        "",
        `Screening hints: ${candidates.length ? candidates.map((c) => `${c.type} (${c.reasons.join("; ")})`).join(" | ") : "none"}`,
        lookups === 0 ? SCHEMA_HINT : "No more lookups are available; decide now.",
      ].filter(Boolean).join("\n");
      const reply = await chatJson<Finding & { lookupSql?: string }>({
        purpose: "Investigate shipment across sources",
        model: "deep",
        system: SYSTEM,
        user,
        maxTokens: 1400,
        validate: (v) => {
          if (v.lookupSql && lookups === 0) {
            try { assertReadOnly(v.lookupSql); return null; } catch (e) { return (e as Error).message; }
          }
          if (v.problemType !== "NONE" && !PROBLEM_TYPE_IDS.includes(v.problemType as ProblemType)) return `problemType must be one of ${PROBLEM_TYPE_IDS.join(", ")} or NONE`;
          const keys = validKeys();
          const bad = (v.cited ?? []).filter((k) => !keys.has(k));
          if (bad.length) return `cited keys ${bad.join(", ")} do not exist`;
          if (v.problemType !== "NONE" && !(v.cited ?? []).length) return "a problem must cite evidence";
          const inText = [...(v.explanation ?? "").matchAll(/\[(X\d+)\]/g)].map((m) => m[1]).filter((k) => !keys.has(k));
          if (inText.length) return `explanation cites unknown keys ${inText.join(", ")}`;
          return null;
        },
      });
      if (reply.lookupSql && lookups === 0) {
        lookups++;
        try {
          const rows = await freeQuery(reply.lookupSql);
          items.push({ key: `X${items.length + 1}`, source: "zetaris.lookup", recordId: `lookup-${lookups}`, text: `Result of your lookup "${reply.lookupSql}": ${JSON.stringify(rows.slice(0, 10))}` });
        } catch (err) {
          items.push({ key: `X${items.length + 1}`, source: "zetaris.lookup", recordId: `lookup-${lookups}`, text: `Your lookup failed: ${(err as Error).message}` });
        }
        continue;
      }
      finding = { ...reply, dismissed: reply.dismissed ?? [], notes: reply.notes ?? [], method: "nemotron" };
    }
  } catch (err) {
    if (!(err instanceof LlmError || err instanceof ZetarisError)) throw err;
    record("decision", `Model unavailable (${(err as Error).message.slice(0, 120)}); using the rule-based result`);
  }
  if (!finding) {
    const top = candidates[0];
    finding = top
      ? { problemType: top.type, confidence: 0.6, summary: top.reasons[0], explanation: top.reasons.map((r, i) => `${r} [${top.keys[i] ?? top.keys[0]}]`).join(". "), cited: top.keys.filter(Boolean), dismissed: [], notes: [], method: "rules-fallback" }
      : { problemType: "NONE", confidence: 0.6, summary: "No problem found by the rules", explanation: "", cited: [], dismissed: [], notes: [], method: "rules-fallback" };
  }
  record("decision", `Finding: ${finding.problemType} (${Math.round(finding.confidence * 100)}%) ${finding.summary}`, finding);
  return { finding, bundle, items, candidates };
}

/** Writes a finding into shared state: opens or updates the case and stores the cited evidence. */
export async function applyFinding(awb: string, owner: string, result: NonNullable<Awaited<ReturnType<typeof investigate>>>, existingCaseId?: string): Promise<string | null> {
  const { finding, items } = result;
  if (finding.problemType === "NONE") return null;
  let caseId = existingCaseId ?? findOpenCase(awb);
  if (caseId) {
    const before = caseFacts(caseId);
    await setFacts(caseId, {
      problemType: finding.problemType,
      title: PROBLEM_TYPES[finding.problemType],
      summary: finding.summary,
      explanation: finding.explanation,
      confidence: finding.confidence,
    }, "investigation");
    if (before && before.problemType !== finding.problemType) record("decision", `Case type changed from ${before.problemType} to ${finding.problemType}`);
  } else {
    caseId = await openCase({
      awbNo: awb,
      problemType: finding.problemType,
      title: PROBLEM_TYPES[finding.problemType],
      owner,
      summary: finding.summary,
      explanation: finding.explanation,
      confidence: finding.confidence,
      by: "investigation",
    });
  }
  const keyMap = new Map<string, Evidence>();
  for (const key of finding.cited) {
    const item = items.find((i) => i.key === key);
    if (!item) continue;
    const ev = await addEvidence(caseId, { source: item.source, recordId: item.recordId, claim: item.text, kind: "record", addedBy: "investigation" });
    keyMap.set(key, ev);
  }
  // Rewrite [X#] references to the stored evidence ids so the dashboard can link them.
  const explanation = finding.explanation.replace(/\[(X\d+)\]/g, (m, k) => (keyMap.get(k) ? `[${keyMap.get(k)!.id}]` : m));
  await setFacts(caseId, { explanation, investigationRun: "" }, "investigation");
  return caseId;
}
