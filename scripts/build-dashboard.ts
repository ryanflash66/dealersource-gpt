import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runOfflineContract } from "../src/contract.ts";
import { loadConfig, loadContractProviders, projectRoot } from "../src/config.ts";

export async function buildDashboard(): Promise<string> {
  const source = resolve(projectRoot, "dashboard");
  const output = resolve(projectRoot, "dashboard", "dist");
  await mkdir(output, { recursive: true });
  await Promise.all([
    cp(resolve(source, "index.html"), resolve(output, "index.html")),
    cp(resolve(source, "fonts.css"), resolve(output, "fonts.css")),
    cp(resolve(source, "fonts"), resolve(output, "fonts"), { recursive: true }),
    cp(resolve(source, "tokens.css"), resolve(output, "tokens.css")),
    cp(resolve(source, "dashboard.css"), resolve(output, "dashboard.css")),
    cp(resolve(source, "styles.css"), resolve(output, "styles.css")),
    cp(resolve(source, "favicon.svg"), resolve(output, "favicon.svg")),
    cp(resolve(source, "src", "app.ts"), resolve(output, "app.js")),
  ]);

  const contractOutput = resolve(projectRoot, ".data", "contract");
  const reportPath = process.env.DEALERSOURCE_REPORT_PATH
    ? resolve(process.env.DEALERSOURCE_REPORT_PATH)
    : resolve(contractOutput, "report.json");
  let report: string;
  try {
    report = await readFile(reportPath, "utf8");
  } catch {
    const built = await runOfflineContract({
      fixturesDir: resolve(projectRoot, "test", "fixtures", "golden-v1", "input"),
      outDir: contractOutput,
      runDate: "2026-09-16",
    });
    report = `${JSON.stringify(built.report, null, 2)}\n`;
  }
  await writeFile(resolve(output, "data.json"), report, "utf8");

  const [config, providers] = await Promise.all([loadConfig(projectRoot), loadContractProviders()]);
  const publicConfig = {
    supabaseUrl: process.env.SUPABASE_URL ?? "",
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? "",
    mapStyleUrl: process.env.MAP_STYLE_URL ?? "",
    maplibreAssetUrl: process.env.MAPLIBRE_ASSET_URL ?? "",
    pmtilesUrl: process.env.PMTILES_URL ?? "",
    publicConfig: { business: config.business, providers },
  };
  await writeFile(resolve(output, "runtime-config.js"), `window.DEALERSOURCE_CONFIG = ${JSON.stringify(publicConfig)};\n`, "utf8");
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const output = await buildDashboard();
  console.log(`Dashboard built at ${output}`);
}
