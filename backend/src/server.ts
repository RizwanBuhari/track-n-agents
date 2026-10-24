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
