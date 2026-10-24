// Demo clock (Team Demo Rules). Real time plus an offset the
// operator can advance from the dashboard, so reminder and escalation
// timers can be shown in a short demo. Persisted so restarts keep it.

import fs from "node:fs";
import path from "node:path";
import { config } from "../config.ts";

const file = path.join(config.dataDir, "clock.json");
fs.mkdirSync(config.dataDir, { recursive: true });

let offsetMs = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf-8")).offsetMs ?? 0 : 0;

export const clock = {
  now(): Date {
    return new Date(Date.now() + offsetMs);
  },
  advanceHours(hours: number): Date {
    offsetMs += hours * 3_600_000;
    fs.writeFileSync(file, JSON.stringify({ offsetMs }));
    return clock.now();
  },
  offsetHours(): number {
    return offsetMs / 3_600_000;
  },
  reset(): void {
    offsetMs = 0;
    fs.writeFileSync(file, JSON.stringify({ offsetMs }));
  },
};

export function addHours(iso: string, hours: number): string {
  return new Date(new Date(iso).getTime() + hours * 3_600_000).toISOString();
}
