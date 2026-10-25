// Starts the backend in sample mode: no Docker, Zetaris, databases,
// Nightshift or .env needed. `npm run sample`, then start the dashboard.
// The flag is set here, before anything reads the config, so it works the
// same on Windows, macOS and Linux.

process.env.SAMPLE_MODE = "true";
await import("../src/server.ts");
