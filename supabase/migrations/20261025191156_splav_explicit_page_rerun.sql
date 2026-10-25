-- Explicit run identity is necessary: document/source identity must not be falsified
-- to repeat a paid control. Zero UUID preserves every existing job/coordinator.
-- Installation does not enqueue anything, enable zones, or modify candidate data.
begin;
alter table crm_private.zone_coordinators add column run_id uuid not null default '00000000-0000-0000-0000-000000000000';
alter table crm_private.zone_coordinators add column previous_job_id uuid references crm_private.splav_jobs(id);
alter table crm_private.zone_coordinators add column run_reason text;
create unique index zone_coordinators_explicit_run on crm_private.zone_coordinators(run_id)
 where run_id<>'00000000-0000-0000-0000-000000000000';
alter table crm_private.zone_coordinators add constraint zone_coordinator_run_audit check(
 (run_id='00000000-0000-0000-0000-000000000000' and previous_job_id is null and run_reason is null)
 or (run_id<>'00000000-0000-0000-0000-000000000000' and previous_job_id is not null and run_reason is not null and length(btrim(run_reason)) between 1 and 500));
alter table crm_private.splav_jobs add column run_id uuid not null default '00000000-0000-0000-0000-000000000000';
alter table crm_private.splav_jobs drop constraint splav_jobs_source_unique;
alter table crm_private.splav_jobs add constraint splav_jobs_source_unique unique(document_id,original_source,kind,run_id);
alter table crm_private.splav_jobs add constraint splav_root_run check(kind='zone' or run_id='00000000-0000-0000-0000-000000000000');

do $patch$ declare definition text;needle text;replacement text;signature text;begin
 definition:=pg_get_functiondef('crm_private.zone_job_valid(crm_private.splav_jobs)'::regprocedure);
 needle:=$n$c.id=j.coordinator_id and c.document_id=j.document_id$n$;
 if strpos(definition,needle)=0 then raise exception 'Unexpected job binding';end if;
 execute replace(definition,needle,needle||' and c.run_id=j.run_id');
 -- Both enqueue paths retain source equality and deduplication *within* a run.
 foreach signature in array array['public.crm_splav_zone_enqueue(uuid,integer,integer)','crm_private.zone_canary_enqueue_core(uuid,integer,integer)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  needle:=$n$q.kind='zone';$n$;
  if strpos(definition,needle)=0 then raise exception 'Unexpected enqueue lookup';end if;
  definition:=replace(definition,needle,$n$q.kind='zone' and q.run_id=c.run_id;$n$);
  needle:=$n$j.current_source:=crm_private.splav_source(d);$n$;
  if strpos(definition,needle)=0 then raise exception 'Unexpected enqueue source';end if;
  definition:=replace(definition,needle,needle||'j.run_id:=c.run_id;');
  needle:=$n$original_source,current_source,kind,coordinator_id)$n$;
  if strpos(definition,needle)=0 then raise exception 'Unexpected enqueue columns';end if;
  definition:=replace(definition,needle,$n$original_source,current_source,kind,coordinator_id,run_id)$n$);
  definition:=replace(definition,$n$j.current_source,j.current_source,'zone',c.id)$n$,$n$j.current_source,j.current_source,'zone',c.id,c.run_id)$n$);
  definition:=replace(definition,$n$original_source=j.current_source and kind='zone';$n$,$n$original_source=j.current_source and kind='zone' and run_id=c.run_id;$n$);
  -- Prior run receipts are preserved, not treated as unbound manual dispatches.
  definition:=replace(definition,$n$r.source=c.source
   and (r.state=$n$,$n$r.source=c.source and not exists(select 1 from crm_private.zone_coordinator_steps rs where rs.request_id=r.id and rs.coordinator_id<>c.id)
   and (r.state=$n$);
  execute definition;
 end loop;
 -- Resume the explicitly leased coordinator. Never reopen the canonical old run.
 definition:=pg_get_functiondef('crm_private.worker_crm_zone_coordinator_open(uuid,text,boolean)'::regprocedure);
 definition:=replace(definition,'worker_crm_zone_coordinator_open(p_document_id uuid, p_file_sha256 text, p_recover boolean DEFAULT false)',
 'worker_crm_zone_coordinator_resume(p_document_id uuid, p_file_sha256 text, p_recover boolean, p_coordinator_id uuid)');
 if strpos(definition,'worker_crm_zone_coordinator_resume(')=0 then raise exception 'Unexpected coordinator signature';end if;
 needle:=substring(definition from 'sk:=encode[\s\S]*?for update;');
 if needle is null then raise exception 'Unexpected coordinator open';end if;
 replacement:=$n$select * into c from crm_private.zone_coordinators where id=p_coordinator_id for update;
 if not found or c.document_id is distinct from p_document_id or c.source is distinct from source or c.binding is distinct from binding
 then raise exception 'Coordinator source binding changed' using errcode='40001';end if;$n$;
 definition:=replace(definition,needle,replacement);execute definition;
 definition:=pg_get_functiondef('public.crm_splav_zone_step(uuid,uuid,text,jsonb)'::regprocedure);
 needle:=$n$crm_private.worker_crm_zone_coordinator_open(j.document_id,c.file_sha256,true)$n$;
 if strpos(definition,needle)=0 then raise exception 'Unexpected worker load';end if;
 execute replace(definition,needle,'crm_private.worker_crm_zone_coordinator_resume(j.document_id,c.file_sha256,true,c.id)');
 -- Receipt source remains the actual unchanged document; only the cache namespace
 -- differs. A repeat HTTP request in the same run still recovers the same receipt.
 definition:=pg_get_functiondef('crm_private.worker_crm_zone_begin(uuid,jsonb,text,integer,jsonb,text)'::regprocedure);
 definition:=replace(definition,'worker_crm_zone_begin(p_document_id uuid, p_source jsonb, p_mode text, p_page integer, p_box jsonb, p_render_sha256 text)',
 'worker_crm_zone_run_begin(p_document_id uuid, p_source jsonb, p_mode text, p_page integer, p_box jsonb, p_render_sha256 text, p_run_id uuid)');
 if strpos(definition,'worker_crm_zone_run_begin(')=0 then raise exception 'Unexpected receipt signature';end if;
 needle:=$n$sk:=encode(sha256(convert_to(snapshot::text,'UTF8')),'hex');$n$;
 if strpos(definition,needle)=0 then raise exception 'Unexpected receipt namespace';end if;
 definition:=replace(definition,needle,$n$if p_run_id is null then raise exception 'Run identity required';end if;
 sk:=encode(sha256(convert_to(jsonb_build_object('source',snapshot,'run_id',p_run_id)::text,'UTF8')),'hex');$n$);execute definition;
 definition:=pg_get_functiondef('crm_private.worker_crm_zone_coordinator_begin(uuid,integer,uuid,text,integer,jsonb,text)'::regprocedure);
 needle:=$n$answer:=crm_private.worker_crm_zone_begin(p_document_id,source,p_mode,p_page,p_box,p_render_sha256);$n$;
 if strpos(definition,needle)=0 then raise exception 'Unexpected coordinator receipt call';end if;
 execute replace(definition,needle,$n$if c.run_id='00000000-0000-0000-0000-000000000000' then
 answer:=crm_private.worker_crm_zone_begin(p_document_id,source,p_mode,p_page,p_box,p_render_sha256);
 else answer:=crm_private.worker_crm_zone_run_begin(p_document_id,source,p_mode,p_page,p_box,p_render_sha256,c.run_id);end if;$n$);
 -- Old and new report views must be isolated by coordinator membership.
 definition:=pg_get_functiondef('public.crm_splav_job_status(uuid)'::regprocedure);
 needle:=$n$q.source=c.source and q.state='completed'$n$;
 if strpos(definition,needle)=0 then raise exception 'Unexpected status receipt selection';end if;
 definition:=replace(definition,needle,$n$q.source=c.source and exists(select 1 from crm_private.zone_coordinator_steps rs where rs.coordinator_id=c.id and rs.request_id=q.id) and q.state='completed'$n$);
 needle:=$n$'zone_summary',summary$n$;
 if strpos(definition,needle)=0 then raise exception 'Unexpected status audit metadata';end if;
 execute replace(definition,needle,$n$'zone_run',case when c.id is not null then jsonb_build_object('id',c.run_id,'previous_job_id',c.previous_job_id,'reason',c.run_reason) else null end,'zone_summary',summary$n$);
end $patch$;
revoke all on function crm_private.worker_crm_zone_coordinator_resume(uuid,text,boolean,uuid),crm_private.worker_crm_zone_run_begin(uuid,jsonb,text,integer,jsonb,text,uuid) from public,anon,authenticated;

create function public.crm_splav_zone_page_rerun_enqueue(p_previous_job uuid,p_run_id uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $body$
declare old_job crm_private.splav_jobs;old_c crm_private.zone_coordinators;c crm_private.zone_coordinators;
 s crm_private.splav_settings;source jsonb;answer jsonb;existing crm_private.splav_jobs;begin
 if auth.uid() is null or crm_private.is_processor() or not exists(select 1 from public.crm_staff where user_id=auth.uid() and active and role='owner')
 then raise exception 'Active owner required' using errcode='42501';end if;
 if p_run_id is null or p_run_id='00000000-0000-0000-0000-000000000000' or p_reason is null or length(btrim(p_reason)) not between 1 and 500
 then raise exception 'Explicit run identity and reason required' using errcode='22023';end if;
 select * into old_job from crm_private.splav_jobs where id=p_previous_job;
 if not found or old_job.kind<>'zone' or old_job.state not in ('completed','needs_review') or old_job.stage<>'finished'
 then raise exception 'Finished prior zonal control required' using errcode='55000';end if;
 source:=crm_private.zone_source(old_job.document_id);
 select * into old_c from crm_private.zone_coordinators where id=old_job.coordinator_id;
 if old_c.source is distinct from source or old_c.run_id is distinct from old_job.run_id or not crm_private.zone_job_valid(old_job)
 then raise exception 'Prior control source changed' using errcode='40001';end if;
 if old_c.snapshot->>'pages' is distinct from '1' or old_c.snapshot->>'budget' is distinct from '13'
 or source->>'document_type' is distinct from 'Автобіографія друкована'
 then raise exception 'One-page printed biography control required' using errcode='22023';end if;
 select * into c from crm_private.zone_coordinators where run_id=p_run_id;
 if found then
  if c.previous_job_id is distinct from p_previous_job or c.created_by is distinct from auth.uid() or c.run_reason is distinct from btrim(p_reason)
  then raise exception 'Run identity already assigned' using errcode='40001';end if;
  select * into existing from crm_private.splav_jobs where coordinator_id=c.id and run_id=p_run_id;
  if not found then raise exception 'Incomplete run registration';end if;
  return jsonb_build_object('id',existing.id,'state',existing.state,'kind',existing.kind,'run_id',p_run_id);
 end if;
 if exists(select 1 from crm_private.splav_jobs where document_id=old_job.document_id and state in ('queued','running'))
 then raise exception 'Document already has active work' using errcode='55000';end if;
 select * into s from crm_private.splav_settings where singleton for update;
 if not s.enabled or s.zones_enabled or s.zone_canary_coordinator is not null
 then raise exception 'Rerun requires global zones off and an unused allowance' using errcode='55000';end if;
 insert into crm_private.zone_coordinators(document_id,source,file_sha256,binding,source_key,created_by,updated_by,run_id,previous_job_id,run_reason)
 values(old_c.document_id,old_c.source,old_c.file_sha256,old_c.binding,
 encode(sha256(convert_to(jsonb_build_object('source',old_c.source,'file_sha256',old_c.file_sha256,'run_id',p_run_id)::text,'UTF8')),'hex'),
 auth.uid(),auth.uid(),p_run_id,p_previous_job,btrim(p_reason)) returning * into c;
 update crm_private.splav_settings set zone_canary_coordinator=c.id where singleton;
 answer:=crm_private.zone_canary_enqueue_core(c.id,1,13);
 return answer||jsonb_build_object('run_id',p_run_id);
end $body$;
revoke all on function public.crm_splav_zone_page_rerun_enqueue(uuid,uuid,text) from public,anon;
grant execute on function public.crm_splav_zone_page_rerun_enqueue(uuid,uuid,text) to authenticated;
commit;
