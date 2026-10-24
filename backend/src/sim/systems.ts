// The simulated carrier tracking API and customs broker portal. Both are
// external systems as far as the agents are concerned: Zetaris registers
// their HTTP endpoints as REST tables and the agents query them with SQL.
// Clearly labelled as simulated everywhere they are shown.

import fs from "node:fs";
import path from "node:path";
import { config } from "../config.ts";
import { seedCarrierEvents, seedCustomsEntries, type CarrierEvent, type CustomsEntry } from "./seed.ts";

const dir = path.join(config.dataDir, "sim");
fs.mkdirSync(dir, { recursive: true });

function load<T>(name: string, seed: T[]): T[] {
  const file = path.join(dir, `${name}.json`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(seed, null, 2));
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

function save(name: string, rows: unknown[]) {
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(rows, null, 2));
}

let carrier = load<CarrierEvent>("carrier", seedCarrierEvents);
let customs = load<CustomsEntry>("customs", seedCustomsEntries);

export const carrierApi = {
  events: () => carrier,
  add(event: Omit<CarrierEvent, "event_id">): CarrierEvent {
    const n = carrier.filter((e) => e.awb_no === event.awb_no).length + 1;
    const row = { ...event, event_id: `${event.awb_no.replace("-", "")}-${String(n).padStart(2, "0")}` };
    carrier.push(row);
    save("carrier", carrier);
    return row;
  },
};

export const customsApi = {
  entries: () => customs,
  update(entryNo: string, patch: Partial<CustomsEntry>): CustomsEntry | undefined {
    const row = customs.find((c) => c.entry_no === entryNo);
    if (!row) return undefined;
    Object.assign(row, patch);
    save("customs", customs);
    return row;
  },
  findByAwbDigits(digits: string): CustomsEntry | undefined {
    return customs.find((c) => c.awb_reference.replace(/\D/g, "") === digits);
  },
};

export function resetSimSystems() {
  carrier = structuredClone(seedCarrierEvents);
  customs = structuredClone(seedCustomsEntries);
  save("carrier", carrier);
  save("customs", customs);
}
