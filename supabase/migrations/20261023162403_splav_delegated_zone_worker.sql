-- Explicit PDF-only delegation. Existing jobs, cron, planner and receipts are reused.
-- No backfill, no activation, no candidate writes.
begin;
alter table crm_private.splav_settings add column zones_enabled boolean not null default false;
alter table crm_private.splav_jobs add column kind text not null default 'root' check(kind in ('root','zone'));
alter table crm_private.splav_jobs add column coordinator_id uuid references crm_private.zone_coordinators(id);
alter table crm_private.splav_jobs add constraint splav_job_kind check((kind='zone')=(coordinator_id is not null));
alter table crm_private.splav_jobs drop constraint splav_jobs_source_unique;
alter table crm_private.splav_jobs add constraint splav_jobs_source_unique unique(document_id,original_source,kind);

create function crm_private.zone_job_valid(j crm_private.splav_jobs) returns boolean
language sql stable security definer set search_path='' as $$
 select j.kind='zone' and crm_private.splav_valid_source(j) and exists(
 select 1 from crm_private.zone_coordinators c join public.documents d on d.id=c.document_id
 where c.id=j.coordinator_id and c.document_id=j.document_id
 and c.source=crm_private.splav_source(d)||jsonb_build_object('ai_document_type',d.ai_document_type)
 and jsonb_typeof(d.ai_extracted)='object' and (d.mime_type='application/pdf' or d.storage_path ~* '\.pdf$')
 and coalesce(d.file_size,0)<=20971520 and public.crm_document_zone_allowed(d.id))
$$;
revoke all on function crm_private.zone_job_valid(crm_private.splav_jobs) from public,anon,authenticated;

-- Root capabilities must never accept a zonal lease.
do $$ declare definition text;begin
 definition:=pg_get_functiondef('crm_private.splav_valid_source(crm_private.splav_jobs)'::regprocedure);
 if position('d.verification_status is distinct from ''Підтверджено''' in definition)=0 then raise exception 'Unexpected source contract';end if;
 -- Zonal work appends a read-only report, never overwrites primary OCR or verification.
 definition:=replace(definition,'d.verification_status is distinct from ''Підтверджено''','(j.kind=''zone'' or d.verification_status is distinct from ''Підтверджено'')');execute definition;
 definition:=pg_get_functiondef('public.crm_splav_claim()'::regprocedure);
 if position('where state=''running'' and lease_until<=now()' in definition)=0 or position('where state=''queued'' order by' in definition)=0 then raise exception 'Unexpected root claim contract';end if;
 definition:=replace(definition,'where state=''running'' and lease_until<=now()','where kind=''root'' and state=''running'' and lease_until<=now()');
 definition:=replace(definition,'where state=''queued'' order by','where kind=''root'' and state=''queued'' order by');execute definition;
 definition:=pg_get_functiondef('crm_private.splav_lock_job(uuid,uuid)'::regprocedure);
 definition:=replace(definition,'if not found or j.state<>''running''','if not found or j.kind<>''root'' or j.state<>''running''');execute definition;
 definition:=pg_get_functiondef('public.crm_splav_candidate_jobs(uuid)'::regprocedure);
 if position('''state'',j.state))' in definition)=0 then raise exception 'Unexpected job status contract';end if;
 definition:=replace(definition,'''state'',j.state))','''state'',j.state,''kind'',j.kind))');execute definition;
end $$;

-- Clone the existing implementations into private cores. Public human entry points
-- keep their signatures, grants and bodies, with an explicit processor denial.
do $$ declare signature text;name text;definition text;core text;doc_expr text;begin
 foreach signature in array array['crm_zone_begin(uuid,jsonb,text,integer,jsonb,text)','crm_zone_finish(uuid,uuid,jsonb)',
 'crm_zone_coordinator_open(uuid,text,boolean)','crm_zone_coordinator_save(uuid,integer,jsonb)',
 'crm_zone_coordinator_begin(uuid,integer,uuid,text,integer,jsonb,text)'] loop
  name:=split_part(signature,'(',1);definition:=pg_get_functiondef(('public.'||signature)::regprocedure);
  core:=replace(definition,'FUNCTION public.'||name||'(','FUNCTION crm_private.worker_'||name||'(');
  if core=definition then raise exception 'Unexpected zonal function definition';end if;
  if name='crm_zone_coordinator_begin' then core:=replace(core,'public.crm_zone_begin(','crm_private.worker_crm_zone_begin(');end if;
  if name='crm_zone_finish' then
   core:=replace(core,'or crm_private.is_processor()','');
   core:=replace(core,'''owner'',''lead'',''recruiter'',''observer''','''owner'',''lead'',''recruiter'',''observer'',''processor''');
  end if;
  execute core;
  execute 'revoke all on function crm_private.worker_'||signature||' from public,anon,authenticated';
  doc_expr:=case when name='crm_zone_coordinator_save' then '(select document_id from crm_private.zone_coordinators where id=p_id)'
    when name='crm_zone_finish' then '(select document_id from crm_private.zone_requests where id=p_request_id)' else 'p_document_id' end;
  definition:=regexp_replace(definition,'\mbegin\M','begin if crm_private.is_processor() then raise exception ''Human reader required'' using errcode=''42501''; end if; '
   ||'if exists(select 1 from crm_private.splav_jobs j where j.kind=''zone'' and j.document_id='||doc_expr||' and j.state in (''queued'',''running'') and crm_private.zone_job_valid(j)) then raise exception ''Background zonal job active'' using errcode=''55000''; end if;','i');
  execute definition;
 end loop;
end $$;

-- Only a live, enabled, explicitly delegated zonal lease can reach private cores.
-- No caller-editable claim, GUC, service-role data access or human impersonation.
create or replace function crm_private.zone_source(p_document_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.documents;
begin
 if auth.uid() is null then raise exception 'Active reader required' using errcode='42501';end if;
 if crm_private.is_processor() then
  if not exists(select 1 from crm_private.splav_jobs j join public.crm_staff s on s.user_id=j.leased_by
    where j.document_id=p_document_id and j.kind='zone' and j.state='running' and j.leased_by=auth.uid()
    and j.lease_until>clock_timestamp() and s.active and s.role='processor' and crm_private.zone_job_valid(j)
    and exists(select 1 from crm_private.splav_settings where enabled and zones_enabled))
  then raise exception 'Delegated zonal lease required' using errcode='42501';end if;
 elsif not exists(select 1 from public.crm_staff where user_id=auth.uid() and active and role in ('owner','lead','recruiter','observer'))
 then raise exception 'Active human reader required' using errcode='42501';end if;
 select * into d from public.documents where id=p_document_id for update;
 if not found or d.deleted_at is not null or d.storage_path is null or not public.crm_document_zone_allowed(d.id) then raise exception 'Zone document unavailable' using errcode='42501';end if;
 if exists(select 1 from public.documents v where v.version_group_id=d.version_group_id and v.version_number>d.version_number and v.deleted_at is null)
 or not exists(select 1 from public.candidates c where c.id=d.candidate_id and jsonb_typeof(coalesce(c.profile_data,'{}'::jsonb))='object'
 and nullif(c.profile_data->>'merged_into','') is null and nullif(c.profile_data->'workflow'->>'archived_at','') is null and nullif(c.profile_data->'workflow'->>'archive_lock','') is null)
 or exists(select 1 from public.crm_archive a where a.candidate_id=d.candidate_id) then raise exception 'Superseded zone source' using errcode='40001';end if;
 return crm_private.splav_source(d)||jsonb_build_object('ai_document_type',d.ai_document_type);
end $$;

create or replace function crm_private.splav_case_allowed(wanted uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from crm_private.splav_jobs j join public.crm_staff s on s.user_id=j.leased_by
 where j.candidate_id=wanted and j.state='running' and j.leased_by=(select auth.uid()) and s.active and s.role='processor' and j.lease_until>now()
 and exists(select 1 from crm_private.splav_settings where enabled and (j.kind='root' or zones_enabled))
 and case when j.kind='zone' then crm_private.zone_job_valid(j) else crm_private.splav_valid_source(j) end)
$$;

create function public.crm_zone_background_ready() returns boolean
language sql stable security definer set search_path='' as $$
 select not crm_private.is_processor() and exists(select 1 from public.crm_staff where user_id=auth.uid() and active)
 and exists(select 1 from crm_private.splav_settings where enabled and zones_enabled)
$$;
revoke all on function public.crm_zone_background_ready() from public,anon;
grant execute on function public.crm_zone_background_ready() to authenticated;

create function public.crm_splav_zone_enqueue(p_id uuid,p_pages integer,p_budget integer default 2600) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c crm_private.zone_coordinators;d public.documents;j crm_private.splav_jobs;existing crm_private.splav_jobs;initial_snapshot jsonb;tasks jsonb;
begin
 if crm_private.is_processor() or not public.crm_zone_background_ready() then raise exception 'Zonal background queue disabled' using errcode='42501';end if;
 select document_id into j.document_id from crm_private.zone_coordinators where id=p_id;
 perform crm_private.zone_source(j.document_id);
 select * into c from crm_private.zone_coordinators where id=p_id for update;
 select * into d from public.documents where id=c.document_id;
 if p_pages is null or p_pages not between 1 and 200 or p_budget is null or p_budget not between 1 and 2600 then raise exception 'Invalid page count or budget';end if;
 j.document_id:=d.id;j.candidate_id:=d.candidate_id;j.initiated_by:=auth.uid();j.kind:='zone';j.coordinator_id:=c.id;
 j.current_source:=crm_private.splav_source(d);
 if not crm_private.zone_job_valid(j) then raise exception 'Source is not eligible for zonal delegation' using errcode='40001';end if;
 select * into existing from crm_private.splav_jobs q where q.document_id=d.id and q.original_source=crm_private.splav_source(d) and q.kind='zone';
 if found then
  if existing.coordinator_id<>c.id or (c.snapshot->>'pages')::integer<>p_pages then raise exception 'Another coordinator already delegated' using errcode='40001';end if;
  return jsonb_build_object('id',existing.id,'state',existing.state,'kind',existing.kind);
 end if;
 if exists(select 1 from crm_private.zone_requests r where r.document_id=d.id and r.source=c.source
   and (r.state='dispatched' or not exists(select 1 from crm_private.zone_coordinator_steps s where s.coordinator_id=c.id and s.request_id=r.id)))
 then raise exception 'Existing manual receipts require review before background delegation' using errcode='55000';end if;
 if c.snapshot is null then
  select jsonb_agg(jsonb_build_object('mode','overview','page',n) order by n) into tasks from generate_series(1,p_pages)n;
  initial_snapshot:=jsonb_build_object('version',1,'pages',p_pages,'source',c.binding,'budget',p_budget,'attempts',0,'completed',0,'tasks',tasks,'in_flight',null,'errors','[]'::jsonb);
  update crm_private.zone_coordinators set snapshot=initial_snapshot,version=version+1 where id=c.id;
 elsif (c.snapshot->>'pages')::integer<>p_pages or (c.snapshot->>'budget')::integer<>p_budget then raise exception 'Source page count changed' using errcode='40001';end if;
 insert into crm_private.splav_jobs(document_id,candidate_id,initiated_by,original_source,current_source,kind,coordinator_id)
 values(d.id,d.candidate_id,auth.uid(),j.current_source,j.current_source,'zone',c.id) on conflict on constraint splav_jobs_source_unique do nothing;
 select * into j from crm_private.splav_jobs where document_id=d.id and original_source=j.current_source and kind='zone';
 if j.coordinator_id<>c.id then raise exception 'Another coordinator already delegated' using errcode='40001';end if;
 return jsonb_build_object('id',j.id,'state',j.state,'kind',j.kind);
end $$;
revoke all on function public.crm_splav_zone_enqueue(uuid,integer,integer) from public,anon;
grant execute on function public.crm_splav_zone_enqueue(uuid,integer,integer) to authenticated;

create function public.crm_splav_zone_claim() returns jsonb
language plpgsql security definer set search_path='' as $$
declare j crm_private.splav_jobs;
begin
 if not crm_private.is_processor() or not exists(select 1 from public.crm_staff where user_id=auth.uid() and active and role='processor') then raise exception 'Processor required' using errcode='42501';end if;
 if not exists(select 1 from crm_private.splav_settings where enabled and zones_enabled) then return null;end if;
 if not pg_try_advisory_xact_lock(hashtextextended(auth.uid()::text,0)) then return null;end if;
 for j in select * from crm_private.splav_jobs where kind='zone' and state='running' and lease_until<=now() for update skip locked loop
  update crm_private.splav_jobs set state=case when not crm_private.zone_job_valid(j) then 'superseded' when attempts>=3 then 'needs_review' else 'queued' end,
    leased_by=null,lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=j.id;
 end loop;
 if exists(select 1 from crm_private.splav_jobs where state='running' and leased_by=auth.uid()) then return null;end if;
 for j in select * from crm_private.splav_jobs where kind='zone' and state='queued' order by created_at,id for update skip locked loop
  if not crm_private.zone_job_valid(j) then update crm_private.splav_jobs set state='superseded' where id=j.id;continue;end if;
  update crm_private.splav_jobs set state='running',leased_by=auth.uid(),lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '10 minutes',attempts=attempts+1,updated_at=clock_timestamp() where id=j.id returning * into j;
  return jsonb_build_object('id',j.id,'kind','zone','document_id',j.document_id,'lease_token',j.lease_token);
 end loop;
 return null;
end $$;
revoke all on function public.crm_splav_zone_claim() from public,anon;
grant execute on function public.crm_splav_zone_claim() to authenticated;

create function public.crm_splav_zone_step(p_job uuid,p_token uuid,p_operation text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare j crm_private.splav_jobs;c crm_private.zone_coordinators;d public.documents;answer jsonb;reports jsonb;report jsonb;v integer;status text;report_bytes bigint;
begin
 if not crm_private.is_processor() or not exists(select 1 from public.crm_staff where user_id=auth.uid() and active and role='processor') then raise exception 'Processor required' using errcode='42501';end if;
 select * into j from crm_private.splav_jobs where id=p_job for update;
 if not found or j.kind<>'zone' or j.state<>'running' or j.leased_by is distinct from auth.uid() or j.lease_token is distinct from p_token or j.lease_until<=clock_timestamp()
 then raise exception 'Invalid zonal lease' using errcode='42501';end if;
 if not exists(select 1 from crm_private.splav_settings where enabled and zones_enabled) then raise exception 'Zonal queue disabled' using errcode='42501';end if;
 perform 1 from public.documents where id=j.document_id for update;
 if not crm_private.zone_job_valid(j) then raise exception 'Zonal source changed' using errcode='40001';end if;
 select * into c from crm_private.zone_coordinators where id=j.coordinator_id for update;
 if jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>1100000 then raise exception 'Invalid worker payload';end if;
 if p_operation='load' then
  answer:=crm_private.worker_crm_zone_coordinator_open(j.document_id,c.file_sha256,true);
  if answer->>'id' is distinct from c.id::text then raise exception 'Coordinator binding changed';end if;
  select * into d from public.documents where id=j.document_id;
  return answer||jsonb_build_object('document',jsonb_build_object('id',d.id,'storage_path',d.storage_path,'file_size',d.file_size));
 elsif p_operation='validate' then return jsonb_build_object('document_id',j.document_id,'coordinator_id',c.id,'version',c.version);
 elsif p_operation='save' then
  if c.snapshot->'in_flight'<>'null'::jsonb and (p_data#>>'{snapshot,completed}')::integer=(c.snapshot->>'completed')::integer+1 then
   if exists(select 1 from crm_private.zone_coordinator_steps s join crm_private.zone_requests r on r.id=s.request_id
    where s.coordinator_id=c.id and s.attempt=(c.snapshot->>'attempts')::integer and r.state not in ('completed','failed'))
    or (not exists(select 1 from crm_private.zone_coordinator_steps s where s.coordinator_id=c.id and s.attempt=(c.snapshot->>'attempts')::integer)
     and jsonb_array_length(p_data#>'{snapshot,errors}')<>jsonb_array_length(c.snapshot->'errors')+1)
   then raise exception 'Durable receipt or preparation failure required';end if;
  end if;
  v:=crm_private.worker_crm_zone_coordinator_save(c.id,(p_data->>'version')::integer,p_data->'snapshot');return to_jsonb(v);
 elsif p_operation='begin' then
  return crm_private.worker_crm_zone_coordinator_begin(c.id,(p_data->>'version')::integer,j.document_id,p_data->>'mode',(p_data->>'page')::integer,p_data->'box',p_data->>'render_sha256');
 elsif p_operation='finish' then
  if not exists(select 1 from crm_private.zone_coordinator_steps where coordinator_id=c.id and request_id=(p_data->>'request_id')::uuid and attempt=(c.snapshot->>'attempts')::integer)
  then raise exception 'Receipt is outside delegated step' using errcode='42501';end if;
  return crm_private.worker_crm_zone_finish((p_data->>'request_id')::uuid,(p_data->>'receipt')::uuid,p_data->'result');
 elsif p_operation='final' then
  if c.snapshot->'tasks'<>'[]'::jsonb or c.snapshot->'in_flight'<>'null'::jsonb then raise exception 'Coordinator not finished';end if;
  select coalesce(sum(octet_length(r.result::text)),0) into report_bytes from crm_private.zone_coordinator_steps s join crm_private.zone_requests r on r.id=s.request_id
   where s.coordinator_id=c.id and s.attempt<=(c.snapshot->>'completed')::integer and r.state='completed' and r.result->'review_only'='true'::jsonb;
  if report_bytes>1800000 then raise exception 'Final report budget exceeded';end if;
  select coalesce(jsonb_agg(r.result order by s.attempt),'[]'::jsonb) into reports from crm_private.zone_coordinator_steps s join crm_private.zone_requests r on r.id=s.request_id
   where s.coordinator_id=c.id and s.attempt<=(c.snapshot->>'completed')::integer and r.state='completed' and r.result->'review_only'='true'::jsonb;
  -- Derive gaps from durable evidence, never a caller's completeness claim.
  status:=case when jsonb_array_length(c.snapshot->'errors')>0 or exists(select 1 from jsonb_array_elements(reports) r where
    (r->>'mode'='overview' and jsonb_array_length(coalesce(r->'quality_issues','[]'))>0) or
    (r->>'mode'='zone' and (not exists(select 1 from jsonb_array_elements(coalesce(r->'rows','[]')) row where jsonb_array_length(coalesce(row->'fields','[]'))>0)
     or exists(select 1 from jsonb_array_elements(coalesce(r->'rows','[]')) row cross join lateral jsonb_array_elements(coalesce(row->'fields','[]')) f where f->'value'='null'::jsonb or f->>'legibility' is distinct from 'clear')))) then 'complete_with_gaps' else 'complete' end;
  report:=jsonb_build_object('status',status,'reports',reports,'errors',c.snapshot->'errors');
  answer:=public.crm_save_military_zone_report(j.document_id,j.current_source->>'storage_path',report);
  update crm_private.splav_jobs set state=case when status='complete' then 'completed' else 'needs_review' end,stage='finished',result=answer,
    leased_by=null,lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=j.id;return answer;
 elsif p_operation in ('yield','retry','block','hold') then
  update crm_private.splav_jobs set state=case when p_operation='block' then 'uncertain' when p_operation='hold' or (p_operation='retry' and attempts>=3) then 'needs_review' else 'queued' end,
    attempts=case when p_operation='yield' then 0 else attempts end,leased_by=null,lease_token=null,lease_until=null,updated_at=clock_timestamp()
    where id=j.id;return jsonb_build_object('released',true);
 end if;
 raise exception 'Unknown zonal operation';
end $$;
revoke all on function public.crm_splav_zone_step(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.crm_splav_zone_step(uuid,uuid,text,jsonb) to authenticated;
commit;
