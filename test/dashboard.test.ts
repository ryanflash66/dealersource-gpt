import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildDashboard } from "../scripts/build-dashboard.ts";

test("dashboard builds a credential-free static artifact", async () => {
  const output = await buildDashboard();
  const [html, script, data, runtime, tokens, components] = await Promise.all([
    readFile(resolve(output, "index.html"), "utf8"),
    readFile(resolve(output, "app.js"), "utf8"),
    readFile(resolve(output, "data.json"), "utf8"),
    readFile(resolve(output, "runtime-config.js"), "utf8"),
    readFile(resolve(output, "tokens.css"), "utf8"),
    readFile(resolve(output, "dashboard.css"), "utf8"),
  ]);
  assert.match(html, /class="ds-root"/);
  assert.match(html, /class="topbar"/);
  assert.match(html, /class="site-list"/);
  assert.match(script, /fetchSupabase/);
  assert.match(script, /chip-\$\{status\}/);
  assert.match(script, /score-track score-bar/);
  assert.match(script, /evidence-row/);
  assert.match(html, /stages stage-strip/);
  assert.match(html, /cases-table/);
  assert.match(tokens, /--accent: #10A37F/);
  assert.match(components, /\.site-card/);
  assert.equal(JSON.parse(data).shortlist.length, 2);
  assert.doesNotMatch(runtime, /service_role/i);
});
