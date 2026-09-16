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
