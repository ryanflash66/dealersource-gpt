import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { PipelineState, SourceRecord } from "./types.ts";

export function emptyState(sources: SourceRecord[]): PipelineState {
  return {
    sources: structuredClone(sources),
    rawDocuments: [],
    listings: [],
    sites: [],
    evidence: [],
    cases: [],
    messages: [],
    contacts: [],
    runs: [],
  };
}

export class JsonStateStore {
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  async load(sources: SourceRecord[]): Promise<PipelineState> {
    try {
      const stored = JSON.parse(await readFile(this.path, "utf8")) as PipelineState;
      stored.sources = structuredClone(sources);
      return stored;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState(sources);
      throw error;
    }
  }

  async save(state: PipelineState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(temporary, this.path);
  }
}
