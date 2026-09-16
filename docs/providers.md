# Providers and cost controls

Each external layer is selected in `providers.yaml`. The registry validates the layer/name pair and uses recorded fixtures whenever `--offline` is present or the selected adapter's endpoint variable is absent and `fixture_fallback` is true.

Paid calls require both controls:

1. Set `paid_enabled: true`.
2. Select a paid adapter for that layer.

Every paid call is logged with `paid: true` and a cost class. The default selects only free adapters and makes zero paid calls.

Cost starts when any of these adapters is selected with paid providers enabled and its endpoint and credential are configured: Google Geocoding, Google Distance Matrix, Google Street View, Google Places, Mapbox, Regrid, AnyCrawl Cloud, Claude API, or one of the optional paid traffic, flood, social, mail, or zoning services.

Public OpenStreetMap tile servers and public Nominatim are not valid production endpoints. `NOMINATIM_URL`, `OVERPASS_URL`, `PMTILES_URL`, and `MAP_STYLE_URL` must point to self-hosted or explicitly approved services.
