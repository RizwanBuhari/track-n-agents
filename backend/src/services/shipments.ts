// Confirming an uploaded AWB writes the shipment into the operations
// database (the system of record). Duplicate uploads of the same AWB
// update the same row instead of creating a second shipment.

import { ops } from "../lib/db.ts";
import { awbCheckDigitValid, canonicalAwb } from "../lib/refs.ts";

export type ShipmentFields = {
  awbNumber: string;
  carrier: string;
  origin: string;
  destination: string;
  flightNumber: string;
  flightDate: string;
  shipper: string;
  consignee: string;
  agent: string;
  cargoDescription: string;
  pieces: number | null;
  weightKg: number | null;
  chargeableWeightKg: number | null;
  hsCode: string;
  declaredValue: number | null;
  currency: string;
  invoiceRef: string;
};

/**
 * Fields a shipment cannot be tracked or investigated without. The rest
 * (flight, agent, HS code, value, invoice reference...) may be blank when
 * the document does not show them. The Upload page applies the same rules.
 */
export function missingRequired(f: Partial<ShipmentFields>): string[] {
  const problems: string[] = [];
  const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === "";
  if (!canonicalAwb(f.awbNumber)) problems.push("AWB number (11 digits)");
  else if (!awbCheckDigitValid(f.awbNumber)) problems.push("AWB number (check digit fails: re-check the number)");
  if (blank(f.carrier)) problems.push("carrier");
  for (const [k, label] of [["origin", "origin"], ["destination", "destination"]] as const) {
    if (!/^[A-Z]{3}$/.test(String(f[k] ?? "").trim().toUpperCase())) problems.push(`${label} (3-letter airport code)`);
  }
  if (blank(f.shipper)) problems.push("shipper");
  if (blank(f.consignee)) problems.push("consignee");
  if (blank(f.cargoDescription)) problems.push("goods");
  if (!(Number(f.pieces) > 0) || !Number.isInteger(Number(f.pieces))) problems.push("pieces (whole number)");
  if (!(Number(f.weightKg) > 0)) problems.push("gross weight (kg)");
  if (!blank(f.flightDate) && !/^\d{4}-\d{2}-\d{2}$/.test(String(f.flightDate))) problems.push("flight date (YYYY-MM-DD, or leave blank)");
  return problems;
}

export async function confirmShipment(f: ShipmentFields, owner: string, sourceFile: string): Promise<{ awbNo: string; created: boolean }> {
  const missing = missingRequired(f);
  if (missing.length) throw new Error(`Please complete before confirming: ${missing.join(", ")}`);
  const awbNo = canonicalAwb(f.awbNumber)!;
  f = { ...f, origin: f.origin.trim().toUpperCase(), destination: f.destination.trim().toUpperCase() };
  const existing = await ops.query("SELECT 1 FROM shipments WHERE awb_no = $1", [awbNo]);
  await ops.query(
    `INSERT INTO shipments (awb_no, carrier, origin, destination, flight_no, flight_date, shipper, consignee, agent, goods, pieces,
       gross_weight_kg, chargeable_weight_kg, hs_code, declared_value, currency, invoice_ref, owner, source_file)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     ON CONFLICT (awb_no) DO UPDATE SET carrier=EXCLUDED.carrier, origin=EXCLUDED.origin, destination=EXCLUDED.destination,
       flight_no=EXCLUDED.flight_no, flight_date=EXCLUDED.flight_date, shipper=EXCLUDED.shipper, consignee=EXCLUDED.consignee,
       agent=EXCLUDED.agent, goods=EXCLUDED.goods, pieces=EXCLUDED.pieces, gross_weight_kg=EXCLUDED.gross_weight_kg,
       chargeable_weight_kg=EXCLUDED.chargeable_weight_kg, hs_code=EXCLUDED.hs_code, declared_value=EXCLUDED.declared_value,
       currency=EXCLUDED.currency, invoice_ref=EXCLUDED.invoice_ref, source_file=EXCLUDED.source_file`,
    [
      awbNo, f.carrier, f.origin, f.destination, f.flightNumber, /^\d{4}-\d{2}-\d{2}$/.test(f.flightDate) ? f.flightDate : null,
      f.shipper, f.consignee, f.agent, f.cargoDescription, f.pieces, f.weightKg, f.chargeableWeightKg, f.hsCode || null,
      f.declaredValue, f.currency || null, f.invoiceRef || null, owner, sourceFile,
    ],
  );
  return { awbNo, created: existing.rowCount === 0 };
}

export async function listShipments() {
  const { rows } = await ops.query("SELECT * FROM shipments ORDER BY confirmed_at DESC");
  return rows;
}

export async function getShipment(awbNo: string) {
  const { rows } = await ops.query("SELECT * FROM shipments WHERE awb_no = $1", [awbNo]);
  return rows[0] ?? null;
}

export async function setTrackingStatus(awbNo: string, status: string) {
  await ops.query("UPDATE shipments SET tracking_status = $2 WHERE awb_no = $1", [awbNo, status]);
}
