-- Operations database (Postgres): shipments confirmed from AWB uploads,
-- received documents, the simulated mailbox, case parties and the
-- operating procedures. Queried by the agents through Zetaris.

CREATE TABLE shipments (
  awb_no               TEXT PRIMARY KEY,          -- canonical 3-8 form, e.g. 901-44173021
  carrier              TEXT,
  origin               TEXT,
  destination          TEXT,
  flight_no            TEXT,
  flight_date          DATE,
  shipper              TEXT,
  consignee            TEXT,
  agent                TEXT,
  goods                TEXT,
  pieces               INTEGER,
  gross_weight_kg      NUMERIC(10,1),
  chargeable_weight_kg NUMERIC(10,1),
  hs_code              TEXT,
  declared_value       NUMERIC(14,2),
  currency             TEXT,
  invoice_ref          TEXT,                       -- invoice number printed in AWB handling info
  owner                TEXT,                       -- operations user who confirmed the upload
  tracking_status      TEXT NOT NULL DEFAULT 'booked',
  source_file          TEXT,
  confirmed_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE documents (
  doc_id           TEXT PRIMARY KEY,               -- e.g. PL-901-44173021-v1
  doc_type         TEXT NOT NULL,                  -- PACKING_LIST | CERTIFICATE_OF_ORIGIN | WEIGHT_RECORD | ...
  ref_no           TEXT,                           -- the document's own number
  version          INTEGER NOT NULL DEFAULT 1,
  awb_as_written   TEXT,                           -- reference exactly as printed (formats differ on purpose)
  invoice_ref      TEXT,
  consignee_as_written TEXT,
  goods            TEXT,
  pieces           INTEGER,
  gross_weight_kg  NUMERIC(10,1),
  net_weight_kg    NUMERIC(10,1),
  issuer           TEXT,
  issued_on        DATE,
  file_name        TEXT,
  received_at      TIMESTAMPTZ NOT NULL,
  status           TEXT NOT NULL DEFAULT 'received' -- received | rejected | set_aside
);

CREATE TABLE parties (
  awb_no   TEXT NOT NULL,
  role     TEXT NOT NULL,                          -- shipper | consignee | broker | carrier | warehouse | operations | operations_manager
  name     TEXT NOT NULL,
  email    TEXT NOT NULL,
  PRIMARY KEY (awb_no, role)
);

CREATE TABLE mailbox (
  message_id    TEXT PRIMARY KEY,
  direction     TEXT NOT NULL,                     -- inbound | outbound
  from_addr     TEXT NOT NULL,
  to_addr       TEXT NOT NULL,
  subject       TEXT NOT NULL,
  body          TEXT NOT NULL,
  attachments   TEXT NOT NULL DEFAULT '',          -- comma-separated file names
  content_hash  TEXT NOT NULL,
  case_id       TEXT,                              -- set once matched to a case
  sent_at       TIMESTAMPTZ NOT NULL,
  simulated     BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE procedures (
  problem_type        TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  request_to_role     TEXT NOT NULL,
  confirm_with_role   TEXT NOT NULL,
  expected_senders    TEXT NOT NULL,              -- comma-separated roles
  request_items       TEXT NOT NULL,
  reminder1_hours     INTEGER NOT NULL,
  reminder2_hours     INTEGER NOT NULL,
  escalate_hours      INTEGER NOT NULL,
  closing_evidence    TEXT NOT NULL,
  not_enough          TEXT NOT NULL,
  needs_customs_release BOOLEAN NOT NULL
);

CREATE INDEX mailbox_case_idx ON mailbox (case_id);
CREATE INDEX documents_awb_idx ON documents (awb_as_written);
