# Sponsor technology in Track-N

## Zetaris: the data layer

Track-N's problem is fragmentation, so Zetaris sits at the centre. Four
separate systems are registered once (`backend/scripts/setupZetaris.ts`):

| Zetaris name | Kind | Holds |
|---|---|---|
| `trackn_ops` | Postgres via JDBC (`CREATE DATASOURCE`) | shipments confirmed from AWB uploads, documents (packing lists, certificates, weight records, proofs of delivery), the shared mailbox, parties, operating procedures |
| `trackn_finance` | MySQL via JDBC | commercial invoices and their versions |
| `trackn_carrier.tracking_events` | `CREATE LIGHTNING REST TABLE` over the simulated carrier API | movement events (RCS, DEP, OFLD, BKD, ARR, HLD, DLV ...) |
| `trackn_customs.customs_entries` | `CREATE LIGHTNING REST TABLE` over the simulated customs portal | entries, holds, missing documents, release references |

Every agent read goes through Zetaris's REST SQL endpoint
(`backend/src/lib/zetaris.ts`). References are matched across sources the way
operators do it, digits only (`regexp_replace(col, '[^0-9]', '')`), because
each system writes the AWB differently (`901-44173021`, `90144173021`,
`901 4417 3021`). REST tables re-query their source on every SQL query, so when
a simulated broker releases a shipment, the next Verification query sees it.

What is distinctive: Verification never trusts an email. It re-reads the
customs record, the invoice versions and the documents through Zetaris and
compares them with what the reply claims, which is how Track-N catches a
release reference that does not exist.

## Meterless World Model: shared case state

The vendored engine (`backend/src/engines/world-model/`, unchanged, conformance
8/8) holds every case. The adapter (`backend/src/state/caseState.ts`) maps the
domain onto the engine's primitives:

- **Entities**: case, shipment, party, evidence, plan, draft, email, check.
- **Facts** (most-recent-wins): case status, problem type, counters, timers,
  next action. The fact log is the case's history of decisions.
- **Relationships**: `evidence -supports-> case`, `email -part-of-> case`,
  `plan -plan-for-> case`, `check -verifies-> case`, and the bitemporal
  `case -awaiting-> party`: when Planning re-targets a follow-up from the shipper
  to the broker, the old edge is closed, not deleted, so "who were we waiting on,
  and when" is preserved.
- **Provenance**: every write names the agent (or person) and the run ID, so the
  audit log doubles as the activity feed, linked to the run traces.

All four agents read and write the same state: Investigation writes evidence,
Planning reads Verification's failed checks, Communication reads the plan,
Verification reads the evidence and the request time. The dashboard renders
straight from the engine's views.

## Meterless Nightshift + NVIDIA Nemotron: the AI provider

`backend/src/lib/llm.ts` implements the Meterless Runtime contract (Bearer token,
`meterless-app`, `meterless-scope: user`, `/v1/models` discovery). Two pinned
Nemotron lanes:

| Lane | Model | Used for |
|---|---|---|
| deep | `nvidia/nemotron-3-ultra-550b-a55b` | Investigation (reasoning across all evidence with citations), Verification critic |
| fast | `nvidia/nemotron-3.5-lightning-30b-a3b` | Planning, email drafting, reply classification, AWB extraction, chat |

Requests send `chat_template_kwargs: {enable_thinking: false}`; agents put
their reasoning into explicit JSON fields instead, which the trace records.
Every model reply is validated (cited evidence must exist, roles must be allowed,
no HS code may be suggested, emails must name the AWB) and the model gets one
correction round before a rule-based fallback takes over. Each trace step records
the requested and the served model.

## Development environment

Built with AI coding assistance (Claude Code in VS Code). If team members also
build in Cursor, add how it was used here before submitting.
