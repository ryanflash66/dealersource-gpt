import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { projectRoot } from "../src/config.ts";
import { runPipeline } from "../src/pipeline.ts";

test("changing one providers.yaml line switches geocoder behavior", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "dealersource-switch-"));
  await mkdir(resolve(root, "fixtures"));
  await Promise.all([
    cp(resolve(projectRoot, "business.yaml"), resolve(root, "business.yaml")),
    cp(resolve(projectRoot, "sources.yaml"), resolve(root, "sources.yaml")),
    cp(resolve(projectRoot, "fixtures", "providers.json"), resolve(root, "fixtures", "providers.json")),
    cp(resolve(projectRoot, "fixtures", "listings.json"), resolve(root, "fixtures", "listings.json")),
  ]);
  const providers = (await readFile(resolve(projectRoot, "providers.yaml"), "utf8")).replace("geocoder: census", "geocoder: nominatim");
  await writeFile(resolve(root, "providers.yaml"), providers, "utf8");
  const result = await runPipeline({ offline: true, runDate: "2026-09-16", root, statePath: resolve(root, "state.json"), reportPath: resolve(root, "report.json") });
  assert.match(result.state.sites[0].address, /Pitt County/);
  assert.ok(result.run.logs.some((entry) => entry.event === "provider.call" && entry.details.provider === "nominatim"));
});
