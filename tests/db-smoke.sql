begin;
insert into public.app_users(user_id) values('00000000-0000-0000-0000-000000000001') on conflict do nothing;
insert into public.sites(id,payload) values('smoke-site','{"id":"smoke-site"}') on conflict do nothing;
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
do $$ begin if exists(select 1 from public.sites) then raise exception 'RLS leaked rows';end if;end $$;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
do $$ begin if not exists(select 1 from public.sites where id='smoke-site') then raise exception 'Authorized dashboard read failed';end if;end $$;
reset role;
do $$ declare state jsonb; m jsonb; begin
 state=public.acquire_pipeline('smoke-lease')->'state';
 perform public.save_pipeline('smoke-lease',(state->>'revision')::integer,jsonb_set(state,'{revision}',to_jsonb((state->>'revision')::integer+1)));
 perform public.release_pipeline('smoke-lease');
 m=public.flood_metrics('{"type":"Polygon","coordinates":[[[-77.37,35.61],[-77.36,35.61],[-77.36,35.62],[-77.37,35.62],[-77.37,35.61]]]}', '[{"zone":"X","geometry":{"type":"Polygon","coordinates":[[[-77.38,35.60],[-77.35,35.60],[-77.35,35.63],[-77.38,35.63],[-77.38,35.60]]]}}]',array['AE']);
 if not (m->>'coverage_complete')::boolean or (m->>'high_risk_fraction')::numeric<>0 then raise exception 'Flood overlay failed';end if;
end $$;
rollback;
