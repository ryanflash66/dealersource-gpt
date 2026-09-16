import type { BusinessConfig, Evidence, GateName, GateResult, SiteRecord } from "./types.ts";

function latestEvidence(evidence: Evidence[], siteId: string, fact: string): Evidence | undefined {
  return evidence
    .filter((item) => item.siteId === siteId && item.fact === fact)
    .sort((left, right) => right.fetchedAt.localeCompare(left.fetchedAt))[0];
}

function evidenceStatus(item: Evidence | undefined, asOf: string): "valid" | "unknown" | "expired" {
  if (!item || !item.verified || !item.sourceUrl || !item.fetchedAt || !item.expiresAt) return "unknown";
  return Date.parse(item.expiresAt) <= Date.parse(asOf) ? "expired" : "valid";
}

function result(
  name: GateName,
  status: GateResult["status"],
  reason: string,
  item?: Evidence,
): GateResult {
  return { name, status, reason, evidenceId: item?.id ?? null };
}

export function evaluateGates(
  site: SiteRecord,
  evidence: Evidence[],
  business: BusinessConfig,
  asOf: string,
): GateResult[] {
  const zoning = latestEvidence(evidence, site.id, "zoning");
  const rent = latestEvidence(evidence, site.id, "rent");
  const flood = latestEvidence(evidence, site.id, "flood");

  const zoningState = evidenceStatus(zoning, asOf);
  const zoningGate =
    zoningState === "expired"
      ? result("zoning", "expired", "Zoning evidence has expired.", zoning)
      : zoningState === "unknown"
        ? result("zoning", "unknown", "Written approval or an official layer plus exact use-table citation is missing.", zoning)
        : (zoning!.value as { permitted: boolean }).permitted
          ? result("zoning", "pass", "Motor vehicle sales is verified as permitted or conditionally approved.", zoning)
          : result("zoning", "fail", "Motor vehicle sales is not permitted on this parcel.", zoning);

  const rentState = evidenceStatus(rent, asOf);
  const monthlyRent = Number((rent?.value as { monthlyRent?: number } | undefined)?.monthlyRent);
  const rentGate =
    rentState === "expired"
      ? result("rent", "expired", "Written rent evidence has expired.", rent)
      : rentState === "unknown" || !Number.isFinite(monthlyRent)
        ? result("rent", "unknown", "A written base-rent quote is missing.", rent)
        : monthlyRent >= business.rent.min_monthly && monthlyRent <= business.rent.max_monthly
          ? result("rent", "pass", `$${monthlyRent} monthly base rent is within the configured range.`, rent)
          : result("rent", "fail", `$${monthlyRent} monthly base rent is outside the configured range.`, rent);

  const floodState = evidenceStatus(flood, asOf);
  const floodValue = flood?.value as { centroidZone?: string; highRiskAreaPct?: number } | undefined;
  const centroidHighRisk = floodValue?.centroidZone
    ? business.flood.high_risk_zones.includes(floodValue.centroidZone.toUpperCase())
    : true;
  const majorityHighRisk = (floodValue?.highRiskAreaPct ?? 100) >= 50;
  const floodGate =
    floodState === "expired"
      ? result("flood", "expired", "Flood evidence has expired.", flood)
      : floodState === "unknown"
        ? result("flood", "unknown", "Verified parcel flood overlay is missing.", flood)
        : !centroidHighRisk && !majorityHighRisk
          ? result("flood", "pass", `Centroid zone ${floodValue!.centroidZone}; ${floodValue!.highRiskAreaPct}% high-risk area.`, flood)
          : result("flood", "fail", `Centroid zone ${floodValue!.centroidZone}; ${floodValue!.highRiskAreaPct}% high-risk area.`, flood);

  return [zoningGate, rentGate, floodGate];
}

export function hasOperationalRequirements(site: SiteRecord, business: BusinessConfig): boolean {
  const officePass = !business.site.office_required || site.office === true;
  const displayPass = (site.vehicleDisplay ?? 0) >= business.site.min_vehicle_display;
  const distancePass = (site.metrics.driveMinutes ?? Number.POSITIVE_INFINITY) <= business.search.max_drive_minutes;
  const sharingPass = business.site.shared_lot !== "exclude" || !site.sharedLot;
  return officePass && displayPass && distancePass && sharingPass;
}
