# Architecture

## Data flow

```text
approved sources
      |
  discover -> raw documents + extracted listings
      |
  resolve  -> canonical address + parcel + deduplicated site
      |
  enrich   -> zoning + flood + AADT + drive time + imagery + competitors
      |
  verify   -> cases + approved email templates + reply ingestion boundary
      |
  score    -> three hard gates + operational checks + weighted score
      |
  report   -> ranked shortlist + pipeline + exceptions + read-only config
```

Each stage upserts deterministic records and saves after completion. A failed run can repeat one stage or start again without creating duplicate sites, evidence, cases, or same-day messages.

## Trust boundaries

Provider selection is configuration-driven. `ProviderRegistry` enforces the paid-provider master switch and chooses a recorded fixture whenever the run is offline. `JsonStateStore` is the credential-free storage adapter; `SupabaseStateStore` activates only when a live run has both Supabase URL and service-role key.

Raw source payloads and model extractions are stored separately. A duplicate listing merges by canonical fixture site key. It contributes a source link but no confidence multiplier.

Only current evidence with a source URL, fetch timestamp, expiry, verification method, and verified flag can pass a gate. Site requirements for an enclosed office, display capacity, drive time, and shared-lot policy are checked after the three evidence gates.

## Ranking

Configured weights apply to normalized traffic, visibility, distance, rent, and competitor density. Visibility combines frontage, corner-lot status, and signage line-of-sight. The final sort partitions standalone sites before shared lots, even when a shared site has the higher numerical score.

## Dashboard

The dashboard is a zero-dependency static application. Offline development reads `.data/report.json`; its build embeds the same report as `data.json`. A deployed build with Supabase variables reads RLS-protected REST tables directly. Case reads expose status and next action but not contact addresses or message bodies.

The default map is a no-network coordinate plot. A deployed environment can upgrade it to MapLibre by providing a self-hosted MapLibre asset directory and style. The style can reference self-hosted PMTiles.
