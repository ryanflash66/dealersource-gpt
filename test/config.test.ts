import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig, parseYaml } from "../src/config.ts";
import { sourceIsSafe } from "../src/pipeline.ts";

test("minimal YAML parser reads nested maps, lists, and scalars", () => {
  const parsed = parseYaml("root:\n  enabled: true\n  count: 3\n  values: [A, B]\nitems:\n  - id: one\n    allowed: false\n") as Record<string, unknown>;
  assert.deepEqual(parsed, {
    root: { enabled: true, count: 3, values: ["A", "B"] },
    items: [{ id: "one", allowed: false }],
  });
});

test("default configuration matches hard business gates", async () => {
  const { business, providers } = await loadConfig();
  assert.deepEqual(business.rent, { min_monthly: 600, max_monthly: 1000 });
  assert.equal(business.site.office_required, true);
  assert.equal(business.site.shared_lot, "last_resort");
  assert.equal(providers.paid_enabled, false);
});

test("source allowlist fails closed", async () => {
  const { sources } = await loadConfig();
  assert.equal(sourceIsSafe(sources.find((source) => source.id === "reddit-eastern-nc")!), true);
  assert.equal(sourceIsSafe({ ...sources.find((source) => source.id === "loopnet")!, enabled: true }), false);
  assert.equal(sourceIsSafe({ ...sources.find((source) => source.id === "pitt-county-sites-buildings")!, enabled: true }), false);
  assert.equal(sourceIsSafe({ ...sources.find((source) => source.id === "craigslist")!, enabled: true, terms_status: "allowed" }), false);
});
