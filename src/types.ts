export type Layer =
  | "geocoder"
  | "parcels"
  | "zoning"
  | "drive_time"
  | "traffic"
  | "flood"
  | "imagery"
  | "competitors"
  | "map_tiles"
  | "crawler"
  | "social"
  | "mail"
  | "llm";

export type GateName = "zoning" | "rent" | "flood";
export type GateStatus = "pass" | "fail" | "unknown" | "expired";

export interface ProviderConfig {
  paid_enabled: boolean;
  fixture_fallback: boolean;
  providers: Record<Layer, string>;
}

export interface BusinessConfig {
  search: { home_base: string; max_drive_minutes: number };
  rent: { min_monthly: number; max_monthly: number };
  site: {
    min_vehicle_display: number;
    office_required: boolean;
    shared_lot: "exclude" | "last_resort" | "allowed";
  };
  flood: { high_risk_zones: string[] };
  dealer: { license_status: "held" };
  ranking: {
    competitor_radius_miles: number;
    weights: Record<"traffic" | "visibility" | "distance" | "rent" | "competitors", number>;
  };
  mail: {
    sender: "owner" | "operator";
    followup_days: number;
    max_followups: number;
    bounce_pause_pct: number;
    paused: boolean;
  };
  schedule: { cron: string; timezone: string; scheduler: string };
  evidence: { default_ttl_days: number };
}

export interface SourceRecord {
  id: string;
  name: string;
  kind: "crawl" | "reddit" | "rss" | "manual";
  source_class: string;
  url: string;
  robots_txt: "allowed" | "disallowed" | "unknown";
  terms_status: "allowed" | "prohibited" | "unclear";
  enabled: boolean;
  cadence: string;
  checked_at: string;
  status_note: string;
}

export interface RawDocument {
  id: string;
  sourceId: string;
  sourceUrl: string;
  fetchedAt: string;
  payload: unknown;
  extraction: ListingExtraction;
}

export interface ListingExtraction {
  listingId: string;
  address: string;
  siteKey: string;
  monthlyRent: number | null;
  writtenRentQuote: boolean;
  office: boolean | null;
  vehicleDisplay: number | null;
  sharedLot: boolean;
  contactEmail: string | null;
  contactSourceUrl: string | null;
}

export interface Evidence {
  id: string;
  siteId: string;
  fact: string;
  value: unknown;
  sourceUrl: string;
  fetchedAt: string;
  expiresAt: string;
  method: string;
  verified: boolean;
  citation?: string;
}

export interface GateResult {
  name: GateName;
  status: GateStatus;
  reason: string;
  evidenceId: string | null;
}

export interface ScoreBreakdown {
  traffic: number;
  visibility: number;
  distance: number;
  rent: number;
  competitors: number;
  total: number;
}

export interface SiteRecord {
  id: string;
  siteKey: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  parcelId: string | null;
  listingIds: string[];
  sourceUrls: string[];
  monthlyRent: number | null;
  office: boolean | null;
  vehicleDisplay: number | null;
  sharedLot: boolean;
  stage: "discovered" | "resolved" | "enriched" | "verifying" | "scored" | "reported";
  metrics: {
    aadt: number | null;
    frontageFeet: number | null;
    cornerLot: boolean | null;
    signageVisible: boolean | null;
    driveMinutes: number | null;
    competitors: number | null;
  };
  imagery: string[];
  gates: GateResult[];
  viable: boolean;
  score: ScoreBreakdown | null;
}

export interface CaseRecord {
  id: string;
  siteId: string;
  type: GateName | "office" | "space" | "sublease";
  owner: "leasing-contact" | "planning-authority";
  recipient: string;
  recipientSourceUrl: string;
  status: "open" | "waiting" | "escalated" | "closed";
  openedAt: string;
  nextActionAt: string;
  followups: number;
}

export interface MessageRecord {
  id: string;
  caseId: string;
  siteId: string;
  recipient: string;
  direction: "outbound" | "inbound";
  template: string;
  sentAt: string;
  dedupeKey: string;
  status: "fixture-sent" | "sent" | "bounced" | "received";
}

export interface ContactRecord {
  email: string;
  sourceUrl: string;
  doNotContact: boolean;
}

export interface StructuredLog {
  timestamp: string;
  runId: string;
  level: "info" | "warn" | "error";
  event: string;
  details: Record<string, unknown>;
}

export interface RunRecord {
  id: string;
  runDate: string;
  mode: "offline" | "live";
  startedAt: string;
  completedAt: string | null;
  stagesCompleted: string[];
  counts: Record<string, number>;
  errors: string[];
  paidCalls: number;
  logs: StructuredLog[];
}

export interface PipelineState {
  sources: SourceRecord[];
  rawDocuments: RawDocument[];
  listings: ListingExtraction[];
  sites: SiteRecord[];
  evidence: Evidence[];
  cases: CaseRecord[];
  messages: MessageRecord[];
  contacts: ContactRecord[];
  runs: RunRecord[];
}

export interface DashboardReport {
  generatedAt: string;
  runId: string;
  shortlist: SiteRecord[];
  pipeline: SiteRecord[];
  cases: CaseRecord[];
  exceptions: Array<{ type: string; severity: "warning" | "error"; message: string }>;
  config: { business: BusinessConfig; providers: ProviderConfig };
}
