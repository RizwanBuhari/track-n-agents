// Resets sample mode to its starting point: deletes the sample database,
// cases, traces and simulator state. STOP THE SAMPLE BACKEND FIRST.
// Live demo data is not touched.

process.env.SAMPLE_MODE = "true";
const fs = await import("node:fs");
const path = await import("node:path");
const { config } = await import("../src/config.ts");

if (path.basename(config.dataDir) !== "sample") throw new Error(`Refusing to delete ${config.dataDir}: not the sample data directory`);
fs.rmSync(config.dataDir, { recursive: true, force: true });
console.log(`Sample mode reset (${config.dataDir} removed). Start it again with npm run sample.`);
