// Shipment reference matching ("Matching References" operating rule): ignore
// spaces and hyphens, and validate the AWB check digit before calling
// anything a mismatch. A formatting difference alone never opens a case.

export function digitsOnly(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

/** Canonical AWB form "PPP-SSSSSSSS", or null if it is not 11 digits. */
export function canonicalAwb(value: string | null | undefined): string | null {
  const d = digitsOnly(value);
  if (d.length !== 11) return null;
  return `${d.slice(0, 3)}-${d.slice(3)}`;
}

/** IATA rule: the last digit of the 8-digit serial is the first 7 digits mod 7. */
export function awbCheckDigitValid(value: string | null | undefined): boolean {
  const d = digitsOnly(value);
  if (d.length !== 11) return false;
  const serial = d.slice(3);
  return Number(serial.slice(0, 7)) % 7 === Number(serial[7]);
}

export function sameAwb(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = digitsOnly(a);
  return da.length === 11 && da === digitsOnly(b);
}

/** Loose company-name comparison so "Blue Dune Trdg L.L.C" matches "Blue Dune Trading LLC". */
export function normalizeCompany(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/\btrdg\b/g, "trading")
    .replace(/\bl\.?\s?l\.?\s?c\.?\b/g, "llc")
    .replace(/\bf\.?\s?z\.?\s?e\.?\b/g, "fze")
    .replace(/health\s+care/g, "healthcare")
    .replace(/[^a-z0-9]/g, "");
}

export function similarCompany(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeCompany(a);
  const nb = normalizeCompany(b);
  if (!na || !nb) return false;
  if (na === nb || na.startsWith(nb) || nb.startsWith(na)) return true;
  // Share the first distinctive word and most characters.
  const prefix = Math.min(6, na.length, nb.length);
  return na.slice(0, prefix) === nb.slice(0, prefix);
}
