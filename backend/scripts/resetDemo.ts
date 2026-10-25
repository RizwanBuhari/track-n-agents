// Resets the demo to its starting point. STOP THE BACKEND FIRST (it keeps
// case state in memory). Removes cases, traces, the demo clock and the
// simulated systems' changes, and deletes rows the demo added to the
// databases. Seeded rows stay. Pass --shipments to also remove confirmed
// shipments (then run scripts/loadDemoShipments.ts again).

import fs from "node:fs";
import path from "node:path";
import { config, repoRoot } from "../src/config.ts";
import { finance, ops } from "../src/lib/db.ts";

const keepShipments = !process.argv.includes("--shipments");

await ops.query("DELETE FROM mailbox WHERE message_id LIKE 'SIM-%' OR message_id LIKE 'OUT-%'");
await ops.query("UPDATE mailbox SET case_id = NULL");
await ops.query("DELETE FROM documents WHERE doc_id NOT LIKE 'PL-CASE-%'");
await ops.query("UPDATE documents SET status = 'received'");
if (!keepShipments) await ops.query("DELETE FROM shipments");
// Re-apply the operating procedures, so rule changes reach an existing database.
await ops.query(fs.readFileSync(path.join(repoRoot, "infra", "ops-db", "03_procedures.sql"), "utf-8"));
await finance.query("DELETE FROM invoices WHERE file_name NOT LIKE 'CASE-%\\_INV.pdf'");
await finance.query("UPDATE invoices SET status = 'received'");

for (const entry of ["sim", "traces", "uploads", ".world", "runs.json", "clock.json", "conformance.txt"]) {
  fs.rmSync(path.join(config.dataDir, entry), { recursive: true, force: true });
}
console.log(`Demo reset${keepShipments ? " (confirmed shipments kept)" : " (shipments removed)"}. Start the backend again.`);
await ops.end();
await finance.end();
