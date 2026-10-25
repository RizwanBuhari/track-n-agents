// Zetaris REST client. Every read the agents make of shipment, invoice,
// document, mailbox, carrier and customs data goes through here, so one
// SQL dialect reaches all four fragmented sources.

import { randomUUID } from "node:crypto";
import { config } from "../config.ts";
import { record } from "./trace.ts";

export type Row = Record<string, unknown>;

export class ZetarisError extends Error {}

export async function runSql(sql: string, opts: { purpose?: string; limit?: number; trace?: boolean } = {}): Promise<Row[]> {
  const started = Date.now();
  if (config.sampleMode) return runSampleSql(sql, opts, started);
  const body = { queryId: randomUUID(), sql: sql.trim(), source: "SqlEditor", limit: opts.limit ?? 500 };
  let response: Response;
  try {
    response = await fetch(config.zetaris.restUrl.replace(/\/$/, "") + "/sql-editor/sqls/run", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.zetaris.apiKey()}`,
        "X-Org-ID": config.zetaris.orgId,
        "X-Request-ID": randomUUID(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    throw new ZetarisError(`Zetaris is unreachable at ${config.zetaris.restUrl}: ${(err as Error).message}`);
  }
  const text = await response.text();
  if (!response.ok) {
    if (opts.trace !== false) record("sql", `FAILED ${opts.purpose ?? "query"}`, { sql, status: response.status, error: text.slice(0, 300) }, Date.now() - started);
    throw new ZetarisError(`Zetaris ${response.status}: ${text.slice(0, 300)}`);
  }
  const json = text ? JSON.parse(text) : { headers: [], data: [] };
  const headers: string[] = json.headers ?? [];
  const rows = (json.data ?? []).map((values: unknown[]) => Object.fromEntries(headers.map((h, i) => [h, values[i]])));
  if (opts.trace !== false) {
    record("sql", opts.purpose ?? "Zetaris query", { sql, rows: rows.length, sample: rows.slice(0, 5) }, Date.now() - started);
  }
  return rows;
}

/** Sample mode: the same query against the embedded Postgres that stands in for Zetaris. */
async function runSampleSql(sql: string, opts: { purpose?: string; limit?: number; trace?: boolean }, started: number): Promise<Row[]> {
  const engine = "sample mode (embedded Postgres, no Zetaris)";
  let rows: Row[];
  try {
    const { zetarisQuery } = await import("../sample/sampleDb.ts");
    rows = await zetarisQuery(sql.trim(), opts.limit ?? 500);
  } catch (err) {
    if (opts.trace !== false) record("sql", `FAILED ${opts.purpose ?? "query"}`, { sql, engine, error: (err as Error).message.slice(0, 300) }, Date.now() - started);
    throw new ZetarisError(`Sample database: ${(err as Error).message.slice(0, 300)}`);
  }
  if (opts.trace !== false) record("sql", opts.purpose ?? "Zetaris query", { sql, engine, rows: rows.length, sample: rows.slice(0, 5) }, Date.now() - started);
  return rows;
}

/** Agents may only read. Rejects anything that is not a single SELECT/WITH statement. */
export function assertReadOnly(sql: string): void {
  const s = sql.trim().replace(/;+\s*$/, "");
  if (s.includes(";")) throw new ZetarisError("Only one statement is allowed");
  if (!/^(select|with)\b/i.test(s)) throw new ZetarisError("Only SELECT queries are allowed");
  if (/\b(insert|update|delete|drop|create|alter|grant|register|cache|uncache)\b/i.test(s)) {
    throw new ZetarisError("Only read-only queries are allowed");
  }
}

export function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function str(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

/** Quote a literal for Lightning SQL. */
export function lit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export const SOURCES = {
  shipments: "trackn_ops.shipments",
  documents: "trackn_ops.documents",
  mailbox: "trackn_ops.mailbox",
  parties: "trackn_ops.parties",
  procedures: "trackn_ops.procedures",
  invoices: "trackn_finance.invoices",
  tracking: "trackn_carrier.tracking_events",
  customs: "trackn_customs.customs_entries",
} as const;

/** Zetaris returns TIMESTAMP values in UTC without a zone ("2026-10-24 13:57:42.692"). */
export function ts(value: unknown): number {
  const s = str(value).trim();
  if (!s) return NaN;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) return Date.parse(s.replace(" ", "T") + "Z");
  return Date.parse(s);
}
