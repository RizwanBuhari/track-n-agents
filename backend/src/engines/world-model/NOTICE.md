# Meterless World Model engine (vendored)

The files in this folder (except this notice) are the Meterless World Model
reference implementation, copied unchanged from
https://github.com/Meterless/Meterless/tree/main/engines/world-model/reference/src
at commit 1742dec56a66e58eef9dda2d2b865823758ca8cd (19 Oct 2026),
Apache-2.0 licensed (see LICENSE).

Track-N's domain adapter is `src/state/caseState.ts`. It keeps every case's
shared state (problem, evidence, plan, tasks, emails, verification results,
approvals) in this engine. `npm run conformance` runs the official
conformance suite (`scripts/worldModelConformanceRunner.ts`, also copied
unchanged) against this folder's `index.ts`.
