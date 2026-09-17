# Decisions

The task spec is authoritative. These choices fill gaps without changing its gates.

1. **Runtime:** Node.js 22.6 or newer runs TypeScript directly with type stripping. The project has no runtime or test dependencies, so fixture acceptance does not require a registry connection.
2. **Offline persistence:** The default store is a replay-safe JSON file under `.data/`. Hosted Supabase remains the production store and is represented by migrations and an adapter boundary.
3. **Evidence expiry:** Fixture zoning, rent, and flood evidence uses a 90-day default TTL. Expired evidence fails its gate.
4. **Source safety:** A source is crawlable only when enabled, `robots_txt: allowed`, and `terms_status: allowed`. `unknown` and `unclear` fail closed until a PM records approval.
5. **Fixture geography:** All fixture addresses and contacts are synthetic. `Greenville, NC 27858` is retained only as the spec's non-secret development home-base placeholder.
6. **Dashboard map:** Offline mode uses a coordinate plot with no network requests. Deployment can enable MapLibre with a self-hosted style and PMTiles URL; public OSM services are never defaults.
7. **Visibility score:** Frontage contributes 50%, corner-lot status 25%, and verified signage line-of-sight 25% before the configured ranking weight is applied.
8. **Normalized ranking:** Traffic is capped at 30,000 AADT, distance at the configured drive-time limit, rent within the configured range, and competitor density at 10 nearby dealers.
9. **Dashboard access:** Site, evidence, score, source, and run data may be read through the anonymous Supabase key under RLS. Case status is exposed through column grants that exclude contact addresses and message bodies.
10. **Production cutover:** Fixture fallback stays on for credential-free builds. Deployment documentation requires turning it off before production so incomplete live configuration fails visibly.
11. **Fixture clock:** Recorded evidence and the documented acceptance run use 2026-09-16 so expiry and replay behavior remain deterministic.
12. **Dashboard template v2 integration:** The published `fonts.css`, font files, and `dashboard.css` are shipped verbatim. `tokens.css` differs only at the four allowed primary-color declarations: light `#10A37F`/`#0D876A` and dark `#38CBA4`/`#63D8B8`. Runtime data is rendered into the template's four page layouts and component class names. App-only behavior and accessibility rules live in `styles.css`.
13. **Dashboard contract adapter:** The v2 views normalize the binding snake_case `report.json` in the browser. Gate rows resolve their cited evidence IDs and show the contract source, fetched time, and expiry without inventing missing values.
14. **Derived factor shades:** The v2 template's factor colors are derived from the assigned primary hue in `styles.css`. This keeps the copied token file within the template's allowed primary-only edits while preserving the five distinct score-factor bars.
15. **Offline contract boundary:** The evaluator CLI uses a dedicated adapter that reads all nine files from `--fixtures`, maps them into site, evidence, case, and message records, and writes only the three contract files plus replay state under `--out/state/`. It never falls back to the repository's original fixtures.
16. **Out-of-area gate representation:** The report schema requires a three-gate object for every site, while the golden contract intentionally omits expected gate assertions for out-of-area sites. Those sites therefore report all three gates as `pending` with no evidence, remain unscored, and never trigger outreach.
17. **Deterministic official evidence time:** Contract fixtures do not timestamp zoning or flood rows. Their `fetched_at` uses the logical run start and their expiry uses the configured evidence TTL. Listing and reply evidence retains its supplied timestamp.
