type JsonRecord = Record<string, any>;

export const STALE_REPORT_MS = 24 * 60 * 60 * 1000;
export const EXPIRING_SOON_MS = 7 * 24 * 60 * 60 * 1000;

export function addDays(value: string, days: number): string {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

export function resolveTheme(search: string, systemDark: boolean): "light" | "dark" {
  const selected = new URLSearchParams(search).get("theme");
  if (selected === "light" || selected === "dark") return selected;
  return systemDark ? "dark" : "light";
}

export function gateStatus(value: unknown): "pass" | "fail" | "pending" | "stale" {
  if (value === "pass" || value === "fail" || value === "stale") return value;
  return "pending";
}

export function pipelineStage(site: JsonRecord): "discovered" | "resolved" | "enriched" | "verifying" | "scored" | "excluded" {
  if (site.inSearchArea === false) return "excluded";
  if (site.viable || site.stage === "reported" || site.stage === "scored") return "scored";
  if ((site.gates ?? []).some((gate: JsonRecord) => gateStatus(gate.status) === "fail")) return "excluded";
  return ["discovered", "resolved", "enriched", "verifying"].includes(site.stage) ? site.stage : "verifying";
}

export function oneAwaySites(report: JsonRecord): JsonRecord[] {
  return (report.pipeline ?? []).filter((site: JsonRecord) => {
    if (site.inSearchArea === false) return false;
    const statuses = (site.gates ?? []).map((gate: JsonRecord) => gateStatus(gate.status));
    return !site.viable && statuses.filter((status: string) => status === "pending" || status === "stale").length === 1 && !statuses.includes("fail");
  });
}

function currency(value: unknown): string {
  return typeof value === "number"
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value)
    : "unknown rent";
}

export function evidenceFact(item: JsonRecord | undefined, business: JsonRecord): string {
  if (!item) return "Evidence pending";
  const value = item.value ?? {};
  if (item.fact === "zoning") {
    if (value.citation) return `${value.district ? `${value.district}: ` : ""}${value.citation}`;
    if (value.response) return String(value.response);
    return `${value.district ?? "Unknown district"}, dealer use ${value.dealer_use ?? "unknown"}`;
  }
  if (item.fact === "rent") {
    const rent = value.monthly_rent;
    const minimum = business.rent?.min_monthly;
    const maximum = business.rent?.max_monthly;
    if (typeof rent !== "number") return "Written rent not recorded";
    if (typeof minimum === "number" && typeof maximum === "number") {
      const result = rent < minimum ? `below ${currency(minimum)} minimum` : rent > maximum ? `over ${currency(maximum)} maximum` : `within ${currency(minimum)} to ${currency(maximum)}`;
      return `${currency(rent)}/mo, ${result}`;
    }
    return `${currency(rent)}/mo`;
  }
  if (item.fact === "flood") {
    return `Zone ${value.zone ?? "unknown"}, ${Number(value.pct_area_high_risk ?? 0)}% high-risk area`;
  }
  return `${item.fact}: ${typeof value === "string" ? value : JSON.stringify(value)}`;
}

export function evidenceMethod(value: unknown): string {
  const method = String(value ?? "");
  if (/email-reply/.test(method)) return "email reply";
  if (/listing-rent/.test(method)) return "listing";
  if (/official/.test(method)) return "official record";
  return method || "recorded evidence";
}

export function exclusionOutcome(site: JsonRecord, evidenceById: Map<string, JsonRecord>, business: JsonRecord): string {
  if (site.inSearchArea === false) {
    return `Outside ${business.search?.max_drive_minutes ?? "configured"} min search area (${site.metrics?.driveMinutes ?? site.driveMinutes ?? "?"} min)`;
  }
  const failed = (site.gates ?? []).find((gate: JsonRecord) => gateStatus(gate.status) === "fail");
  if (!failed) return "Awaiting required evidence";
  const evidence = evidenceById.get(failed.evidenceId);
  const value = evidence?.value ?? {};
  if (failed.name === "rent") return `${currency(value.monthly_rent ?? site.monthlyRent)}/mo exceeds ${currency(business.rent?.max_monthly)} maximum`;
  if (failed.name === "zoning") return `${value.district ?? "Zoning district"} does not permit used vehicle sales`;
  if (failed.name === "flood") return `Flood zone ${value.zone ?? "high risk"} (${Number(value.pct_area_high_risk ?? 0)}% high-risk area)`;
  return evidenceFact(evidence, business);
}

export function pipelineRowView(site: JsonRecord, evidenceById: Map<string, JsonRecord>, business: JsonRecord): JsonRecord {
  const stage = pipelineStage(site);
  const outcome = site.rank != null
    ? `Rank ${site.rank}, score ${Math.round(Number(site.score?.total ?? site.score ?? 0))}`
    : stage === "excluded"
      ? exclusionOutcome(site, evidenceById, business)
      : "One answer away";
  return {
    stage,
    showGates: site.inSearchArea !== false,
    outcome,
    outcomeClass: stage === "excluded" ? "fail" : site.rank == null ? "wait" : "",
  };
}

export function stageCounts(report: JsonRecord): Record<string, number> {
  const pipeline = report.pipeline ?? [];
  return {
    discovered: Number(report.run?.counts?.listings ?? pipeline.reduce((sum: number, site: JsonRecord) => sum + (site.listingIds?.length ?? 0), 0)),
    resolved: Number(report.run?.counts?.sites ?? pipeline.length),
    enriched: pipeline.filter((site: JsonRecord) => site.inSearchArea !== false).length,
    verifying: pipeline.filter((site: JsonRecord) => pipelineStage(site) === "verifying").length,
    scored: pipeline.filter((site: JsonRecord) => pipelineStage(site) === "scored").length,
    excluded: pipeline.filter((site: JsonRecord) => pipelineStage(site) === "excluded").length,
  };
}

export function reportAge(generatedAt: string, now = Date.now()): { stale: boolean; hours: number } {
  const age = Math.max(0, now - new Date(generatedAt).valueOf());
  return { stale: age > STALE_REPORT_MS, hours: Math.max(1, Math.floor(age / (60 * 60 * 1000))) };
}

export function evidenceExceptions(report: JsonRecord, now = Date.now()): JsonRecord[] {
  return (report.evidence ?? [])
    .map((item: JsonRecord) => ({ ...item, expiresIn: new Date(item.expires_at).valueOf() - now }))
    .filter((item: JsonRecord) => Number.isFinite(item.expiresIn) && item.expiresIn <= EXPIRING_SOON_MS)
    .sort((left: JsonRecord, right: JsonRecord) => left.expiresIn - right.expiresIn);
}

export function normalizeContractReport(
  report: JsonRecord,
  messages: JsonRecord[] = [],
  run: JsonRecord = {},
  publicConfig: JsonRecord = {},
): JsonRecord {
  if (report?.schema_version !== "1") return report;
  const business = publicConfig.business ?? {};
  const rentMin = Number(business.rent?.min_monthly ?? 600);
  const rentMax = Number(business.rent?.max_monthly ?? 1000);
  const maxDrive = Number(business.search?.max_drive_minutes ?? 60);
  const evidenceById = new Map<string, JsonRecord>((report.evidence ?? []).map((item: JsonRecord) => [item.evidence_id, item]));
  const listingsById = new Map<string, JsonRecord>((report.listings ?? []).map((item: JsonRecord) => [item.listing_id, item]));
  const pipeline = (report.sites ?? []).map((site: JsonRecord) => {
    const metrics = site.metrics ?? {};
    const rentRange = Math.max(1, rentMax - rentMin);
    const score = site.score == null ? null : {
      traffic: Math.max(0, Math.min(35, Number(metrics.aadt ?? 0) / 30_000 * 35)),
      visibility: Math.max(0, Math.min(25, Number(metrics.visibility ?? 0) * 25)),
      distance: Math.max(0, Math.min(20, (1 - Number(site.drive_minutes ?? maxDrive) / maxDrive) * 20)),
      rent: Math.max(0, Math.min(12, (1 - (Number(metrics.rent_monthly ?? rentMax) - rentMin) / rentRange) * 12)),
      competitors: Math.max(0, Math.min(8, (1 - Number(metrics.competitors ?? 10) / 10) * 8)),
      total: Number(site.score),
    };
    const gates = ["zoning", "rent", "flood"].map((name) => {
      const evidenceId = site.gates?.[name]?.evidence_ids?.[0] ?? null;
      const item = evidenceId ? evidenceById.get(evidenceId) : undefined;
      return {
        name,
        status: site.gates?.[name]?.status ?? "pending",
        evidenceId,
        reason: evidenceFact(item, business),
        sourceUrl: item?.source_url,
        fetchedAt: item?.fetched_at,
        expiresAt: item?.expires_at,
        method: evidenceMethod(item?.method),
        evidence: item,
      };
    });
    return {
      id: site.site_id,
      siteKey: site.parcel_id,
      address: site.address,
      latitude: site.latitude ?? null,
      longitude: site.longitude ?? null,
      parcelId: site.parcel_id,
      listingIds: site.listing_ids,
      listings: (site.listing_ids ?? []).map((id: string) => listingsById.get(id) ?? { listing_id: id }),
      sourceUrls: gates.map((gate) => gate.sourceUrl).filter(Boolean),
      monthlyRent: metrics.rent_monthly,
      sharedLot: site.shared_lot,
      inSearchArea: site.in_search_area,
      stage: site.viable ? "reported" : !site.in_search_area || gates.some((gate) => gate.status === "fail") ? "excluded" : "verifying",
      metrics: {
        aadt: metrics.aadt,
        frontageFeet: Math.round(Number(metrics.visibility ?? 0) * 200),
        cornerLot: null,
        signageVisible: null,
        driveMinutes: site.drive_minutes,
        competitors: metrics.competitors,
      },
      imagery: [],
      gates,
      viable: site.viable,
      score,
      rank: site.rank,
      rawOpenCases: site.open_cases ?? [],
    };
  });
  const cases = pipeline.flatMap((site: JsonRecord) => (site.rawOpenCases ?? []).map((item: JsonRecord, index: number) => {
    const sent = messages.find((message) => message.site_id === site.id && message.case_type === item.case_type);
    const openedAt = item.opened_at ?? sent?.sent_at ?? `${report.run_date}T10:00:00.000Z`;
    return {
      id: `case-${site.id}-${item.case_type}-${index}`,
      siteId: site.id,
      type: item.case_type,
      owner: item.case_type === "zoning" ? "planning-authority" : "leasing-contact",
      recipient: item.recipient,
      status: item.status,
      openedAt,
      nextActionAt: item.next_action_at ?? addDays(openedAt, Number(business.mail?.followup_days ?? 4)),
      followups: Math.max(0, Number(item.emails_sent ?? (sent ? 1 : 0)) - 1),
      emailsSent: Number(item.emails_sent ?? (sent ? 1 : 0)),
    };
  }));
  const sourceExceptions = (publicConfig.sources ?? [])
    .filter((source: JsonRecord) => source.terms_status === "prohibited")
    .map((source: JsonRecord) => ({ type: "source", severity: "warning", label: source.name, message: source.status_note, url: source.url, status: "Excluded by terms" }));
  const runExceptions = (run.errors ?? []).map((message: string) => ({ type: "run", severity: "error", label: "Run error", message, status: "Failed today" }));
  const normalized = {
    generatedAt: run.finished_at ?? `${report.run_date}T09:05:00.000Z`,
    runId: report.run_id,
    run,
    evidence: report.evidence ?? [],
    messages,
    shortlist: pipeline.filter((site: JsonRecord) => site.viable).sort((left: JsonRecord, right: JsonRecord) => left.rank - right.rank),
    pipeline,
    cases,
    exceptions: [...runExceptions, ...sourceExceptions],
    config: { business, providers: report.providers, sources: publicConfig.sources ?? [] },
  };
  for (const site of pipeline) site.openCases = cases.filter((item: JsonRecord) => item.siteId === site.id);
  return normalized;
}
