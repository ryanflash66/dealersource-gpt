import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { buildDashboard } from "../scripts/build-dashboard.ts";
import { projectRoot } from "../src/config.ts";

const output = await buildDashboard();
const port = Number(process.env.PORT ?? 4321);
const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml" };

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    let path = url.pathname === "/api/data" ? resolve(projectRoot, ".data", "contract", "report.json") : resolve(output, `.${url.pathname === "/" ? "/index.html" : url.pathname}`);
    try {
      if ((await stat(path)).isDirectory()) path = resolve(path, "index.html");
    } catch {
      if (url.pathname === "/api/data") path = resolve(output, "data.json");
      else path = resolve(output, "index.html");
    }
    const body = await readFile(path);
    response.writeHead(200, { "content-type": mime[extname(path)] ?? "application/octet-stream", "cache-control": "no-store" });
    response.end(body);
  } catch (error) {
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
});

server.listen(port, "127.0.0.1", () => console.log(`DealerSource dashboard: http://127.0.0.1:${port}`));
