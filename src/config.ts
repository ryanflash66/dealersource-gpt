import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { BusinessConfig, ProviderConfig, SourceRecord } from "./types.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function stripComment(line: string): string {
  let single = false;
  let double = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "'" && !double) single = !single;
    if (char === '"' && !single) double = !double;
    if (char === "#" && !single && !double && (index === 0 || /\s/.test(line[index - 1]))) {
      return line.slice(0, index).trimEnd();
    }
  }
  return line.trimEnd();
}

function parseScalar(raw: string): unknown {
  const value = raw.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    return inner ? inner.split(",").map((item) => parseScalar(item)) : [];
  }
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function splitPair(text: string): [string, string] {
  const separator = text.indexOf(":");
  if (separator < 1) throw new Error(`Invalid YAML line: ${text}`);
  return [text.slice(0, separator).trim(), text.slice(separator + 1).trim()];
}

export function parseYaml(text: string): unknown {
  const lines = text
    .split(/\r?\n/)
    .map((raw) => ({ raw: stripComment(raw), indent: raw.match(/^\s*/)?.[0].length ?? 0 }))
    .filter((line) => line.raw.trim().length > 0);
  const root: Record<string, unknown> = {};
  const stack: Array<{ indent: number; value: Record<string, unknown> | unknown[] }> = [
    { indent: -1, value: root },
  ];

  for (let index = 0; index < lines.length; index += 1) {
    const { raw, indent } = lines[index];
    const content = raw.trim();
    while (stack.length > 1 && stack.at(-1)!.indent >= indent) stack.pop();
    const parent = stack.at(-1)!.value;

    if (content.startsWith("- ")) {
      if (!Array.isArray(parent)) throw new Error(`YAML list has no array parent: ${content}`);
      const itemText = content.slice(2).trim();
      if (itemText.includes(":")) {
        const item: Record<string, unknown> = {};
        const [key, valueText] = splitPair(itemText);
        item[key] = valueText ? parseScalar(valueText) : {};
        parent.push(item);
        stack.push({ indent, value: item });
      } else {
        parent.push(parseScalar(itemText));
      }
      continue;
    }

    if (Array.isArray(parent)) throw new Error(`YAML mapping has array parent: ${content}`);
    const [key, valueText] = splitPair(content);
    if (valueText) {
      parent[key] = parseScalar(valueText);
      continue;
    }

    const next = lines[index + 1];
    const child: Record<string, unknown> | unknown[] =
      next && next.indent > indent && next.raw.trim().startsWith("- ") ? [] : {};
    parent[key] = child;
    stack.push({ indent, value: child });
  }
  return root;
}

export async function loadYaml<T>(path: string): Promise<T> {
  return parseYaml(await readFile(path, "utf8")) as T;
}

export async function loadConfig(root = projectRoot): Promise<{
  business: BusinessConfig;
  providers: ProviderConfig;
  sources: SourceRecord[];
}> {
  const [business, providers, sourceFile] = await Promise.all([
    loadYaml<BusinessConfig>(resolve(root, "business.yaml")),
    loadYaml<ProviderConfig>(resolve(root, "providers.yaml")),
    loadYaml<{ sources: SourceRecord[] }>(resolve(root, "sources.yaml")),
  ]);
  return { business, providers, sources: sourceFile.sources };
}

export { projectRoot };
