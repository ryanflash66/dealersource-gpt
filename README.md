# DealerSource

DealerSource continuously discovers, verifies, and ranks leaseable used-car dealership sites in Eastern North Carolina. A site reaches the shortlist only when current, cited evidence passes its zoning, written-rent, and flood gates.

This implementation follows the approved [task specification](https://raw.githubusercontent.com/ryanflash66/dealersource/main/prompts/task-spec.md), [shared system prompt](https://raw.githubusercontent.com/ryanflash66/dealersource/main/prompts/system-prompt.md), and mandatory [dashboard design template v2](https://github.com/ryanflash66/dealersource/tree/main/prompts/dashboard-design). The dashboard uses a user-selected indigo primary color, `#5B4BC4`, and its darker hover color, `#4938AD`. Its Hanken Grotesk and IBM Plex Mono font files are included locally, so the dashboard makes no font request during an offline run.

## Offline first run

Requirements: Node.js 22.6 or newer and pnpm. No account, network connection, `.env`, database, or API key is needed.

```bash
pnpm install --offline --frozen-lockfile
npm test
npm run pipeline -- --offline --fixtures test/fixtures/golden-v1/input --out .data/contract --run-date 2026-09-16
npm run dashboard:build
npm run dashboard:dev
```

Open [http://127.0.0.1:4321](http://127.0.0.1:4321). The fixture run yields two ranked viable sites, one standalone and one shared-lot last resort. It also opens one zoning case. Running the same pipeline command again sends zero outbound fixture messages.

Generated state and reports live under `.data/` and are ignored by Git. The dashboard build embeds fixture data when Supabase is not configured.

## Commands

| Command | Purpose |
|---|---|
| `npm test` | Run unit, integration, schema, dashboard, golden-fixture, and replay tests |
| `npm run pipeline -- --offline --fixtures <dir> --out <dir> --run-date YYYY-MM-DD` | Run the binding offline contract against the supplied nine fixture files |
| `npm run pipeline -- --offline --fixtures <dir> --out <dir> --run-date YYYY-MM-DD --config <providers.yaml>` | Run with an alternate provider selection |
| `npm run dashboard:dev` | Build and serve the dashboard locally |
| `npm run dashboard:build` | Create the static Vercel artifact in `dashboard/dist/` |
| `npm run verify` | Run tests and the dashboard build |

The stages are `discover`, `resolve`, `enrich`, `verify`, `score`, and `report`. Every run writes structured JSON logs and a run summary. See [docs/architecture.md](docs/architecture.md).

## Configuration

- `business.yaml` contains search, rent, site, flood, ranking, mail, schedule, and evidence-expiry rules.
- `providers.yaml` contains the eight binding provider keys and defaults. Change `geocoder: census` to `geocoder: nominatim`, or pass an alternate file with `--config`, to switch the reported selection without editing code.
- `sources.yaml` is the source allowlist and terms register.

### Enable a grey source

Sources marked `unclear` or with unknown robots policy fail closed. After the PM verifies both policies, change all three fields in that source row:

```yaml
robots_txt: allowed
terms_status: allowed
enabled: true
```

`prohibited` or `disallowed` always wins over `enabled: true`.

### Pause outreach

Set `mail.paused: true` in `business.yaml`. The dashboard immediately reports the pause. Live sending also pauses automatically when the 24-hour bounce threshold is exceeded or Gmail returns quota errors.

## Local PostGIS

The migration creates all core tables, PostGIS indexes, the viable-shortlist view, and RLS policies.

```bash
docker compose up -d
```

Postgres listens on `localhost:54322` with the local-only credentials in `docker-compose.yml`. The migration is mounted into the container initialization directory. Remove the named volume before restarting only when you intentionally want a clean local database.

## Deploy

### 1. Supabase

Apply `supabase/migrations/202609160001_initial.sql` with the Supabase CLI or SQL editor. Set these secrets for the scheduled pipeline:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` for the dashboard build. The anonymous key is constrained by RLS. The service-role key is never included in the dashboard artifact.

### 2. Live providers and mail

Copy only the needed names from `.env.example` into the deployment secret store. At minimum, a live run needs endpoints for each selected provider plus Gmail OAuth variables for outbound and inbound mail. Reddit requires its OAuth variables when enabled. The scheduled-agent setup is in [docs/scheduled-agent.md](docs/scheduled-agent.md).

The binding offline command never falls back to bundled data and never calls live adapters. Production adapter configuration is separate from the evaluator path so fixture and live data cannot be mixed accidentally.

### 3. Self-hosted map

Set `MAP_STYLE_URL`, `PMTILES_URL`, and `MAPLIBRE_ASSET_URL` to self-hosted assets. Without them, the dashboard uses its offline coordinate plot. Public OSM tiles and public Nominatim are not supported scheduled-run defaults.

### 4. Vercel

Install and authenticate the Vercel CLI, set the dashboard environment variables, then deploy with one command:

```bash
pnpm deploy:vercel
```

`vercel.json` runs the static build and publishes `dashboard/dist/`. In production the dashboard reads sites, evidence, scores, source exceptions, run status, and sanitized case status directly from Supabase.

## Cost controls

The default configuration costs nothing and selects only free adapters. A paid call is possible only when `paid_enabled: true` and a paid adapter is selected. Every paid call is logged with a cost class. [docs/providers.md](docs/providers.md) lists the exact switches that can incur cost.

## Safety boundaries

- No response is ever treated as approval.
- Contacts must come from a listing or official government page.
- Outreach uses approved templates only.
- The same recipient is not contacted twice for the same site inside the configured follow-up interval.
- Stop requests set do-not-contact. The system never negotiates, signs, pays, calls, or texts.
- Duplicate listings merge into one site and do not increase confidence.

Implementation choices not fixed by the task specification are recorded in [docs/decisions.md](docs/decisions.md).
