// AWB extraction. Text PDFs: the text layer is read locally and Nemotron
// maps it to fields. Scanned PDFs (no text layer): the page image goes to
// a vision lane in Nightshift if one is configured; otherwise every field
// is flagged for the person to fill in. A person always confirms before
// anything is saved.

import { extractImages, extractText, getDocumentProxy } from "unpdf";
import { PNG } from "pngjs";
import { chat, chatJson, LlmError, parseJsonReply } from "../lib/llm.ts";
import { awbCheckDigitValid, canonicalAwb } from "../lib/refs.ts";
import { record } from "../lib/trace.ts";
import type { ShipmentFields } from "../services/shipments.ts";

export type Extraction = {
  fields: ShipmentFields;
  flaggedFields: string[];
  confidence: number;
  notes: string;
  method: "text+nemotron" | "vision" | "manual";
  model?: string;
};

const FIELD_NAMES: (keyof ShipmentFields)[] = [
  "awbNumber", "carrier", "origin", "destination", "flightNumber", "flightDate", "shipper", "consignee", "agent",
  "cargoDescription", "pieces", "weightKg", "chargeableWeightKg", "hsCode", "declaredValue", "currency", "invoiceRef",
];

const SYSTEM = `You read air waybills (AWB) for an air freight operations team and return the shipment facts exactly as printed.
Layouts vary between carriers, so find each value by its printed label, not its position.
- awbNumber: the master AWB number as "PPP-SSSSSSSS" (3-digit airline prefix, 8-digit serial).
- carrier: the issuing carrier (airline). agent: the issuing carrier's agent / forwarder name.
- origin, destination: 3-letter IATA airport codes from "Airport of Departure" and "Airport of Destination" (a transit "To" box is not the destination).
- flightNumber like "DW 512"; flightDate as YYYY-MM-DD (from "Requested Flight/Date", not the "Executed on" date).
- shipper, consignee: company names only (no address).
- cargoDescription: nature and quantity of goods.
- pieces: integer. weightKg: gross weight in kg (number). chargeableWeightKg: chargeable weight (number).
- hsCode: HS code if printed. declaredValue + currency: "Declared Value for Customs".
- invoiceRef: the commercial invoice number if the handling information names one.
Use "" or null when a value is not printed. Never invent a value.
flaggedFields: names of fields you are unsure about. confidence: 0..1.
Return JSON: {"fields": {${FIELD_NAMES.map((f) => `"${f}": ...`).join(", ")}}, "flaggedFields": [], "confidence": 0.0, "notes": ""}`;

function emptyFields(): ShipmentFields {
  return {
    awbNumber: "", carrier: "", origin: "", destination: "", flightNumber: "", flightDate: "", shipper: "", consignee: "", agent: "",
    cargoDescription: "", pieces: null, weightKg: null, chargeableWeightKg: null, hsCode: "", declaredValue: null, currency: "", invoiceRef: "",
  };
}

function normalize(raw: Partial<ShipmentFields>): ShipmentFields {
  const f = emptyFields();
  for (const k of FIELD_NAMES) if (raw[k] !== undefined && raw[k] !== null) (f as Record<string, unknown>)[k] = raw[k];
  const n = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(String(v).replace(/[^0-9.]/g, "")) || null);
  f.pieces = n(f.pieces) === null ? null : Math.round(n(f.pieces)!);
  f.weightKg = n(f.weightKg);
  f.chargeableWeightKg = n(f.chargeableWeightKg);
  f.declaredValue = n(f.declaredValue);
  for (const k of FIELD_NAMES) if (typeof f[k] !== "number" && f[k] !== null) (f as Record<string, unknown>)[k] = String(f[k]).trim();
  f.awbNumber = canonicalAwb(f.awbNumber) ?? f.awbNumber;
  f.flightNumber = f.flightNumber.toUpperCase().replace(/^([A-Z0-9]{2})\s*(\d{1,4})$/, "$1 $2");
  // "SEOUL INCHEON (ICN)" -> "ICN"
  const iata = (v: string) => v.toUpperCase().match(/\(([A-Z]{3})\)/)?.[1] ?? (v.toUpperCase().match(/^[A-Z]{3}$/) ? v.toUpperCase() : v.toUpperCase());
  f.origin = iata(f.origin);
  f.destination = iata(f.destination);
  // The packaging line ("18 CARTONS") is not part of the goods description.
  f.cargoDescription = f.cargoDescription.replace(/[\s,;]+\d+\s+(CARTONS?|PACKAGES?|CTNS?|PALLETS?)\s*$/i, "").trim();
  return f;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** Deterministic cross-checks on top of the model's own flags. */
function crossCheck(fields: ShipmentFields, text: string, flagged: Set<string>, notes: string[]) {
  if (!canonicalAwb(fields.awbNumber)) {
    flagged.add("awbNumber");
    notes.push("AWB number is not 11 digits.");
  } else if (!awbCheckDigitValid(fields.awbNumber)) {
    flagged.add("awbNumber");
    notes.push("AWB check digit fails: probably a misread digit.");
  } else if (text && !text.replace(/\D/g, "").includes(fields.awbNumber.replace(/\D/g, ""))) {
    flagged.add("awbNumber");
    notes.push("AWB number not found verbatim in the document text.");
  }
  if (fields.weightKg !== null && fields.chargeableWeightKg !== null && fields.chargeableWeightKg < fields.weightKg) {
    flagged.add("chargeableWeightKg");
    notes.push("Chargeable weight is below gross weight.");
  }
  for (const k of ["origin", "destination"] as const) {
    if (!fields[k] || /^[A-Z]{3}$/.test(fields[k])) continue;
    // The model gave an airport name: take the IATA code printed next to it, e.g. "STOCKHOLM ARLANDA (ARN)".
    const name = fields[k].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const printed = text.toUpperCase().match(new RegExp(`${name}\\s*\\(([A-Z]{3})\\)`));
    if (printed) {
      notes.push(`${k === "origin" ? "Origin" : "Destination"} "${fields[k]}" read as ${printed[1]}.`);
      fields[k] = printed[1];
    } else {
      flagged.add(k);
    }
  }
  // IATA "Requested Flight/Date" is printed like DW512/10OCT26: parse it ourselves and correct the model.
  const m = text.toUpperCase().match(/\b([A-Z0-9]{2})\s?(\d{1,4})\s*\/\s*(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2})\b/);
  if (m) {
    const printed = `20${m[5]}-${String(MONTHS.indexOf(m[4]) + 1).padStart(2, "0")}-${m[3]}`;
    if (fields.flightDate !== printed) {
      notes.push(`Flight date corrected from ${fields.flightDate || "blank"} to ${printed} (printed ${m[3]}${m[4]}${m[5]}).`);
      fields.flightDate = printed;
      flagged.add("flightDate");
    }
    const printedFlight = `${m[1]} ${m[2]}`;
    if (!fields.flightNumber) fields.flightNumber = printedFlight;
  }
}

export async function extractAwb(data: Uint8Array, fileName: string): Promise<Extraction> {
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const { text } = await extractText(pdf, { mergePages: true });
  const plain = String(text).replace(/[ \t]+/g, " ").trim();
  record("tool", `Read PDF text layer of ${fileName}`, { chars: plain.length });

  if (plain.length > 150) {
    const reply = await chatJson<{ fields: Partial<ShipmentFields>; flaggedFields?: string[]; confidence?: number; notes?: string }>({
      purpose: "Extract AWB fields",
      model: "fast",
      system: SYSTEM,
      user: `AWB text (from ${fileName}):\n${plain.slice(0, 6000)}`,
      maxTokens: 1200,
      validate: (v) => (v && (typeof v.fields === "object" || "awbNumber" in v) ? null : 'wrap the values as {"fields": {...}}'),
    });
    const fields = normalize(reply.fields ?? (reply as Partial<ShipmentFields>));
    const flagged = new Set(reply.flaggedFields ?? []);
    const notes = reply.notes ? [reply.notes] : [];
    crossCheck(fields, plain, flagged, notes);
    return { fields, flaggedFields: [...flagged], confidence: reply.confidence ?? 0.8, notes: notes.join(" "), method: "text+nemotron" };
  }

  // Scanned: no text layer. Try a vision lane.
  try {
    const images = await extractImages(pdf, 1);
    const img = images.sort((a, b) => b.width * b.height - a.width * a.height)[0];
    if (!img) throw new Error("no page image found");
    const png = new PNG({ width: img.width, height: img.height });
    const c = img.channels;
    for (let p = 0, q = 0; p < img.width * img.height; p++) {
      png.data[q++] = img.data[p * c];
      png.data[q++] = img.data[p * c + (c >= 3 ? 1 : 0)];
      png.data[q++] = img.data[p * c + (c >= 3 ? 2 : 0)];
      png.data[q++] = 255;
    }
    const b64 = PNG.sync.write(png).toString("base64");
    const result = await chat({
      purpose: "Read scanned AWB (vision)",
      model: "vision",
      maxTokens: 1200,
      messages: [
        { role: "system", content: SYSTEM + "\nReply with one JSON object only." },
        { role: "user", content: [{ type: "text", text: `Scanned AWB ${fileName}.` }, { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } }] },
      ],
    });
    const reply = parseJsonReply<{ fields: Partial<ShipmentFields>; flaggedFields?: string[]; confidence?: number; notes?: string }>(result.text);
    const fields = normalize(reply.fields);
    const flagged = new Set(reply.flaggedFields ?? []);
    const notes = ["Read from a scanned image: check every field.", ...(reply.notes ? [reply.notes] : [])];
    crossCheck(fields, "", flagged, notes);
    return { fields, flaggedFields: [...flagged], confidence: Math.min(reply.confidence ?? 0.6, 0.7), notes: notes.join(" "), method: "vision", model: result.model };
  } catch (err) {
    const reason = err instanceof LlmError ? "no vision lane is available in Nightshift" : (err as Error).message;
    record("decision", `Scanned document could not be read automatically (${reason}); asking a person to enter the fields`);
    return {
      fields: emptyFields(),
      flaggedFields: [...FIELD_NAMES],
      confidence: 0,
      notes: `This is a scanned document with no text layer and ${reason}. Please type the fields from the document shown on the left.`,
      method: "manual",
    };
  }
}
