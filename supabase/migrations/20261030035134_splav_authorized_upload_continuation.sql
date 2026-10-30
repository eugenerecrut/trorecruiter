-- Per-job delegation for the existing pipeline. No table/column changes,
-- no backfill, no broad rollout and no upgrades of an already queued source.
begin;
create function public.crm_splav_enqueue_autopilot(document_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.documents;j crm_private.splav_jobs;source jsonb;answer jsonb;existed boolean;granted timestamptz;
begin
 if auth.uid() is null or crm_private.is_processor() or not exists(
  select 1 from public.crm_staff where user_id=auth.uid() and active and role in ('owner','lead','recruiter','observer')
 ) then raise exception 'Human delegation required' using errcode='42501';end if;
 if not exists(select 1 from crm_private.splav_settings where enabled and zones_enabled)
 then raise exception 'SPLAV_ZONE_CONTINUATION_DISABLED' using errcode='55000';end if;
 select * into d from public.documents where id=document_id for update;
 if not found then raise exception 'Document unavailable' using errcode='42501';end if;
 source:=crm_private.splav_source(d);
 select exists(select 1 from crm_private.splav_jobs q where q.document_id=d.id and q.kind='root' and q.original_source=source) into existed;
 -- Reuse all current human/source/access checks and the idempotent root queue.
 answer:=public.crm_splav_enqueue(d.id);
 select * into j from crm_private.splav_jobs where id=(answer->>'id')::uuid;
 if not existed then
  if j.initiated_by is distinct from auth.uid() or j.kind<>'root' or j.state<>'queued' or j.stage<>'waiting' or j.result is not null
  then raise exception 'New root delegation required' using errcode='40001';end if;
  granted:=clock_timestamp();
  update crm_private.splav_jobs set result=jsonb_build_object('zone_authorization',jsonb_build_object(
   'contract','splav-zone-authorization-1','job_id',j.id,'document_id',j.document_id,'actor_id',auth.uid(),
   'source_key',encode(sha256(convert_to(j.original_source::text,'UTF8')),'hex'),
   'max_pages',1,'budget',13,'granted_at',granted,'expires_at',granted+interval '24 hours'))
   where id=j.id returning * into j;
  insert into crm_private.splav_events(job_id,actor_id,initiated_by,operation)
   values(j.id,auth.uid(),j.initiated_by,'zone_continuation_authorized');
 end if;
 return answer||jsonb_build_object('zone_authorized',coalesce(j.result#>>'{zone_authorization,contract}'='splav-zone-authorization-1',false));
end $$;
revoke all on function public.crm_splav_enqueue_autopilot(uuid) from public,anon;
grant execute on function public.crm_splav_enqueue_autopilot(uuid) to authenticated;

create or replace function public.crm_splav_validate(job_id uuid,token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j crm_private.splav_jobs;a jsonb;
begin
 j:=crm_private.splav_lock_job(job_id,token);
 a:=j.result->'zone_authorization';
 if a->>'job_id' is distinct from j.id::text or a->>'document_id' is distinct from j.document_id::text
 or a->>'actor_id' is distinct from j.initiated_by::text
 or a->>'source_key' is distinct from encode(sha256(convert_to(j.original_source::text,'UTF8')),'hex')
 then a:=null;end if;
 return jsonb_build_object('document_id',j.document_id,'stage',j.stage,'source_revision',j.current_source->'ai_processed_at',
  'zone_authorization',a);
end $$;
-- Keep the existing processor lease, role and source checks authoritative.
revoke all on function public.crm_splav_validate(uuid,uuid) from public,anon;
grant execute on function public.crm_splav_validate(uuid,uuid) to authenticated;
commit;
