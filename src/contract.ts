import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadContractProviders, loadYaml, projectRoot } from "./config.ts";
import type { BusinessConfig, ContractProviderConfig } from "./types.ts";

type CaseType = "rent" | "zoning" | "space";
type GateName = "zoning" | "rent" | "flood";
type GateStatus = "pass" | "fail" | "pending";

interface ListingFixture {
  listing_id: string;
  source_id: string;
  url: string;
  fetched_at: string;
  title: string;
  address: string;
  rent_monthly: number | null;
  description: string;
  contact_email: string | null;
  shared_lot: boolean | null;
  has_office: boolean | null;
  vehicle_capacity: number | null;
}

interface GeocodeFixture {
  lat: number;
  lon: number;
  formatted_address: string;
  parcel_id: string;
}

interface ParcelFixture {
  parcel_id: string;
  owner: string;
  acres: number;
  centroid: { lat: number; lon: number };
  geometry: { type: "Polygon"; coordinates: number[][][] };
  frontage_ft: number;
  corner_lot: boolean;
  fronting_road: string;
}

interface ZoningFixture {
  district: string;
  jurisdiction: string;
  planning_email: string;
  use_table_url: string;
  dealer_use: "permitted" | "conditional" | "prohibited" | "unknown";
  citation: string | null;
}

interface FloodFixture { zone: string; pct_area_high_risk: number; source_url: string }
interface TrafficFixture { aadt: number; road: string; year: number; source_url: string }
interface DriveTimeFixture { minutes: number }
interface CompetitorFixture { count_within_radius: number; radius_m: number }
interface ReplyFixture {
  listing_id: string;
  case_type: CaseType;
  from: string;
  received_at: string;
  subject: string;
  body: string;
}

export interface ContractFixtures {
  listings: ListingFixture[];
  geocode: Record<string, GeocodeFixture>;
  parcels: Record<string, ParcelFixture>;
  zoning: Record<string, ZoningFixture>;
  flood: Record<string, FloodFixture>;
  traffic: Record<string, TrafficFixture>;
  drivetime: Record<string, DriveTimeFixture>;
  competitors: Record<string, CompetitorFixture>;
  replies: ReplyFixture[];
}

interface ContractEvidence {
  evidence_id: string;
  site_id: string;
  fact: string;
  value: unknown;
  source_url: string;
  fetched_at: string;
  expires_at: string;
  method: string;
}

interface ContractGate { status: GateStatus; evidence_ids: string[] }
interface ContractCase { case_type: CaseType; status: string; recipient: string }

export interface ContractSite {
  site_id: string;
  parcel_id: string;
  listing_ids: string[];
  address: string;
  in_search_area: boolean;
  drive_minutes: number | null;
  shared_lot: boolean;
  gates: Record<GateName, ContractGate>;
  viable: boolean;
  score: number | null;
  rank: number | null;
  metrics: {
    aadt: number | null;
    visibility: number | null;
    drive_minutes: number | null;
    rent_monthly: number | null;
    competitors: number | null;
  };
  open_cases: ContractCase[];
  latitude: number | null;
  longitude: number | null;
}

export interface ContractReport {
  schema_version: "1";
  run_id: string;
  run_date: string;
  offline: true;
  providers: ContractProviderConfig;
  sites: ContractSite[];
  evidence: ContractEvidence[];
  external_calls: [];
}

export interface ContractMessage {
  message_id: string;
  site_id: string;
  listing_id: string;
  case_type: CaseType;
  to: string;
  subject: string;
  body: string;
  sent_at: string;
  template_id: string;
}

export interface ContractRun {
  run_id: string;
  run_date: string;
  started_at: string;
  finished_at: string;
  counts: Record<string, number>;
  errors: string[];
}

interface OfflineContractState {
  schema_version: "1";
  run_count: number;
  sent_message_keys: string[];
}

interface WorkingSite {
  site: ContractSite;
  listings: ListingFixture[];
  cases: ContractCase[];
}

const fixtureFiles = ["listings", "geocode", "parcels", "zoning", "flood", "traffic", "drivetime", "competitors", "replies"] as const;

async function readJson<T>(path: string): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    throw new Error(`Cannot read contract fixture ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function loadContractFixtures(fixturesDir: string): Promise<ContractFixtures> {
  const values = await Promise.all(fixtureFiles.map((name) => readJson<unknown>(resolve(fixturesDir, `${name}.json`))));
  const fixtures = Object.fromEntries(fixtureFiles.map((name, index) => [name, values[index]])) as unknown as ContractFixtures;
  if (!Array.isArray(fixtures.listings)) throw new Error("listings.json must contain an array");
  if (!Array.isArray(fixtures.replies)) throw new Error("replies.json must contain an array");
  for (const name of fixtureFiles.filter((item) => item !== "listings" && item !== "replies")) {
    if (!fixtures[name] || typeof fixtures[name] !== "object" || Array.isArray(fixtures[name])) {
      throw new Error(`${name}.json must contain an object`);
    }
  }
  return fixtures;
}

function addDays(iso: string, days: number): string {
  const value = new Date(iso);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString();
}

const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const round = (value: number): number => Math.round(value * 10) / 10;

function evidence(
  evidence_id: string,
  site_id: string,
  fact: string,
  value: unknown,
  source_url: string,
  fetched_at: string,
  ttlDays: number,
  method: string,
): ContractEvidence {
  return { evidence_id, site_id, fact, value, source_url, fetched_at, expires_at: addDays(fetched_at, ttlDays), method };
}

function gate(status: GateStatus, evidenceId?: string): ContractGate {
  return { status, evidence_ids: evidenceId ? [evidenceId] : [] };
}

function rentFromReply(body: string): number | null {
  const currency = body.match(/\$\s*([0-9][0-9,]*(?:\.\d{1,2})?)/);
  const monthly = body.match(/\b([0-9][0-9,]*(?:\.\d{1,2})?)\s*(?:per\s+month|monthly|\/\s*mo(?:nth)?)/i);
  const raw = currency?.[1] ?? monthly?.[1];
  if (!raw) return null;
  const value = Number(raw.replaceAll(",", ""));
  return Number.isFinite(value) ? value : null;
}

function zoningFromReply(body: string): GateStatus | null {
  if (/\b(?:not|isn't|is not)\s+(?:a\s+)?permitted\b|\bprohibited\b/i.test(body)) return "fail";
  if (/\bpermitted\b/i.test(body)) return "pass";
  return null;
}

function messageCopy(caseType: CaseType, address: string): { subject: string; body: string; template_id: string } {
  if (caseType === "rent") return {
    subject: `Written base-rent confirmation request: ${address}`,
    body: `Hello,\n\nPlease confirm the monthly base rent in writing, excluding utilities and pass-through charges.\n\nSite: ${address}\n\nThank you,\nDealership site review`,
    template_id: "rent-initial-v1",
  };
  if (caseType === "zoning") return {
    subject: `Written zoning confirmation request: ${address}`,
    body: `Hello,\n\nPlease confirm whether used motor vehicle sales is permitted at this parcel and cite the controlling use-table section.\n\nSite: ${address}\n\nThank you,\nDealership site review`,
    template_id: "zoning-initial-v1",
  };
  return {
    subject: `Site capacity confirmation request: ${address}`,
    body: `Hello,\n\nPlease confirm that the site includes an enclosed office and space for the required vehicle display.\n\nSite: ${address}\n\nThank you,\nDealership site review`,
    template_id: "space-initial-v1",
  };
}

function scoreSite(site: ContractSite, business: BusinessConfig): number {
  const weights = business.score?.weights ?? business.ranking.weights;
  const rentRange = Math.max(1, business.rent.max_monthly - business.rent.min_monthly);
  const parts = {
    traffic: clamp((site.metrics.aadt ?? 0) / 30_000) * weights.traffic,
    visibility: clamp(site.metrics.visibility ?? 0) * weights.visibility,
    distance: clamp(1 - (site.drive_minutes ?? business.search.max_drive_minutes) / business.search.max_drive_minutes) * weights.distance,
    rent: clamp(1 - ((site.metrics.rent_monthly ?? business.rent.max_monthly) - business.rent.min_monthly) / rentRange) * weights.rent,
    competitors: clamp(1 - (site.metrics.competitors ?? 10) / 10) * weights.competitors,
  };
  return round(Object.values(parts).reduce((sum, value) => sum + value, 0) * 100);
}

async function loadState(path: string): Promise<OfflineContractState> {
  try {
    const stored = await readJson<OfflineContractState>(path);
    stored.sent_message_keys ??= [];
    stored.run_count ??= 0;
    return stored;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || /Cannot read contract fixture/.test(String(error))) {
      try {
        await readFile(path, "utf8");
      } catch (readError) {
        if ((readError as NodeJS.ErrnoException).code === "ENOENT") return { schema_version: "1", run_count: 0, sent_message_keys: [] };
      }
    }
    throw error;
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

export interface OfflineContractOptions {
  fixturesDir: string;
  outDir: string;
  runDate: string;
  configPath?: string;
  root?: string;
}

export async function runOfflineContract(options: OfflineContractOptions): Promise<{
  report: ContractReport;
  messages: ContractMessage[];
  run: ContractRun;
}> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.runDate) || Number.isNaN(Date.parse(`${options.runDate}T00:00:00.000Z`))) {
    throw new Error("--run-date must be a valid YYYY-MM-DD date");
  }
  const root = options.root ?? projectRoot;
  const fixturesDir = resolve(options.fixturesDir);
  const outDir = resolve(options.outDir);
  const configPath = resolve(options.configPath ?? resolve(root, "providers.yaml"));
  const [fixtures, providers, business] = await Promise.all([
    loadContractFixtures(fixturesDir),
    loadContractProviders(configPath),
    loadYaml<BusinessConfig>(resolve(root, "business.yaml")),
  ]);
  const statePath = resolve(outDir, "state", "state.json");
  const state = await loadState(statePath);
  state.run_count += 1;
  const runId = `run-${options.runDate}-${String(state.run_count).padStart(3, "0")}`;
  const startedAt = `${options.runDate}T09:00:00.000Z`;
  const finishedAt = `${options.runDate}T09:05:00.000Z`;
  const visibleThrough = Date.parse(`${options.runDate}T23:59:59.999Z`);
  const ttl = business.evidence.default_ttl_days;
  const evidenceRows: ContractEvidence[] = [];
  const messages: ContractMessage[] = [];
  const sentKeys = new Set(state.sent_message_keys);
  const grouped = new Map<string, ListingFixture[]>();

  for (const listing of fixtures.listings) {
    const geocode = fixtures.geocode[listing.address];
    if (!geocode?.parcel_id) throw new Error(`geocode.json has no parcel_id for listing address: ${listing.address}`);
    const group = grouped.get(geocode.parcel_id) ?? [];
    group.push(listing);
    grouped.set(geocode.parcel_id, group);
  }

  const working: WorkingSite[] = [];
  for (const [parcelId, listings] of grouped) {
    const geocode = fixtures.geocode[listings[0].address];
    const parcel = fixtures.parcels[parcelId];
    if (!parcel) throw new Error(`parcels.json has no entry for ${parcelId}`);
    const zoning = fixtures.zoning[parcelId];
    const flood = fixtures.flood[parcelId];
    const traffic = fixtures.traffic[parcelId];
    const drive = fixtures.drivetime[parcelId];
    const competitors = fixtures.competitors[parcelId];
    const siteId = `site-${parcelId}`;
    const inSearchArea = typeof drive?.minutes === "number" && drive.minutes <= business.search.max_drive_minutes;
    const statedRent = listings.find((listing) => listing.rent_monthly !== null);
    const latitude = parcel.centroid?.lat ?? geocode.lat ?? null;
    const longitude = parcel.centroid?.lon ?? geocode.lon ?? null;
    const visibility = round(clamp((parcel.frontage_ft ?? 0) / 200) * 0.75 + (parcel.corner_lot ? 0.25 : 0));
    const site: ContractSite = {
      site_id: siteId,
      parcel_id: parcelId,
      listing_ids: listings.map((listing) => listing.listing_id).sort(),
      address: geocode.formatted_address,
      in_search_area: inSearchArea,
      drive_minutes: drive?.minutes ?? null,
      shared_lot: listings.some((listing) => listing.shared_lot === true),
      gates: { zoning: gate("pending"), rent: gate("pending"), flood: gate("pending") },
      viable: false,
      score: null,
      rank: null,
      metrics: {
        aadt: traffic?.aadt ?? null,
        visibility,
        drive_minutes: drive?.minutes ?? null,
        rent_monthly: statedRent?.rent_monthly ?? null,
        competitors: competitors?.count_within_radius ?? null,
      },
      open_cases: [],
      latitude,
      longitude,
    };
    const cases: ContractCase[] = [];

    if (inSearchArea) {
      if (zoning?.dealer_use === "permitted" && zoning.citation) {
        const id = `evidence-${parcelId}-zoning-official`;
        evidenceRows.push(evidence(id, siteId, "zoning", { district: zoning.district, dealer_use: zoning.dealer_use, citation: zoning.citation }, zoning.use_table_url, startedAt, ttl, "official-use-table"));
        site.gates.zoning = gate("pass", id);
      } else if (zoning?.dealer_use === "prohibited") {
        const id = `evidence-${parcelId}-zoning-official`;
        evidenceRows.push(evidence(id, siteId, "zoning", { district: zoning.district, dealer_use: zoning.dealer_use, citation: zoning.citation }, zoning.use_table_url, startedAt, ttl, "official-use-table"));
        site.gates.zoning = gate("fail", id);
      }

      if (statedRent?.rent_monthly !== null && statedRent?.rent_monthly !== undefined) {
        const id = `evidence-${parcelId}-rent-${statedRent.listing_id}`;
        evidenceRows.push(evidence(id, siteId, "rent", { monthly_rent: statedRent.rent_monthly }, statedRent.url, statedRent.fetched_at, ttl, "written-listing-rent"));
        site.gates.rent = gate(statedRent.rent_monthly >= business.rent.min_monthly && statedRent.rent_monthly <= business.rent.max_monthly ? "pass" : "fail", id);
      }

      if (flood) {
        const id = `evidence-${parcelId}-flood`;
        evidenceRows.push(evidence(id, siteId, "flood", { zone: flood.zone, pct_area_high_risk: flood.pct_area_high_risk }, flood.source_url, startedAt, ttl, "official-flood-layer"));
        site.gates.flood = gate(business.flood.high_risk_zones.includes(flood.zone.toUpperCase()) ? "fail" : "pass", id);
      }

      const hasKnownFailure = Object.values(site.gates).some((item) => item.status === "fail");
      const pendingCases: Array<{ caseType: CaseType; recipient: string | null; listingId: string }> = [];
      if (site.gates.rent.status === "pending") {
        const contactListing = listings.find((listing) => listing.contact_email);
        pendingCases.push({ caseType: "rent", recipient: contactListing?.contact_email ?? null, listingId: contactListing?.listing_id ?? listings[0].listing_id });
      }
      if (site.gates.zoning.status === "pending") {
        pendingCases.push({ caseType: "zoning", recipient: zoning?.planning_email ?? null, listingId: listings[0].listing_id });
      }
      for (const pending of pendingCases) {
        if (!pending.recipient) continue;
        const messageKey = `${siteId}|${pending.listingId}|${pending.caseType}|${pending.recipient.toLowerCase()}`;
        const alreadySent = sentKeys.has(messageKey);
        const status = hasKnownFailure ? "suppressed" : "waiting";
        cases.push({ case_type: pending.caseType, status, recipient: pending.recipient });
        if (hasKnownFailure || alreadySent) continue;
        const copy = messageCopy(pending.caseType, site.address);
        messages.push({
          message_id: `message-${options.runDate}-${parcelId}-${pending.caseType}`,
          site_id: siteId,
          listing_id: pending.listingId,
          case_type: pending.caseType,
          to: pending.recipient,
          subject: copy.subject,
          body: copy.body,
          sent_at: `${options.runDate}T10:00:00.000Z`,
          template_id: copy.template_id,
        });
        sentKeys.add(messageKey);
      }
    }
    working.push({ site, listings, cases });
  }

  for (const reply of fixtures.replies.filter((item) => Date.parse(item.received_at) <= visibleThrough)) {
    const owner = working.find((item) => item.listings.some((listing) => listing.listing_id === reply.listing_id));
    if (!owner || !owner.site.in_search_area) continue;
    if (!owner.cases.some((item) => item.case_type === reply.case_type && item.status === "waiting")) continue;
    if (reply.case_type === "rent") {
      const rent = rentFromReply(reply.body);
      if (rent === null) continue;
      const id = `evidence-${owner.site.parcel_id}-rent-reply-${reply.listing_id}`;
      evidenceRows.push(evidence(id, owner.site.site_id, "rent", { monthly_rent: rent }, `mailto:${reply.from}`, reply.received_at, ttl, "written-email-reply"));
      owner.site.metrics.rent_monthly = rent;
      owner.site.gates.rent = gate(rent >= business.rent.min_monthly && rent <= business.rent.max_monthly ? "pass" : "fail", id);
      owner.cases = owner.cases.filter((item) => item.case_type !== "rent");
    }
    if (reply.case_type === "zoning") {
      const status = zoningFromReply(reply.body);
      if (!status) continue;
      const id = `evidence-${owner.site.parcel_id}-zoning-reply-${reply.listing_id}`;
      evidenceRows.push(evidence(id, owner.site.site_id, "zoning", { response: reply.body }, `mailto:${reply.from}`, reply.received_at, ttl, "planning-email-reply"));
      owner.site.gates.zoning = gate(status, id);
      owner.cases = owner.cases.filter((item) => item.case_type !== "zoning");
    }
  }

  for (const item of working) {
    item.site.open_cases = item.cases;
    const officePass = !business.site.office_required || item.listings.some((listing) => listing.has_office === true);
    const capacity = Math.max(...item.listings.map((listing) => listing.vehicle_capacity ?? 0));
    const spacePass = capacity >= business.site.min_vehicle_display;
    const gatesPass = Object.values(item.site.gates).every((value) => value.status === "pass");
    item.site.viable = item.site.in_search_area && gatesPass && officePass && spacePass && (business.site.shared_lot !== "exclude" || !item.site.shared_lot);
    item.site.score = item.site.viable ? scoreSite(item.site, business) : null;
  }

  const viable = working
    .map((item) => item.site)
    .filter((site) => site.viable)
    .sort((left, right) => left.shared_lot === right.shared_lot ? (right.score ?? 0) - (left.score ?? 0) : left.shared_lot ? 1 : -1);
  viable.forEach((site, index) => { site.rank = index + 1; });
  state.sent_message_keys = [...sentKeys].sort();

  const report: ContractReport = {
    schema_version: "1",
    run_id: runId,
    run_date: options.runDate,
    offline: true,
    providers,
    sites: working.map((item) => item.site),
    evidence: evidenceRows,
    external_calls: [],
  };
  const run: ContractRun = {
    run_id: runId,
    run_date: options.runDate,
    started_at: startedAt,
    finished_at: finishedAt,
    counts: {
      listings: fixtures.listings.length,
      sites: report.sites.length,
      viable_sites: viable.length,
      evidence: evidenceRows.length,
      messages_sent: messages.length,
      replies_visible: fixtures.replies.filter((item) => Date.parse(item.received_at) <= visibleThrough).length,
    },
    errors: [],
  };

  await mkdir(outDir, { recursive: true });
  await Promise.all([
    writeJsonAtomic(resolve(outDir, "report.json"), report),
    writeJsonAtomic(resolve(outDir, "messages.json"), messages),
    writeJsonAtomic(resolve(outDir, "run.json"), run),
    writeJsonAtomic(statePath, state),
  ]);
  return { report, messages, run };
}
