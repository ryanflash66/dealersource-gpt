import type { CaseRecord, SiteRecord } from "./types.ts";

const subjects: Record<CaseRecord["type"], string> = {
  zoning: "Written zoning confirmation request",
  rent: "Written base-rent confirmation request",
  flood: "Parcel flood-zone confirmation request",
  office: "Enclosed office confirmation request",
  space: "Vehicle display capacity confirmation request",
  sublease: "Written sublease consent request",
};

export function renderApprovedMessage(caseRecord: CaseRecord, site: SiteRecord): {
  subject: string;
  body: string;
} {
  const question = {
    zoning: "Please confirm in writing whether used motor vehicle sales is permitted or conditionally permitted at this parcel, and cite the controlling use-table section or approval.",
    rent: "Please confirm the monthly base rent in writing, excluding utilities and pass-through charges.",
    flood: "Please provide the official parcel flood-zone determination covering the centroid and majority of parcel area.",
    office: "Please confirm that the leased area includes an enclosed office reserved for the tenant.",
    space: "Please confirm how many vehicles can be displayed on the leased lot.",
    sublease: "Please confirm in writing that vehicle sales and the proposed sublease are permitted by the owner.",
  }[caseRecord.type];
  return {
    subject: `${subjects[caseRecord.type]}: ${site.address}`,
    body: `Hello,\n\n${question}\n\nSite: ${site.address}\n\nThank you,\nDealership site review`,
  };
}
