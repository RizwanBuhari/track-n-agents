// Evidence-gathering tools. Each function is one Zetaris query against one
// of the fragmented sources, matching references the way the operating rules
// say: digits only, so "901 4417 3021", "90144173021" and "901-44173021"
// are the same AWB. Every row keeps its source table and record ID.

import { digitsOnly } from "../lib/refs.ts";
import { lit, num, runSql, SOURCES, str, type Row } from "../lib/zetaris.ts";

const digitsExpr = (col: string) => `regexp_replace(${col}, '[^0-9]', '')`;

export type SourceRow = { source: string; recordId: string; row: Row };

function tag(source: string, idCol: (r: Row) => string, rows: Row[]): SourceRow[] {
  return rows.map((row) => ({ source, recordId: idCol(row), row }));
}

export async function shipmentByAwb(awb: string): Promise<SourceRow | null> {
  const rows = await runSql(`SELECT * FROM ${SOURCES.shipments} WHERE ${digitsExpr("awb_no")} = ${lit(digitsOnly(awb))}`, { purpose: "Find the shipment record (Postgres)" });
  return tag(SOURCES.shipments, (r) => str(r.awb_no), rows)[0] ?? null;
}

/** Invoices that quote this AWB, plus any invoice named on the AWB itself (it may quote another AWB). */
export async function invoicesFor(awb: string, invoiceRef: string | null): Promise<SourceRow[]> {
  const byName = invoiceRef ? ` OR invoice_no = ${lit(invoiceRef)}` : "";
  const rows = await runSql(
    `SELECT * FROM ${SOURCES.invoices} WHERE status <> 'set_aside' AND (${digitsExpr("shipment_ref_as_written")} = ${lit(digitsOnly(awb))}${byName}) ORDER BY invoice_no, version`,
    { purpose: "Find invoices for this AWB (MySQL)" },
  );
  return tag(SOURCES.invoices, (r) => `${str(r.invoice_no)} v${str(r.version)}`, rows);
}

export async function documentsFor(awb: string): Promise<SourceRow[]> {
  const rows = await runSql(
    `SELECT * FROM ${SOURCES.documents} WHERE status <> 'set_aside' AND ${digitsExpr("awb_as_written")} = ${lit(digitsOnly(awb))} ORDER BY received_at`,
    { purpose: "Find packing lists, certificates and weight records (Postgres)" },
  );
  return tag(SOURCES.documents, (r) => str(r.doc_id), rows);
}

export async function trackingFor(awb: string): Promise<SourceRow[]> {
  const rows = await runSql(
    `SELECT * FROM ${SOURCES.tracking} WHERE ${digitsExpr("awb_no")} = ${lit(digitsOnly(awb))} ORDER BY event_time`,
    { purpose: "Read carrier tracking events (carrier REST API)" },
  );
  return tag(SOURCES.tracking, (r) => str(r.event_id), rows);
}

export async function customsFor(awb: string): Promise<SourceRow[]> {
  const rows = await runSql(
    `SELECT * FROM ${SOURCES.customs} WHERE ${digitsExpr("awb_reference")} = ${lit(digitsOnly(awb))}`,
    { purpose: "Read the customs entry (customs broker REST API)" },
  );
  return tag(SOURCES.customs, (r) => str(r.entry_no), rows);
}

export async function mailFor(awb: string, caseId?: string): Promise<SourceRow[]> {
  const byCase = caseId ? ` OR case_id = ${lit(caseId)}` : "";
  const rows = await runSql(
    `SELECT message_id, direction, from_addr, to_addr, subject, body, attachments, sent_at, case_id FROM ${SOURCES.mailbox}
     WHERE ${digitsExpr("subject")} LIKE ${lit(`%${digitsOnly(awb)}%`)} OR ${digitsExpr("body")} LIKE ${lit(`%${digitsOnly(awb)}%`)}${byCase}
     ORDER BY sent_at`,
    { purpose: "Search the shared mailbox (Postgres)" },
  );
  return tag(SOURCES.mailbox, (r) => str(r.message_id), rows);
}

export async function partiesFor(awb: string): Promise<{ role: string; name: string; email: string }[]> {
  const rows = await runSql(`SELECT role, name, email FROM ${SOURCES.parties} WHERE awb_no = ${lit(awb)}`, { purpose: "Look up the parties for this shipment (Postgres)" });
  return rows.map((r) => ({ role: str(r.role), name: str(r.name), email: str(r.email) }));
}

export type Procedure = {
  problem_type: string;
  title: string;
  request_to_role: string;
  confirm_with_role: string;
  expected_senders: string[];
  request_items: string;
  reminder1_hours: number;
  reminder2_hours: number;
  escalate_hours: number;
  closing_evidence: string;
  not_enough: string;
  needs_customs_release: boolean;
};

export async function procedureFor(problemType: string): Promise<Procedure> {
  const rows = await runSql(`SELECT * FROM ${SOURCES.procedures} WHERE problem_type = ${lit(problemType)}`, { purpose: `Read the operating procedure for ${problemType} (Postgres)` });
  const r = rows[0];
  if (!r) throw new Error(`No procedure for ${problemType}`);
  return {
    problem_type: str(r.problem_type),
    title: str(r.title),
    request_to_role: str(r.request_to_role),
    confirm_with_role: str(r.confirm_with_role),
    expected_senders: str(r.expected_senders).split(",").map((s) => s.trim()),
    request_items: str(r.request_items),
    reminder1_hours: num(r.reminder1_hours) ?? 2,
    reminder2_hours: num(r.reminder2_hours) ?? 4,
    escalate_hours: num(r.escalate_hours) ?? 6,
    closing_evidence: str(r.closing_evidence),
    not_enough: str(r.not_enough),
    needs_customs_release: r.needs_customs_release === true || str(r.needs_customs_release) === "true",
  };
}

/** Agent-written read-only query (Investigation may ask for one extra lookup). */
export async function freeQuery(sql: string): Promise<Row[]> {
  return runSql(sql, { purpose: "Agent-requested lookup", limit: 50 });
}
