import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
export const backendRoot = path.resolve(here, "..");
export const repoRoot = path.resolve(backendRoot, "..");

dotenv.config({ path: path.join(repoRoot, ".env"), quiet: true });

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") throw new Error(`${name} is missing from .env (see .env.example)`);
  return value;
}

// Sample mode (`npm run sample`): no Zetaris, databases or Nightshift. Reads and
// writes go to an embedded Postgres seeded from infra/, model calls take the
// agents' rule-based paths, and state lives apart from the live demo's.
const sampleMode = process.env.SAMPLE_MODE === "true";

export const config = {
  port: Number(process.env.PORT ?? 4100),
  sampleMode,
  dataDir: path.join(backendRoot, "data", ...(sampleMode ? ["sample"] : [])),
  // Address the Zetaris driver container uses to reach the simulated
  // carrier and customs APIs served by this backend.
  zetarisCallbackBase: process.env.ZETARIS_CALLBACK_BASE ?? "http://host.docker.internal:4100",
  zetaris: {
    restUrl: env("ZETARIS_REST_URL", "http://localhost:8888/api/v1.0"),
    orgId: env("ZETARIS_ORG_ID", "1"),
    apiKey: () => env("ZETARIS_API_KEY"),
  },
  meterless: {
    baseUrl: env("METERLESS_BASE_URL", "http://127.0.0.1:8088/v1"),
    token: () => env("METERLESS_RUNTIME_TOKEN"),
    // Pinned Nemotron lanes so every agent request is served by NVIDIA Nemotron.
    fastModel: process.env.METERLESS_FAST_MODEL ?? process.env.METERLESS_MODEL ?? "nvidia/nemotron-3.5-lightning-30b-a3b",
    deepModel: process.env.METERLESS_DEEP_MODEL ?? "nvidia/nemotron-3-ultra-550b-a55b",
    visionModel: process.env.METERLESS_VISION_MODEL ?? "meterless/vision",
    app: "track-n",
  },
  opsDbUrl: env("OPS_DB_URL", "postgres://trackn:trackn_local_only@127.0.0.1:5433/trackn_ops"),
  financeDbUrl: env("FINANCE_DB_URL", "mysql://trackn:trackn_local_only@127.0.0.1:3307/trackn_finance"),
  limits: {
    stepsPerRun: 25,
    reminders: 2,
    wrongDocuments: 2,
    sendBacks: 3,
  },
};
