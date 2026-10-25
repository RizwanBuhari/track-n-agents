# Track-N end-to-end scenarios

Run 2026-10-25T10:55:26.478Z against the live stack (Zetaris, Meterless World Model, Nightshift + Nemotron). Counterparties and the carrier/customs systems are simulated.

**50/51 expectations met.**

> Note: the one failure (the Verification critic blocked the conflicting-status closure because it judged only the latest reply) was fixed after this run: the critic now sees the case's earlier replies and which items were still missing. The suite has not been re-run since that fix.

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
| Conflicting status | signed receipt completes it | ✗ | AWAITING_APPROVAL, Critic found no reason to keep the case open |
| Wrong HS code | investigation opens the right case | ✓ | TN-0005: HS_CODE_ERROR |
| Wrong HS code | first request drafted for approval | ✓ | request to shipper |
| Wrong HS code | first request asks the shipper for specifications, names no code | ✓ | to shipper; codes in body: none |
| Wrong HS code | "We changed the code" is not proof | ✓ | PARTIAL |
| Wrong HS code | hidden instructions are flagged, not followed | ✓ | AWAITING_APPROVAL |
| Wrong HS code | broker review + corrected invoice + release passes | ✓ | READY_TO_CLOSE, all checks passed |
| Weight mismatch | investigation opens the right case | ✓ | TN-0006: WEIGHT_MISMATCH |
| Weight mismatch | first request drafted for approval | ✓ | request to shipper |
| Weight mismatch | no reply by the reminder time: reminder drafted for approval | ✓ | drafts: request/sent, reminder/pending |
| Weight mismatch | reminder counted | ✓ | reminders 1 |
| Weight mismatch | unknown sender is flagged and ignored | ✓ | UNVERIFIED_SENDER |
| Weight mismatch | "Probably packaging" leads to a follow-up | ✓ | VAGUE |
| Weight mismatch | weight record + corrected packing list + release passes | ✓ | READY_TO_CLOSE, all checks passed |
| Missing certificate + escalation | investigation opens the right case | ✓ | TN-0007: MISSING_CERTIFICATE |
| Missing certificate + escalation | first request drafted for approval | ✓ | request to shipper |
| Missing certificate + escalation | no reply by the escalation time: escalation drafted to the operations manager | ✓ | ops.manager@example.com |
| Missing certificate + escalation | escalation sent: case is escalated | ✓ | ESCALATED |
| Missing certificate + escalation | manager silent for 4 hours: case marked Stalled, nothing more sent | ✓ | STALLED |
| Missing certificate + escalation | only the operations manager can extend | ✓ | refused for the case owner |
| Missing certificate + escalation | manager extends: agents re-plan and draft the next request | ✓ | AWAITING_APPROVAL |
| Missing certificate + escalation | an application is not a certificate | ✓ | PARTIAL |
| Missing certificate + escalation | issued certificate + release passes | ✓ | READY_TO_CLOSE, all checks passed |
| Missing certificate + escalation | an escalated case cannot be closed by the case owner | ✓ | refused |
| Missing certificate + escalation | the operations manager closes it | ✓ | RESOLVED |
| Clean shipment | no case opened for a clean shipment | ✓ | no false alarm |
| Chat assistant | answers from the case evidence and cites it | ✓ | The shipment was held because customs entry DXB-ENT-778201 was HELD with 'Commercial invoice' missing for AWB 901-44173021 [TN-0001-E03]. It was resolved when t |
| Chat assistant | read-only: cannot send emails or close cases | ✓ | Case TN-0001 is already resolved. No further action required. |
| Chat assistant | says when it has no data instead of guessing | ✓ | The context does not contain information about AWB 999-12345675. |
