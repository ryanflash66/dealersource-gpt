#!/usr/bin/env node
import { resolve } from "node:path";
import { runPipeline, stageNames, type StageName } from "./pipeline.ts";
import { projectRoot } from "./config.ts";

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function usage(): never {
  console.error("Usage: pnpm pipeline --offline [--date YYYY-MM-DD] [--state PATH] [--stage discover|resolve|enrich|verify|score|report]");
  process.exit(2);
}

const args = process.argv.slice(2);
if (args.includes("--help")) usage();
const offline = args.includes("--offline") || process.env.DEALERSOURCE_OFFLINE === "1";
const runDate = valueAfter(args, "--date") ?? new Date().toISOString().slice(0, 10);
const stateValue = valueAfter(args, "--state");
const stageValue = valueAfter(args, "--stage") as StageName | undefined;
if (!/^\d{4}-\d{2}-\d{2}$/.test(runDate)) usage();
if (stageValue && !stageNames.includes(stageValue)) usage();

try {
  const result = await runPipeline({
    offline,
    runDate,
    statePath: stateValue ? resolve(stateValue) : undefined,
    stages: stageValue ? [stageValue] : undefined,
  });
  for (const entry of result.run.logs) console.log(JSON.stringify(entry));
  console.log(JSON.stringify({
    status: "ok",
    runId: result.run.id,
    mode: result.run.mode,
    stages: result.run.stagesCompleted,
    counts: result.run.counts,
    paidCalls: result.run.paidCalls,
    report: resolve(projectRoot, ".data", "report.json"),
  }));
} catch (error) {
  console.error(JSON.stringify({ status: "error", message: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
}
