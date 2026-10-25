# Track-N end-to-end scenarios

Run 2026-10-24T18:00:43.583Z in sample mode (embedded Postgres instead of Zetaris and the databases; no Nightshift, so every agent used its rule-based path; Meterless World Model as in live mode). Counterparties and the carrier/customs systems are simulated.

**41/41 expectations met.**

| Scenario | Expectation | Result | Detail |
|---|---|---|---|
| Missing invoice | investigation opens the right case | ✓ | TN-0001: MISSING_INVOICE |
| Missing invoice | first request drafted for approval | ✓ | request to shipper |
| Missing invoice | "Invoice sent" is not proof | ✓ | PARTIAL, verification fail, next follow_up to broker |
| Missing invoice | follow-up goes to whoever can confirm the result | ✓ | broker |
| Missing invoice | release claimed but not in customs: rejected | ✓ | cited-reference check false |
| Missing invoice | duplicate reply causes no new action | ✓ | DUPLICATE |
| Missing invoice | real resolution passes every check | ✓ | READY_TO_CLOSE, all checks passed |
| Missing invoice | a person closes it | ✓ | RESOLVED |
| Wrong invoice reference | investigation opens the right case | ✓ | TN-0002: INVOICE_REF_MISMATCH |
| Wrong invoice reference | first request drafted for approval | ✓ | request to shipper |
| Wrong invoice reference | another shipment's invoice is rejected and set aside | ✓ | WRONG_DOCUMENT, wrongDocs 1 |
| Wrong invoice reference | follow-up goes back to the sender | ✓ | shipper |
| Wrong invoice reference | corrected invoice + release passes | ✓ | READY_TO_CLOSE, all checks passed |
| Transport delay | investigation opens the right case | ✓ | TN-0003: TRANSPORT_DELAY |
| Transport delay | first request drafted for approval | ✓ | request to carrier |
| Transport delay | vague reply leads to a follow-up | ✓ | VAGUE |
| Transport delay | departure alone is stage 1: awaiting arrival | ✓ | AWAITING_ARRIVAL |
| Transport delay | arrival at destination passes | ✓ | READY_TO_CLOSE |
| Conflicting status | investigation opens the right case | ✓ | TN-0004: CONFLICTING_STATUS |
| Conflicting status | first request drafted for approval | ✓ | request to broker |
| Conflicting status | second-hand claim leads to a follow-up | ✓ | CONFLICTING |
| Conflicting status | customs release without a signed receipt stays open | ✓ | receipt check false |
| Conflicting status | signed receipt completes it | ✓ | READY_TO_CLOSE, all checks passed |
| Wrong HS code | investigation opens the right case | ✓ | TN-0005: HS_CODE_ERROR |
| Wrong HS code | first request drafted for approval | ✓ | request to shipper |
| Wrong HS code | first request asks the shipper for specifications, names no code | ✓ | to shipper; codes in body: none |
| Wrong HS code | "We changed the code" is not proof | ✓ | PARTIAL |
| Wrong HS code | hidden instructions are flagged, not followed | ✓ | AWAITING_APPROVAL |
| Wrong HS code | broker review + corrected invoice + release passes | ✓ | READY_TO_CLOSE, all checks passed |
| Weight mismatch | investigation opens the right case | ✓ | TN-0006: WEIGHT_MISMATCH |
| Weight mismatch | first request drafted for approval | ✓ | request to warehouse |
| Weight mismatch | no reply by the reminder time: reminder drafted for approval | ✓ | drafts: request/sent, reminder/pending |
| Weight mismatch | reminder counted | ✓ | reminders 1 |
| Weight mismatch | unknown sender is flagged and ignored | ✓ | UNVERIFIED_SENDER |
| Weight mismatch | "Probably packaging" leads to a follow-up | ✓ | UNSUBSTANTIATED |
| Weight mismatch | weight record + corrected packing list + release passes | ✓ | READY_TO_CLOSE, all checks passed |
| Missing certificate | investigation opens the right case | ✓ | TN-0007: MISSING_CERTIFICATE |
| Missing certificate | first request drafted for approval | ✓ | request to shipper |
| Missing certificate | an application is not a certificate | ✓ | PROGRESS_UPDATE |
| Missing certificate | issued certificate + release passes | ✓ | READY_TO_CLOSE, all checks passed |
| Clean shipment | no case opened for a clean shipment | ✓ | no false alarm |
