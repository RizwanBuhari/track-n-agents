// Demo bootstrap: runs the real AWB extraction on the demo AWB PDFs and
// confirms them as the demo case owner, as if each had been uploaded and
// checked on the Upload page. CASE-001 is left out by default so it can be
// uploaded live in the demo; pass --all to include it.
//   npx tsx scripts/loadDemoShipments.ts [--all] [CASE-003 ...]

import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "../src/config.ts";
import { extractAwb } from "../src/extraction/extractAwb.ts";
import { confirmShipment } from "../src/services/shipments.ts";
import { DEMO_USERS } from "../src/services/users.ts";

const args = process.argv.slice(2);
const dir = path.join(repoRoot, "demo-data", "cases");
const named = args.filter((a) => a.startsWith("CASE-"));
const cases = named.length ? named : fs.readdirSync(dir).filter((c) => args.includes("--all") || c !== "CASE-001");

for (const c of cases) {
  const file = path.join(dir, c, `${c}_AWB.pdf`);
  const result = await extractAwb(new Uint8Array(fs.readFileSync(file)), path.basename(file));
  const saved = await confirmShipment(result.fields, DEMO_USERS.owner.name, path.basename(file));
  console.log(`${c}: ${saved.awbNo} ${saved.created ? "created" : "updated"} (${result.method}${result.flaggedFields.length ? `, flagged ${result.flaggedFields.join(", ")}` : ""})`);
}
process.exit(0);
