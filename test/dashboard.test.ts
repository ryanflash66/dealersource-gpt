import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildDashboard } from "../scripts/build-dashboard.ts";

test("dashboard builds a credential-free static artifact", async () => {
  const output = await buildDashboard();
  const [html, script, data, runtime] = await Promise.all([
    readFile(resolve(output, "index.html"), "utf8"),
    readFile(resolve(output, "app.js"), "utf8"),
    readFile(resolve(output, "data.json"), "utf8"),
    readFile(resolve(output, "runtime-config.js"), "utf8"),
  ]);
  assert.match(html, /Verified shortlist/);
  assert.match(script, /fetchSupabase/);
  assert.equal(JSON.parse(data).shortlist.length, 2);
  assert.doesNotMatch(runtime, /service_role/i);
});
