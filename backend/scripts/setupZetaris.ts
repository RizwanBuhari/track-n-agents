// Registers Track-N's four fragmented sources in Zetaris (idempotent):
//   trackn_ops      Postgres  shipments, documents, mailbox, parties, procedures
//   trackn_finance  MySQL     invoices
//   trackn_carrier  REST      simulated carrier tracking API (this backend)
//   trackn_customs  REST      simulated customs broker portal (this backend)
// Run after `docker compose up -d` in infra/ and with the backend running.

import { config } from "../src/config.ts";
import { runSql } from "../src/lib/zetaris.ts";

function dbParts(url: string) {
  const u = new URL(url);
  return { user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), db: u.pathname.slice(1) };
}

async function step(label: string, sql: string) {
  try {
    await runSql(sql, { trace: false });
    console.log(`  done     ${label}`);
  } catch (err) {
    const msg = (err as Error).message;
    if (/already exist|exists/i.test(msg)) console.log(`  exists   ${label}`);
    else {
      console.log(`  FAILED   ${label}: ${msg}`);
      process.exitCode = 1;
    }
  }
}

const ops = dbParts(config.opsDbUrl);
const fin = dbParts(config.financeDbUrl);
const cb = config.zetarisCallbackBase;

console.log("Registering Track-N sources in Zetaris");
await step("trackn_ops (Postgres)", `CREATE DATASOURCE trackn_ops DESCRIBE BY "Track-N operations Postgres" OPTIONS (jdbcdriver "org.postgresql.Driver", jdbcurl "jdbc:postgresql://trackn-ops-db:5432/${ops.db}", username "${ops.user}", password "${ops.password}", fetchsize "1000")`);
await step("trackn_ops tables", "REGISTER DATASOURCE TABLES FROM trackn_ops");
await step("trackn_finance (MySQL)", `CREATE DATASOURCE trackn_finance DESCRIBE BY "Track-N finance MySQL" OPTIONS (jdbcdriver "com.mysql.cj.jdbc.Driver", jdbcurl "jdbc:mysql://trackn-finance-db:3306/${fin.db}", username "${fin.user}", password "${fin.password}", fetchsize "1000")`);
await step("trackn_finance tables", "REGISTER DATASOURCE TABLES FROM trackn_finance");
await step("trackn_carrier database", `CREATE LIGHTNING DATABASE trackn_carrier DESCRIBE BY "Simulated carrier tracking API"`);
await step("trackn_carrier.tracking_events (REST)", `CREATE LIGHTNING REST TABLE tracking_events FROM trackn_carrier REQUEST (endpoint "${cb}/sim/carrier/events", method "GET", http_encoding "URLENCODED", response_type "JSON", insecure_ssl "false") HEADER () BODY ()`);
await step("trackn_customs database", `CREATE LIGHTNING DATABASE trackn_customs DESCRIBE BY "Simulated customs broker portal"`);
await step("trackn_customs.customs_entries (REST)", `CREATE LIGHTNING REST TABLE customs_entries FROM trackn_customs REQUEST (endpoint "${cb}/sim/customs/entries", method "GET", http_encoding "URLENCODED", response_type "JSON", insecure_ssl "false") HEADER () BODY ()`);

console.log("\nCross-source check: packing lists (Postgres) joined to invoices (MySQL) and customs (REST)");
const rows = await runSql(
  `SELECT d.awb_as_written, d.gross_weight_kg AS packing_list_kg, i.invoice_no, i.shipment_ref_as_written, c.status AS customs_status
   FROM trackn_ops.documents d
   LEFT JOIN trackn_finance.invoices i ON i.invoice_no = d.invoice_ref
   LEFT JOIN trackn_customs.customs_entries c ON regexp_replace(c.awb_reference, '[^0-9]', '') = d.awb_as_written
   ORDER BY d.awb_as_written`,
  { trace: false },
);
console.table(rows);
