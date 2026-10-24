// Starting state of the two simulated external systems, transcribed from
// demo case pack's tracking printouts and customs notices (fictional data).
// CASE-006 has no customs notice in the pack; its entry is derived from
// the "customs hold: weight differs" tracking event.

export type CarrierEvent = {
  event_id: string;
  awb_no: string;
  carrier: string;
  event_time: string;
  code: string;
  description: string;
  location: string;
  flight: string | null;
};

export type CustomsEntry = {
  entry_no: string;
  awb_reference: string;
  importer: string;
  port: string;
  documents_received: string;
  documents_missing: string;
  status: string;
  remarks: string;
  release_ref: string | null;
  status_at: string;
  updated_by: string;
};

const DW = "Desert Wing Cargo";
const GA = "Gulf Arrow Airlines";

function ev(awb: string, carrier: string, rows: [string, string, string, string, string?][]): CarrierEvent[] {
  return rows.map(([time, code, description, location, flight], i) => ({
    event_id: `${awb.replace("-", "")}-${String(i + 1).padStart(2, "0")}`,
    awb_no: awb,
    carrier,
    event_time: `${time}:00+04:00`,
    code,
    description,
    location,
    flight: flight ?? null,
  }));
}

export const seedCarrierEvents: CarrierEvent[] = [
  ...ev("901-44173021", DW, [
    ["2026-10-10T16:20", "RCS", "Received from shipper", "PVG"],
    ["2026-10-11T01:45", "DEP", "Departed on DW 512", "PVG", "DW 512"],
    ["2026-10-11T07:10", "ARR", "Arrived", "DXB", "DW 512"],
    ["2026-10-11T09:30", "RCF", "Received from flight", "DXB", "DW 512"],
    ["2026-10-12T08:05", "HLD", "Customs hold: documents incomplete", "DXB"],
  ]),
  ...ev("901-51288462", DW, [
    ["2026-10-08T13:00", "RCS", "Received from shipper", "FRA"],
    ["2026-10-09T10:15", "DEP", "Departed on DW 207", "FRA", "DW 207"],
    ["2026-10-09T19:40", "ARR", "Arrived", "DXB", "DW 207"],
    ["2026-10-10T09:20", "HLD", "Customs hold: invoice does not match shipment", "DXB"],
  ]),
  ...ev("902-33904150", GA, [
    ["2026-10-12T18:00", "RCS", "Received from shipper", "BOM"],
    ["2026-10-13T02:10", "MAN", "Manifested on GA 418", "BOM", "GA 418"],
    ["2026-10-13T03:05", "OFLD", "Offloaded from GA 418: capacity", "BOM", "GA 418"],
    ["2026-10-13T06:40", "BKD", "Rebooked on GA 422, 2026-10-14", "BOM", "GA 422"],
  ]),
  ...ev("901-60217791", DW, [
    ["2026-10-06T15:30", "RCS", "Received from shipper", "IST"],
    ["2026-10-07T08:20", "DEP", "Departed on DW 331", "IST", "DW 331"],
    ["2026-10-07T13:05", "ARR", "Arrived", "DXB", "DW 331"],
    ["2026-10-08T10:00", "NFD", "Consignee notified for collection", "DXB"],
    ["2026-10-09T11:45", "DLV", "Delivered", "DXB"],
  ]),
  ...ev("902-71844205", GA, [
    ["2026-10-11T20:15", "RCS", "Received from shipper", "ICN"],
    ["2026-10-12T00:40", "DEP", "Departed on GA 905", "ICN", "GA 905"],
    ["2026-10-12T05:55", "ARR", "Arrived", "DXB", "GA 905"],
    ["2026-10-12T14:30", "HLD", "Customs hold: classification query", "DXB"],
  ]),
  ...ev("901-28755311", DW, [
    ["2026-10-09T11:00", "RCS", "Received from shipper", "MXP"],
    ["2026-10-09T12:35", "DIS", "Weight discrepancy noted at acceptance", "MXP"],
    ["2026-10-10T09:50", "DEP", "Departed on DW 118", "MXP", "DW 118"],
    ["2026-10-10T18:25", "ARR", "Arrived", "DXB", "DW 118"],
    ["2026-10-11T08:40", "HLD", "Customs hold: weight differs from packing list", "DXB"],
  ]),
  ...ev("902-83401765", GA, [
    ["2026-10-07T09:10", "RCS", "Received from shipper", "MEL"],
    ["2026-10-08T22:30", "DEP", "Departed on GA 640", "MEL", "GA 640"],
    ["2026-10-09T06:15", "ARR", "Arrived", "DXB", "GA 640"],
    ["2026-10-09T13:00", "HLD", "Customs hold: certificate of origin required", "DXB"],
  ]),
  ...ev("902-19588030", GA, [
    ["2026-10-05T14:00", "RCS", "Received from shipper", "ARN"],
    ["2026-10-06T07:30", "DEP", "Departed on GA 271", "ARN", "GA 271"],
    ["2026-10-06T16:10", "ARR", "Arrived", "AUH", "GA 271"],
    ["2026-10-07T10:20", "CLR", "Customs cleared", "AUH"],
    ["2026-10-08T09:15", "DLV", "Delivered", "AUH"],
  ]),
];

const broker = "Gulf Clear Customs Brokers LLC";

export const seedCustomsEntries: CustomsEntry[] = [
  { entry_no: "DXB-ENT-778201", awb_reference: "901 4417 3021", importer: "ORION ELECTRONICS F.Z.E.", port: "DXB", documents_received: "Air waybill; Packing list", documents_missing: "Commercial invoice", status: "HELD", remarks: "Clearance cannot proceed until the commercial invoice is submitted.", release_ref: null, status_at: "2026-10-12T08:05:00+04:00", updated_by: broker },
  { entry_no: "DXB-ENT-778645", awb_reference: "901 5128 8462", importer: "Blue Dune Trdg L.L.C", port: "DXB", documents_received: "Air waybill; Commercial invoice RPV-2026-4471; Packing list", documents_missing: "Commercial invoice matching this AWB", status: "HELD", remarks: "Invoice RPV-2026-4471 quotes a different air waybill number. Please submit a corrected invoice.", release_ref: null, status_at: "2026-10-10T09:20:00+04:00", updated_by: broker },
  { entry_no: "DXB-ENT-779010", awb_reference: "901 6021 7791", importer: "Crescent Health Care Distributors", port: "DXB", documents_received: "Air waybill; Commercial invoice; Packing list", documents_missing: "None", status: "HELD FOR INSPECTION", remarks: "Shipment selected for physical inspection. Not released.", release_ref: null, status_at: "2026-10-10T09:00:00+04:00", updated_by: broker },
  { entry_no: "DXB-ENT-778930", awb_reference: "902 7184 4205", importer: "Falcon Retail L.L.C.", port: "DXB", documents_received: "Air waybill; Commercial invoice; Packing list", documents_missing: "Corrected commercial invoice", status: "HELD", remarks: "Declared HS code 610910 (cotton T-shirts) does not match goods described as smartphones.", release_ref: null, status_at: "2026-10-12T14:30:00+04:00", updated_by: broker },
  { entry_no: "DXB-ENT-778700", awb_reference: "901 2875 5311", importer: "PALM INTERIORS", port: "DXB", documents_received: "Air waybill; Commercial invoice; Packing list", documents_missing: "Weight reconciliation", status: "HELD", remarks: "Gross weight on the air waybill differs from the packing list.", release_ref: null, status_at: "2026-10-11T08:40:00+04:00", updated_by: broker },
  { entry_no: "DXB-ENT-778512", awb_reference: "902 8340 1765", importer: "Oasis Fresh Foodstuff Trdg", port: "DXB", documents_received: "Air waybill; Commercial invoice; Packing list", documents_missing: "Certificate of origin", status: "HELD", remarks: "Preferential duty claimed. A valid certificate of origin is required, or the goods will be assessed at the standard rate.", release_ref: null, status_at: "2026-10-09T13:00:00+04:00", updated_by: broker },
  { entry_no: "AUH-ENT-552190", awb_reference: "902 1958 8030", importer: "Sahara Water Systems L.L.C.", port: "AUH", documents_received: "Air waybill; Commercial invoice; Packing list", documents_missing: "None", status: "CLEARED", remarks: "Cleared and released on 2026-10-07 10:20.", release_ref: "AUH-REL-552190", status_at: "2026-10-07T10:20:00+04:00", updated_by: broker },
];
