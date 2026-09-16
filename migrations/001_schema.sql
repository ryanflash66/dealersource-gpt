-- Supabase/Postgres application schema. Run with a migration owner, never a browser key.
create extension if not exists postgis;
create table if not exists public.app_users(user_id uuid primary key);
alter table public.app_users enable row level security;
create or replace function public.is_dashboard_user() returns boolean language sql stable security definer set search_path=public,pg_temp as $$ select exists(select 1 from public.app_users where user_id=auth.uid()) $$;
revoke all on function public.is_dashboard_user() from public;
grant execute on function public.is_dashboard_user() to authenticated;

do $$
declare t text;
begin
 foreach t in array array['sources','raw_documents','listings','sites','parcels','evidence','cases','messages','contacts','scores','runs'] loop
  execute format('create table if not exists public.%I(id text primary key, payload jsonb not null, updated_at timestamptz not null default now())',t);
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon, authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  if t = any(array['sources','sites','parcels','evidence','cases','scores','runs']) then
   execute format('grant select on public.%I to authenticated',t);
   execute format('drop policy if exists dashboard_read on public.%I',t);
   execute format('create policy dashboard_read on public.%I for select to authenticated using (public.is_dashboard_user())',t);
  end if;
 end loop;
end $$;
create index if not exists evidence_site_fact on public.evidence ((payload->>'site_id'),(payload->>'fact'));
create index if not exists messages_case on public.messages ((payload->>'case_id'));
create index if not exists cases_status on public.cases ((payload->>'status'));
create unique index if not exists messages_provider_unique on public.messages ((payload->>'provider_id')) where payload->>'provider_id' is not null;
create table if not exists public.parcel_shapes(id text primary key references public.parcels(id) on delete cascade, geom geometry(Geometry,4326) not null);
create index if not exists parcel_shapes_geom on public.parcel_shapes using gist(geom);
alter table public.parcel_shapes enable row level security;
revoke all on public.parcel_shapes from anon,authenticated;
grant all on public.parcel_shapes to service_role;
create table if not exists public.pipeline_state(id integer primary key check(id=1), state jsonb not null, revision integer not null default 0, lease_token text, lease_until timestamptz);
alter table public.pipeline_state enable row level security;
revoke all on public.pipeline_state from anon,authenticated;

create or replace function public.acquire_pipeline(lease_token text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare row_state public.pipeline_state; empty_tables jsonb; t text;
begin
 empty_tables='{}'::jsonb;
 foreach t in array array['sources','raw_documents','listings','sites','parcels','evidence','cases','messages','contacts','scores','runs'] loop empty_tables=empty_tables||jsonb_build_object(t,'[]'::jsonb);end loop;
 insert into public.pipeline_state(id,state) values(1,jsonb_build_object('version',1,'revision',0,'tables',empty_tables,'controls',jsonb_build_object('sending_paused',false,'pause_reason',null))) on conflict do nothing;
 select * into row_state from public.pipeline_state where id=1 for update;
 if row_state.lease_until>now() and row_state.lease_token is distinct from acquire_pipeline.lease_token then raise exception 'Pipeline is locked';end if;
 update public.pipeline_state set lease_token=acquire_pipeline.lease_token,lease_until=now()+interval '10 minutes' where id=1;
 return jsonb_build_object('state',row_state.state);
end $$;

create or replace function public.save_pipeline(lease_token text,expected_revision integer,new_state jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare row_state public.pipeline_state; t text; item jsonb;
begin
 select * into row_state from public.pipeline_state where id=1 for update;
 if row_state.lease_token is distinct from save_pipeline.lease_token or row_state.lease_until<now() or row_state.revision<>expected_revision then raise exception 'Lease or revision mismatch';end if;
 if (new_state->>'version')::integer<>1 or (new_state->>'revision')::integer<>expected_revision+1 then raise exception 'Invalid state revision';end if;
 foreach t in array array['sources','raw_documents','listings','sites','parcels','evidence','cases','messages','contacts','scores','runs'] loop
  if jsonb_typeof(new_state->'tables'->t)<>'array' then raise exception 'Missing state table';end if;
  for item in select value from jsonb_array_elements(new_state->'tables'->t) loop
   execute format('insert into public.%I(id,payload) values($1,$2) on conflict(id) do update set payload=excluded.payload, updated_at=now()',t) using item->>'id',item;
   if t='parcels' and item->'geometry' is not null then
    insert into public.parcel_shapes(id,geom) values(item->>'id',st_setsrid(st_geomfromgeojson((item->'geometry')::text),4326)) on conflict(id) do update set geom=excluded.geom;
   end if;
  end loop;
 end loop;
 update public.pipeline_state set state=new_state,revision=expected_revision+1,lease_until=now()+interval '10 minutes' where id=1;
 return jsonb_build_object('revision',expected_revision+1);
end $$;
create or replace function public.release_pipeline(lease_token text) returns void language sql security definer set search_path=public,pg_temp as $$ update public.pipeline_state set lease_token=null,lease_until=null where id=1 and pipeline_state.lease_token=release_pipeline.lease_token $$;
revoke all on function public.acquire_pipeline(text),public.save_pipeline(text,integer,jsonb),public.release_pipeline(text) from public;
grant execute on function public.acquire_pipeline(text),public.save_pipeline(text,integer,jsonb),public.release_pipeline(text) to service_role;

-- Full PostGIS union/intersection path for arbitrary official flood geometries.
create or replace function public.flood_metrics(parcel_geojson jsonb,zones jsonb,high_zones text[]) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p geometry; all_zones geometry; dangerous geometry; z record; g geometry; centroid_zone text;
begin
 p=st_makevalid(st_setsrid(st_geomfromgeojson(parcel_geojson::text),4326));
 for z in select value from jsonb_array_elements(zones) loop
  g=st_makevalid(st_setsrid(st_geomfromgeojson((z.value->'geometry')::text),4326));
  all_zones=case when all_zones is null then g else st_union(all_zones,g) end;
  if z.value->>'zone'=any(high_zones) then dangerous=case when dangerous is null then g else st_union(dangerous,g) end;end if;
  if st_covers(g,st_centroid(p)) then if centroid_zone is null or z.value->>'zone'=any(high_zones) then centroid_zone=z.value->>'zone';end if;end if;
 end loop;
 if st_area(st_transform(p,32119))<=0 then raise exception 'Invalid parcel area';end if;
 return jsonb_build_object('centroid_zone',centroid_zone,'high_risk_fraction',coalesce(st_area(st_transform(st_intersection(p,dangerous),32119))/st_area(st_transform(p,32119)),0),'coverage_complete',coalesce(st_covers(all_zones,p),false) and centroid_zone is not null,'geometry_checked',true);
end $$;
revoke all on function public.flood_metrics(jsonb,jsonb,text[]) from public;
grant execute on function public.flood_metrics(jsonb,jsonb,text[]) to service_role;
