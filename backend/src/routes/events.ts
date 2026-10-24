// Server-sent events: live agent steps and World Model events, so the
// dashboard shows agents working without polling.
import type { Request, Response } from "express";
import { onTraceStep } from "../lib/trace.ts";
import { world } from "../state/caseState.ts";

const clients = new Set<Response>();

export function broadcast(type: string, data: unknown) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}

onTraceStep((step) => broadcast("step", step));
world.subscribeEvents((e) => {
  const p = e.payload as { id?: string; about?: string; predicate?: string; value?: unknown; from?: string; type?: string; to?: string };
  broadcast("world", { seq: e.seq, kind: e.kind, at: e.at, id: p.id, about: p.about, predicate: p.predicate, value: p.predicate === "status" ? p.value : undefined, from: p.from, to: p.to, type: p.type });
});

export function eventsHandler(req: Request, res: Response) {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.flushHeaders();
  res.write("event: hello\ndata: {}\n\n");
  clients.add(res);
  const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
  req.on("close", () => {
    clearInterval(ping);
    clients.delete(res);
  });
}
