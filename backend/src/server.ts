import express from "express";
import cors from "cors";
import { config } from "./config.ts";
import { tick } from "./agents/coordinator.ts";
import { api } from "./routes/api.ts";
import { eventsHandler } from "./routes/events.ts";
import { simApiRouter } from "./routes/sim.ts";

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

// The backend has no UI of its own; point people opening it in a browser to the dashboard.
app.get("/", (_req, res) => {
  res.type("html").send(`<!doctype html><meta charset="utf-8"><title>Track-N backend</title>
<body style="font-family:system-ui,sans-serif;max-width:560px;margin:60px auto;line-height:1.6;color:#1b2233">
<h2>Track-N backend is running</h2>
<p>This is the API server. Open the dashboard instead: <a href="http://localhost:5173">http://localhost:5173</a>
(start it with <code>cd dashboard</code> and <code>npm run dev</code>; Vite prints the port if 5173 is taken).</p>
<p>Checks: <a href="/health">/health</a> · <a href="/api/integrations">/api/integrations</a> · or run <code>npm run doctor</code> in <code>backend/</code>.</p>
</body>`);
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});
// Simulated external systems (carrier tracking API, customs broker portal).
app.use("/sim", simApiRouter);
app.get("/api/events", eventsHandler);
app.use("/api", api);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(400).json({ error: err.message });
});

app.listen(config.port, () => {
  console.log(`Track-N backend on http://localhost:${config.port}`);
});

// Reminder / escalation timers on the demo clock.
setInterval(() => {
  tick().catch((err) => console.error("tick:", err));
}, 30_000);
