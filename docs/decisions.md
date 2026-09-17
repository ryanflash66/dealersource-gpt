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
12. **Dashboard template v2 integration:** The published `fonts.css`, font files, and `dashboard.css` are shipped verbatim. After the user rejected green, `tokens.css` differs only at the four allowed primary-color declarations: light `#5B4BC4`/`#4938AD` and dark `#A99BFF`/`#C1B8FF`. Runtime data is rendered into the template's four page layouts and component class names. App-only behavior and accessibility rules live in `styles.css`.
13. **Dashboard evidence fallback:** The current `report.json` contract carries gate reasons and source URLs but not full evidence timestamps. The evidence table therefore labels the report generation date as fetched and the configured lifetime as `report TTL` instead of inventing expiration dates.
14. **Derived factor shades:** The v2 template's factor colors are derived from the assigned primary hue in `styles.css`. This keeps the copied token file within the template's allowed primary-only edits while preserving the five distinct score-factor bars.
