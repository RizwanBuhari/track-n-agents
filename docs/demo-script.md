# Demo video script (3–4 minutes)

Prepare a fresh state first (backend stopped):

```bash
cd backend
npm run reset -- --shipments
npm run dev                         # keep running
npm run load:demo                   # loads CASE-002..008; CASE-001 is uploaded live
cd ../dashboard && npm run dev
```

Have `demo-data/cases/CASE-001/CASE-001_AWB.pdf` ready to drag in. Run the other
investigations before recording (Shipments → each AWB → *Re-investigate*), so the
Overview already shows open cases.

| Time | Screen | Say / do |
|---|---|---|
| 0:00 | Overview | The problem: shipment facts are scattered across the AWB, finance, documents, carrier, customs and email. Track-N has four agents that connect them, and a person stays in control. |
| 0:20 | Upload AWB | Drop CASE-001's AWB. Fields are extracted by Nemotron; flagged fields would be highlighted. Confirm. |
| 0:40 | Case TN-xxxx | Investigation joined four sources through Zetaris: no invoice in finance (MySQL), customs HELD (REST), tracking hold (REST), the broker's email (Postgres). Every sentence links to evidence. Verification challenged the finding before anyone was contacted. |
| 1:05 | Case → draft | Planning chose the shipper; Communication drafted the request. Approve and send. |
| 1:20 | Demo controls (top right) | Deliver *Shipper: "Invoice sent"*. |
| 1:30 | Case | Classified PARTIAL. Verification rejects closing: no invoice on file, customs still HELD. Planning re-targets the broker. Point at "Waiting on (history)": shipper crossed out, broker current (World Model bitemporal edge). Approve. |
| 1:55 | Simulator → Case | Deliver *Broker: release claimed, not in customs yet*. Rejected: the cited release reference is not in the customs record. |
| 2:15 | Simulator → Case | Re-send the last reply (duplicate): linked, no new action. Deliver *Broker: invoice accepted + released*. All checks pass; the critic agrees. |
| 2:40 | Case | Approve closure as a person. Open an agent run: every Zetaris query and every Nemotron call with the served model. |
| 3:05 | Another case (wrong invoice reference or transport delay) | Wrong document set aside and sent back to the sender, or two-stage closing (departed ≠ arrived). |
| 3:25 | System | Zetaris: four sources in one query. Nightshift: pinned Nemotron lanes. World Model: events, entities, run the conformance suite (8/8). |
| 3:45 | Overview | Close: verified outcomes, not "invoice sent". |
