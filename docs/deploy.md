# Deployment, separate from offline acceptance

Nothing here is executed by the default test, pipeline or dashboard commands. Real deployment requires the deployer's environment and account permissions. Do not put secrets in Git.

## Supabase and local PostGIS

For Supabase, apply `migrations/001_schema.sql` followed by `migrations/002_dashboard.sql` using the database migration owner. RLS is enabled. The server uses `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; the dashboard receives only `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY`. Register the intended authenticated user's UUID in `app_users` through an administrative migration. Anonymous access is denied. The dashboard accepts an existing Supabase access token in the URL fragment, removes it from the address bar immediately, and keeps it only in memory; it does not add a separate login/settings view.

Local database option (Docker image must already be present for no-network startup):

```sh
docker compose up -d --wait
DATABASE_URL=postgresql://postgres:local-development-only@127.0.0.1:54329/dealersource npm run db:test
```

The local bootstrap creates Supabase-compatible roles and a test `auth.uid()` function. The password is deliberately local-development-only; the port is bound to loopback. Do not use this compose configuration as an internet-facing database. `db:test` applies migrations and a transactional RLS/lease/geometry smoke test. With no `DATABASE_URL` it reports NOT RUN and exits 2 rather than pretending a database test happened.

The supplied build environment had no Docker or psql; the SQL was reviewed and tested structurally, not executed there. Full PostGIS geometry and RLS execution remain a deployment-validation step.

## Configure providers

Edit one selected value in `providers.yaml`, for example:

```json
"geocoding": "nominatim"
```

No code change is needed. If that adapter's environment variables are unset, its original recorded fixture implementation is used. `--offline` forces fixture implementations even if environment variables exist. Supported IDs and required variables are defined by `CATALOG` in `src/providers/index.ts` and listed in `.env.example`.

Census, Nominatim, OSRM, Valhalla, Google geocoding/distance/POI, ArcGIS queries, AnyCrawl and Reddit request construction have explicit adapter paths. Vendor response schemas are normalized at one boundary. A deployment gateway can return `{ "dealersource": <normalized layer data> }` where the source's particular schema differs. It must preserve provenance and must not manufacture verified facts. Official-only layers do not have artificial paid alternatives.

Examples of required normalized layer facts:
- Zoning: status, official=true, exact section, layer_url and use_table_url, and verified conditional status where applicable. A district lookup alone remains unknown.
- Flood: centroid_zone, high_risk_fraction, coverage_complete and geometry_checked. Raw ArcGIS geometries can be conservatively measured locally for supported convex shapes; use the supplied `flood_metrics` PostGIS RPC for complex shapes.
- Drive time: minutes and inside_isochrone from the configured home base. Straight-line distance is not acceptable.
- Traffic: AADT for the fronting road, road identity and source year. A nearest unrelated count is not sufficient.
- Imagery: source/capture date and image URL; frontage/corner/line-of-sight metrics require recorded evidence, not mere image availability.

Public Nominatim and OSM public tile servers are explicitly rejected for scheduled calls. Host routing/map services and the NC extract yourself, or choose an approved provider within its terms and limits.

## Gmail OAuth and approved outreach

Supply either a short-lived `GMAIL_ACCESS_TOKEN` or the refresh-token/client-ID/client-secret trio. Refresh is performed at run time. Select `mail.sender` as `owner` or `operator`; set only the corresponding authorized mailbox address. The code never silently chooses a different mailbox. Reply-To is the same sender.

Use appropriate Google OAuth send/read scopes and complete any required Workspace admin/verification steps before deployment. The scheduled code polls tracked inquiry threads, preserving case IDs and provider IDs. The model may extract a bounded answer; it never creates a new inquiry template. Live test messages require explicitly approved recipients. All fixture addresses end in `example.invalid` and cannot be sent through the live adapter.

To pause sending, set `mail.paused` to true in `business.yaml`. A quota/bounce pause is persistent and visible. After investigating and fixing its cause, an authorized operator can use:

```sh
npm run pipeline -- --resume-mail
```

Do not use that command to bypass a quota or recipient opt-out. Contact opt-outs remain stored. Ambiguous sends are escalated for reconciliation, not retried automatically. Do not force-delete database locks or reset message history to make a run proceed.

## Source allowlist

Every crawl requires `enabled: true`, `terms_status: allowed`, and `robots_txt: allowed`. To enable a grey source, research its actual terms and robots policy, record the reviewer/date/policy URL in `sources.yaml`, and explicitly change its status. Merely being publicly visible is not permission. Do not flip a prohibited source without an applicable authorization. The initial registry includes excluded marketplace classes and unverified local/Reddit/RSS candidates so coverage gaps are visible.

Local broker POIs discovered by enrichment become disabled source-review candidates. No broker/MLS integration is implemented. Tax-record owner lookups and off-market outreach are outside this version.

## Dashboard and Vercel

```sh
npm run dashboard:build
npm run deploy
```

The first command is offline and creates `dist/`. With no public Supabase variables it builds only synthetic report data. When public Supabase variables are set, it omits `report.json` so private live state is never baked into a public static bundle. The browser requests the RLS-protected `get_dashboard` RPC.

The deploy command invokes the Vercel CLI and requires authorized account/network access; it is not part of offline acceptance. Supply the public configuration to Vercel and use Node.js 24. Vercel and database quotas may cost money; do not enable automatic overages by assumption.

For a real basemap, provide same-origin/self-hosted MapLibre and PMTiles ES modules plus a reviewed style JSON via `MAPLIBRE_SCRIPT_URL`, `PMTILES_SCRIPT_URL`, `MAP_STYLE_URL` and `PMTILES_URL`. The default synthetic coordinate map never fetches a public map server. MapLibre is a renderer, not a free tile-hosting service.

## What starts costing money

Default fixture execution has zero external calls and no new subscriptions. Hardware/time remain real operating costs. Paid endpoints require their explicit selection and `providers.paid_enabled: true`, plus deployment credentials. Every paid transport call records `cost_class: paid` without credentials in logs. Google/Regrid/Mapbox/AnyCrawl cloud/Claude API fees depend on their plans and use. Claude Max is not API credit. Reddit commercial access may require a separate agreement. Map hosting, Supabase, Vercel and professional/agency work may also cost; no live cost or coverage guarantee is asserted by offline tests.
