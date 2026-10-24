// Confirming an uploaded AWB writes the shipment into the operations
// database (the system of record). Duplicate uploads of the same AWB
// update the same row instead of creating a second shipment.

import { ops } from "../lib/db.ts";
import { canonicalAwb } from "../lib/refs.ts";

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

export async function confirmShipment(f: ShipmentFields, owner: string, sourceFile: string): Promise<{ awbNo: string; created: boolean }> {
  const awbNo = canonicalAwb(f.awbNumber);
  if (!awbNo) throw new Error(`"${f.awbNumber}" is not an 11-digit air waybill number`);
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
