# Contributing to Track-N

This guide gets a teammate from zero to a running backend, and explains how we
work on the repository together.

## 1. Get access

1. Ask the repository owner to add your GitHub account as a collaborator
   (*Settings → Collaborators → Add people*). Accept the email invitation.
2. Make sure Git can push as you: `gh auth login` (GitHub CLI) or a personal
   access token / SSH key.

## 2. Set up your machine

You need your **own** local copies of the sponsor services. Keys are personal
and are never shared through the repository.

| What | How | Gives you |
|---|---|---|
| Node.js 22+ | nodejs.org | |
| Docker Desktop (+ WSL 2 on Windows) | docs.docker.com | |
| Zetaris | Participant Setup Guide, *Data* section. Register at Zetaris Cloud, download the platform bundle, `./verify.sh` must pass 9/9 | `ZETARIS_API_KEY` (create it in the Zetaris web UI) |
| Meterless Nightshift | meterless.ai install cards; add your NVIDIA key in **Setup → Providers**; put a Nemotron model in a lane | `METERLESS_RUNTIME_TOKEN` and URL (from **Console**) |
| NVIDIA API key | build.nvidia.com | goes into Nightshift only, never into `.env` |

> If your Zetaris web UI port is not 3000 (for example 3002 because something else
> uses 3000), set `ZETARIS_UI_URL` accordingly.

## 3. Clone and run

```bash
git clone https://github.com/RizwanBuhari/track-n-agents.git
cd track-n-agents
cp .env.example .env               # fill in YOUR Zetaris API key and Nightshift token

cd infra && docker compose up -d && cd ..      # start Zetaris first
cd backend
npm install
npm run dev                        # backend on http://localhost:4100
npm run setup:zetaris              # in a second terminal, once
npm run load:demo -- --all        # needs the backend running: also starts the investigations
npm run conformance                # expect 8/8

cd ../dashboard
npm install
npm run dev                        # http://localhost:5173
```

Then check everything in one go (backend running):

```bash
cd backend
npm run doctor
```

It prints PASS/FAIL for `.env`, Docker, Zetaris, the Track-N databases, the
registered sources, Nightshift and the Nemotron lanes, and the World Model
engine, with the fix for each failure.

> **Nemotron availability differs per NVIDIA account.** If the doctor says a
> pinned model is not offered, pick ones your account serves (Nightshift model
> list) and set `METERLESS_FAST_MODEL` / `METERLESS_DEEP_MODEL` in `.env`.

### Resetting the demo state

Case state, traces and the simulated systems live in `backend/data/` (git-ignored).
To start over:

```bash
# stop the backend first
cd backend
npm run reset -- --shipments       # clears cases, traces, simulated systems and demo rows
npm run dev                        # start it again
npm run load:demo -- --all
```

To wipe the databases completely instead: `cd infra && docker compose down -v && docker compose up -d`,
then `npm run setup:zetaris` again (it prints "exists" for sources already registered).

## 4. How we work

- **Never commit to `main` directly.** Create a branch per change:
  `git checkout -b feature/dashboard-cases-page` (or `fix/...`, `docs/...`).
- Keep commits small, with messages in the imperative: *"Add case timeline panel"*.
- Before pushing: `cd backend && npm run typecheck` and `cd dashboard && npm run build` must pass.
- If you change agent behaviour, run `npm run scenarios` on a fresh state and commit the updated `eval/scenario-results.md`.
- Push and open a pull request: `git push -u origin <branch>` then
  `gh pr create --fill`. Another teammate reviews and merges.
- Pull often: `git checkout main && git pull`, then `git rebase main` on your branch.

## 5. Rules that keep the project eligible and safe

- **No secrets in Git.** `.env` is ignored; `.env.example` holds placeholders only.
  Never paste keys into code, README, screenshots or traces you share.
- **Agents read through Zetaris.** Direct database access in `backend/src/lib/db.ts`
  is for writes only (confirming a shipment, logging a sent email, the simulator).
- **Shared case state goes through the World Model** (`backend/src/state/caseState.ts`).
  Don't add a parallel store for case data.
- **Every AI request goes through `backend/src/lib/llm.ts`** (Meterless Runtime).
  Don't add another provider.
- **Humans approve every email and every closure.** Don't add a path around it.
- **Fictional data only.** No real customer documents, internship material or company
  branding.
- **The answer sheet (`eval/answer_sheet/`) is never read by agent code.**
- Don't edit `backend/src/engines/world-model/` (vendored engine). Build on it in
  `caseState.ts`.

## 6. Where to change what

| I want to... | Look at |
|---|---|
| Change how a problem is detected | `backend/src/agents/investigation.ts` (`screen`, prompt) |
| Change a closing check | `backend/src/agents/verification.ts` (`typeChecks`) |
| Change who is asked or what is asked | `infra/ops-db/02_seed.sql` (`procedures`), `backend/src/agents/planning.ts` |
| Change email wording rules | `backend/src/agents/communication.ts` |
| Add a scripted reply for the demo | `backend/src/sim/scenarios.ts` |
| Add an API endpoint | `backend/src/routes/api.ts` |
| Change a dashboard page | `dashboard/src/pages/` (styles in `dashboard/src/index.css` and `app.css`) |
| Replace the logo | `dashboard/src/components/Logo.jsx`, `dashboard/public/favicon.svg` |
| Add a demo shipment | `demo-data/cases/`, `infra/ops-db/02_seed.sql`, `infra/finance-db/01_schema_seed.sql`, `backend/src/sim/seed.ts` |
