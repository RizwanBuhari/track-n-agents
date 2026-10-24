// Shared vocabulary: the seven problem types and the reply types.
// Communication, Verification and the dashboard all use these names.

export const PROBLEM_TYPES = {
  MISSING_INVOICE: "Missing invoice",
  INVOICE_REF_MISMATCH: "Wrong shipment reference on the invoice",
  TRANSPORT_DELAY: "Transport delay or cargo moved to a later departure",
  CONFLICTING_STATUS: "Conflicting shipment status",
  HS_CODE_ERROR: "Wrong product code or HS code",
  WEIGHT_MISMATCH: "Weight mismatch",
  MISSING_CERTIFICATE: "Missing certificate",
} as const;

export type ProblemType = keyof typeof PROBLEM_TYPES;
export const PROBLEM_TYPE_IDS = Object.keys(PROBLEM_TYPES) as ProblemType[];

export const REPLY_TYPES = {
  RESOLUTION_EVIDENCE: "Says the problem is fixed and gives references or attachments. Possibly enough: check before closing.",
  PARTIAL: "Reports an action but not the result (invoice sent, code changed, application submitted).",
  VAGUE: "No usable facts (we are checking, will update soon).",
  WRONG_DOCUMENT: "The attachment belongs to another shipment or does not match.",
  CONFLICTING: "Contradicts a current record, or is second-hand (the carrier says it is released).",
  UNSUBSTANTIATED: "A guess or opinion with no measurement or record behind it.",
  PROGRESS_UPDATE: "A factual intermediate update that moves the case to its next stage without closing it (for example cargo departed, certificate application pending with an expected issue time).",
} as const;

export type ReplyType = keyof typeof REPLY_TYPES | "DUPLICATE" | "UNVERIFIED_SENDER";

export const ROLE_LABELS: Record<string, string> = {
  shipper: "Shipper",
  consignee: "Consignee",
  broker: "Customs broker",
  carrier: "Carrier",
  warehouse: "Warehouse",
  operations: "Operations",
  operations_manager: "Operations manager",
};

export const OPERATIONS = { name: "Track-N Operations", email: "logistics@example.com" };
export const OPERATIONS_MANAGER = { name: "Operations Manager", email: "ops.manager@example.com" };
