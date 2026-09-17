import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { loadConfig, loadContractProviders, projectRoot } from "../src/config.ts";
import { runOfflineContract } from "../src/contract.ts";
import {
  evidenceExceptions,
  normalizeContractReport,
  pipelineRowView,
  reportAge,
  resolveTheme,
  stageCounts,
} from "../dashboard/src/view-model.ts";

async function goldenDashboard() {
  const outDir = await mkdtemp(resolve(tmpdir(), "dealersource-dashboard-model-"));
  const result = await runOfflineContract({
    fixturesDir: resolve(projectRoot, "test", "fixtures", "golden-v1", "input"),
    outDir,
    runDate: "2026-09-16",
  });
  const [config, providers] = await Promise.all([loadConfig(projectRoot), loadContractProviders()]);
  return normalizeContractReport(result.report, result.messages, result.run, {
    business: config.business,
    providers,
    sources: config.sources,
  });
}

test("pipeline stage counts are non-zero and consistent with the golden site list", async () => {
  const report = await goldenDashboard();
  assert.deepEqual(stageCounts(report), {
    discovered: 10,
    resolved: 8,
    enriched: 7,
    verifying: 1,
    scored: 3,
    excluded: 4,
  });
});

test("every excluded row has a specific outcome and out-of-area gates are not rendered", async () => {
  const report = await goldenDashboard();
  const evidenceById = new Map<string, any>(report.evidence.map((item: any) => [item.evidence_id, item]));
  const excluded = Object.fromEntries(report.pipeline
    .filter((site: any) => !site.viable && (site.inSearchArea === false || site.gates.some((gate: any) => gate.status === "fail")))
    .map((site: any) => [site.parcelId, pipelineRowView(site, evidenceById, report.config.business)]));

  assert.equal(excluded["WAYN-0007"].showGates, false);
  assert.match(excluded["WAYN-0007"].outcome, /Outside 60 min search area \(78 min\)/);
  assert.match(excluded["PITT-0003"].outcome, /\$1,400\/mo exceeds \$1,000 maximum/);
  assert.match(excluded["BEAU-0004"].outcome, /B1 does not permit used vehicle sales/);
  assert.match(excluded["PITT-0005"].outcome, /Flood zone AE \(85% high-risk area\)/);
  assert.ok(Object.values(excluded).every((row: any) => !/recorded|one answer away/i.test(row.outcome)));
});

test("dashboard model includes sent mail, correct follow-up dates, listing details, and open cases", async () => {
  const report = await goldenDashboard();
  assert.equal(report.messages.length, 3);
  assert.deepEqual(report.messages.map((item: any) => item.case_type).sort(), ["rent", "zoning", "zoning"]);

  const ayden = report.pipeline.find((site: any) => site.parcelId === "PITT-0008");
  assert.equal(ayden.openCases.length, 1);
  assert.equal(ayden.openCases[0].openedAt, "2026-09-16T10:00:00.000Z");
  assert.equal(ayden.openCases[0].nextActionAt, "2026-09-21T10:00:00.000Z");

  const memorial = report.pipeline.find((site: any) => site.parcelId === "PITT-0001");
  assert.deepEqual(memorial.listings.map((item: any) => [item.listing_id, item.source_id, item.rent_monthly]), [
    ["L01", "broker-a", 800],
    ["L02", "greenville-ed-available-properties", 800],
    ["L03", "reddit-r-greenvillenc", null],
  ]);
});

test("drawer evidence uses contract facts and exceptions include prohibited sources", async () => {
  const report = await goldenDashboard();
  const memorial = report.pipeline.find((site: any) => site.parcelId === "PITT-0001");
  assert.match(memorial.gates.find((gate: any) => gate.name === "zoning").reason, /Greenville Code sec\. 9-4-78/);
  assert.equal(memorial.gates.find((gate: any) => gate.name === "rent").reason, "$800/mo, within $600 to $1,000");
  assert.equal(memorial.gates.find((gate: any) => gate.name === "flood").reason, "Zone X, 0% high-risk area");
  assert.ok(memorial.gates.every((gate: any) => gate.sourceUrl && gate.method && gate.fetchedAt && gate.expiresAt));

  const excludedNames = report.exceptions.filter((item: any) => item.type === "source").map((item: any) => item.label).sort();
  assert.deepEqual(excludedNames, ["Craigslist", "Crexi", "Facebook Marketplace", "LoopNet"]);
});

test("staleness, evidence expiry, and explicit theme overrides are deterministic", async () => {
  const report = await goldenDashboard();
  assert.deepEqual(reportAge(report.generatedAt, Date.parse("2026-09-17T10:05:01Z")), { stale: true, hours: 25 });
  assert.equal(resolveTheme("?theme=dark", false), "dark");
  assert.equal(resolveTheme("?theme=light", true), "light");
  assert.equal(resolveTheme("", true), "dark");

  const expiring = evidenceExceptions({ evidence: [
    { evidence_id: "expired", expires_at: "2026-09-15T00:00:00Z" },
    { evidence_id: "soon", expires_at: "2026-09-20T00:00:00Z" },
    { evidence_id: "later", expires_at: "2026-10-20T00:00:00Z" },
  ] }, Date.parse("2026-09-16T00:00:00Z"));
  assert.deepEqual(expiring.map((item: any) => item.evidence_id), ["expired", "soon"]);
});
