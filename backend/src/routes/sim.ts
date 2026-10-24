import { Router } from "express";
import { carrierApi, customsApi } from "../sim/systems.ts";

// Public read endpoints of the simulated external systems. Zetaris
// registers these as REST tables (trackn_carrier / trackn_customs).
export const simApiRouter = Router();

simApiRouter.get("/carrier/events", (_req, res) => {
  res.json(carrierApi.events());
});

simApiRouter.get("/customs/entries", (_req, res) => {
  res.json(customsApi.entries());
});
