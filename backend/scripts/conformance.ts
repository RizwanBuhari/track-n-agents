// Runs the official Meterless World Model conformance suite against the
// engine Track-N uses at runtime (src/engines/world-model/index.ts).
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const impl = path.resolve(here, "..", "src", "engines", "world-model", "index.ts").split(path.sep).join("/");
const runner = path.join(here, "worldModelConformanceRunner.ts");
const result = spawnSync(process.execPath, ["--import", "tsx", runner], {
  stdio: "inherit",
  env: { ...process.env, WORLD_MODEL_IMPL: impl },
});
process.exit(result.status ?? 1);
