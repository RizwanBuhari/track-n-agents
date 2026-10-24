# Track-N evaluation

Run 2026-10-24T14:18:44.409Z · models: nvidia/nemotron-3-ultra-550b-a55b (investigation), nvidia/nemotron-3.5-lightning-30b-a3b (extraction)

## 1. AWB extraction (text PDFs)

| Document | Correct | Wrong fields |
|---|---|---|
| CASE-001_AWB.pdf | 10/10 | — |
| CASE-002_AWB.pdf | 9/10 | goods: got "STAINLESS STEEL BALL VALVES, DN50", expected "STAINLESS STEEL BALL VALVES, DN50, 96 PCS" |
| CASE-003_AWB.pdf | 10/10 | — |
| CASE-004_AWB.pdf | 10/10 | — |
| CASE-005_AWB.pdf | 10/10 | — |
| CASE-006_AWB.pdf | 10/10 | — |
| CASE-007_AWB.pdf | 10/10 | — |
| CASE-008_AWB.pdf | 10/10 | — |

**Field accuracy: 79/80 (98.8%).** Scanned copies are not scored: without a vision lane they go to manual entry by design.

## 2. Investigation and first action

| Case | Expected | Found | Type | Expected first contact | Procedure sends first request to | Recipient |
|---|---|---|---|---|---|---|
| CASE-001 | MISSING_INVOICE | MISSING_INVOICE | ✓ | Shipper | shipper | ✓ |
| CASE-002 | INVOICE_REF_MISMATCH | INVOICE_REF_MISMATCH | ✓ | Shipper | shipper | ✓ |
| CASE-003 | TRANSPORT_DELAY | TRANSPORT_DELAY | ✓ | Carrier | carrier | ✓ |
| CASE-004 | CONFLICTING_STATUS | CONFLICTING_STATUS | ✓ | Customs broker and consignee | broker | ✓ |
| CASE-005 | HS_CODE_ERROR | HS_CODE_ERROR | ✓ | Shipper and broker | shipper | ✓ |
| CASE-006 | WEIGHT_MISMATCH | WEIGHT_MISMATCH | ✓ | Shipper and carrier | warehouse | ✗ |
| CASE-007 | MISSING_CERTIFICATE | MISSING_CERTIFICATE | ✓ | Shipper | shipper | ✓ |
| CASE-008 | NONE | NONE | ✓ | None | — | n/a |

**Problem type: 8/8.** False alarms on clean shipments: 0. First recipient matches the answer sheet: 6/7.

Notes: the answer sheet lists some cases with two parties (for example "Shipper and carrier"); a match on either counts. Closing behaviour (no early closure on "invoice sent", wrong documents, premature release claims, duplicates, unknown senders) is exercised by `npm run scenarios`.
