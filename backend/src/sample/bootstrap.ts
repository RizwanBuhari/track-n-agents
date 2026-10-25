// Sample mode start-up. On a fresh sample database, confirms the 8 demo
// shipments (the fields Nemotron extracted in the live demo, as checked by
// the case owner; sample/shipments.json) and starts an investigation for
// each one, exactly as confirming an upload does. `npm run sample --
// --no-investigate` skips the investigations (as load:demo does), which is
// the starting point `npm run scenarios` expects.

import fs from "node:fs";
import path from "node:path";
import { backendRoot } from "../config.ts";
import { investigateShipment } from "../agents/coordinator.ts";
import { ops } from "../lib/db.ts";
import { confirmShipment, type ShipmentFields } from "../services/shipments.ts";
import { DEMO_USERS } from "../services/users.ts";

export async function bootstrapSample(): Promise<void> {
  const { rows } = await ops.query("SELECT count(*)::int AS n FROM shipments");
  if (rows[0].n > 0) {
    console.log(`Sample mode: ${rows[0].n} shipments already loaded (stop the backend and run npm run sample:reset to start over)`);
    return;
  }
  const demo: { sourceFile: string; fields: ShipmentFields }[] = JSON.parse(fs.readFileSync(path.join(backendRoot, "sample", "shipments.json"), "utf-8"));
  const owner = DEMO_USERS.owner.name;
  const awbs: string[] = [];
  for (const s of demo) awbs.push((await confirmShipment(s.fields, owner, s.sourceFile)).awbNo);
  if (process.argv.includes("--no-investigate")) {
    console.log(`Sample mode: ${awbs.length} demo shipments loaded (no investigations started)`);
    return;
  }
  console.log(`Sample mode: ${awbs.length} demo shipments loaded; investigations are running (watch the dashboard)`);
  for (const awb of awbs) {
    investigateShipment(awb, owner, "sample mode start-up").catch((err) => console.error(`investigate ${awb}:`, err));
  }
}
