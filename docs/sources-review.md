# Source findings and ingestion status

Reviewed September 16, 2026. These findings support a conservative allowlist, not a legal opinion or a claim of complete low-rent coverage. No real listing crawl or verification email was run during the build.

| Class/source | Seeded status | Evidence and limitation |
| --- | --- | --- |
| Synthetic fixture collection | allowed, enabled | Original fixture material authored for this solution, with no actual property or personal contact data. |
| Pitt County Sites and Buildings | unclear, disabled | Official available-properties page found at https://www.pittcountync.gov/1172/Sites-Buildings . Automated reuse/robots permission and target price coverage not established. |
| Invest Greenville property search | unclear, disabled | https://www.investgreenvillenc.com/real-estate-resources/properties identifies regional opportunities. No blanket automation permission or small-site coverage inferred. |
| Chamber/local broker discovery | unclear, disabled | https://www.greenvillenc.org/ is a verified chamber resource. Broker/manager POI candidates require their own URL and terms review before any crawl. |
| Public RSS/listing feed class | unclear, disabled | No specific permitted RSS feed was established. The seed is a discovery candidate and is explicitly not presented as a verified feed endpoint. |
| Reddit official API | unclear, disabled | https://www.redditinc.com/policies/data-api-terms section 3.1 requires a separate agreement for commercial use. OAuth alone is not approval, and no free commercial access is assumed. |
| LoopNet | prohibited, disabled | https://www.loopnet.com/solutions/LoopNetTerms-of-Use prohibits scraping and automated extraction without authorization. |
| Craigslist | prohibited, disabled | https://www.craigslist.org/about/terms.of.use/en USE section prohibits automated collection without separate permission. |
| Facebook Marketplace | prohibited, disabled | https://www.facebook.com/legal/automated_data_collection_terms requires express written permission for automated collection. None is configured. |
| Crexi | unclear, disabled | https://www.crexi.com/tos was located but its actual automation clauses could not be reliably retrieved. The failed/unreliable retrieval is not converted into an invented permission or prohibition. |

Unknown robots status is a blocker. A reviewer must record actual robots and applicable terms before enabling a real source. No `enabled` value overrides prohibited terms or disallowed robots.

## Data adapter references

- US Census Geocoder: https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html
- NC OneMap: https://www.nconemap.gov/
- NCDOT traffic data: https://connect.ncdot.gov/resources/State-Mapping/Pages/Traffic-Survey-GIS-Data.aspx
- FEMA NFHL services: https://hazards.fema.gov/femaportal/resources/flood_map_svc.htm
- OSRM API: https://project-osrm.org/docs/v5.24.0/api/
- OpenRouteService API: https://openrouteservice.org/dev/#/api-docs
- Gmail API: https://developers.google.com/workspace/gmail/api/guides/sending
- Public Nominatim policy: https://operations.osmfoundation.org/policies/nominatim/
- OSM tile policy: https://operations.osmfoundation.org/policies/tiles/

Free software, a public page and a usable data license are different things. Publisher changes, endpoint schemas, update dates, credentials and terms must be verified at deployment. Raw source payloads and model extractions are stored separately for traceability. Repeated syndication does not increase confidence.
