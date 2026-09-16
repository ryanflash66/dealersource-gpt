import type { BusinessConfig, ScoreBreakdown, SiteRecord } from "./types.ts";

const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const rounded = (value: number): number => Math.round(value * 10) / 10;

export function scoreSite(site: SiteRecord, business: BusinessConfig): ScoreBreakdown {
  const weights = business.ranking.weights;
  const trafficRaw = clamp((site.metrics.aadt ?? 0) / 30_000);
  const frontage = clamp((site.metrics.frontageFeet ?? 0) / 200);
  const visibilityRaw =
    frontage * 0.5 + (site.metrics.cornerLot ? 0.25 : 0) + (site.metrics.signageVisible ? 0.25 : 0);
  const distanceRaw = clamp(1 - (site.metrics.driveMinutes ?? business.search.max_drive_minutes) / business.search.max_drive_minutes);
  const range = business.rent.max_monthly - business.rent.min_monthly;
  const rentRaw = clamp(1 - ((site.monthlyRent ?? business.rent.max_monthly) - business.rent.min_monthly) / range);
  const competitorsRaw = clamp(1 - (site.metrics.competitors ?? 10) / 10);

  const breakdown = {
    traffic: rounded(trafficRaw * weights.traffic * 100),
    visibility: rounded(visibilityRaw * weights.visibility * 100),
    distance: rounded(distanceRaw * weights.distance * 100),
    rent: rounded(rentRaw * weights.rent * 100),
    competitors: rounded(competitorsRaw * weights.competitors * 100),
  };
  return { ...breakdown, total: rounded(Object.values(breakdown).reduce((sum, value) => sum + value, 0)) };
}

export function rankSites(sites: SiteRecord[]): SiteRecord[] {
  return [...sites].sort((left, right) => {
    if (left.sharedLot !== right.sharedLot) return left.sharedLot ? 1 : -1;
    return (right.score?.total ?? 0) - (left.score?.total ?? 0);
  });
}
