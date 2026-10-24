// Verification agent. Two jobs:
//  1. Challenge a new finding: re-check its key fact against the sources
//     (through Zetaris) before anyone is contacted. If it does not hold,
//     the case goes back to Investigation with the reason.
//  2. Check a claimed resolution against the operating rules' closing checks: the reply
//     type, the shipment reference, the dates, and the records themselves
//     (customs release, corrected invoice, certificate, weight record,
//     tracking). A Nemotron critic then looks for reasons not to close; it
//     can block a closure but can never turn a failed check into a pass.

import { chatJson, LlmError } from "../lib/llm.ts";
import { digitsOnly, similarCompany } from "../lib/refs.ts";
import { record } from "../lib/trace.ts";
import { lit, num, runSql, SOURCES, str, ts, type Row } from "../lib/zetaris.ts";
import { addEvidence, getCase, saveVerification, type Check, type VerificationResult } from "../state/caseState.ts";
import type { ReplyReading } from "./communication.ts";
import { customsFor, documentsFor, invoicesFor, procedureFor, shipmentByAwb, trackingFor } from "./sources.ts";

const ok = (name: string, passed: boolean, detail: string, evidenceIds?: string[]): Check => ({ name, passed, detail, evidenceIds });

function latestBy<T extends Row>(rows: T[], key: string): T[] {
  const m = new Map<string, T>();
  for (const r of rows) {
    const k = str(r[key]);
    const cur = m.get(k);
    if (!cur || (num(r.version) ?? 1) > (num(cur.version) ?? 1)) m.set(k, r);
  }
  return [...m.values()];
}

// ------------------------------------------------------------ finding review

export async function reviewFinding(caseId: string): Promise<VerificationResult> {
  const c = getCase(caseId)!;
  const awbDigits = digitsOnly(c.awbNo);
  const ship = (await shipmentByAwb(c.awbNo))!.row;
  const checks: Check[] = [];
  const t = c.problemType;

  if (t === "MISSING_INVOICE" || t === "INVOICE_REF_MISMATCH") {
    const invoices = (await invoicesFor(c.awbNo, str(ship.invoice_ref) || null)).map((r) => r.row);
    const own = invoices.filter((i) => digitsOnly(str(i.shipment_ref_as_written)) === awbDigits && similarCompany(str(i.consignee_as_written), str(ship.consignee)));
    const elsewhere = invoices.filter((i) => i.invoice_no === ship.invoice_ref && digitsOnly(str(i.shipment_ref_as_written)) !== awbDigits);
    if (t === "MISSING_INVOICE") {
      checks.push(ok("No invoice quotes this AWB", own.length === 0, own.length ? `Invoice ${own[0].invoice_no} already quotes this AWB` : "Finance has no invoice for this AWB and consignee"));
      checks.push(ok("Named invoice not filed under another AWB", elsewhere.length === 0, elsewhere.length ? `Invoice ${elsewhere[0].invoice_no} named on the AWB exists but quotes ${elsewhere[0].shipment_ref_as_written}: this is a wrong-reference case` : "The invoice named on the AWB is not in finance under any AWB"));
    } else {
      checks.push(ok("Named invoice quotes another AWB", elsewhere.length > 0, elsewhere.length ? `Invoice ${elsewhere[0].invoice_no} quotes ${elsewhere[0].shipment_ref_as_written}, not ${c.awbNo}` : "No invoice named on the AWB quotes a different AWB"));
    }
  } else if (t === "WEIGHT_MISMATCH") {
    const pl = latestBy((await documentsFor(c.awbNo)).map((r) => r.row).filter((d) => d.doc_type === "PACKING_LIST"), "doc_type")[0];
    const a = num(ship.gross_weight_kg);
    const p = num(pl?.gross_weight_kg);
    const gap = a && p ? Math.abs(a - p) / Math.max(a, p) : 0;
    checks.push(ok("AWB and packing list gross weights differ by more than 2%", gap > 0.02, `AWB ${a} kg vs packing list ${p ?? "missing"} kg`));
  } else if (t === "HS_CODE_ERROR") {
    const inv = latestBy((await invoicesFor(c.awbNo, null)).map((r) => r.row), "invoice_no")[0];
    checks.push(ok("Invoice HS code differs from the AWB", !!inv && str(inv.hs_code) !== str(ship.hs_code), `Invoice ${inv?.invoice_no ?? "missing"} HS ${inv?.hs_code ?? "-"} vs AWB HS ${ship.hs_code || "-"}`));
  } else if (t === "MISSING_CERTIFICATE") {
    const docs = (await documentsFor(c.awbNo)).map((r) => r.row);
    const customs = (await customsFor(c.awbNo))[0]?.row;
    checks.push(ok("No certificate of origin on file", !docs.some((d) => d.doc_type === "CERTIFICATE_OF_ORIGIN" && d.status === "received"), "Documents searched for this AWB"));
    checks.push(ok("A certificate is required", /certificate/i.test(`${customs?.documents_missing} ${customs?.remarks}`), `Customs: ${customs?.documents_missing ?? "no entry"}`));
  } else if (t === "TRANSPORT_DELAY") {
    const ev = (await trackingFor(c.awbNo)).map((r) => r.row);
    const ofld = ev.filter((e) => e.code === "OFLD").pop();
    const dep = ev.some((e) => e.code === "DEP" && (!ofld || str(e.event_time) > str(ofld.event_time)));
    checks.push(ok("No departure since the offload or planned flight", !dep, ofld ? `Offloaded ${str(ofld.event_time).slice(0, 16)}; departure since: ${dep ? "yes" : "no"}` : "No departure event"));
  } else if (t === "CONFLICTING_STATUS") {
    const ev = (await trackingFor(c.awbNo)).map((r) => r.row);
    const customs = (await customsFor(c.awbNo))[0]?.row;
    const claim = ev.find((e) => ["DLV", "CLR"].includes(str(e.code)));
    checks.push(ok("Carrier status contradicts customs", !!claim && /^held/i.test(str(customs?.status)), `Carrier ${claim?.code ?? "-"} vs customs ${customs?.status ?? "-"}`));
  }
  const passed = checks.every((k) => k.passed);
  record("decision", passed ? "Finding confirmed against the sources" : `Finding challenged: ${checks.filter((k) => !k.passed).map((k) => k.detail).join("; ")}`, checks);
  return saveVerification(caseId, { mode: "finding", result: passed ? "pass" : "fail", checks, critique: passed ? "" : checks.filter((k) => !k.passed).map((k) => k.detail).join("; "), trigger: "new finding" });
}

// --------------------------------------------------------- resolution check

async function customsReleased(awb: string, since: string, claimedRefs: string[]): Promise<Check[]> {
  const entry = (await customsFor(awb))[0];
  const row = entry?.row;
  const released = !!row && /^(released|cleared)$/i.test(str(row.status)) && !!row.release_ref;
  const after = !!row && ts(row.status_at) >= Date.parse(since);
  const cited = [...new Set(claimedRefs.map((r) => r.trim().replace(/\.(pdf|png|jpe?g)$/i, "")).filter((r) => /^(CLR|REL|AUH-REL|DXB-REL)/i.test(r)))];
  const citedOk = cited.every((r) => r.replace(/\W/g, "").toUpperCase() === str(row?.release_ref).replace(/\W/g, "").toUpperCase());
  return [
    ok("Customs record shows released", released, row ? `Customs entry ${row.entry_no}: ${row.status}${row.release_ref ? `, release ${row.release_ref}` : ""}` : "No customs entry found"),
    ok("Release dated after our request", released && after, row ? `Status time ${str(row.status_at).slice(0, 16)} vs request ${since.slice(0, 16)}` : "-"),
    ok("Cited release reference found in the customs record", citedOk, cited.length ? `Reply cites ${cited.join(", ")}; customs record has ${row?.release_ref ?? "none"}` : "Reply cites no release reference"),
  ];
}

async function typeChecks(caseId: string, since: string, claimedRefs: string[]): Promise<{ checks: Check[]; stage?: "departed" }> {
  const c = getCase(caseId)!;
  const awbDigits = digitsOnly(c.awbNo);
  const ship = (await shipmentByAwb(c.awbNo))!.row;
  const docs = (await documentsFor(c.awbNo)).map((r) => r.row);
  const t = c.problemType;
  const checks: Check[] = [];

  if (t === "MISSING_INVOICE" || t === "INVOICE_REF_MISMATCH" || t === "HS_CODE_ERROR") {
    const all = (await invoicesFor(c.awbNo, str(ship.invoice_ref) || null)).map((r) => r.row);
    const own = latestBy(all.filter((i) => digitsOnly(str(i.shipment_ref_as_written)) === awbDigits && similarCompany(str(i.consignee_as_written), str(ship.consignee))), "invoice_no");
    const inv = own[0];
    if (t === "MISSING_INVOICE") {
      checks.push(ok("Invoice on file shows this AWB and consignee", !!inv, inv ? `Invoice ${inv.invoice_no} v${inv.version} quotes ${inv.shipment_ref_as_written} for ${inv.consignee_as_written}` : "No invoice in finance quotes this AWB for this consignee"));
    }
    if (t === "INVOICE_REF_MISMATCH") {
      const corrected = own.find((i) => (num(i.version) ?? 1) > 1);
      checks.push(ok("Corrected invoice quotes this AWB", !!corrected, corrected ? `Invoice ${corrected.invoice_no} v${corrected.version} quotes ${corrected.shipment_ref_as_written}` : "No newer invoice version quotes this AWB"));
      checks.push(ok("Corrected invoice names the version it replaces", !!corrected?.supersedes, corrected?.supersedes ? `Replaces ${corrected.supersedes}` : "No replaced version named"));
    }
    if (t === "HS_CODE_ERROR") {
      const review = docs.filter((d) => d.doc_type === "BROKER_REVIEW").pop();
      const approved = str(review?.goods).match(/\b\d{6,10}\b/)?.[0];
      const corrected = own.find((i) => (num(i.version) ?? 1) > 1);
      checks.push(ok("Broker classification review on file", !!review, review ? `${review.ref_no}: ${review.goods}` : "No broker review record"));
      checks.push(ok("Corrected invoice carries the reviewed code", !!corrected && !!approved && str(corrected.hs_code) === approved, corrected ? `Invoice ${corrected.invoice_no} v${corrected.version} HS ${corrected.hs_code}; review approved ${approved ?? "-"}` : "No corrected invoice version"));
    }
  }
  if (t === "WEIGHT_MISMATCH") {
    const rec = docs.filter((d) => d.doc_type === "WEIGHT_RECORD").pop();
    const pl = latestBy(docs.filter((d) => d.doc_type === "PACKING_LIST"), "doc_type")[0];
    const recKg = num(rec?.gross_weight_kg);
    checks.push(ok("Dated official weight record", !!rec && !!rec.issued_on, rec ? `${rec.ref_no}: ${recKg} kg gross, ${rec.pieces} pieces, ${str(rec.issued_on).slice(0, 10)}` : "No weight record"));
    checks.push(ok("Piece counts agree", !!rec && num(rec.pieces) === num(ship.pieces), `Record ${rec?.pieces ?? "-"} vs AWB ${ship.pieces}`));
    checks.push(ok("Documents now agree with the record", !!rec && num(pl?.gross_weight_kg) === recKg && num(ship.gross_weight_kg) === recKg, `AWB ${num(ship.gross_weight_kg)} kg, packing list v${pl?.version ?? "-"} ${num(pl?.gross_weight_kg)} kg, record ${recKg ?? "-"} kg`));
  }
  if (t === "MISSING_CERTIFICATE") {
    const cert = docs.filter((d) => d.doc_type === "CERTIFICATE_OF_ORIGIN" && d.status === "received").pop();
    checks.push(ok("Issued certificate on file (not an application)", !!cert && !!cert.issuer && !!cert.issued_on, cert ? `${cert.ref_no} issued by ${cert.issuer} on ${str(cert.issued_on).slice(0, 10)}` : "No issued certificate for this AWB"));
    checks.push(ok("Certificate matches the consignee", !!cert && similarCompany(str(cert.consignee_as_written), str(ship.consignee)), cert ? `Certificate consignee "${cert.consignee_as_written}" vs "${ship.consignee}"` : "-"));
  }
  if (t === "CONFLICTING_STATUS") {
    const pod = docs.filter((d) => d.doc_type === "PROOF_OF_DELIVERY").pop();
    checks.push(ok("Signed receipt from the consignee", !!pod && ts(pod.received_at) >= Date.parse(since), pod ? `${pod.ref_no} signed ${str(pod.issued_on).slice(0, 10)}` : "No proof of delivery on file (delivery was claimed)"));
  }
  if (t === "TRANSPORT_DELAY") {
    const ev = (await trackingFor(c.awbNo)).map((r) => r.row);
    const ofld = ev.filter((e) => e.code === "OFLD").pop();
    const dep = ev.filter((e) => e.code === "DEP" && (!ofld || str(e.event_time) > str(ofld.event_time))).pop();
    const arr = dep && ev.filter((e) => e.code === "ARR" && str(e.event_time) > str(dep.event_time) && str(e.location) === str(ship.destination)).pop();
    checks.push(ok("Stage 1: actual departure recorded by the carrier", !!dep, dep ? `${dep.description} at ${str(dep.event_time).slice(0, 16)}` : "Only a booking or estimate so far"));
    checks.push(ok("Stage 2: arrival at the destination recorded", !!arr, arr ? `Arrived ${arr.location} ${str(arr.event_time).slice(0, 16)}` : `No arrival at ${ship.destination} yet`));
    return { checks, stage: dep && !arr ? "departed" : undefined };
  }
  const proc = await procedureFor(t);
  if (proc.needs_customs_release) checks.push(...(await customsReleased(c.awbNo, since, claimedRefs)));
  return { checks };
}

export async function verifyResolution(caseId: string, reading: ReplyReading, mail: { message_id: string; from_addr: string; subject: string; body: string; sent_at: string }): Promise<VerificationResult> {
  const c = getCase(caseId)!;
  const since = c.requestSentAt ?? c.openedAt;
  const checks: Check[] = [
    ok("Reply is real resolution evidence", reading.replyType === "RESOLUTION_EVIDENCE", `Reply type ${reading.replyType}: ${reading.meaning}`),
    ok("Reply refers to this shipment", digitsOnly(`${mail.subject} ${mail.body}`).includes(digitsOnly(c.awbNo)) || mail.subject.includes(caseId), `Looked for AWB ${c.awbNo} or ${caseId}`),
    ok("Reply dated after our request", Date.parse(mail.sent_at) >= Date.parse(since), `Reply ${mail.sent_at.slice(0, 16)} vs request ${since.slice(0, 16)}`),
  ];
  const typed = await typeChecks(caseId, since, reading.claimedRefs);
  checks.push(...typed.checks);
  // An email claim is evidence to check, not the decision. When every check against the
  // systems of record passes, a reply worded as partial or progress does not block closure.
  const recordChecks = checks.filter((k) => !k.name.startsWith("Reply"));
  if (!checks[0].passed && ["PARTIAL", "PROGRESS_UPDATE"].includes(reading.replyType) && recordChecks.length > 0 && recordChecks.every((k) => k.passed)) {
    checks[0] = ok("Reply is real resolution evidence", true, `Reply worded as ${reading.replyType}, but the systems of record prove the result: ${reading.meaning}`);
  }

  // Stage 1 of a transport delay: progress, not closure.
  const stageOnly = typed.stage === "departed" && checks.filter((k) => !k.passed).every((k) => k.name.startsWith("Stage 2") || k.name.startsWith("Reply is real"));

  // Critic: looks for reasons NOT to close. Can only add failures.
  let critique = "";
  if (checks.every((k) => k.passed)) {
    try {
      const proc = await procedureFor(c.problemType);
      const v = await chatJson<{ blocking: boolean; concerns: string[]; reasoning: string }>({
        purpose: "Critique the proposed closure",
        model: "deep",
        system: `You are the Verification agent's critic in Track-N. All rule checks passed for closing an exception case. Your job is to look for a reason NOT to close: second-hand claims, evidence about a different shipment, an action reported without its result, or anything on the procedure's "not enough" list. Only block for a concrete reason grounded in the text below. Return JSON {"blocking": true|false, "concerns": ["..."], "reasoning": "<two sentences>"}`,
        user: [
          `Case: ${c.title}, AWB ${c.awbNo}. Finding: ${c.summary}`,
          `Closing evidence required: ${proc.closing_evidence}`,
          `Not enough: ${proc.not_enough}`,
          `Reply from ${mail.from_addr}: "${mail.subject}" ${mail.body}`,
          `Checks: ${checks.map((k) => `${k.name}: ${k.detail}`).join(" | ")}`,
        ].join("\n"),
        maxTokens: 500,
      });
      critique = v.reasoning;
      if (v.blocking && v.concerns?.length) checks.push(ok("Critic found no reason to keep the case open", false, v.concerns.join("; ")));
    } catch (err) {
      if (!(err instanceof LlmError)) throw err;
      critique = "Critic unavailable; rule checks only.";
    }
  }
  const passed = checks.every((k) => k.passed);
  const result: VerificationResult["result"] = passed ? "pass" : stageOnly ? "stage" : "fail";
  for (const k of checks.filter((x) => x.passed && !x.name.startsWith("Reply"))) {
    await addEvidence(caseId, { source: "verification", recordId: k.name, claim: k.detail, kind: "check", addedBy: "verification" });
  }
  record("decision", passed ? "All closing checks passed" : result === "stage" ? "Stage 1 confirmed (departed); waiting for arrival" : `Closure rejected: ${checks.filter((k) => !k.passed).map((k) => k.name).join("; ")}`, checks);
  return saveVerification(caseId, { mode: "resolution", result, checks, critique, trigger: `reply ${mail.message_id}` });
}

/** For a reply with an attachment: is it about this shipment at all? */
export async function attachmentBelongs(caseId: string, attachmentRef: string): Promise<{ belongs: boolean; detail: string }> {
  const c = getCase(caseId)!;
  const ship = (await shipmentByAwb(c.awbNo))!.row;
  const rows = await runSql(`SELECT invoice_no, version, shipment_ref_as_written, consignee_as_written FROM ${SOURCES.invoices} WHERE file_name = ${lit(attachmentRef)}`, { purpose: `Check attachment ${attachmentRef} (finance)` });
  const docRows = rows.length ? [] : await runSql(`SELECT doc_id, ref_no, awb_as_written, consignee_as_written FROM ${SOURCES.documents} WHERE file_name = ${lit(attachmentRef)}`, { purpose: `Check attachment ${attachmentRef} (documents)` });
  const r = rows[0] ?? docRows[0];
  if (!r) return { belongs: true, detail: `${attachmentRef} is not in any system yet` };
  const ref = str(r.shipment_ref_as_written ?? r.awb_as_written);
  const belongs = digitsOnly(ref) === digitsOnly(c.awbNo) && similarCompany(str(r.consignee_as_written), str(ship.consignee));
  return { belongs, detail: `${attachmentRef} quotes ${ref || "no AWB"} for "${r.consignee_as_written}"; this case is ${c.awbNo} for "${ship.consignee}"` };
}
