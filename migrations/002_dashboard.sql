create table if not exists public.dashboard_reports(id integer primary key check(id=1), report jsonb not null, updated_at timestamptz not null default now());
alter table public.dashboard_reports enable row level security;
revoke all on public.dashboard_reports from anon,authenticated;
grant all on public.dashboard_reports to service_role;
create or replace function public.publish_dashboard(new_report jsonb) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new_report->'report'->'sites' is null or new_report->'run' is null then raise exception 'Invalid report contract';end if;
 insert into public.dashboard_reports(id,report) values(1,new_report) on conflict(id) do update set report=excluded.report,updated_at=now();
end $$;
create or replace function public.get_dashboard() returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not public.is_dashboard_user() then raise exception 'Dashboard access denied';end if;
 return (select report from public.dashboard_reports where id=1);
end $$;
revoke all on function public.publish_dashboard(jsonb),public.get_dashboard() from public;
grant execute on function public.publish_dashboard(jsonb) to service_role;
grant execute on function public.get_dashboard() to authenticated;
