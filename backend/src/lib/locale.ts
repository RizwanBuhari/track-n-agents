// Suggested email language for a recipient, from where they are. The
// shipper sits at the origin airport, the consignee, broker and warehouse
// at the destination; carriers and our own managers get English. When the
// airport is unknown, the company's legal form gives a hint (GmbH, S.r.l.).
// Deterministic, so it works in sample mode too.

export const COUNTRY_NAMES: Record<string, string> = {
  CN: "China", DE: "Germany", IN: "India", TR: "Turkey", KR: "South Korea", IT: "Italy", AU: "Australia",
  SE: "Sweden", AE: "United Arab Emirates", FR: "France", ES: "Spain", JP: "Japan", NL: "Netherlands",
  US: "United States", GB: "United Kingdom", SA: "Saudi Arabia", HK: "Hong Kong", SG: "Singapore",
  BR: "Brazil", MX: "Mexico", RU: "Russia", PT: "Portugal", PL: "Poland", VN: "Vietnam", TH: "Thailand",
};

const AIRPORT_COUNTRY: Record<string, string> = {
  PVG: "CN", PEK: "CN", CAN: "CN", SZX: "CN", HKG: "HK",
  FRA: "DE", MUC: "DE", LEJ: "DE", CGN: "DE",
  BOM: "IN", DEL: "IN", MAA: "IN", BLR: "IN",
  IST: "TR", SAW: "TR",
  ICN: "KR",
  MXP: "IT", FCO: "IT",
  MEL: "AU", SYD: "AU",
  ARN: "SE", GOT: "SE",
  DXB: "AE", DWC: "AE", SHJ: "AE", AUH: "AE",
  CDG: "FR", MAD: "ES", NRT: "JP", HND: "JP", AMS: "NL", JFK: "US", ORD: "US", LAX: "US",
  LHR: "GB", RUH: "SA", JED: "SA", SIN: "SG", GRU: "BR", MEX: "MX", SVO: "RU", LIS: "PT", WAW: "PL",
  SGN: "VN", BKK: "TH",
};

// First language is the suggestion; the rest are listed as alternatives.
const COUNTRY_LANGUAGES: Record<string, string[]> = {
  CN: ["Chinese (Simplified)"], HK: ["Chinese (Traditional)", "English"], DE: ["German"], IN: ["Hindi", "English"],
  TR: ["Turkish"], KR: ["Korean"], IT: ["Italian"], AU: ["English"], SE: ["Swedish"], AE: ["Arabic", "English"],
  FR: ["French"], ES: ["Spanish"], JP: ["Japanese"], NL: ["Dutch"], US: ["English"], GB: ["English"],
  SA: ["Arabic"], SG: ["English", "Chinese (Simplified)"], BR: ["Portuguese (Brazil)"], MX: ["Spanish"],
  RU: ["Russian"], PT: ["Portuguese"], PL: ["Polish"], VN: ["Vietnamese"], TH: ["Thai"],
};

const LEGAL_SUFFIX_COUNTRY: [RegExp, string][] = [
  [/\bGmbH\b|\bAG\b/, "DE"],
  [/\bS\.?r\.?l\.?|\bS\.?p\.?A\.?/i, "IT"],
  [/\bA\.?Ş\.?|\bA\.S\.$/, "TR"],
  [/\sAB$/, "SE"],
  [/\bPvt\.? Ltd\b/i, "IN"],
  [/\bPty\.? Ltd\b/i, "AU"],
  [/\bS\.?A\.?R\.?L\b|\bSAS\b/, "FR"],
  [/\bS\.?L\.?$|\bS\.A\.$/, "ES"],
  [/\bB\.?V\.?$/, "NL"],
  [/\bK\.?K\.?$/, "JP"],
  [/\bL\.?L\.?C\.?|\bFZE\b|\bFZCO\b|\bTrdg\b/i, "AE"],
];

export type LanguageSuggestion = { language: string; country: string | null; reason: string };

const ROLE_SIDE: Record<string, "origin" | "destination" | "english"> = {
  shipper: "origin",
  consignee: "destination",
  broker: "destination",
  warehouse: "destination",
  carrier: "english",
  operations: "english",
  operations_manager: "english",
};

function countryFromName(name: string): string | null {
  return LEGAL_SUFFIX_COUNTRY.find(([re]) => re.test(name.trim()))?.[1] ?? null;
}

/** Suggested languages for one recipient, best first. Always ends with English. */
export function suggestLanguages(role: string, shipment: { origin?: string | null; destination?: string | null } | null, partyName = ""): LanguageSuggestion[] {
  const side = ROLE_SIDE[role] ?? "destination";
  const roleLabel = role.replace(/_/g, " ");
  const out: LanguageSuggestion[] = [];
  let country: string | null = null;
  let how = "";
  if (side !== "english") {
    const airport = String((side === "origin" ? shipment?.origin : shipment?.destination) ?? "").trim().toUpperCase();
    country = AIRPORT_COUNTRY[airport] ?? null;
    how = country ? `${side} ${airport}` : "";
    if (!country && partyName) {
      country = countryFromName(partyName);
      how = country ? `company name "${partyName}"` : "";
    }
  }
  if (country) {
    for (const language of COUNTRY_LANGUAGES[country] ?? []) {
      out.push({ language, country: COUNTRY_NAMES[country] ?? country, reason: `${roleLabel[0].toUpperCase()}${roleLabel.slice(1)} is in ${COUNTRY_NAMES[country] ?? country} (${how})` });
    }
  }
  if (!out.some((s) => s.language === "English")) {
    out.push({ language: "English", country: null, reason: side === "english" ? "Carriers and managers are written to in English" : "Common business language" });
  }
  return out;
}
