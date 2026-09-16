# DealerSource GPT solution

An independent, offline-first implementation of the approved DealerSource task: discover candidate leases, resolve and enrich their property facts, ask bounded verification questions, rank only evidence-qualified sites, and publish a four-view read-only dashboard.

Owner: `ryanflash66`. Implementation agent: GPT. Parent mount: `agents/gpt-solution`. No other solution code or logs were read.

## Start offline in under five minutes

Prerequisite: Node.js 24 or newer with npm. No install step, Docker, API key, account, real address or `.env` is required.

```sh
git clone https://github.com/ryanflash66/dealersource-gpt.git
cd dealersource-gpt
npm test
npm run pipeline -- --offline --day 2026-09-16
npm run dashboard:dev
```

Open `http://127.0.0.1:3000`. The dashboard displays **synthetic fixture data**, not actual available properties. It has Shortlist, Pipeline, Exceptions and Config views, a theme toggle, evidence details and an accessible coordinate map. The default run makes zero external calls and sends only fixture messages recorded in local storage.

Re-run the same fixture day:

```sh
npm run pipeline -- --offline --day 2026-09-16
```

The second run records **zero outbound messages**. `.data/state.json` persists evidence, cases, messages and checkpoints; `.data/report.json` follows the shared dashboard contract. `.data/digest.md` is the human-readable run summary. `--data-dir` selects a separate local fixture database; do not reset a real message ledger to force a retry.

## Commands

| Command | Purpose |
| --- | --- |
| `npm test` | Unit, provider-protocol, pipeline, replay, persistence, report and dashboard-build tests with network disabled |
| `npm run pipeline -- --offline` | All six stages using fixtures |
| `npm run pipeline -- --offline --stage enrich` | A selected resumable stage against existing local state |
| `npm run dashboard:dev` | Build and serve the fixture dashboard on loopback port 3000 |
| `npm run dashboard:build` | Produce static `dist/` without downloads |
| `npm run acceptance` | Fresh local Git clone, no `.env`, blocked network, all five section 13 checks and clean status |
| `npm run db:test` | Optional real local Postgres/PostGIS smoke test; NOT RUN/exit 2 without `DATABASE_URL` |
| `npm run deploy` | Explicit Vercel deployment; network/account access required, never used in offline acceptance |

Before `npm run acceptance`, commit current work. It clones only this repository into ignored `.verify/`, executes the tests and CLI, proves replay and provider switching, builds the dashboard, and checks clean status. Results are saved locally in `.data/acceptance.json`; the test transcript is `.data/tests.tap`. Runtime files are ignored so testing does not dirty the repository.

## Configuration

`business.yaml`, `providers.yaml`, and `sources.yaml` use the JSON-compatible YAML 1.2 subset. Edit keys without installing a YAML parser.

- Home base defaults to the approved Greenville development placeholder and 60 driving minutes, never a straight-line radius.
- Base rent has hard inclusive bounds of $600 and $1,000.
- An enclosed office and capacity for at least two display vehicles are required. The owner already holds a dealer license; this is premises screening, not license application automation.
- Shared/subleased sites are flagged and rank after every standalone site.
- Only fresh, cited zoning, written rent and centroid-plus-area flood evidence can pass the three gates. Unknown or expired facts never become a soft pass.
- Provider choice is one line in `providers.yaml`. `geocoding: census` can be changed to `nominatim` without code changes. Their fixture outputs are intentionally distinguishable.
- Paid providers exist but default to disabled. Calling one requires both selection and `paid_enabled: true`, plus deployment configuration. Paid calls carry an explicit cost class in structured logs.

Every external service has a fixture-backed path when its configuration is unset. `--offline` forces that path. Partial live configuration cannot send fixture contacts real email.

## Verification and safety

Unknown gate facts become persistent cases owned by the appropriate published leasing contact or planning authority. Questions use fixed templates. A scheduled model fills bounded facts and classifies replies; it cannot invent new asks or recipients. No new-lead daily cap is imposed, but recipient/site cooldown, two maximum follow-ups, opt-outs, bounce-rate pause and quota pause are enforced. The default follow-up interval is five days.

A send intent is persisted before execution. Timeouts or interrupted sends are not blindly retried. No-response cases escalate rather than imply approval. Source terms and robots restrictions cannot be overridden just by setting `enabled: true`.

No offers, negotiations, signatures, payments, phone/SMS, off-market owner harvesting, broker/MLS integrations or non-email channel are included.

## Deploy

See [docs/deploy.md](docs/deploy.md) for migrations, local PostGIS, Gmail OAuth, provider environment variables, the grey-source review process, outreach pause/resume, authenticated Supabase dashboard reads, map hosting and Vercel deployment.

See [docs/scheduling.md](docs/scheduling.md) for the cloud scheduled-agent task and the bounded request/response protocol. `github-actions` and `pg_cron` alternatives are documented configuration choices, not activated workflows.

`.env.example` contains variable names with empty values and purpose comments. Secrets are not committed. Existing Claude/Gmail subscriptions, hosting, data licenses and paid API usage are not assumed free. Claude Max is not model API credit. No live deployment or subscription integration is claimed tested by the offline suite.

## Shared design

GPT accent: **`#10A37F`**. The shared design README was still **not yet published** at the checked milestones, so this is a provisional functional implementation of its four views and `report.json` contract. When the published tokens/components/layout files exist, they must replace the provisional styling; semantic colors must remain those of the shared template. See [docs/decisions.md](docs/decisions.md).

## Layout

```text
src/             pipeline, gates, providers, mail, model, report and persistence
fixtures/        original synthetic sources and replies
migrations/      Supabase/PostGIS schema, RLS, leases and dashboard RPCs
dashboard/       static-first four-view frontend
scripts/         CLI support, tests, acceptance, build and local dev server
tests/           actual implementation tests and optional SQL smoke test
docs/            deployment, scheduling, source findings and decisions
```

## Authoritative shared references

The prompt files are not copied into this repository:

- System prompt: https://raw.githubusercontent.com/ryanflash66/dealersource/main/prompts/system-prompt.md
- Task spec: https://raw.githubusercontent.com/ryanflash66/dealersource/main/prompts/task-spec.md
- Dashboard brief: https://raw.githubusercontent.com/ryanflash66/dealersource/main/prompts/dashboard-design-brief.md
- Mandatory template status: https://github.com/ryanflash66/dealersource/tree/main/prompts/dashboard-design

The repository is independent. Parent comparison results and submodule pin updates remain the PM's responsibility. No parent or peer repository is modified by this implementation.
