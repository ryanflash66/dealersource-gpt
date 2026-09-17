import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildDashboard } from "../scripts/build-dashboard.ts";

test("dashboard builds a credential-free static artifact", async () => {
  const output = await buildDashboard();
  const [html, script, data, runtime, tokens, shell, fonts, components] = await Promise.all([
    readFile(resolve(output, "index.html"), "utf8"),
    readFile(resolve(output, "app.js"), "utf8"),
    readFile(resolve(output, "data.json"), "utf8"),
    readFile(resolve(output, "runtime-config.js"), "utf8"),
    readFile(resolve(output, "tokens.css"), "utf8"),
    readFile(resolve(output, "dashboard.css"), "utf8"),
    readFile(resolve(output, "fonts.css"), "utf8"),
    readFile(resolve(output, "styles.css"), "utf8"),
  ]);
  await access(resolve(output, "fonts", "f0b211bc-77ba-4a37-ade2-22b89ff97aff.woff2"));
  assert.match(html, /class="app(?: |")/);
  assert.match(html, /class="topbar"/);
  assert.match(html, /class="pill-nav"/);
  assert.match(html, /id="shortlist"/);
  assert.match(script, /fetchSupabase/);
  assert.match(script, /gate-result \$\{status\}/);
  assert.match(script, /factor-bars/);
  assert.match(script, /evidence-row/);
  assert.match(html, /id="stage-strip"/);
  assert.match(html, /id="case-rows"/);
  assert.match(tokens, /--primary: #10A37F/);
  assert.match(tokens, /--primary-hover: #0D876A/);
  assert.match(fonts, /Hanken Grotesk/);
  assert.match(shell, /\.app/);
  assert.match(components, /\.site-card/);
  assert.equal(JSON.parse(data).shortlist.length, 2);
  assert.doesNotMatch(runtime, /service_role/i);
});
