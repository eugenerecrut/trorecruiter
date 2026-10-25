-- Pending approval: one owner-scoped one-page control, fixed budget 13.
-- Does not activate the global queue or enqueue any document.
begin;
do $gate$ declare definition text;needle text;replacement text;begin
 definition:=pg_get_functiondef('crm_private.zone_job_enabled(crm_private.splav_jobs)'::regprocedure);
 needle:=$n$c.snapshot->>'budget'='1'$n$;
 replacement:=$n$(c.snapshot->>'budget'='1' or (c.snapshot->>'budget'='13' and c.snapshot->>'pages'='1'))$n$;
 if strpos(definition,replacement)=0 then
  if strpos(definition,needle)=0 then raise exception 'Unexpected canary job gate';end if;
  execute replace(definition,needle,replacement);
 end if;
 definition:=pg_get_functiondef('crm_private.zone_canary_enqueue_core(uuid,integer,integer)'::regprocedure);
 needle:=$n$zone_canary_coordinator=p_id and p_budget=1$n$;
 replacement:=$n$zone_canary_coordinator=p_id and (p_budget=1 or (p_budget=13 and p_pages=1))$n$;
 if strpos(definition,replacement)=0 then
  if strpos(definition,needle)=0 then raise exception 'Unexpected canary enqueue gate';end if;
  execute replace(definition,needle,replacement);
 end if;
end $gate$;
create or replace function public.crm_splav_zone_page_canary_enqueue(p_id uuid,p_pages integer) returns jsonb
language plpgsql security definer set search_path='' as $body$
declare c crm_private.zone_coordinators;s crm_private.splav_settings;doc uuid;begin
 if auth.uid() is null or crm_private.is_processor() or not exists(select 1 from public.crm_staff where user_id=auth.uid() and active and role='owner')
 then raise exception 'Active owner required' using errcode='42501';end if;
 if p_pages is distinct from 1 then raise exception 'One-page control requires exactly one page' using errcode='22023';end if;
 select document_id into doc from crm_private.zone_coordinators where id=p_id;
 perform crm_private.zone_source(doc);
 select * into c from crm_private.zone_coordinators where id=p_id for update;
 if not found or (c.snapshot is not null and (c.snapshot->>'budget'<>'13' or c.snapshot->>'attempts'<>'0'))
 or exists(select 1 from crm_private.splav_jobs where coordinator_id=c.id)
 then raise exception 'Canary already consumed or coordinator has another budget' using errcode='55000';end if;
 select * into s from crm_private.splav_settings where singleton for update;
 if not s.enabled or s.zones_enabled or (s.zone_canary_coordinator is not null and s.zone_canary_coordinator<>p_id)
 then raise exception 'Canary requires global zones off and an unused allowance' using errcode='55000';end if;
 update crm_private.splav_settings set zone_canary_coordinator=p_id where singleton;
 return crm_private.zone_canary_enqueue_core(p_id,p_pages,13);
end $body$;
revoke all on function public.crm_splav_zone_page_canary_enqueue(uuid,integer) from public,anon;
grant execute on function public.crm_splav_zone_page_canary_enqueue(uuid,integer) to authenticated;
commit;
