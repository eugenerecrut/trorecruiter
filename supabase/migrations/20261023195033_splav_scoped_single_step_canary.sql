-- A one-coordinator, one-attempt allowance; never enables the global zonal queue.
begin;
alter table crm_private.splav_settings add column zone_canary_coordinator uuid references crm_private.zone_coordinators(id);
create function crm_private.zone_job_enabled(j crm_private.splav_jobs) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from crm_private.splav_settings s where enabled and
  (zones_enabled or (s.zone_canary_coordinator=j.coordinator_id and j.kind='zone' and exists(
   select 1 from crm_private.zone_coordinators c where c.id=j.coordinator_id and c.snapshot->>'budget'='1'))))
$$;
revoke all on function crm_private.zone_job_enabled(crm_private.splav_jobs) from public,anon,authenticated;

do $$ declare definition text;core text;needle text:='exists(select 1 from crm_private.splav_settings where enabled and zones_enabled)';begin
 definition:=pg_get_functiondef('crm_private.zone_source(uuid)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'Unexpected zone source gate';end if;
 definition:=replace(definition,needle,'crm_private.zone_job_enabled(j)');execute definition;
 definition:=pg_get_functiondef('public.crm_splav_zone_step(uuid,uuid,text,jsonb)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'Unexpected zonal step gate';end if;
 definition:=replace(definition,needle,'crm_private.zone_job_enabled(j)');
 definition:=replace(definition,'where id=j.id;return answer;',
  'where id=j.id;update crm_private.splav_settings set zone_canary_coordinator=null where zone_canary_coordinator=j.coordinator_id;return answer;');
 definition:=replace(definition,'return jsonb_build_object(''released'',true);',
  'if p_operation in (''block'',''hold'') or (p_operation=''retry'' and j.attempts>=3) then update crm_private.splav_settings set zone_canary_coordinator=null where zone_canary_coordinator=j.coordinator_id;end if;return jsonb_build_object(''released'',true);');execute definition;
 definition:=pg_get_functiondef('public.crm_splav_zone_claim()'::regprocedure);
 if position(needle in definition)=0 then raise exception 'Unexpected zonal claim gate';end if;
 definition:=replace(definition,needle,'exists(select 1 from crm_private.splav_settings where enabled and (zones_enabled or zone_canary_coordinator is not null))');
 definition:=replace(definition,'from crm_private.splav_jobs where kind=''zone''','from crm_private.splav_jobs q where crm_private.zone_job_enabled(q) and kind=''zone''');execute definition;
 -- Reuse the same enqueue implementation behind a private, narrow entry gate.
 definition:=pg_get_functiondef('public.crm_splav_zone_enqueue(uuid,integer,integer)'::regprocedure);
 core:=replace(definition,'FUNCTION public.crm_splav_zone_enqueue(','FUNCTION crm_private.zone_canary_enqueue_core(');
 if core=definition or position('not public.crm_zone_background_ready()' in core)=0 then raise exception 'Unexpected enqueue gate';end if;
 core:=replace(core,'not public.crm_zone_background_ready()',
  'not exists(select 1 from crm_private.splav_settings where enabled and zone_canary_coordinator=p_id and p_budget=1)');execute core;
end $$;
revoke all on function crm_private.zone_canary_enqueue_core(uuid,integer,integer) from public,anon,authenticated;

create or replace function crm_private.splav_case_allowed(wanted uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from crm_private.splav_jobs j join public.crm_staff s on s.user_id=j.leased_by
 where j.candidate_id=wanted and j.state='running' and j.leased_by=(select auth.uid()) and s.active and s.role='processor' and j.lease_until>now()
 and exists(select 1 from crm_private.splav_settings where enabled)
 and case when j.kind='zone' then crm_private.zone_job_enabled(j) and crm_private.zone_job_valid(j) else crm_private.splav_valid_source(j) end)
$$;

create function public.crm_splav_zone_canary_enqueue(p_id uuid,p_pages integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c crm_private.zone_coordinators;s crm_private.splav_settings;doc uuid;begin
 if auth.uid() is null or crm_private.is_processor() or not exists(select 1 from public.crm_staff where user_id=auth.uid() and active and role='owner')
 then raise exception 'Active owner required' using errcode='42501';end if;
 select document_id into doc from crm_private.zone_coordinators where id=p_id;
 perform crm_private.zone_source(doc);
 select * into c from crm_private.zone_coordinators where id=p_id for update;
 if not found or (c.snapshot is not null and (c.snapshot->>'budget'<>'1' or c.snapshot->>'attempts'<>'0'))
 or exists(select 1 from crm_private.splav_jobs where coordinator_id=c.id)
 then raise exception 'Canary already consumed or coordinator has another budget' using errcode='55000';end if;
 select * into s from crm_private.splav_settings where singleton for update;
 if not s.enabled or s.zones_enabled or (s.zone_canary_coordinator is not null and s.zone_canary_coordinator<>p_id)
 then raise exception 'Canary requires global zones off and an unused allowance' using errcode='55000';end if;
 update crm_private.splav_settings set zone_canary_coordinator=p_id where singleton;
 return crm_private.zone_canary_enqueue_core(p_id,p_pages,1);
end $$;
revoke all on function public.crm_splav_zone_canary_enqueue(uuid,integer) from public,anon;
grant execute on function public.crm_splav_zone_canary_enqueue(uuid,integer) to authenticated;
commit;
