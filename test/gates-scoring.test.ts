import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.ts";
import { evaluateGates } from "../src/gates.ts";
import { rankSites, scoreSite } from "../src/scoring.ts";
import type { Evidence, SiteRecord } from "../src/types.ts";

function site(overrides: Partial<SiteRecord> = {}): SiteRecord {
  return {
    id: "site-test", siteKey: "test", address: "1 Fixture Way", latitude: 35, longitude: -77,
    parcelId: "fixture", listingIds: ["listing"], sourceUrls: ["https://fixtures.local/listing"], monthlyRent: 800,
    office: true, vehicleDisplay: 5, sharedLot: false, stage: "enriched",
    metrics: { aadt: 20000, frontageFeet: 150, cornerLot: true, signageVisible: true, driveMinutes: 20, competitors: 2 },
    imagery: [], gates: [], viable: false, score: null, ...overrides,
  };
}

function evidence(fact: string, value: unknown, overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: `evidence-site-test-${fact}`, siteId: "site-test", fact, value,
    sourceUrl: `https://fixtures.local/${fact}`, fetchedAt: "2026-09-15T00:00:00.000Z",
    expiresAt: "2026-12-15T00:00:00.000Z", method: "fixture", verified: true, ...overrides,
  };
}

test("all three gates require current cited evidence", async () => {
  const { business } = await loadConfig();
  const items = [
    evidence("zoning", { permitted: true }, { citation: "UDO §1" }),
    evidence("rent", { monthlyRent: 800 }),
    evidence("flood", { centroidZone: "X", highRiskAreaPct: 2 }),
  ];
  assert.deepEqual(evaluateGates(site(), items, business, "2026-09-16T23:59:59.999Z").map((item) => item.status), ["pass", "pass", "pass"]);
  items[0].expiresAt = "2026-09-16T00:00:00.000Z";
  assert.equal(evaluateGates(site(), items, business, "2026-09-16T23:59:59.999Z")[0].status, "expired");
  items[0].expiresAt = "2026-12-15T00:00:00.000Z";
  items[2].value = { centroidZone: "AE", highRiskAreaPct: 60 };
  assert.equal(evaluateGates(site(), items, business, "2026-09-16T23:59:59.999Z")[2].status, "fail");
});

test("shared lots always rank after standalone sites regardless of score", async () => {
  const { business } = await loadConfig();
  const standalone = site({ id: "standalone", score: { traffic: 1, visibility: 1, distance: 1, rent: 1, competitors: 1, total: 5 } });
  const shared = site({ id: "shared", sharedLot: true });
  shared.score = scoreSite(shared, business);
  assert.ok(shared.score.total > standalone.score!.total);
  assert.deepEqual(rankSites([shared, standalone]).map((item) => item.id), ["standalone", "shared"]);
});
