import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { projectRoot } from "../src/config.ts";

type JsonSchema = Record<string, any>;

function validate(schema: JsonSchema, data: unknown, root = schema, path = "$"): string[] {
  const errors: string[] = [];
  const current = schema.$ref ? root.$defs[schema.$ref.split("/").at(-1)!] : schema;
  if (current.const !== undefined && data !== current.const) errors.push(`${path}: expected ${JSON.stringify(current.const)}`);
  if (current.enum && !current.enum.includes(data)) errors.push(`${path}: value is outside enum`);
  if (current.type) {
    const expected = [current.type].flat();
    const actual = data === null ? "null" : Array.isArray(data) ? "array" : Number.isInteger(data) ? "integer" : typeof data;
    if (!expected.some((item) => item === actual || (item === "number" && actual === "integer"))) return [`${path}: expected ${expected.join("|")}, got ${actual}`];
  }
  if (typeof data === "string") {
    if (current.minLength && data.length < current.minLength) errors.push(`${path}: too short`);
    if (current.pattern && !new RegExp(current.pattern).test(data)) errors.push(`${path}: pattern mismatch`);
  }
  if (typeof data === "number" && current.minimum !== undefined && data < current.minimum) errors.push(`${path}: below minimum`);
  if (Array.isArray(data)) {
    if (current.minItems && data.length < current.minItems) errors.push(`${path}: too few items`);
    if (current.items) data.forEach((item, index) => errors.push(...validate(current.items, item, root, `${path}[${index}]`)));
  }
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const record = data as Record<string, unknown>;
    for (const key of current.required ?? []) if (!(key in record)) errors.push(`${path}: missing ${key}`);
    for (const [key, subschema] of Object.entries(current.properties ?? {})) {
      if (key in record) errors.push(...validate(subschema as JsonSchema, record[key], root, `${path}.${key}`));
    }
  }
  return errors;
}

function runContract(fixtures: string, out: string, config?: string) {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const args = ["run", "pipeline", "--", "--offline", "--fixtures", fixtures, "--out", out, "--run-date", "2026-09-16"];
  if (config) args.push("--config", config);
  const env = { ...process.env, CI: "1", HTTP_PROXY: "http://127.0.0.1:9", HTTPS_PROXY: "http://127.0.0.1:9", NO_PROXY: "" };
  for (const key of Object.keys(env)) if (/^(SUPABASE|GMAIL|GOOGLE|REDDIT|VERCEL|ANTHROPIC|DEALERSOURCE)_/.test(key)) delete env[key];
  const quote = process.platform === "win32"
    ? (value: string) => `"${value.replaceAll('"', '""')}"`
    : (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const command = [npm, ...args].map(quote).join(" ");
  return spawnSync(command, { cwd: projectRoot, env, encoding: "utf8", timeout: 60_000, shell: true });
}

async function json(path: string): Promise<any> {
  return JSON.parse(await readFile(path, "utf8"));
}

test("golden-v1 exact CLI contract matches expected results and replays idempotently", async () => {
  const fixtureRoot = resolve(projectRoot, "test", "fixtures", "golden-v1");
  const fixtures = resolve(fixtureRoot, "input");
  const expected = await json(resolve(fixtureRoot, "expected.json"));
  const out = await mkdtemp(resolve(tmpdir(), "dealersource-contract-"));

  const first = runContract(fixtures, out);
  assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
  assert.deepEqual((await readdir(out)).sort(), ["messages.json", "report.json", "run.json", "state"]);

  const report = await json(resolve(out, "report.json"));
  const messages = await json(resolve(out, "messages.json"));
  const run = await json(resolve(out, "run.json"));
  for (const [name, value] of Object.entries({ report, messages, run })) {
    const schema = await json(resolve(projectRoot, "test", "fixtures", "contract", `${name}.schema.json`));
    assert.deepEqual(validate(schema, value), [], `${name}.json must validate against the contract schema`);
  }

  assert.equal(report.schema_version, "1");
  assert.equal(report.run_date, expected.run_date);
  assert.equal(report.offline, true);
  assert.deepEqual(report.external_calls, []);
  const byParcel = new Map(report.sites.map((site: any) => [site.parcel_id, site]));
  assert.deepEqual([...byParcel.keys()].sort(), Object.keys(expected.sites).sort(), "site set must match expected parcels");
  for (const [parcelId, expectedSite] of Object.entries(expected.sites) as Array<[string, any]>) {
    const site = byParcel.get(parcelId);
    assert.ok(site, `${parcelId} must be present`);
    assert.deepEqual([...site.listing_ids].sort(), [...expectedSite.listing_ids].sort(), `${parcelId} listing dedupe`);
    assert.equal(site.in_search_area, expectedSite.in_search_area, `${parcelId} search area`);
    assert.equal(site.shared_lot, expectedSite.shared_lot, `${parcelId} shared lot`);
    assert.equal(site.viable, expectedSite.viable, `${parcelId} viability`);
    if (expectedSite.gates) {
      for (const name of ["zoning", "rent", "flood"]) {
        assert.equal(site.gates[name].status, expectedSite.gates[name], `${parcelId} ${name} gate`);
      }
    }
  }
  const ranked = report.sites.filter((site: any) => site.viable).sort((a: any, b: any) => a.rank - b.rank).map((site: any) => site.parcel_id);
  assert.deepEqual(ranked, expected.viable_rank_order);
  assert.ok(report.sites.every((site: any) => site.viable ? Number.isInteger(site.rank) && site.rank >= 1 : site.rank === null));

  const siteParcel = new Map(report.sites.map((site: any) => [site.site_id, site.parcel_id]));
  const sent = messages.map((message: any) => ({ parcel_id: siteParcel.get(message.site_id), case_type: message.case_type, to: message.to }));
  assert.deepEqual(sent, expected.outreach_run1);
  assert.equal(new Set(messages.map((message: any) => `${message.site_id}|${message.case_type}|${message.to}`)).size, messages.length);
  for (const parcelId of expected.no_outreach_parcels) assert.ok(!sent.some((message: any) => message.parcel_id === parcelId));

  const second = runContract(fixtures, out);
  assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
  assert.deepEqual(await json(resolve(out, "messages.json")), []);
});

test("--config switches the echoed contract provider without code changes", async () => {
  const fixtures = resolve(projectRoot, "test", "fixtures", "golden-v1", "input");
  const out = await mkdtemp(resolve(tmpdir(), "dealersource-contract-config-"));
  const config = resolve(out, "providers.alt.yaml");
  const source = await readFile(resolve(projectRoot, "providers.yaml"), "utf8");
  await writeFile(config, source.replace(/^geocoder:\s*census$/m, "geocoder: nominatim"), "utf8");
  const result = runContract(fixtures, out, config);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal((await json(resolve(out, "report.json"))).providers.geocoder, "nominatim");
});
