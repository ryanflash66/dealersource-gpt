create extension if not exists postgis;
create extension if not exists pgcrypto;

create table public.sources (
  id text primary key,
  name text not null,
  kind text not null check (kind in ('crawl', 'reddit', 'rss', 'manual')),
  url text not null,
  robots_txt text not null check (robots_txt in ('allowed', 'disallowed', 'unknown')),
  terms_status text not null check (terms_status in ('allowed', 'prohibited', 'unclear')),
  enabled boolean not null default false,
  cadence text not null,
  checked_at timestamptz,
  status_note text,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.raw_documents (
  id text primary key,
  source_id text not null references public.sources(id),
  source_url text not null,
  fetched_at timestamptz not null,
  raw_payload jsonb not null,
  extraction jsonb not null,
  payload jsonb not null default '{}'::jsonb,
  unique (source_id, source_url, fetched_at)
);

create table public.listings (
  id text primary key,
  raw_document_id text references public.raw_documents(id),
  source_listing_id text,
  address text not null,
  site_key text not null,
  monthly_rent numeric(12, 2),
  written_rent_quote boolean not null default false,
  contact_email text,
  contact_source_url text,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.sites (
  id text primary key,
  site_key text not null unique,
  canonical_address text not null,
  location geography(point, 4326),
  stage text not null check (stage in ('discovered', 'resolved', 'enriched', 'verifying', 'scored', 'reported')),
  monthly_rent numeric(12, 2),
  office boolean,
  vehicle_display integer,
  shared_lot boolean not null default false,
  viable boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.parcels (
  id text primary key,
  site_id text not null unique references public.sites(id) on delete cascade,
  owner_name text,
  acreage numeric,
  geometry geometry(multipolygon, 4326),
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.evidence (
  id text primary key,
  site_id text not null references public.sites(id) on delete cascade,
  fact text not null,
  value jsonb not null,
  source_url text not null,
  fetched_at timestamptz not null,
  expires_at timestamptz not null,
  method text not null,
  verified boolean not null default false,
  citation text,
  payload jsonb not null default '{}'::jsonb,
  unique (site_id, fact, source_url, fetched_at)
);

create table public.contacts (
  id text primary key,
  email text not null unique,
  source_url text not null,
  do_not_contact boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.cases (
  id text primary key,
  site_id text not null references public.sites(id) on delete cascade,
  case_type text not null,
  owner text not null,
  contact_id text references public.contacts(id),
  status text not null check (status in ('open', 'waiting', 'escalated', 'closed')),
  opened_at timestamptz not null,
  next_action_at timestamptz not null,
  followups integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  unique (site_id, case_type)
);

create table public.messages (
  id text primary key,
  case_id text not null references public.cases(id) on delete cascade,
  site_id text not null references public.sites(id) on delete cascade,
  recipient text not null,
  direction text not null check (direction in ('outbound', 'inbound')),
  template text not null,
  sent_at timestamptz not null,
  dedupe_key text not null unique,
  status text not null,
  payload jsonb not null default '{}'::jsonb
);

create table public.scores (
  id text primary key,
  site_id text not null unique references public.sites(id) on delete cascade,
  traffic numeric not null,
  visibility numeric not null,
  distance numeric not null,
  rent numeric not null,
  competitors numeric not null,
  total numeric not null,
  calculated_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create table public.runs (
  id text primary key,
  run_date date not null,
  mode text not null check (mode in ('offline', 'live')),
  started_at timestamptz not null,
  completed_at timestamptz,
  stages_completed text[] not null default '{}',
  counts jsonb not null default '{}'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  paid_calls integer not null default 0,
  logs jsonb not null default '[]'::jsonb,
  payload jsonb not null default '{}'::jsonb
);

create table public.system_state (
  id text primary key,
  paused boolean not null default false,
  reason text,
  updated_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create index evidence_site_fact_idx on public.evidence (site_id, fact, expires_at desc);
create index sites_viable_score_idx on public.sites (viable, shared_lot, updated_at desc);
create index cases_status_next_action_idx on public.cases (status, next_action_at);
create index messages_recipient_sent_idx on public.messages (recipient, sent_at desc);
create index raw_documents_source_fetched_idx on public.raw_documents (source_id, fetched_at desc);
create index sites_location_gix on public.sites using gist (location);
create index parcels_geometry_gix on public.parcels using gist (geometry);

alter table public.sources enable row level security;
alter table public.raw_documents enable row level security;
alter table public.listings enable row level security;
alter table public.sites enable row level security;
alter table public.parcels enable row level security;
alter table public.evidence enable row level security;
alter table public.contacts enable row level security;
alter table public.cases enable row level security;
alter table public.messages enable row level security;
alter table public.scores enable row level security;
alter table public.runs enable row level security;
alter table public.system_state enable row level security;

create policy "dashboard reads sources" on public.sources for select to anon, authenticated using (true);
create policy "dashboard reads sites" on public.sites for select to anon, authenticated using (true);
create policy "dashboard reads parcels" on public.parcels for select to anon, authenticated using (true);
create policy "dashboard reads evidence" on public.evidence for select to anon, authenticated using (true);
create policy "dashboard reads scores" on public.scores for select to anon, authenticated using (true);
create policy "dashboard reads run summaries" on public.runs for select to anon, authenticated using (true);
create policy "dashboard reads system status" on public.system_state for select to anon, authenticated using (true);
create policy "dashboard reads case status" on public.cases for select to anon, authenticated using (true);
create policy "authenticated reads listings" on public.listings for select to authenticated using (true);
create policy "authenticated reads raw documents" on public.raw_documents for select to authenticated using (true);
create policy "authenticated reads messages" on public.messages for select to authenticated using (true);
create policy "authenticated reads contacts" on public.contacts for select to authenticated using (true);

grant usage on schema public to anon, authenticated;
grant select on public.sources, public.sites, public.parcels, public.evidence, public.scores, public.runs, public.system_state to anon, authenticated;
grant select (id, site_id, case_type, owner, status, opened_at, next_action_at, followups) on public.cases to anon;
grant select on public.cases to authenticated;
grant select on public.raw_documents, public.listings, public.cases, public.messages, public.contacts to authenticated;

create or replace view public.viable_shortlist
with (security_invoker = true)
as
select
  s.id,
  s.canonical_address,
  s.location,
  s.monthly_rent,
  s.office,
  s.vehicle_display,
  s.shared_lot,
  sc.traffic,
  sc.visibility,
  sc.distance,
  sc.rent,
  sc.competitors,
  sc.total
from public.sites s
join public.scores sc on sc.site_id = s.id
where s.viable = true
order by s.shared_lot asc, sc.total desc;

grant select on public.viable_shortlist to anon, authenticated;
