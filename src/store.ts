import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { PipelineState, SourceRecord } from "./types.ts";

export interface StateStore {
  load(sources: SourceRecord[]): Promise<PipelineState>;
  save(state: PipelineState): Promise<void>;
}

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
    system: [{ id: "mail", paused: false, reason: null, updatedAt: new Date(0).toISOString() }],
    runs: [],
  };
}

export class JsonStateStore implements StateStore {
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  async load(sources: SourceRecord[]): Promise<PipelineState> {
    try {
      const stored = JSON.parse(await readFile(this.path, "utf8")) as PipelineState;
      stored.sources = structuredClone(sources);
      stored.system ??= [{ id: "mail", paused: false, reason: null, updatedAt: new Date(0).toISOString() }];
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

type StateCollection = Exclude<keyof PipelineState, "sources"> | "sources";

const tableCollections: Array<{ table: string; collection: StateCollection }> = [
  { table: "sources", collection: "sources" },
  { table: "raw_documents", collection: "rawDocuments" },
  { table: "listings", collection: "listings" },
  { table: "sites", collection: "sites" },
  { table: "evidence", collection: "evidence" },
  { table: "contacts", collection: "contacts" },
  { table: "cases", collection: "cases" },
  { table: "messages", collection: "messages" },
  { table: "system_state", collection: "system" },
  { table: "scores", collection: "sites" },
  { table: "runs", collection: "runs" },
];

function rowFor(table: string, value: Record<string, unknown>): Record<string, unknown> | null {
  if (table === "sources") return {
    id: value.id, name: value.name, kind: value.kind, url: value.url, robots_txt: value.robots_txt,
    terms_status: value.terms_status, enabled: value.enabled, cadence: value.cadence,
    checked_at: value.checked_at, status_note: value.status_note, payload: value,
  };
  if (table === "raw_documents") return {
    id: value.id, source_id: value.sourceId, source_url: value.sourceUrl, fetched_at: value.fetchedAt,
    raw_payload: value.payload, extraction: value.extraction, payload: value,
  };
  if (table === "listings") return {
    id: value.listingId, source_listing_id: value.listingId, address: value.address, site_key: value.siteKey,
    monthly_rent: value.monthlyRent, written_rent_quote: value.writtenRentQuote,
    contact_email: value.contactEmail, contact_source_url: value.contactSourceUrl, payload: value,
  };
  if (table === "sites") return {
    id: value.id, site_key: value.siteKey, canonical_address: value.address,
    location: value.latitude !== null && value.longitude !== null ? `POINT(${value.longitude} ${value.latitude})` : null,
    stage: value.stage, monthly_rent: value.monthlyRent, office: value.office,
    vehicle_display: value.vehicleDisplay, shared_lot: value.sharedLot, viable: value.viable, payload: value,
  };
  if (table === "evidence") return {
    id: value.id, site_id: value.siteId, fact: value.fact, value: value.value,
    source_url: value.sourceUrl, fetched_at: value.fetchedAt, expires_at: value.expiresAt,
    method: value.method, verified: value.verified, citation: value.citation, payload: value,
  };
  if (table === "contacts") return {
    id: value.email, email: value.email, source_url: value.sourceUrl,
    do_not_contact: value.doNotContact, payload: value,
  };
  if (table === "cases") return {
    id: value.id, site_id: value.siteId, case_type: value.type, owner: value.owner,
    contact_id: value.recipient, status: value.status, opened_at: value.openedAt,
    next_action_at: value.nextActionAt, followups: value.followups, payload: value,
  };
  if (table === "messages") return {
    id: value.id, case_id: value.caseId, site_id: value.siteId, recipient: value.recipient,
    direction: value.direction, template: value.template, sent_at: value.sentAt,
    dedupe_key: value.dedupeKey, status: value.status, payload: value,
  };
  if (table === "system_state") return {
    id: value.id, paused: value.paused, reason: value.reason, updated_at: value.updatedAt, payload: value,
  };
  if (table === "scores") {
    const score = value.score as Record<string, unknown> | null;
    if (!score) return null;
    return { id: `score-${value.id}`, site_id: value.id, ...score, payload: score };
  }
  if (table === "runs") return {
    id: value.id, run_date: value.runDate, mode: value.mode, started_at: value.startedAt,
    completed_at: value.completedAt, stages_completed: value.stagesCompleted, counts: value.counts,
    errors: value.errors, paid_calls: value.paidCalls, logs: value.logs, payload: value,
  };
  return null;
}

export class SupabaseStateStore implements StateStore {
  private readonly baseUrl: string;
  private readonly serviceKey: string;

  constructor(baseUrl: string, serviceKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.serviceKey = serviceKey;
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(`${this.baseUrl}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: this.serviceKey,
        authorization: `Bearer ${this.serviceKey}`,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Supabase storage request failed: ${response.status} ${await response.text()}`);
    return response;
  }

  async load(sources: SourceRecord[]): Promise<PipelineState> {
    const state = emptyState(sources);
    const readable = tableCollections.filter((item) => item.table !== "scores" && item.table !== "sources");
    const results = await Promise.all(readable.map(async ({ table, collection }) => {
      const response = await this.request(`${table}?select=payload`);
      const rows = await response.json() as Array<{ payload: unknown }>;
      return { collection, values: rows.map((row) => row.payload) };
    }));
    for (const { collection, values } of results) {
      (state[collection] as unknown[]) = values;
    }
    if (!state.system.length) state.system.push({ id: "mail", paused: false, reason: null, updatedAt: new Date(0).toISOString() });
    return state;
  }

  async save(state: PipelineState): Promise<void> {
    for (const { table, collection } of tableCollections) {
      const values = state[collection] as unknown[];
      const rows = values.map((value) => rowFor(table, value as Record<string, unknown>)).filter(Boolean);
      if (!rows.length) continue;
      await this.request(`${table}?on_conflict=id`, {
        method: "POST",
        headers: { prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(rows),
      });
    }
  }
}

export function selectStateStore(offline: boolean, statePath: string): StateStore {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!offline && url && key) return new SupabaseStateStore(url, key);
  return new JsonStateStore(statePath);
}
