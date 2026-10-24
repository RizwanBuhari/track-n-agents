-- Finance database (MySQL): commercial invoices as received from shippers.
-- Fictional demo data. CASE-001 has no invoice on purpose; CASE-002's
-- invoice quotes another shipment's AWB; CASE-005 carries a T-shirt HS
-- code for smartphones.

CREATE TABLE invoices (
  invoice_no           VARCHAR(40)  NOT NULL,
  version              INT          NOT NULL DEFAULT 1,
  supersedes           VARCHAR(60)  NULL,
  shipment_ref_as_written VARCHAR(40) NULL,
  seller               VARCHAR(120) NOT NULL,
  consignee_as_written VARCHAR(120) NOT NULL,
  goods                VARCHAR(200) NOT NULL,
  hs_code              VARCHAR(12)  NULL,
  quantity             INT          NULL,
  total_value          DECIMAL(14,2) NOT NULL,
  currency             CHAR(3)      NOT NULL,
  country_of_origin    VARCHAR(60)  NULL,
  packages             INT          NULL,
  gross_weight_kg      DECIMAL(10,1) NULL,
  notes                VARCHAR(255) NULL,
  issued_on            DATE         NOT NULL,
  received_at          DATETIME     NOT NULL,
  file_name            VARCHAR(120) NULL,
  status               VARCHAR(20)  NOT NULL DEFAULT 'received',
  PRIMARY KEY (invoice_no, version)
);

INSERT INTO invoices (invoice_no, version, shipment_ref_as_written, seller, consignee_as_written, goods, hs_code, quantity, total_value, currency, country_of_origin, packages, gross_weight_kg, notes, issued_on, received_at, file_name) VALUES
('RPV-2026-4471', 1, '901-28755311', 'Rhine Precision Valves GmbH', 'Blue Dune Trdg L.L.C', 'STAINLESS STEEL BALL VALVES', '848180', 96, 41250.00, 'EUR', 'Germany', 12, 318.5, NULL, '2026-10-09', '2026-10-09 08:00:00', 'CASE-002_INV.pdf'),
('KTL/EXP/26/312', 1, '902-33904150', 'Kaveri Textiles Pvt. Ltd.', 'Al-Noor Garments Trdg LLC', 'WOVEN COTTON FABRIC ROLLS', '520812', 250, 18400.00, 'USD', 'India', 25, 510.0, NULL, '2026-10-13', '2026-10-12 16:00:00', 'CASE-003_INV.pdf'),
('BMS-26-1188', 1, '901-60217791', 'Bosphorus Medical Supplies A.S.', 'Crescent Health Care Distributors', 'DISPOSABLE NITRILE EXAMINATION GLOVES', '401519', 180, 12900.00, 'USD', 'Turkiye', 18, 236.0, NULL, '2026-10-07', '2026-10-07 05:00:00', 'CASE-004_INV.pdf'),
('HSD-EX-26-0457', 1, '902-71844205', 'Hanbit Smart Devices Co.', 'Falcon Retail L.L.C.', 'SMARTPHONES', '610910', 600, 150000.00, 'USD', 'Korea', 30, 288.0, NULL, '2026-10-12', '2026-10-11 21:00:00', 'CASE-005_INV.pdf'),
('MFD-26-0712', 1, '901-28755311', 'Milano Forma Design S.r.l.', 'PALM INTERIORS', 'UPHOLSTERED LOUNGE CHAIRS', '940161', 140, 33600.00, 'EUR', 'Italy', 14, 612.0, NULL, '2026-10-10', '2026-10-09 10:00:00', 'CASE-006_INV.pdf'),
('PHF-INV-88213', 1, '902-83401765', 'Pacific Harvest Foods Pty Ltd', 'Oasis Fresh Foodstuff Trdg', 'DRIED FRUIT AND NUT MIX', '081350', 200, 21800.00, 'AUD', 'Australia', 20, 402.0, 'Preferential origin claimed under the UAE-Australia CEPA. Certificate of origin to follow.', '2026-10-08', '2026-10-07 23:00:00', 'CASE-007_INV.pdf'),
('NVP-26-3390', 1, '902-19588030', 'Nordvik Pumps AB', 'Sahara Water Systems L.L.C.', 'CENTRIFUGAL WATER PUMPS AND SPARE SEALS', '841370', 60, 27450.00, 'EUR', 'Sweden', 6, 274.0, NULL, '2026-10-06', '2026-10-05 12:00:00', 'CASE-008_INV.pdf');
