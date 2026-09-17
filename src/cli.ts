#!/usr/bin/env node
import { resolve } from "node:path";
import { runOfflineContract } from "./contract.ts";

function usage(message?: string): never {
  if (message) console.error(message);
  console.error("Usage: npm run pipeline -- --offline --fixtures <dir> --out <dir> --run-date YYYY-MM-DD [--config <providers.yaml>]");
  process.exit(2);
}

function parseArgs(rawArgs: string[]): {
  offline: true;
  fixturesDir: string;
  outDir: string;
  runDate: string;
  configPath?: string;
} {
  const args = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;
  if (args.includes("--help")) usage();
  const allowed = new Set(["--offline", "--fixtures", "--out", "--run-date", "--config"]);
  const values = new Map<string, string>();
  let offline = false;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!allowed.has(flag)) usage(`Unknown argument: ${flag}`);
    if (flag === "--offline") {
      if (offline) usage("--offline may be supplied only once");
      offline = true;
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) usage(`${flag} requires a value`);
    if (values.has(flag)) usage(`${flag} may be supplied only once`);
    values.set(flag, value);
    index += 1;
  }
  if (!offline) usage("--offline is required by the fixture contract");
  for (const required of ["--fixtures", "--out", "--run-date"]) {
    if (!values.has(required)) usage(`${required} is required`);
  }
  const runDate = values.get("--run-date")!;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(runDate)) usage("--run-date must use YYYY-MM-DD");
  return {
    offline: true,
    fixturesDir: resolve(values.get("--fixtures")!),
    outDir: resolve(values.get("--out")!),
    runDate,
    configPath: values.has("--config") ? resolve(values.get("--config")!) : undefined,
  };
}

const options = parseArgs(process.argv.slice(2));
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("Network access attempted while --offline is active"); };

try {
  const result = await runOfflineContract(options);
  console.log(JSON.stringify({
    status: "ok",
    run_id: result.run.run_id,
    run_date: result.run.run_date,
    sites: result.report.sites.length,
    viable_sites: result.run.counts.viable_sites,
    messages_sent: result.messages.length,
    out: options.outDir,
  }));
} catch (error) {
  console.error(JSON.stringify({ status: "error", message: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
} finally {
  globalThis.fetch = originalFetch;
}
