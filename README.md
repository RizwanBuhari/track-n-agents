# Track-N

**Multi-agent shipment exception resolution for logistics operations, demonstrated on air freight.**
Built for the Open Agent Hackathon 2026, Track 1: *Solving Fragmented Intelligence*.

When an air shipment gets stuck, the reason is scattered across systems that
don't talk to each other: the air waybill (AWB), the finance system's
invoices, packing lists and certificates, the carrier's tracking feed, the
customs broker's portal and a shared mailbox. Operations staff piece it
together by hand, chase people by email, and too often close a case on
"invoice sent" when customs still hasn't released anything.

Track-N connects those sources through **Zetaris**, lets four cooperating
agents find the problem, plan the fix, handle the emails and **verify** the
outcome against the systems of record, and keeps a person in control of every
email sent and every case closed.

---

## How it works

```
Upload AWB ─► extract fields ─► person confirms ─► shipment saved
                                                       │
         ┌─────────────────────────────────────────────┘
         ▼
  Investigation ──► Verification (challenges the finding) ──┐
         ▲                    │ fails: sent back            │ passes
         └────────────────────┘                             ▼
                                                    Resolution Planning
                                                            │
                                                     Communication drafts
                                                            │
                                               person approves ─► email sent
                                                            │
                         reply arrives ─► Communication reads it
                                                            │
             duplicate / unknown sender / hidden instructions: flagged, no action
             vague / guess / second-hand: Planning follows up
             wrong document: set aside, follow up, counts toward the limit
             "done" / partial: Verification checks the SOURCES
                                   │ fail: sent back to Planning (max 3, then escalate)
                                   │ pass: person approves closure
```

**Example (CASE-001, missing invoice).** Investigation joins the confirmed AWB
(Postgres), finance (MySQL), carrier tracking and the customs portal (REST) and
finds the customs hold for a missing invoice. The shipper replies *"Invoice sent"*:
Verification rejects closing because no invoice is on file and customs still shows
HELD, and Planning re-targets the follow-up to the broker. The broker then claims a
release reference that is **not** in the customs record: rejected again. Only when
the invoice is on file and customs shows the cited release, dated after our
request, does the case become *Ready to close*, and a person closes it.

### The four agents

| Agent | What it does | Model |
|---|---|---|
| **Investigation** | Queries all sources for one shipment through Zetaris, screens them with explicit rules, then decides the problem type and explains it, **citing every claim** to a source record. Uncited or invented conclusions are rejected and corrected. May request one extra read-only SQL lookup. | Nemotron Ultra 550B |
| **Resolution Planning** | Reads the operating procedure and the shipment's parties (through Zetaris), the case history and any failed checks, and chooses the next action, recipient and the proof that will close the case. Revises the plan when Verification sends a case back or a person rejects a draft. | Nemotron Lightning 30B |
| **Communication** | Drafts emails for approval; reads replies. Duplicate, unknown-sender and hidden-instruction checks are deterministic; the reply's meaning is classified into the operating rules' reply types. | Nemotron Lightning 30B |
| **Verification** | Challenges new findings before anyone is contacted, and checks claimed resolutions against the **records themselves**: customs release (dated after our request, cited reference must exist), corrected invoice version, certificate, weight record, signed receipt, tracking. A Nemotron critic then looks for reasons *not* to close; it can block a closure but can never turn a failed check into a pass. | Rules + Nemotron Ultra 550B |

A **coordinator** (plain code, not an agent) routes events, enforces the
limits (2 reminders, 2 wrong documents, 3 send-backs, 25 steps per run),
runs the reminder/escalation timers on a demo clock, and holds the human
gates: no email is sent and no case is closed without a person.

### The seven problem types

Missing invoice · Wrong shipment reference on the invoice · Transport delay ·
Conflicting status · Wrong HS code · Weight mismatch · Missing certificate.

### Case priority

Open cases are ranked automatically. **Severity** (1–5) is read from the case
content each time Investigation makes a finding: Nemotron rates it from the
problem, explanation, goods and declared value. In sample mode, rules do the
rating instead: customs holds score higher, as do perishable or medical goods
and high values. **Urgency** (0–5) is recomputed on every request from the demo
clock: deadlines passed or near, escalated or stalled cases, a person needed,
loops so far, flags and age. Score = severity × 2 + urgency. The Cases list,
Overview and Approvals are ordered by it, and each case shows why it ranks
where it does. Cases that existed before ranking was added are rated once at
start-up, and any case can be re-rated from its page.
(`backend/src/agents/priority.ts`)

### Critical cases escalate faster

Priority changes how the agents act, not just the order cases are listed in.
A request or follow-up sent on a High case runs its reminder and escalation
timers at 75% of the procedure times; on a Critical case, at 50%. When a case
rises to Critical, the coordinator flags it, halves the time left on its
timers (they only ever move earlier), and drafts a notice to the operations
manager, which a person approves like every other email. The dashboard shows
a live alert, and the case appears under "Critical alerts" on the Overview.
The notice only informs: it does not change the case's status or pause its
reminders. (`checkCritical` in `backend/src/agents/coordinator.ts`)

### Patterns across cases

Each case is worked on its own, so `backend/src/agents/patterns.ts` looks
across all of them for the same party causing the same trouble again: claims
the records did not back (including resolutions Verification rejected),
vague replies, wrong documents, no reply until reminded, and unknown senders.
It also looks for repeat problems on one carrier or at one destination. It
reads the shared case history and, through Zetaris, the documents and
invoices set aside as misdirected in the systems of record. A pattern needs
at least two occurrences in at least two cases. Each pattern names its cases
and evidence, and carries advice that Planning applies when it next writes to
that party. For example, it asks a broker whose release claims failed before
for the customs record entry up front. Patterns appear on the Overview, on
each affected case and in the chat assistant.

### Emails in the recipient's language

Each draft waiting for approval suggests a language for its recipient. The
shipper gets the language of the origin airport's country, and the consignee,
broker and warehouse get the destination's. Carriers and managers get English.
When the airport is unknown, the company's legal form is used instead (GmbH,
S.r.l. and so on). The person can pick a suggestion or type any language, and
Communication translates the draft with Nemotron. The translation keeps the
AWB number, the `[TN-xxxx]` tag and every reference unchanged, and by default
the English original goes underneath. The person reviews the result and
approves it like any edit, and the language is recorded on the draft.
Translation needs live mode. The deterministic reply checks (hidden-instruction
pattern, sample-mode reply reading) are English-only, and replies in other
languages are read by the Nemotron classifier. (`backend/src/lib/locale.ts`,
`translateDraft` in `backend/src/agents/communication.ts`)

### Beyond air freight

The agents, the Zetaris data layer, the World Model case state, the approval
flow and most problem types (invoice, reference, HS code, weight, certificate,
conflicting status) are the same for sea and road shipments. The demo covers
air freight to keep the scope reliable. Adding another mode means adding its
pieces, not changing the system:

| Air (built) | Sea / road (future) |
|---|---|
| AWB reader, AWB check digit | Bill of lading / CMR reader, container-number check digit |
| Flight offload and rebooking | Vessel rollover, missed cut-off, truck delay |
| Carrier flight events | Vessel and gate events |

---

## Sponsor technology

| | How Track-N uses it | Where |
|---|---|---|
| **Zetaris** | One SQL access point to four separate sources: Postgres (shipments, documents, mailbox, parties, procedures), MySQL (invoices), and two REST APIs registered as tables (carrier tracking, customs broker portal). Every agent read goes through Zetaris, including cross-source joins. | `backend/src/lib/zetaris.ts`, `backend/src/agents/sources.ts`, `backend/scripts/setupZetaris.ts` |
| **Meterless World Model engine** | The shared case state all four agents read and write: cases, evidence, plans, drafts, emails and verification results as entities, facts and bitemporal relationships. The event log is the case history; the audit log is the activity feed. Passes the official conformance suite (8/8). | `backend/src/engines/world-model/` (vendored engine), `backend/src/state/caseState.ts` (adapter), `npm run conformance` |
| **Meterless Nightshift** | The primary (and only) AI provider. OpenAI-compatible Runtime contract with `meterless-app` / `meterless-scope` headers. | `backend/src/lib/llm.ts` |
| **NVIDIA Nemotron** | Every agent request is served by a pinned Nemotron lane through Nightshift: Ultra 550B for investigation and the verification critic, Lightning 30B for planning, drafting, reply reading, extraction and chat. The served model is recorded in every trace step. | `backend/src/config.ts`, `backend/data/traces/*.jsonl` |

More detail: [docs/sponsor-technology.md](docs/sponsor-technology.md).

---

## Results

Measured on the fictional demo pack (8 shipments, 7 problem types + 1 clean),
against an answer sheet the agents never read:

- [eval/results.md](eval/results.md): AWB extraction field accuracy, problem
  type per shipment, false alarms, first recipient.
- [eval/scenario-results.md](eval/scenario-results.md): end-to-end behaviour for
  every problem type and trap (partial replies, premature release claim, wrong
  document, duplicate, unknown sender, hidden instructions, reminder timer,
  two-stage closing, human closure).
- [eval/scenario-results-sample.md](eval/scenario-results-sample.md): the same
  suite in sample mode (no Zetaris or Nightshift; rule-based agent paths).

---

## Repository layout

```
track-n/
├── backend/                 Node.js + TypeScript (run with tsx, no build step)
│   ├── src/
│   │   ├── agents/          investigation, planning, communication, verification,
│   │   │                    coordinator, assistant (chat), sources (Zetaris queries)
│   │   ├── engines/world-model/   Meterless World Model engine (vendored, Apache-2.0)
│   │   ├── state/caseState.ts     case state on top of the World Model
│   │   ├── extraction/      AWB PDF extraction
│   │   ├── sim/             simulated carrier API, customs portal and reply scenarios
│   │   ├── lib/             Zetaris client, Meterless client, traces, demo clock, refs
│   │   ├── routes/          REST API and server-sent events
│   │   ├── sample/          sample mode: embedded Postgres stand-in and start-up loader
│   │   └── server.ts
│   ├── sample/shipments.json      the 8 confirmed demo shipments used by sample mode
│   └── scripts/             setupZetaris, loadDemoShipments, resetDemo, conformance,
│                            evaluate, runScenarios, sample, sampleReset
├── dashboard/               React + Vite
├── infra/                   docker compose for the Postgres and MySQL sources + seed SQL
├── demo-data/cases/         8 fictional demo shipments (AWB, invoice, packing list, ...)
├── eval/                    answer sheet (never read by agents) and results
├── docs/                    sponsor technology, demo script
└── .env.example
```

---

## Quick look: sample mode (no setup)

To see Track-N work without Docker, Zetaris, the databases, Nightshift or a `.env`
file, you only need Node.js 22+:

```bash
cd backend && npm install && npm run sample     # http://localhost:4100
cd dashboard && npm install && npm run dev      # second terminal: http://localhost:5173
```

The 8 demo shipments are loaded and investigated at start-up; cases appear on the
dashboard within seconds. The top-right indicator reads **Sample mode: no live services**.

| | Live mode (`npm run dev`) | Sample mode (`npm run sample`) |
|---|---|---|
| Agent reads | Zetaris across Postgres, MySQL and two REST APIs | The same SQL against an embedded Postgres (PGlite) seeded from `infra/` |
| Writes | Postgres and MySQL | The same embedded Postgres |
| Models | NVIDIA Nemotron through Meterless Nightshift | None: every agent takes its rule-based path |
| Meterless World Model, Verification, approvals, timers, simulator | Same | Same |

What you give up in sample mode: findings are explained by the screening rules
rather than Nemotron, emails are drafted from the procedure template, replies are
read by rules, the chat assistant is unavailable, and a newly uploaded AWB has to
be typed by hand. Verification still checks the records, and a person still
approves every email and closure. The full scenario suite passes in sample mode
too: [eval/scenario-results-sample.md](eval/scenario-results-sample.md).
Sample state is kept in `backend/data/sample/` apart from the live demo; stop the
backend and run `npm run sample:reset` to start over.

---

## Getting started

### Prerequisites

| Tool | Notes |
|---|---|
| Node.js 22+ | `node --version` |
| Docker Desktop | with WSL 2 on Windows |
| Zetaris (local) | installed and passing `./verify.sh`; see the hackathon Participant Setup Guide |
| Meterless Nightshift | running, with NVIDIA connected in **Providers** and a Nemotron model in a lane |

### 1. Clone and configure

```bash
git clone https://github.com/RizwanBuhari/track-n-agents.git
cd track-n-agents
cp .env.example .env        # then fill in your own Zetaris API key and Nightshift token
```

### 2. Start the data sources

```bash
cd infra
docker compose up -d        # Postgres :5433 and MySQL :3307, joined to the Zetaris network
cd ..
```

The databases join Docker network `zetaris_default` so Zetaris can reach them by
container name. Start Zetaris first.

### 3. Run the backend

```bash
cd backend
npm install
npm run dev                 # http://localhost:4100
```

### 4. Register the sources in Zetaris (once, with the backend running)

```bash
npm run setup:zetaris
```

Registers `trackn_ops`, `trackn_finance`, `trackn_carrier` and `trackn_customs`,
then prints one query joining Postgres, MySQL and the customs REST API.

### 5. Load the demo shipments and check the engine

```bash
npm run load:demo           # extracts the demo AWBs and starts the investigations (CASE-001 is left for a live upload; add -- --all for all)
npm run conformance         # Meterless World Model conformance: expect 8/8
npm run doctor              # checks every prerequisite and prints the fix for anything missing
```

### 6. Run the dashboard

```bash
cd ../dashboard
npm install
npm run dev                 # http://localhost:5173 (proxies /api to the backend)
```

### Tests and evaluation

```bash
cd backend
npm run typecheck
npm run eval                # extraction + investigation vs the answer sheet -> eval/results.md
npm run scenarios           # end-to-end behaviour -> eval/scenario-results.md
```

Both need a fresh demo state: stop the backend, `npm run reset -- --shipments`,
start it again, `npm run load:demo -- --all --no-investigate` (the tests start the investigations themselves).
For the scenarios in sample mode: stop the backend, `npm run sample:reset`,
`npm run sample -- --no-investigate`, then `npm run scenarios` (writes
`eval/scenario-results-sample.md`).

---

## Dashboard

| Page | What it is for |
|---|---|
| **Overview** | Open cases, what is waiting for a person, live agent activity |
| **Shipments** / detail | Confirmed AWB fields, related records from every source (with their source), carrier timeline, original PDF |
| **Upload AWB** | Drop a PDF, check the extracted fields beside the document (flagged fields highlighted), confirm |
| **Cases** / detail | The finding with evidence links, the full resolution loop (plans, emails, checks), evidence with source and record ID, timers and limits, World Model history, step-by-step agent traces |
| **Approvals** | Edit, approve or send back every email; approve closures after verification |
| **Simulator** (via *Demo controls*, top right) | Plays the outside world (replies, demo clock, duplicate resend), clearly labelled simulated; not part of the operations product |
| **System** (via the *All systems connected* indicator, top right) | Live Zetaris sources, Nightshift/Nemotron lanes, World Model stats and conformance |

Switch between the case owner and the operations manager at the top right.

---

## Data and honesty

- All companies, people, AWB numbers and documents in `demo-data/` are
  **fictional** and watermarked as test data. No real or confidential data is used.
- The carrier tracking API, customs broker portal and mailbox counterparties are
  **simulated** and labelled as simulated. Delivering a scripted reply also changes
  the simulated systems the way the real world would; Verification checks those
  systems, not the email's word.
- `eval/answer_sheet/` holds the expected answers for scoring. No agent code reads it.
- Database passwords in `infra/` and `.env.example` are local-only development
  defaults for containers bound to `127.0.0.1`.
- Scanned AWBs need a vision lane in Nightshift; without one, Track-N asks the
  person to type the fields (it never guesses).

## Traces

Every agent run writes `backend/data/traces/<runId>.jsonl`: each model request
(requested and served model, latency, token usage), each Zetaris query (SQL,
row count, sample rows) and each decision. Runs stop at 25 steps and are marked
*paused*, not failed. The dashboard shows them on each case page.

## Pre-existing components (declared)

- **Meterless World Model reference implementation**, vendored unchanged from
  [Meterless/Meterless](https://github.com/Meterless/Meterless) (Apache-2.0) with
  its conformance runner. See `backend/src/engines/world-model/NOTICE.md`.
- Open-source libraries listed in `backend/package.json` and `dashboard/package.json`.
- The dashboard's visual style (layout, stylesheet, icons, chat panel and
  animations) is adapted from an earlier shipment-tracking prototype built by a
  team member; no logic, data, branding or logo from it is included.

## Team

Built by a team of five for the Open Agent Hackathon 2026. See
[CONTRIBUTING.md](CONTRIBUTING.md) to work on the code.
