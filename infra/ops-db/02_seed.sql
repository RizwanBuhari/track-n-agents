-- Fictional demo data (demo case pack CASE-001..008). All companies,
-- people, AWB numbers and addresses are invented. Shipments are NOT
-- seeded: they are created when an operations user confirms an AWB upload.

-- Packing lists exactly as printed (AWB written without the hyphen,
-- consignee spellings differ on purpose).
INSERT INTO documents (doc_id, doc_type, ref_no, awb_as_written, invoice_ref, consignee_as_written, goods, pieces, gross_weight_kg, net_weight_kg, issuer, issued_on, file_name, received_at) VALUES
('PL-CASE-001', 'PACKING_LIST', 'PL-BWT-0981', '90144173021', 'BWT-INV-26-0981', 'ORION ELECTRONICS F.Z.E.', 'LAPTOP COMPUTERS (14-INCH)', 40, 420.0, 378.0, 'Shenzhen Brightway Technology Co., Ltd.', '2026-10-11', 'CASE-001_PL.pdf', '2026-10-11 10:00+04'),
('PL-CASE-002', 'PACKING_LIST', 'PL-RPV-4471', '90151288462', 'RPV-2026-4471', 'Blue Dune Trdg L.L.C', 'STAINLESS STEEL BALL VALVES', 12, 318.5, 286.7, 'Rhine Precision Valves GmbH', '2026-10-09', 'CASE-002_PL.pdf', '2026-10-09 12:00+04'),
('PL-CASE-003', 'PACKING_LIST', 'PL-KTL-312', '90233904150', 'KTL/EXP/26/312', 'Al-Noor Garments Trdg LLC', 'WOVEN COTTON FABRIC ROLLS', 25, 510.0, 459.0, 'Kaveri Textiles Pvt. Ltd.', '2026-10-13', 'CASE-003_PL.pdf', '2026-10-12 20:00+04'),
('PL-CASE-004', 'PACKING_LIST', 'PL-BMS-1188', '90160217791', 'BMS-26-1188', 'Crescent Health Care Distributors', 'DISPOSABLE NITRILE EXAMINATION GLOVES', 18, 236.0, 212.4, 'Bosphorus Medical Supplies A.S.', '2026-10-07', 'CASE-004_PL.pdf', '2026-10-07 09:00+04'),
('PL-CASE-005', 'PACKING_LIST', 'PL-HSD-0457', '90271844205', 'HSD-EX-26-0457', 'Falcon Retail L.L.C.', 'SMARTPHONES', 30, 288.0, 259.2, 'Hanbit Smart Devices Co.', '2026-10-12', 'CASE-005_PL.pdf', '2026-10-12 01:00+04'),
('PL-CASE-006', 'PACKING_LIST', 'PL-MFD-0712', '90128755311', 'MFD-26-0712', 'PALM INTERIORS', 'UPHOLSTERED LOUNGE CHAIRS', 14, 548.0, 493.2, 'Milano Forma Design S.r.l.', '2026-10-10', 'CASE-006_PL.pdf', '2026-10-09 13:00+04'),
('PL-CASE-007', 'PACKING_LIST', 'PL-PHF-88213', '90283401765', 'PHF-INV-88213', 'Oasis Fresh Foodstuff Trdg', 'DRIED FRUIT AND NUT MIX', 20, 402.0, 361.8, 'Pacific Harvest Foods Pty Ltd', '2026-10-08', 'CASE-007_PL.pdf', '2026-10-08 23:00+04'),
('PL-CASE-008', 'PACKING_LIST', 'PL-NVP-3390', '90219588030', 'NVP-26-3390', 'Sahara Water Systems L.L.C.', 'CENTRIFUGAL WATER PUMPS AND SPARE SEALS', 6, 274.0, 246.6, 'Nordvik Pumps AB', '2026-10-06', 'CASE-008_PL.pdf', '2026-10-06 08:00+04');

-- Who is involved in each shipment. The expected-sender check uses this.
INSERT INTO parties (awb_no, role, name, email) VALUES
('901-44173021', 'shipper', 'Shenzhen Brightway Technology Co., Ltd.', 'exports@brightway.example.com'),
('901-44173021', 'consignee', 'Orion Electronics FZE', 'imports@orion.example.com'),
('901-44173021', 'broker', 'Gulf Clear Customs Brokers LLC', 'ahmed.noor@example.com'),
('901-44173021', 'carrier', 'Desert Wing Cargo', 'cargo@desertwing.example.com'),
('901-51288462', 'shipper', 'Rhine Precision Valves GmbH', 'export@rhinevalves.example.com'),
('901-51288462', 'consignee', 'Blue Dune Trading LLC', 'purchasing@bluedune.example.com'),
('901-51288462', 'broker', 'Gulf Clear Customs Brokers LLC', 'ahmed.noor@example.com'),
('901-51288462', 'carrier', 'Desert Wing Cargo', 'cargo@desertwing.example.com'),
('902-33904150', 'shipper', 'Kaveri Textiles Pvt. Ltd.', 'exports@kaveritex.example.com'),
('902-33904150', 'consignee', 'Al Noor Garments Trading LLC', 'imports@alnoor.example.com'),
('902-33904150', 'broker', 'Gulf Clear Customs Brokers LLC', 'ahmed.noor@example.com'),
('902-33904150', 'carrier', 'Gulf Arrow Airlines', 'movements@gulfarrow.example.com'),
('901-60217791', 'shipper', 'Bosphorus Medical Supplies A.S.', 'export@bosphorusmed.example.com'),
('901-60217791', 'consignee', 'Crescent Healthcare Distributors LLC', 'receiving@crescenthc.example.com'),
('901-60217791', 'broker', 'Gulf Clear Customs Brokers LLC', 'ahmed.noor@example.com'),
('901-60217791', 'carrier', 'Desert Wing Cargo', 'cargo@desertwing.example.com'),
('902-71844205', 'shipper', 'Hanbit Smart Devices Co.', 'docs@hanbit.example.com'),
('902-71844205', 'consignee', 'Falcon Retail LLC', 'supply@falconretail.example.com'),
('902-71844205', 'broker', 'Gulf Clear Customs Brokers LLC', 'ahmed.noor@example.com'),
('902-71844205', 'carrier', 'Gulf Arrow Airlines', 'movements@gulfarrow.example.com'),
('901-28755311', 'shipper', 'Milano Forma Design S.r.l.', 'spedizioni@milanoforma.example.com'),
('901-28755311', 'consignee', 'Palm Interiors LLC', 'orders@palminteriors.example.com'),
('901-28755311', 'broker', 'Gulf Clear Customs Brokers LLC', 'ahmed.noor@example.com'),
('901-28755311', 'carrier', 'Desert Wing Cargo', 'cargo@desertwing.example.com'),
('901-28755311', 'warehouse', 'Falcon Freight Forwarding LLC (warehouse)', 'warehouse@falconfreight.example.com'),
('902-83401765', 'shipper', 'Pacific Harvest Foods Pty Ltd', 'exportdocs@pacificharvest.example.com'),
('902-83401765', 'consignee', 'Oasis Fresh Foodstuff Trading LLC', 'imports@oasisfresh.example.com'),
('902-83401765', 'broker', 'Gulf Clear Customs Brokers LLC', 'ahmed.noor@example.com'),
('902-83401765', 'carrier', 'Gulf Arrow Airlines', 'movements@gulfarrow.example.com'),
('902-19588030', 'shipper', 'Nordvik Pumps AB', 'logistics@nordvik.example.com'),
('902-19588030', 'consignee', 'Sahara Water Systems LLC', 'stores@saharawater.example.com'),
('902-19588030', 'broker', 'Gulf Clear Customs Brokers LLC', 'ahmed.noor@example.com'),
('902-19588030', 'carrier', 'Gulf Arrow Airlines', 'movements@gulfarrow.example.com');

-- Initial problem reports already sitting in the simulated shared mailbox
-- (email scenarios, filled with the real case references).
INSERT INTO mailbox (message_id, direction, from_addr, to_addr, subject, body, attachments, content_hash, sent_at) VALUES
('TN01-INIT', 'inbound', 'ahmed.noor@example.com', 'logistics@example.com', 'AWB 901 4417 3021 | Missing invoice',
 'We cannot proceed with AWB 901 4417 3021 for Orion Electronics. The commercial invoice is missing from the file, so clearance is on hold. Please obtain it from the shipper.', '', md5('TN01-INIT'), '2026-10-12 08:30+04'),
('TN02-INIT', 'inbound', 'ahmed.noor@example.com', 'logistics@example.com', 'AWB 901-51288462 | Invoice reference does not match',
 'Invoice RPV-2026-4471 quotes AWB 901-28755311, not 901-51288462. We cannot use it for this shipment. Please obtain a corrected invoice.', '', md5('TN02-INIT'), '2026-10-10 09:40+04'),
('TN03-INIT', 'inbound', 'movements@gulfarrow.example.com', 'logistics@example.com', 'AWB 902-33904150 offloaded from GA 418',
 'AWB 902-33904150 was offloaded from GA 418 due to capacity. The flight departed without the cargo. We are checking the next available departure.', '', md5('TN03-INIT'), '2026-10-13 03:30+04'),
('TN04-INIT', 'inbound', 'receiving@crescenthc.example.com', 'logistics@example.com', 'AWB 901-60217791 shows delivered but we have nothing',
 'Carrier tracking for 901-60217791 says delivered, but we have not received the gloves and the broker portal still shows a customs hold. Can you confirm which status is current?', '', md5('TN04-INIT'), '2026-10-10 10:15+04'),
('TN05-INIT', 'inbound', 'ahmed.noor@example.com', 'logistics@example.com', 'AWB 902 7184 4205 | Classification query',
 'The HS code on invoice HSD-EX-26-0457 appears inconsistent with the goods description (smartphones) for AWB 902 7184 4205. Please supply product specifications so we can review the classification.', '', md5('TN05-INIT'), '2026-10-12 15:00+04'),
('TN06-INIT', 'inbound', 'ahmed.noor@example.com', 'logistics@example.com', 'AWB 901-28755311 | Weight differs from packing list',
 'We have conflicting gross weights for 901-28755311: 612.0 kg on the AWB and 548.0 kg on the packing list. Both list 14 pieces. Please arrange reconciliation.', '', md5('TN06-INIT'), '2026-10-11 09:00+04'),
('TN07-INIT', 'inbound', 'ahmed.noor@example.com', 'logistics@example.com', 'AWB 902 8340 1765 | Certificate of origin required',
 'Processing of AWB 902 8340 1765 is on hold. Preferential duty under the UAE-Australia CEPA is claimed but the certificate of origin is missing. Please obtain the certificate for these goods.', '', md5('TN07-INIT'), '2026-10-09 13:30+04'),
('TN08-INFO', 'inbound', 'movements@gulfarrow.example.com', 'logistics@example.com', 'AWB 902-19588030 delivered',
 'AWB 902-19588030 was delivered to Sahara Water Systems at AUH on 8 Oct 09:15. Proof of delivery is on file.', '', md5('TN08-INFO'), '2026-10-08 09:30+04');
