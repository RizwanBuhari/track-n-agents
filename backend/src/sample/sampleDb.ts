// Sample mode database: an embedded Postgres (PGlite, in-process WASM) that
// stands in for Zetaris and the two Track-N databases. It is seeded from the
// same infra/ SQL files, with one schema per Zetaris source, so the agents'
// qualified SQL runs unchanged. Agent reads come back the way Zetaris returns
// them (every value a string); the write shims behave like the pg / mysql2
// pools in lib/db.ts.

import fs from "node:fs";
import path from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { config, repoRoot } from "../config.ts";
import { carrierApi, customsApi } from "../sim/systems.ts";

type Row = Record<string, unknown>;

const CARRIER_COLS = ["event_id", "awb_no", "carrier", "event_time", "code", "description", "location", "flight"];
const CUSTOMS_COLS = ["entry_no", "awb_reference", "importer", "port", "documents_received", "documents_missing", "status", "remarks", "release_ref", "status_at", "updated_by"];

let ready: Promise<PGlite> | null = null;

export function sampleDb(): Promise<PGlite> {
  ready ??= open();
  return ready;
}

async function open(): Promise<PGlite> {
  const dir = path.join(config.dataDir, "pg");
  fs.mkdirSync(dir, { recursive: true });
  const db = await PGlite.create(dir);
  // Zetaris returns timestamps in UTC; keep the session in UTC so they match.
  await db.exec("SET TimeZone TO 'UTC'");
  const seeded = (await db.query("SELECT 1 FROM pg_namespace WHERE nspname = 'trackn_ops'")).rows.length > 0;
  if (!seeded) await seed(db);
  // Agent SQL is fully qualified; the direct writes name ops and finance tables without a schema.
  await db.exec("SET search_path TO trackn_compat, pg_catalog, trackn_ops, trackn_finance");
  return db;
}

const infraSql = (file: string) => fs.readFileSync(path.join(repoRoot, "infra", file), "utf-8");

async function seed(db: PGlite) {
  await db.exec(`BEGIN;
    CREATE SCHEMA trackn_ops; CREATE SCHEMA trackn_finance; CREATE SCHEMA trackn_carrier; CREATE SCHEMA trackn_customs; CREATE SCHEMA trackn_compat;
    -- Zetaris (Spark SQL) replaces every match; Postgres replaces only the first without the 'g' flag.
    CREATE FUNCTION trackn_compat.regexp_replace(text, text, text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT pg_catalog.regexp_replace($1, $2, $3, 'g') $$;
    CREATE TABLE trackn_carrier.tracking_events (${CARRIER_COLS.map((c) => `${c} text`).join(", ")});
    CREATE TABLE trackn_customs.customs_entries (${CUSTOMS_COLS.map((c) => `${c} text`).join(", ")});
    SET search_path TO trackn_ops;
    ${infraSql("ops-db/01_schema.sql")}
    ${infraSql("ops-db/02_seed.sql")}
    SET search_path TO trackn_finance;
    ${infraSql("finance-db/01_schema_seed.sql").replace(/\bDATETIME\b/g, "TIMESTAMP")}
    COMMIT;`);
}

/** The carrier and customs sources are REST APIs in live mode: refresh their tables from the simulator before a read. */
async function syncSimTables(tx: Transaction, sql: string) {
  const sources = [
    { mention: /trackn_carrier\./i, table: "trackn_carrier.tracking_events", rows: () => carrierApi.events() },
    { mention: /trackn_customs\./i, table: "trackn_customs.customs_entries", rows: () => customsApi.entries() },
  ];
  for (const s of sources) {
    if (!s.mention.test(sql)) continue;
    await tx.query(`DELETE FROM ${s.table}`);
    await tx.query(`INSERT INTO ${s.table} SELECT * FROM json_populate_recordset(NULL::${s.table}, $1::json)`, [JSON.stringify(s.rows())]);
  }
}

// Keep the text Postgres sends for every type, then shape it like Zetaris.
const RAW = Object.fromEntries([16, 20, 21, 23, 26, 114, 700, 701, 1082, 1114, 1184, 1700, 3802].map((oid) => [oid, (v: string) => v]));

function zetarisValue(value: unknown, oid: number | undefined): unknown {
  if (value === null || value === undefined) return null;
  if (oid === 16) return value === "t" ? "true" : "false";
  // "2026-10-11 06:00:00+00" -> "2026-10-11 06:00:00", the zone-less UTC form Zetaris returns.
  if (oid === 1184 || oid === 1114) return String(value).replace(/[+-]\d{2}(:\d{2})?$/, "");
  return String(value);
}

/** Runs an agent read the way Zetaris would answer it. */
export async function zetarisQuery(sql: string, limit: number): Promise<Row[]> {
  const db = await sampleDb();
  if (/trackn_(carrier|customs)\./i.test(sql)) await db.transaction((tx) => syncSimTables(tx, sql));
  const result = await db.query<Row>(sql, [], { parsers: RAW });
  const oids = new Map(result.fields.map((f) => [f.name, f.dataTypeID]));
  return result.rows.slice(0, limit).map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, zetarisValue(v, oids.get(k))])));
}

/** pg.Pool-shaped query for the operations writes in lib/db.ts. */
export async function opsQuery(text: string, params: unknown[] = []): Promise<{ rows: Row[]; rowCount: number }> {
  const db = await sampleDb();
  // DATE stays "YYYY-MM-DD", as lib/db.ts configures pg.
  const result = await db.query<Row>(text, params, { parsers: { 1082: (v: string) => v } });
  return { rows: result.rows, rowCount: result.fields.length ? result.rows.length : result.affectedRows ?? 0 };
}

/** mysql2-shaped query for the finance writes: "?" placeholders and INSERT IGNORE. */
export async function financeQuery(sql: string, params: unknown[] = []): Promise<[Row[], unknown]> {
  let n = 0;
  let text = sql.replace(/\?/g, () => `$${++n}`);
  if (/^\s*INSERT IGNORE\b/i.test(text)) text = `${text.replace(/INSERT IGNORE/i, "INSERT")} ON CONFLICT DO NOTHING`;
  const result = await (await sampleDb()).query<Row>(text, params);
  return [result.rows, result.fields];
}
