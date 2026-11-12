begin;
-- Test identities are permanently barred from generic claims, even after all
-- their permits expire. Keep the permit row as the durable identity marker.
create function crm_private.splav_isolated_executor(p_user uuid) returns boolean
language sql stable set search_path='' as $$
 select exists(select 1 from crm_private.splav_isolated_permits where executor_id=p_user)
$$;
revoke all on function crm_private.splav_isolated_executor(uuid) from public,anon,authenticated;

create function crm_private.splav_isolated_assert_step(p_user uuid,p_job uuid,p_token uuid) returns void
language plpgsql volatile set search_path='' as $$
begin
 if crm_private.splav_isolated_executor(p_user) and not exists(
  select 1 from crm_private.splav_isolated_permits p
  where p.executor_id=p_user
  and crm_private.splav_isolated_step_deadline(p.root_job_id,p_job,p.document_id,p.file_sha256,p_user,p_token)>clock_timestamp()
 ) then raise exception 'Isolated SPLAV permit denied' using errcode='42501';end if;
end $$;
revoke all on function crm_private.splav_isolated_assert_step(uuid,uuid,uuid) from public,anon,authenticated;

do $migration$
declare f regprocedure; definition text; anchor text;
begin
 foreach f in array array['public.crm_splav_claim()'::regprocedure,'public.crm_splav_zone_claim()'::regprocedure] loop
  definition:=pg_get_functiondef(f);
  anchor:=' if not pg_try_advisory_xact_lock';
  if strpos(definition,anchor)=0 then raise exception 'Unexpected SPLAV claim contract: %',f;end if;
  definition:=replace(definition,anchor,$patch$ if crm_private.splav_isolated_executor(auth.uid()) then raise exception 'Isolated processor cannot claim from shared queue' using errcode='42501';end if;
 if not pg_try_advisory_xact_lock$patch$);
  execute definition;
 end loop;
 foreach f in array array['crm_private.splav_lock_job(uuid,uuid)'::regprocedure,'public.crm_splav_zone_step(uuid,uuid,text,jsonb)'::regprocedure] loop
  definition:=replace(pg_get_functiondef(f),chr(13)||chr(10),chr(10));
  anchor:='begin'||chr(10);
  if strpos(definition,anchor)=0 then raise exception 'Unexpected SPLAV step contract: %',f;end if;
  definition:=overlay(definition placing anchor||
   case when f='crm_private.splav_lock_job(uuid,uuid)'::regprocedure
    then ' perform crm_private.splav_isolated_assert_step(auth.uid(),job_id,token);'
    else ' perform crm_private.splav_isolated_assert_step(auth.uid(),p_job,p_token);' end||chr(10)
   from strpos(definition,anchor) for length(anchor));
  execute definition;
 end loop;
end $migration$;
commit;
