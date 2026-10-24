// Demo bootstrap: runs the real AWB extraction on the demo AWB PDFs and
// confirms them as the demo case owner, as if each had been uploaded and
// checked on the Upload page. If the backend is running, it then starts an
// investigation for each shipment, exactly as the Upload page does.
// CASE-001 is left out by default so it can be uploaded live in the demo.
//   npx tsx scripts/loadDemoShipments.ts [--all] [--no-investigate] [CASE-003 ...]

import fs from "node:fs";
import path from "node:path";
import { config, repoRoot } from "../src/config.ts";
import { extractAwb } from "../src/extraction/extractAwb.ts";
import { confirmShipment } from "../src/services/shipments.ts";
import { DEMO_USERS } from "../src/services/users.ts";

const args = process.argv.slice(2);
const dir = path.join(repoRoot, "demo-data", "cases");
const named = args.filter((a) => a.startsWith("CASE-"));
const cases = named.length ? named : fs.readdirSync(dir).filter((c) => args.includes("--all") || c !== "CASE-001");
const api = `http://localhost:${config.port}/api`;

const confirmed: string[] = [];
for (const c of cases) {
  const file = path.join(dir, c, `${c}_AWB.pdf`);
  const result = await extractAwb(new Uint8Array(fs.readFileSync(file)), path.basename(file));
  const saved = await confirmShipment(result.fields, DEMO_USERS.owner.name, path.basename(file));
  confirmed.push(saved.awbNo);
  console.log(`${c}: ${saved.awbNo} ${saved.created ? "created" : "updated"} (${result.method}${result.flaggedFields.length ? `, flagged ${result.flaggedFields.join(", ")}` : ""})`);
}

if (!args.includes("--no-investigate")) {
  const up = await fetch(`${api.replace("/api", "")}/health`, { signal: AbortSignal.timeout(3000) }).then((r) => r.ok).catch(() => false);
  if (!up) {
    console.log("\nBackend is not running, so no investigations were started. Start it (npm run dev), then click Re-investigate on each shipment, or run this script again.");
  } else {
    for (const awb of confirmed) {
      await fetch(`${api}/shipments/${awb}/investigate`, { method: "POST", headers: { "x-demo-user": "owner" } });
    }
    console.log(`\nStarted ${confirmed.length} investigations. Cases appear on the dashboard over the next few minutes (the clean shipment opens no case).`);
  }
}
process.exit(0);
