// Patterns across cases. Each case is worked on its own; this looks across
// all of them for the same party (or lane) causing the same trouble again:
// claims the records did not back, vague replies, wrong documents, slow
// responses, unknown senders. Read from the shared case history (World
// Model) plus the systems of record through Zetaris (documents and invoices
// set aside). Deterministic, so it works in sample mode, and every pattern
// names its cases and evidence. Planning uses the advice when it writes to
// a party with a known pattern.

import { ROLE_LABELS } from "../domain.ts";
import { similarCompany } from "../lib/refs.ts";
import { runSql, SOURCES, str } from "../lib/zetaris.ts";
import { getCase, listCaseIds, type CaseView } from "../state/caseState.ts";

export type Pattern = {
  id: string;
  kind: "unproven_claims" | "vague_replies" | "wrong_documents" | "slow_responses" | "unverified_sender" | "lane_problem";
  title: string;
  detail: string;
  advice: string;
  party?: { email: string; name: string; role: string };
  cases: string[];
  evidence: string[];
  tone: "warn" | "alert";
};

type Hits = Map<string, { cases: Set<string>; evidence: Set<string> }>;

const KINDS: Record<Exclude<Pattern["kind"], "lane_problem">, { what: string; advice: string; tone: Pattern["tone"] }> = {
  unproven_claims: {
    what: "claims the records did not back",
    advice: "Ask for the record itself (customs entry and release reference, document number) and say that a claim without a matching record cannot close the case.",
    tone: "warn",
  },
  vague_replies: {
    what: "vague replies with no usable facts",
    advice: "Ask for a named owner and a time for the next update.",
    tone: "warn",
  },
  wrong_documents: {
    what: "wrong or misdirected documents",
    advice: "Name the exact AWB number, invoice number and consignee the document must show before it is sent.",
    tone: "warn",
  },
  slow_responses: {
    what: "no reply until reminded",
    advice: "Say when the answer is needed, and copy the other party who can confirm the result.",
    tone: "warn",
  },
  unverified_sender: {
    what: "unexpected emails about our shipments",
    advice: "Do not use these emails as evidence; confirm anything they claim with the known contact.",
    tone: "alert",
  },
};

const CUSTOMS_HOLDS = ["MISSING_INVOICE", "INVOICE_REF_MISMATCH", "HS_CODE_ERROR", "MISSING_CERTIFICATE"];
const MOVEMENT = ["TRANSPORT_DELAY", "CONFLICTING_STATUS"];

function hit(map: Hits, key: string, caseId: string | null, evidence: string) {
  const h = map.get(key) ?? { cases: new Set<string>(), evidence: new Set<string>() };
  if (caseId) h.cases.add(caseId);
  h.evidence.add(evidence);
  map.set(key, h);
}

const time = (v: unknown) => new Date(String(v).includes(" ") && !/[zZ+]/.test(String(v).slice(10)) ? String(v).replace(" ", "T") + "Z" : String(v)).getTime();

/** Finds repeat patterns across all cases. At least 2 occurrences in at least 2 cases (or 2 records set aside). */
export async function detectPatterns(): Promise<Pattern[]> {
  const cases = listCaseIds().map((id) => getCase(id)).filter((c): c is CaseView => !!c);
  if (!cases.length) return [];

  // Untraced reads: this runs inside planning runs and must not use up their step budget.
  const [partyRows, shipmentRows] = await Promise.all([
    runSql(`SELECT awb_no, role, name, email FROM ${SOURCES.parties}`, { trace: false, limit: 2000 }).catch(() => []),
    runSql(`SELECT awb_no, carrier, destination FROM ${SOURCES.shipments}`, { trace: false, limit: 2000 }).catch(() => []),
  ]);
  const partyByEmail = new Map(partyRows.map((r) => [str(r.email).toLowerCase(), { email: str(r.email), name: str(r.name), role: str(r.role) }]));
  const shipmentByAwb = new Map(shipmentRows.map((r) => [str(r.awb_no), r]));

  const byKind: Record<string, Hits> = Object.fromEntries(Object.keys(KINDS).map((k) => [k, new Map()]));
  const lanes: Hits = new Map();

  for (const c of cases) {
    const inbound = c.emails.filter((e) => e.direction === "inbound" && e.classification !== "DUPLICATE");
    for (const e of inbound) {
      const from = String(e.from).toLowerCase();
      const id = String(e.messageId);
      switch (e.classification) {
        case "PARTIAL": case "CONFLICTING": case "UNSUBSTANTIATED": hit(byKind.unproven_claims, from, c.caseId, id); break;
        case "VAGUE": hit(byKind.vague_replies, from, c.caseId, id); break;
        case "WRONG_DOCUMENT": hit(byKind.wrong_documents, from, c.caseId, id); break;
        case "UNVERIFIED_SENDER": hit(byKind.unverified_sender, from, c.caseId, id); break;
      }
    }
    // A claimed resolution that Verification rejected counts against whoever made the claim.
    for (const v of c.verifications.filter((v) => v.mode === "resolution" && v.result === "fail")) {
      const claim = inbound.filter((e) => time(e.sentAt) <= time(v.at)).at(-1);
      if (claim) hit(byKind.unproven_claims, String(claim.from).toLowerCase(), c.caseId, String(claim.messageId));
    }
    for (const d of c.drafts.filter((d) => d.purpose === "reminder" && d.status === "sent" && d.to)) {
      hit(byKind.slow_responses, d.to.toLowerCase(), c.caseId, d.id);
    }
    const s = shipmentByAwb.get(c.awbNo);
    if (s && MOVEMENT.includes(c.problemType) && str(s.carrier)) hit(lanes, `carrier|${str(s.carrier)}`, c.caseId, c.caseId);
    if (s && CUSTOMS_HOLDS.includes(c.problemType) && str(s.destination)) hit(lanes, `customs|${str(s.destination)}`, c.caseId, c.caseId);
  }

  // Systems of record: documents and invoices set aside as misdirected, by who issued them.
  const setAside = await Promise.all([
    runSql(`SELECT issuer AS party, doc_id AS ref FROM ${SOURCES.documents} WHERE status = 'set_aside'`, { trace: false }).catch(() => []),
    runSql(`SELECT seller AS party, invoice_no AS ref FROM ${SOURCES.invoices} WHERE status = 'set_aside'`, { trace: false }).catch(() => []),
  ]);
  for (const r of setAside.flat()) {
    const party = [...partyByEmail.values()].find((p) => similarCompany(p.name, str(r.party)));
    if (party) hit(byKind.wrong_documents, party.email.toLowerCase(), null, `${str(r.ref)} (set aside)`);
  }

  const out: Pattern[] = [];
  for (const [kind, hits] of Object.entries(byKind)) {
    const k = KINDS[kind as keyof typeof KINDS];
    for (const [email, h] of hits) {
      const records = [...h.evidence].filter((e) => e.endsWith("(set aside)")).length;
      if (h.evidence.size < 2 || (h.cases.size < 2 && records < 2)) continue;
      const party = partyByEmail.get(email) ?? { email, name: email, role: "unknown" };
      const role = ROLE_LABELS[party.role] ?? party.role;
      const who = party.role === "unknown" ? email : party.name.toLowerCase().includes(party.role) ? party.name : `${party.name} (${role})`;
      out.push({
        id: `${kind}:${email}`,
        kind: kind as Pattern["kind"],
        title: `${who}: ${k.what}`,
        detail: `${h.evidence.size} times across ${h.cases.size} case${h.cases.size === 1 ? "" : "s"}${records ? `, ${records} record${records > 1 ? "s" : ""} set aside in our systems` : ""}.`,
        advice: k.advice,
        party,
        cases: [...h.cases].sort(),
        evidence: [...h.evidence],
        tone: k.tone,
      });
    }
  }
  for (const [key, h] of lanes) {
    if (h.cases.size < 2) continue;
    const [type, where] = key.split("|");
    out.push({
      id: `lane:${key}`,
      kind: "lane_problem",
      title: type === "carrier" ? `${where}: delays or conflicting status on ${h.cases.size} shipments` : `${h.cases.size} customs holds at ${where}`,
      detail: `Cases ${[...h.cases].sort().join(", ")}.`,
      advice: type === "carrier" ? "Ask the carrier for the movement record up front, not a status message." : "Check invoices and certificates against the AWB before departure on this lane.",
      cases: [...h.cases].sort(),
      evidence: [...h.evidence],
      tone: "warn",
    });
  }
  return out.sort((a, b) => (a.tone === b.tone ? b.cases.length - a.cases.length : a.tone === "alert" ? -1 : 1));
}

/** Patterns about the given parties (by email) or that include the case. */
export function patternsFor(patterns: Pattern[], emails: string[], caseId?: string): Pattern[] {
  const set = new Set(emails.map((e) => e.toLowerCase()));
  return patterns.filter((p) => (p.party && set.has(p.party.email.toLowerCase())) || (caseId && p.cases.includes(caseId)));
}
