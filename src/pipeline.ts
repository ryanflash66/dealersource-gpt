import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { loadConfig, projectRoot } from "./config.ts";
import { ProviderRegistry, type ProviderContext } from "./providers.ts";
import { JsonStateStore } from "./store.ts";
import { evaluateGates, hasOperationalRequirements } from "./gates.ts";
import { rankSites, scoreSite } from "./scoring.ts";
import { renderApprovedMessage } from "./templates.ts";
import type {
  BusinessConfig,
  CaseRecord,
  DashboardReport,
  Evidence,
  ListingExtraction,
  PipelineState,
  RawDocument,
  RunRecord,
  SiteRecord,
  StructuredLog,
} from "./types.ts";

export const stageNames = ["discover", "resolve", "enrich", "verify", "score", "report"] as const;
export type StageName = (typeof stageNames)[number];

export interface PipelineOptions {
  offline: boolean;
  runDate: string;
  root?: string;
  statePath?: string;
  reportPath?: string;
  stages?: StageName[];
}

function upsertById<T extends { id: string }>(records: T[], next: T): void {
  const index = records.findIndex((record) => record.id === next.id);
  if (index >= 0) records[index] = next;
  else records.push(next);
}

function addDays(iso: string, days: number): string {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function mergeListings(siteKey: string, listings: ListingExtraction[], documents: RawDocument[]): SiteRecord {
  const rentListing = listings.find((listing) => listing.writtenRentQuote && listing.monthlyRent !== null);
  const primary = rentListing ?? listings[0];
  return {
    id: `site-${siteKey}`,
    siteKey,
    address: primary.address,
    latitude: null,
    longitude: null,
    parcelId: null,
    listingIds: listings.map((listing) => listing.listingId).sort(),
    sourceUrls: [...new Set(documents.filter((document) => listings.some((listing) => listing.listingId === document.extraction.listingId)).map((document) => document.sourceUrl))],
    monthlyRent: rentListing?.monthlyRent ?? null,
    office: listings.find((listing) => listing.office !== null)?.office ?? null,
    vehicleDisplay: Math.max(...listings.map((listing) => listing.vehicleDisplay ?? 0)),
    sharedLot: listings.some((listing) => listing.sharedLot),
    stage: "discovered",
    metrics: { aadt: null, frontageFeet: null, cornerLot: null, signageVisible: null, driveMinutes: null, competitors: null },
    imagery: [],
    gates: [],
    viable: false,
    score: null,
  };
}

function evidenceRecord(siteId: string, fact: string, value: unknown, raw: Record<string, unknown>): Evidence {
  return {
    id: `evidence-${siteId}-${fact}`,
    siteId,
    fact,
    value,
    sourceUrl: String(raw.sourceUrl ?? ""),
    fetchedAt: String(raw.fetchedAt ?? ""),
    expiresAt: String(raw.expiresAt ?? ""),
    method: String(raw.method ?? "recorded-fixture"),
    verified: raw.verified === true,
    citation: raw.citation ? String(raw.citation) : undefined,
  };
}

function sourceIsSafe(source: PipelineState["sources"][number]): boolean {
  if (!source.enabled) return false;
  if (source.kind === "manual") return true;
  return source.robots_txt === "allowed" && source.terms_status === "allowed";
}

async function discover(state: PipelineState, root: string, run: RunRecord, log: ProviderContext["log"]): Promise<void> {
  const fixtureDocuments = JSON.parse(await readFile(resolve(root, "fixtures", "listings.json"), "utf8")) as RawDocument[];
  const safeSourceIds = new Set(state.sources.filter(sourceIsSafe).map((source) => source.id));
  for (const document of fixtureDocuments.filter((item) => safeSourceIds.has(item.sourceId))) {
    upsertById(state.rawDocuments, document);
    if (!state.listings.some((listing) => listing.listingId === document.extraction.listingId)) {
      state.listings.push(structuredClone(document.extraction));
    }
  }
  const excluded = state.sources.filter((source) => !sourceIsSafe(source)).length;
  run.counts.discoveredDocuments = state.rawDocuments.length;
  run.counts.excludedSources = excluded;
  log({ level: "info", event: "stage.discover", details: { documents: state.rawDocuments.length, excludedSources: excluded } });
}

async function resolveSites(
  state: PipelineState,
  registry: ProviderRegistry,
  business: BusinessConfig,
  context: ProviderContext,
): Promise<void> {
  const grouped = Map.groupBy(state.listings, (listing) => listing.siteKey);
  for (const [siteKey, listings] of grouped) {
    const existing = state.sites.find((site) => site.siteKey === siteKey);
    const site = existing ?? mergeListings(siteKey, listings, state.rawDocuments);
    if (!existing) state.sites.push(site);
    const geocode = await registry.call<{ canonicalAddress: string; latitude: number; longitude: number }>(
      "geocoder",
      { fixtureKey: siteKey, address: site.address },
      context,
    );
    const parcel = await registry.call<{ parcelId: string }>("parcels", { fixtureKey: siteKey, ...geocode }, context);
    site.address = geocode.canonicalAddress;
    site.latitude = geocode.latitude;
    site.longitude = geocode.longitude;
    site.parcelId = parcel.parcelId;
    site.stage = "resolved";

    const written = listings.find((listing) => listing.writtenRentQuote && listing.monthlyRent !== null);
    if (written) {
      const document = state.rawDocuments.find((item) => item.extraction.listingId === written.listingId)!;
      upsertById(state.evidence, {
        id: `evidence-${site.id}-rent`,
        siteId: site.id,
        fact: "rent",
        value: { monthlyRent: written.monthlyRent },
        sourceUrl: document.sourceUrl,
        fetchedAt: document.fetchedAt,
        expiresAt: addDays(document.fetchedAt, business.evidence.default_ttl_days),
        method: "written-listing-quote",
        verified: true,
      });
    }
  }
  context.log({ level: "info", event: "stage.resolve", details: { sites: state.sites.length, provider: registry.selected("geocoder") } });
}

async function enrich(
  state: PipelineState,
  registry: ProviderRegistry,
  context: ProviderContext,
): Promise<void> {
  for (const site of state.sites) {
    const fixtureKey = site.siteKey;
    const [zoning, flood, traffic, driveTime, imagery, competitors] = await Promise.all([
      registry.call<Record<string, unknown>>("zoning", { fixtureKey, parcelId: site.parcelId }, context),
      registry.call<Record<string, unknown>>("flood", { fixtureKey, parcelId: site.parcelId }, context),
      registry.call<{ aadt: number }>("traffic", { fixtureKey, latitude: site.latitude, longitude: site.longitude }, context),
      registry.call<{ minutes: number }>("drive_time", { fixtureKey, destination: site.address }, context),
      registry.call<{ urls: string[]; frontageFeet: number; cornerLot: boolean; signageVisible: boolean }>("imagery", { fixtureKey }, context),
      registry.call<{ count: number }>("competitors", { fixtureKey, latitude: site.latitude, longitude: site.longitude }, context),
    ]);
    upsertById(state.evidence, evidenceRecord(site.id, "zoning", zoning, zoning));
    upsertById(state.evidence, evidenceRecord(site.id, "flood", flood, flood));
    site.metrics.aadt = traffic.aadt;
    site.metrics.driveMinutes = driveTime.minutes;
    site.metrics.frontageFeet = imagery.frontageFeet;
    site.metrics.cornerLot = imagery.cornerLot;
    site.metrics.signageVisible = imagery.signageVisible;
    site.metrics.competitors = competitors.count;
    site.imagery = imagery.urls;
    site.stage = "enriched";
  }
  context.log({ level: "info", event: "stage.enrich", details: { sites: state.sites.length } });
}

function recipientForCase(state: PipelineState, site: SiteRecord, type: CaseRecord["type"]): { email: string; sourceUrl: string } | null {
  if (type === "zoning" || type === "flood") {
    const item = state.evidence.find((candidate) => candidate.siteId === site.id && candidate.fact === type);
    const value = item?.value as { authorityEmail?: string } | undefined;
    return value?.authorityEmail && item?.sourceUrl ? { email: value.authorityEmail, sourceUrl: item.sourceUrl } : null;
  }
  for (const listingId of site.listingIds) {
    const listing = state.listings.find((candidate) => candidate.listingId === listingId);
    if (listing?.contactEmail && listing.contactSourceUrl) return { email: listing.contactEmail, sourceUrl: listing.contactSourceUrl };
  }
  return null;
}

async function verify(
  state: PipelineState,
  registry: ProviderRegistry,
  business: BusinessConfig,
  context: ProviderContext,
  runDate: string,
): Promise<void> {
  let sent = 0;
  const asOf = `${runDate}T23:59:59.999Z`;
  for (const site of state.sites) {
    const gates = evaluateGates(site, state.evidence, business, asOf);
    for (const gate of gates.filter((item) => item.status === "unknown" || item.status === "expired")) {
      const recipient = recipientForCase(state, site, gate.name);
      if (!recipient) continue;
      const caseId = `case-${site.id}-${gate.name}`;
      let caseRecord = state.cases.find((candidate) => candidate.id === caseId);
      if (!caseRecord) {
        caseRecord = {
          id: caseId,
          siteId: site.id,
          type: gate.name,
          owner: gate.name === "zoning" || gate.name === "flood" ? "planning-authority" : "leasing-contact",
          recipient: recipient.email,
          recipientSourceUrl: recipient.sourceUrl,
          status: "open",
          openedAt: `${runDate}T10:00:00.000Z`,
          nextActionAt: `${runDate}T10:00:00.000Z`,
          followups: 0,
        };
        state.cases.push(caseRecord);
      }
      site.stage = "verifying";
      const contact = state.contacts.find((candidate) => candidate.email === recipient.email);
      if (contact?.doNotContact || business.mail.paused) continue;
      if (!contact) state.contacts.push({ email: recipient.email, sourceUrl: recipient.sourceUrl, doNotContact: false });
      const dedupeKey = `${caseId}:${recipient.email}:${runDate}:initial`;
      if (state.messages.some((message) => message.dedupeKey === dedupeKey)) continue;
      if (caseRecord.followups > 0 || caseRecord.status === "closed" || caseRecord.status === "escalated") continue;
      const template = renderApprovedMessage(caseRecord, site);
      const delivery = await registry.call<{ accepted: boolean; messageId: string }>(
        "mail",
        { fixtureKey: "default", to: recipient.email, ...template },
        context,
      );
      if (delivery.accepted) {
        state.messages.push({
          id: `message-${randomUUID()}`,
          caseId,
          siteId: site.id,
          recipient: recipient.email,
          direction: "outbound",
          template: gate.name,
          sentAt: `${runDate}T10:00:00.000Z`,
          dedupeKey,
          status: context.offline ? "fixture-sent" : "sent",
        });
        caseRecord.status = "waiting";
        caseRecord.nextActionAt = addDays(`${runDate}T10:00:00.000Z`, business.mail.followup_days);
        sent += 1;
      }
    }
  }
  context.log({ level: "info", event: "stage.verify", details: { outboundMessages: sent, openCases: state.cases.length } });
}

function score(state: PipelineState, business: BusinessConfig, runDate: string, context: ProviderContext): void {
  const asOf = `${runDate}T23:59:59.999Z`;
  for (const site of state.sites) {
    site.gates = evaluateGates(site, state.evidence, business, asOf);
    site.viable = site.gates.every((gate) => gate.status === "pass") && hasOperationalRequirements(site, business);
    site.score = site.viable ? scoreSite(site, business) : null;
    if (site.stage !== "verifying") site.stage = "scored";
  }
  const viable = state.sites.filter((site) => site.viable).length;
  context.log({ level: "info", event: "stage.score", details: { viable } });
}

export function buildReport(
  state: PipelineState,
  business: BusinessConfig,
  providers: Awaited<ReturnType<typeof loadConfig>>["providers"],
  run: RunRecord,
): DashboardReport {
  const exceptions: DashboardReport["exceptions"] = [];
  if (business.mail.paused) exceptions.push({ type: "outreach", severity: "error", message: "Automated outreach is paused in business.yaml." });
  for (const source of state.sources.filter((item) => !sourceIsSafe(item))) {
    exceptions.push({
      type: "source",
      severity: source.terms_status === "prohibited" || source.robots_txt === "disallowed" ? "error" : "warning",
      message: `${source.name} excluded: robots=${source.robots_txt}, terms=${source.terms_status}.`,
    });
  }
  for (const item of state.evidence.filter((evidence) => Date.parse(evidence.expiresAt) <= Date.parse(`${run.runDate}T23:59:59.999Z`))) {
    exceptions.push({ type: "evidence", severity: "warning", message: `${item.fact} evidence expired for ${item.siteId}.` });
  }
  return {
    generatedAt: run.completedAt ?? `${run.runDate}T23:59:59.999Z`,
    runId: run.id,
    shortlist: rankSites(state.sites.filter((site) => site.viable)),
    pipeline: rankSites(state.sites),
    cases: state.cases.filter((item) => item.status !== "closed"),
    exceptions,
    config: { business, providers },
  };
}

export async function runPipeline(options: PipelineOptions): Promise<{ state: PipelineState; report: DashboardReport; run: RunRecord }> {
  const root = options.root ?? projectRoot;
  const statePath = options.statePath ?? resolve(root, ".data", "state.json");
  const reportPath = options.reportPath ?? resolve(root, ".data", "report.json");
  const config = await loadConfig(root);
  const store = new JsonStateStore(statePath);
  const state = await store.load(config.sources);
  const runSequence = state.runs.filter((item) => item.runDate === options.runDate).length + 1;
  const run: RunRecord = {
    id: `run-${options.runDate}-${String(runSequence).padStart(3, "0")}`,
    runDate: options.runDate,
    mode: options.offline ? "offline" : "live",
    startedAt: `${options.runDate}T09:00:00.000Z`,
    completedAt: null,
    stagesCompleted: [],
    counts: {},
    errors: [],
    paidCalls: 0,
    logs: [],
  };
  state.runs.push(run);
  const log = (entry: Omit<StructuredLog, "timestamp" | "runId">): void => {
    const structured: StructuredLog = { timestamp: `${options.runDate}T09:00:00.000Z`, runId: run.id, ...entry };
    run.logs.push(structured);
    if (entry.event === "provider.call" && entry.details.paid === true) run.paidCalls += 1;
  };
  const context: ProviderContext = { offline: options.offline, runId: run.id, now: run.startedAt, log };
  const registry = await ProviderRegistry.create(config.providers, options.offline, root);
  const selectedStages = options.stages ?? [...stageNames];

  try {
    for (const stage of selectedStages) {
      if (stage === "discover") await discover(state, root, run, log);
      if (stage === "resolve") await resolveSites(state, registry, config.business, context);
      if (stage === "enrich") await enrich(state, registry, context);
      if (stage === "verify") await verify(state, registry, config.business, context, options.runDate);
      if (stage === "score") score(state, config.business, options.runDate, context);
      run.stagesCompleted.push(stage);
      await store.save(state);
    }
    run.counts.sites = state.sites.length;
    run.counts.viableSites = state.sites.filter((site) => site.viable).length;
    run.counts.outboundMessages = run.logs.find((entry) => entry.event === "stage.verify")?.details.outboundMessages as number ?? 0;
    run.completedAt = `${options.runDate}T09:05:00.000Z`;
    const report = buildReport(state, config.business, config.providers, run);
    if (selectedStages.includes("report")) {
      for (const site of state.sites) if (site.stage === "scored") site.stage = "reported";
      await mkdir(dirname(reportPath), { recursive: true });
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      log({ level: "info", event: "stage.report", details: { shortlist: report.shortlist.length, path: reportPath } });
    }
    await store.save(state);
    return { state, report, run };
  } catch (error) {
    run.errors.push(error instanceof Error ? error.message : String(error));
    run.completedAt = `${options.runDate}T09:05:00.000Z`;
    await store.save(state);
    throw error;
  }
}
