import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Layer, ProviderConfig, StructuredLog } from "./types.ts";
import { projectRoot } from "./config.ts";

export interface ProviderContext {
  offline: boolean;
  runId: string;
  now: string;
  log: (entry: Omit<StructuredLog, "timestamp" | "runId">) => void;
}

export interface ProviderAdapter<Input = unknown, Output = unknown> {
  readonly layer: Layer;
  readonly name: string;
  readonly paid: boolean;
  readonly costClass: "free" | "paid-low" | "paid-variable";
  execute(input: Input, context: ProviderContext): Promise<Output>;
}

interface AdapterDefinition {
  layer: Layer;
  name: string;
  paid: boolean;
  costClass: "free" | "paid-low" | "paid-variable";
  endpointEnv?: string;
}

const definitions: AdapterDefinition[] = [
  { layer: "geocoder", name: "census", paid: false, costClass: "free", endpointEnv: "CENSUS_GEOCODER_URL" },
  { layer: "geocoder", name: "nominatim", paid: false, costClass: "free", endpointEnv: "NOMINATIM_URL" },
  { layer: "geocoder", name: "google_geocoding", paid: true, costClass: "paid-variable", endpointEnv: "GOOGLE_GEOCODING_URL" },
  { layer: "parcels", name: "nc_onemap", paid: false, costClass: "free", endpointEnv: "NC_ONEMAP_PARCELS_URL" },
  { layer: "parcels", name: "county_gis", paid: false, costClass: "free", endpointEnv: "COUNTY_GIS_URL" },
  { layer: "parcels", name: "regrid", paid: true, costClass: "paid-variable", endpointEnv: "REGRID_URL" },
  { layer: "zoning", name: "official_arcgis", paid: false, costClass: "free", endpointEnv: "OFFICIAL_ZONING_URL" },
  { layer: "zoning", name: "official_manual_service", paid: true, costClass: "paid-low", endpointEnv: "OFFICIAL_ZONING_SERVICE_URL" },
  { layer: "drive_time", name: "openrouteservice", paid: false, costClass: "free", endpointEnv: "ORS_URL" },
  { layer: "drive_time", name: "valhalla", paid: false, costClass: "free", endpointEnv: "VALHALLA_URL" },
  { layer: "drive_time", name: "google_distance_matrix", paid: true, costClass: "paid-variable", endpointEnv: "GOOGLE_DISTANCE_URL" },
  { layer: "traffic", name: "ncdot_aadt", paid: false, costClass: "free", endpointEnv: "NCDOT_AADT_URL" },
  { layer: "traffic", name: "traffic_data_service", paid: true, costClass: "paid-variable", endpointEnv: "PAID_TRAFFIC_URL" },
  { layer: "flood", name: "fema_nfhl", paid: false, costClass: "free", endpointEnv: "FEMA_NFHL_URL" },
  { layer: "flood", name: "flood_data_service", paid: true, costClass: "paid-variable", endpointEnv: "PAID_FLOOD_URL" },
  { layer: "imagery", name: "nc_onemap_imagery", paid: false, costClass: "free", endpointEnv: "NC_ONEMAP_IMAGERY_URL" },
  { layer: "imagery", name: "mapillary", paid: false, costClass: "free", endpointEnv: "MAPILLARY_URL" },
  { layer: "imagery", name: "google_street_view", paid: true, costClass: "paid-variable", endpointEnv: "GOOGLE_STREET_VIEW_URL" },
  { layer: "competitors", name: "overpass", paid: false, costClass: "free", endpointEnv: "OVERPASS_URL" },
  { layer: "competitors", name: "google_places", paid: true, costClass: "paid-variable", endpointEnv: "GOOGLE_PLACES_URL" },
  { layer: "map_tiles", name: "protomaps", paid: false, costClass: "free", endpointEnv: "PMTILES_URL" },
  { layer: "map_tiles", name: "mapbox", paid: true, costClass: "paid-variable", endpointEnv: "MAPBOX_STYLE_URL" },
  { layer: "crawler", name: "anycrawl_self_hosted", paid: false, costClass: "free", endpointEnv: "ANYCRAWL_URL" },
  { layer: "crawler", name: "anycrawl_cloud", paid: true, costClass: "paid-variable", endpointEnv: "ANYCRAWL_CLOUD_URL" },
  { layer: "social", name: "reddit", paid: false, costClass: "free", endpointEnv: "REDDIT_API_URL" },
  { layer: "social", name: "social_data_service", paid: true, costClass: "paid-variable", endpointEnv: "PAID_SOCIAL_URL" },
  { layer: "mail", name: "gmail", paid: false, costClass: "free", endpointEnv: "GMAIL_API_URL" },
  { layer: "mail", name: "transactional_email", paid: true, costClass: "paid-variable", endpointEnv: "PAID_MAIL_URL" },
  { layer: "llm", name: "scheduled_agent", paid: false, costClass: "free" },
  { layer: "llm", name: "claude_api", paid: true, costClass: "paid-variable", endpointEnv: "CLAUDE_API_URL" },
];

type FixtureFile = Record<string, Record<string, Record<string, unknown>>>;

class RecordedFixtureAdapter implements ProviderAdapter<Record<string, unknown>, unknown> {
  constructor(
    readonly layer: Layer,
    readonly name: string,
    readonly paid: boolean,
    readonly costClass: "free" | "paid-low" | "paid-variable",
    private readonly fixtures: FixtureFile,
  ) {}

  async execute(input: Record<string, unknown>): Promise<unknown> {
    const key = String(input.fixtureKey ?? "default");
    const value = this.fixtures[this.layer]?.[this.name]?.[key] ?? this.fixtures[this.layer]?.[this.name]?.default;
    if (value === undefined) throw new Error(`No recorded fixture for ${this.layer}/${this.name}/${key}`);
    return structuredClone(value);
  }
}

class JsonHttpAdapter implements ProviderAdapter<Record<string, unknown>, unknown> {
  constructor(
    readonly layer: Layer,
    readonly name: string,
    readonly paid: boolean,
    readonly costClass: "free" | "paid-low" | "paid-variable",
    private readonly endpoint: string,
  ) {}

  async execute(input: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "dealersource/1.0" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`${this.layer}/${this.name} returned HTTP ${response.status}`);
    return response.json();
  }
}

export class ProviderRegistry {
  private constructor(
    private readonly config: ProviderConfig,
    private readonly offline: boolean,
    private readonly fixtures: FixtureFile,
  ) {}

  static async create(config: ProviderConfig, offline: boolean, root = projectRoot): Promise<ProviderRegistry> {
    const fixtureText = await readFile(resolve(root, "fixtures", "providers.json"), "utf8");
    return new ProviderRegistry(config, offline, JSON.parse(fixtureText) as FixtureFile);
  }

  selected(layer: Layer): string {
    return this.config.providers[layer];
  }

  adapter(layer: Layer): ProviderAdapter<Record<string, unknown>, unknown> {
    const name = this.selected(layer);
    const definition = definitions.find((candidate) => candidate.layer === layer && candidate.name === name);
    if (!definition) throw new Error(`Unknown provider selection ${layer}/${name}`);
    if (definition.paid && !this.config.paid_enabled) {
      throw new Error(`Paid provider ${layer}/${name} is selected while providers.paid_enabled is false`);
    }
    const endpoint = definition.endpointEnv ? process.env[definition.endpointEnv] : undefined;
    if (!this.offline && endpoint) {
      return new JsonHttpAdapter(layer, name, definition.paid, definition.costClass, endpoint);
    }
    if (!this.offline && !endpoint && !this.config.fixture_fallback) {
      throw new Error(`Missing ${definition.endpointEnv ?? "live adapter configuration"} for ${layer}/${name}`);
    }
    return new RecordedFixtureAdapter(layer, name, definition.paid, definition.costClass, this.fixtures);
  }

  async call<T>(
    layer: Layer,
    input: Record<string, unknown>,
    context: ProviderContext,
  ): Promise<T> {
    const adapter = this.adapter(layer);
    context.log({
      level: "info",
      event: "provider.call",
      details: {
        layer,
        provider: adapter.name,
        mode: adapter instanceof RecordedFixtureAdapter ? "fixture" : "live",
        paid: adapter.paid,
        costClass: adapter.costClass,
      },
    });
    return (await adapter.execute(input, context)) as T;
  }
}

export function listAdapterDefinitions(): ReadonlyArray<Readonly<AdapterDefinition>> {
  return definitions;
}
