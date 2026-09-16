import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.ts";
import { listAdapterDefinitions, ProviderRegistry } from "../src/providers.ts";

const context = {
  offline: true,
  runId: "provider-test",
  now: "2026-09-16T09:00:00.000Z",
  log: () => undefined,
};

test("every external layer exposes free and paid adapters", () => {
  const definitions = listAdapterDefinitions();
  const layers = [...new Set(definitions.map((item) => item.layer))];
  assert.equal(layers.length, 13);
  for (const layer of layers) {
    const adapters = definitions.filter((item) => item.layer === layer);
    assert.ok(adapters.some((item) => !item.paid), `${layer} needs a free adapter`);
    assert.ok(adapters.some((item) => item.paid), `${layer} needs a paid adapter`);
  }
});

test("recorded census and nominatim adapters have distinct behavior", async () => {
  const { providers } = await loadConfig();
  const census = await ProviderRegistry.create(providers, true);
  const censusResult = await census.call<{ identityProvider: string; canonicalAddress: string }>("geocoder", { fixtureKey: "commerce-way" }, context);
  const nominatim = await ProviderRegistry.create({ ...providers, providers: { ...providers.providers, geocoder: "nominatim" } }, true);
  const nominatimResult = await nominatim.call<{ identityProvider: string; canonicalAddress: string }>("geocoder", { fixtureKey: "commerce-way" }, context);
  assert.equal(censusResult.identityProvider, "census");
  assert.equal(nominatimResult.identityProvider, "nominatim");
  assert.notEqual(censusResult.canonicalAddress, nominatimResult.canonicalAddress);
});

test("a paid adapter cannot be selected unless the master switch is enabled", async () => {
  const { providers } = await loadConfig();
  const registry = await ProviderRegistry.create({ ...providers, providers: { ...providers.providers, geocoder: "google_geocoding" } }, true);
  assert.throws(() => registry.adapter("geocoder"), /paid_enabled is false/);
});
