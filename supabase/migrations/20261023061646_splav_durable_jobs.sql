-- Durable, explicitly delegated jobs. Disabled on installation; no document backfill.
begin;
create table crm_private.splav_settings(singleton boolean primary key default true check(singleton),enabled boolean not null default false);
insert into crm_private.splav_settings values(true,false);
create table crm_private.splav_jobs(
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null,candidate_id uuid not null,initiated_by uuid not null,
  original_source jsonb not null,current_source jsonb not null,
  state text not null default 'queued' check(state in ('queued','running','completed','needs_review','superseded','uncertain')),
  stage text not null default 'waiting' check(stage in ('waiting','provider_started','ocr_saved','finished')),
  leased_by uuid,lease_token uuid,lease_until timestamptz,
  attempts integer not null default 0 check(attempts between 0 and 3),
  provider_started_at timestamptz,execution_id uuid,result jsonb,
  created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
  constraint splav_jobs_source_unique unique(document_id,original_source),
  check((state='running')=(leased_by is not null and lease_token is not null and lease_until is not null))
);
create index splav_jobs_queue on crm_private.splav_jobs(created_at,id) where state='queued';
create unique index splav_jobs_one_lease on crm_private.splav_jobs(leased_by) where state='running';
alter table crm_private.splav_settings enable row level security;
alter table crm_private.splav_jobs enable row level security;
revoke all on crm_private.splav_settings,crm_private.splav_jobs from public,anon,authenticated;

create function crm_private.splav_source(d public.documents) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',d.id,'candidate_id',d.candidate_id,'storage_path',d.storage_path,
 'file_hash',d.file_hash,'version_group_id',d.version_group_id,'version_number',d.version_number,
 'ai_processed_at',d.ai_processed_at,'verification_status',d.verification_status,'verified_at',d.verified_at,
 'document_type',d.document_type,'requirement_id',d.requirement_id,'deleted_at',d.deleted_at)
$$;
revoke all on function crm_private.splav_source(public.documents) from public,anon,authenticated;

create function crm_private.splav_valid_source(j crm_private.splav_jobs) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.documents d join public.candidates c on c.id=d.candidate_id
   join public.crm_staff s on s.user_id=j.initiated_by
   where d.id=j.document_id and d.candidate_id=j.candidate_id and d.deleted_at is null
     and d.verification_status is distinct from 'Підтверджено'
     and s.active and s.role in ('owner','lead','recruiter','observer')
     and crm_private.splav_source(d)=j.current_source
     and jsonb_typeof(coalesce(c.profile_data,'{}'::jsonb))='object'
     and nullif(c.profile_data->>'merged_into','') is null
     and nullif(c.profile_data->'workflow'->>'archived_at','') is null
     and nullif(c.profile_data->'workflow'->>'archive_lock','') is null
     and not exists(select 1 from public.documents v where v.version_group_id=d.version_group_id and v.version_number>d.version_number)
     and not exists(select 1 from public.crm_archive a where a.candidate_id=c.id)
     and not exists(select 1 from public.document_requirements r where r.id=d.requirement_id and r.ai_enabled=false))
$$;
revoke all on function crm_private.splav_valid_source(crm_private.splav_jobs) from public,anon,authenticated;

create function crm_private.splav_case_allowed(wanted uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from crm_private.splav_jobs j join public.crm_staff s on s.user_id=j.leased_by
 where j.candidate_id=wanted and j.state='running' and j.leased_by=(select auth.uid())
 and s.active and s.role='processor' and j.lease_until>now() and crm_private.splav_valid_source(j)
 and exists(select 1 from crm_private.splav_settings where enabled))
$$;
create function crm_private.splav_file_allowed(wanted text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from crm_private.splav_jobs j where j.state='running' and j.leased_by=(select auth.uid())
 and j.current_source->>'storage_path'=wanted and crm_private.splav_case_allowed(j.candidate_id))
$$;
revoke all on function crm_private.splav_case_allowed(uuid),crm_private.splav_file_allowed(text) from public,anon;
grant execute on function crm_private.splav_case_allowed(uuid),crm_private.splav_file_allowed(text) to authenticated;

-- Split the previous ALL restriction: leased reads only, all direct mutations remain denied.
do $$ declare rel text; scope text;
begin
 foreach rel in array array['candidates','documents','personal_files','candidate_document_requirements','document_requirements'] loop
  execute format('drop policy splav_processor_isolation on public.%I',rel);
  scope:=case when rel='candidates' then 'crm_private.splav_case_allowed(id)'
    when rel='document_requirements' then 'exists(select 1 from public.candidates c where crm_private.splav_case_allowed(c.id))'
    else 'crm_private.splav_case_allowed(candidate_id)' end;
  execute format('create policy splav_processor_read on public.%I as restrictive for select to authenticated using (not (select crm_private.is_processor()) or (%s))',rel,scope);
  execute format('create policy splav_processor_insert on public.%I as restrictive for insert to authenticated with check (not (select crm_private.is_processor()))',rel);
  execute format('create policy splav_processor_update on public.%I as restrictive for update to authenticated using (not (select crm_private.is_processor())) with check (not (select crm_private.is_processor()))',rel);
  execute format('create policy splav_processor_delete on public.%I as restrictive for delete to authenticated using (not (select crm_private.is_processor()))',rel);
 end loop;
end $$;
drop policy splav_processor_isolation on storage.objects;
create policy splav_processor_read on storage.objects as restrictive for select to authenticated
 using(not (select crm_private.is_processor()) or (bucket_id='candidate-documents' and crm_private.splav_file_allowed(name)));
create policy splav_processor_insert on storage.objects as restrictive for insert to authenticated with check(not (select crm_private.is_processor()));
create policy splav_processor_update on storage.objects as restrictive for update to authenticated using(not (select crm_private.is_processor())) with check(not (select crm_private.is_processor()));
create policy splav_processor_delete on storage.objects as restrictive for delete to authenticated using(not (select crm_private.is_processor()));

create function public.crm_splav_enqueue(document_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.documents;j crm_private.splav_jobs;snapshot jsonb;
begin
 if not exists(select 1 from crm_private.splav_settings where enabled) then raise exception 'SPLAV_QUEUE_DISABLED' using errcode='55000';end if;
 if crm_private.is_processor() or not exists(select 1 from public.crm_staff where user_id=auth.uid() and active and role in ('owner','lead','recruiter','observer')) then raise exception 'Human delegation required' using errcode='42501';end if;
 select * into d from public.documents where id=document_id for update;
 if not found then raise exception 'Document unavailable' using errcode='42501';end if;
 snapshot:=crm_private.splav_source(d);
 j.document_id:=d.id;j.candidate_id:=d.candidate_id;j.initiated_by:=auth.uid();j.current_source:=snapshot;
 if not crm_private.splav_valid_source(j) then raise exception 'Document source no longer eligible' using errcode='40001';end if;
 insert into crm_private.splav_jobs(document_id,candidate_id,initiated_by,original_source,current_source)
 values(d.id,d.candidate_id,auth.uid(),snapshot,snapshot)
 on conflict on constraint splav_jobs_source_unique do nothing;
 select * into j from crm_private.splav_jobs q where q.document_id=d.id and q.original_source=snapshot;
 return jsonb_build_object('id',j.id,'state',j.state,'document_id',d.id);
end $$;

create function public.crm_splav_claim() returns jsonb
language plpgsql security definer set search_path='' as $$
declare j crm_private.splav_jobs;
begin
 if not exists(select 1 from public.crm_staff where user_id=auth.uid() and active and role='processor') or not crm_private.is_processor() then raise exception 'Processor required' using errcode='42501';end if;
 if not exists(select 1 from crm_private.splav_settings where enabled) then return null;end if;
 if not pg_try_advisory_xact_lock(hashtextextended(auth.uid()::text,0)) then return null;end if;
 -- A lost response after model dispatch must never silently trigger another paid root run.
 for j in select * from crm_private.splav_jobs where state='running' and lease_until<=now() for update skip locked loop
  perform 1 from public.crm_staff where user_id=j.initiated_by for share;
  perform 1 from public.documents where id=j.document_id for update;
  perform 1 from public.candidates where id=j.candidate_id for update;
  if not crm_private.splav_valid_source(j) then
   update crm_private.splav_jobs set state='superseded',leased_by=null,lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=j.id;
  elsif j.stage='provider_started' or j.attempts>=3 then
   perform set_config('crm.source_document_id',j.document_id::text,true);
   update public.documents set
    processing_status=case when j.stage='ocr_saved' then processing_status else 'AI помилка' end,
    verification_status='Потребує перевірки',
    ai_warnings=coalesce(ai_warnings,'[]'::jsonb)||jsonb_build_array(case when j.stage='provider_started'
      then '[СПЛАВ] Результат виклику AI невідомий. Автоматичний платний повтор заблоковано.'
      else '[СПЛАВ] Вичерпано спроби відновлення. Збережені дані не перезаписано.' end)
    where id=j.document_id and crm_private.splav_source(documents)=j.current_source;
   update crm_private.splav_jobs set state=case when stage='provider_started' then 'uncertain' else 'needs_review' end,
    leased_by=null,lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=j.id;
   perform set_config('crm.source_document_id','',true);
  else
   update crm_private.splav_jobs set state='queued',leased_by=null,lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=j.id;
  end if;
 end loop;
 if exists(select 1 from crm_private.splav_jobs where state='running' and leased_by=auth.uid()) then return null;end if;
 for j in select * from crm_private.splav_jobs where state='queued' order by created_at,id for update skip locked loop
  if not crm_private.splav_valid_source(j) then
   update crm_private.splav_jobs set state='superseded',updated_at=clock_timestamp() where id=j.id;continue;
  end if;
  update crm_private.splav_jobs set state='running',leased_by=auth.uid(),lease_token=gen_random_uuid(),
    lease_until=clock_timestamp()+interval '10 minutes',attempts=attempts+1,updated_at=clock_timestamp()
    where id=j.id returning * into j;
  return jsonb_build_object('id',j.id,'document_id',j.document_id,'candidate_id',j.candidate_id,'initiated_by',j.initiated_by,
    'stage',j.stage,'lease_token',j.lease_token,'lease_until',j.lease_until,'source_revision',j.current_source->'ai_processed_at');
 end loop;
 return null;
end $$;

create function crm_private.splav_lock_job(job_id uuid,token uuid) returns crm_private.splav_jobs
language plpgsql security definer set search_path='' as $$
declare j crm_private.splav_jobs;
begin
 if not exists(select 1 from crm_private.splav_settings where enabled) then raise exception 'SPLAV_QUEUE_DISABLED' using errcode='55000';end if;
 select * into j from crm_private.splav_jobs where id=job_id for update;
 if not found or j.state<>'running' or j.leased_by is distinct from auth.uid() or j.lease_token is distinct from token or j.lease_until<=clock_timestamp() then raise exception 'Invalid or expired SPLAV lease' using errcode='42501';end if;
 perform 1 from public.crm_staff where user_id=auth.uid() and active and role='processor' for share;
 if not found then raise exception 'Inactive processor' using errcode='42501';end if;
 perform 1 from public.crm_staff where user_id=j.initiated_by and active and role in ('owner','lead','recruiter','observer') for share;
 if not found then raise exception 'Delegation revoked' using errcode='42501';end if;
 perform 1 from public.documents where id=j.document_id for update;
 perform 1 from public.candidates where id=j.candidate_id for update;
 if not crm_private.splav_valid_source(j) then raise exception 'Superseded SPLAV source' using errcode='40001';end if;
 return j;
end $$;
revoke all on function crm_private.splav_lock_job(uuid,uuid) from public,anon,authenticated;

create function public.crm_splav_validate(job_id uuid,token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j crm_private.splav_jobs;
begin
 j:=crm_private.splav_lock_job(job_id,token);
 return jsonb_build_object('document_id',j.document_id,'stage',j.stage,'source_revision',j.current_source->'ai_processed_at');
end $$;

create function public.crm_splav_start_provider(job_id uuid,token uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare j crm_private.splav_jobs;
begin
 j:=crm_private.splav_lock_job(job_id,token);
 if j.stage<>'waiting' then raise exception 'Provider dispatch already consumed' using errcode='55000';end if;
 update crm_private.splav_jobs set stage='provider_started',execution_id=gen_random_uuid(),provider_started_at=clock_timestamp(),updated_at=clock_timestamp() where id=j.id returning execution_id into j.execution_id;
 return j.execution_id;
end $$;

create table crm_private.splav_events(
 id bigint generated always as identity primary key,job_id uuid not null references crm_private.splav_jobs(id),
 actor_id uuid not null,initiated_by uuid not null,operation text not null,created_at timestamptz not null default clock_timestamp()
);
alter table crm_private.splav_events enable row level security;
revoke all on crm_private.splav_events from public,anon,authenticated;
revoke all on sequence crm_private.splav_events_id_seq from public,anon,authenticated;

create function public.crm_splav_release_waiting(job_id uuid,token uuid) returns void
language plpgsql security definer set search_path='' as $$
declare j crm_private.splav_jobs;
begin
 j:=crm_private.splav_lock_job(job_id,token);
 if j.stage<>'waiting' then raise exception 'Provider already dispatched; lease retained' using errcode='55000';end if;
 if j.attempts>=3 then
  perform set_config('crm.source_document_id',j.document_id::text,true);
  update public.documents set processing_status='AI помилка',verification_status='Потребує перевірки',
   ai_warnings=coalesce(ai_warnings,'[]'::jsonb)||jsonb_build_array('[СПЛАВ] Не вдалося підготувати документ після трьох спроб. Платний виклик не підтверджено.') where id=j.document_id;
  perform set_config('crm.source_document_id','',true);
 end if;
 update crm_private.splav_jobs set state=case when attempts>=3 then 'needs_review' else 'queued' end,
  leased_by=null,lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=j.id;
 insert into crm_private.splav_events(job_id,actor_id,initiated_by,operation) values(j.id,auth.uid(),j.initiated_by,'pre_dispatch_retry');
end $$;

create function public.crm_splav_persist(job_id uuid,token uuid,provider_receipt uuid,patch jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j crm_private.splav_jobs;d public.documents;next_doc public.documents;key text;
begin
 j:=crm_private.splav_lock_job(job_id,token);
 if j.stage<>'provider_started' then raise exception 'OCR persistence not authorized' using errcode='55000';end if;
 if provider_receipt is null or j.execution_id is distinct from provider_receipt then raise exception 'Provider receipt required' using errcode='42501';end if;
 if jsonb_typeof(patch) is distinct from 'object' or octet_length(patch::text)>2000000 then raise exception 'Invalid OCR patch';end if;
 for key in select jsonb_object_keys(patch) loop
  if key not in ('requirement_id','document_type','document_name','status','ai_raw_response','ai_model','ai_processed_at','ai_document_type','ai_confidence','ai_candidate_name','ai_extracted','ai_warnings','processing_status','verification_status','notes') then raise exception 'OCR field not allowed: %',key using errcode='42501';end if;
 end loop;
 select * into d from public.documents where id=j.document_id;
 next_doc:=jsonb_populate_record(d,patch);
 if next_doc.verification_status not in ('Не перевірено','Потребує перевірки') or next_doc.verification_status is null
   or next_doc.processing_status not in ('AI оброблено','AI помилка') or next_doc.processing_status is null
   or next_doc.status is distinct from 'Завантажено' then raise exception 'Invalid OCR state' using errcode='42501';end if;
 if next_doc.requirement_id is not null and not exists(select 1 from public.document_requirements r where r.id=next_doc.requirement_id and r.document_type=next_doc.document_type) then raise exception 'Invalid classification requirement';end if;
 if btrim(coalesce(d.notes,''))<>'' and d.notes !~ '^(AI OK|AI REVIEW REQUIRED|Обробку не завершено)' and next_doc.notes is distinct from d.notes then
  next_doc.notes:=d.notes||E'\n'||coalesce(next_doc.notes,'');
 end if;
 perform set_config('crm.source_document_id',d.id::text,true);
 update public.documents set requirement_id=next_doc.requirement_id,document_type=next_doc.document_type,document_name=next_doc.document_name,
  status=next_doc.status,ai_raw_response=next_doc.ai_raw_response,ai_model=next_doc.ai_model,ai_processed_at=clock_timestamp(),
  ai_document_type=next_doc.ai_document_type,ai_confidence=next_doc.ai_confidence,ai_candidate_name=next_doc.ai_candidate_name,
  ai_extracted=next_doc.ai_extracted,ai_warnings=next_doc.ai_warnings,processing_status=next_doc.processing_status,
  verification_status=next_doc.verification_status,notes=next_doc.notes where id=d.id returning * into d;
 update crm_private.splav_jobs set current_source=crm_private.splav_source(d),
  stage=case when d.processing_status='AI помилка' then 'finished' else 'ocr_saved' end,
  state=case when d.processing_status='AI помилка' then 'needs_review' else state end,
  leased_by=case when d.processing_status='AI помилка' then null else leased_by end,
  lease_token=case when d.processing_status='AI помилка' then null else lease_token end,
  lease_until=case when d.processing_status='AI помилка' then null else lease_until end,updated_at=clock_timestamp() where id=j.id;
 insert into crm_private.splav_events(job_id,actor_id,initiated_by,operation) values(j.id,auth.uid(),j.initiated_by,'ocr_saved');
 perform set_config('crm.source_document_id','',true);
 return jsonb_build_object('id',d.id,'ai_processed_at',d.ai_processed_at);
end $$;

create function public.crm_splav_apply_fields(job_id uuid,token uuid,selections jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare j crm_private.splav_jobs;item jsonb;d public.documents;
begin
 j:=crm_private.splav_lock_job(job_id,token);
 if j.stage<>'ocr_saved' then raise exception 'Saved OCR required' using errcode='55000';end if;
 if jsonb_typeof(selections) is distinct from 'array' or jsonb_array_length(selections)>100 then raise exception 'Invalid selections';end if;
 select * into d from public.documents where id=j.document_id;
 for item in select value from jsonb_array_elements(selections) loop
  if item->'expected_ai' is distinct from d.ai_extracted then raise exception 'OCR source changed' using errcode='40001';end if;
  if item->>'target' in ('sync_guard','sync_conflict') then continue;end if;
  if item->>'target' not in ('candidate','profile','file') or item->>'target' is null
    or item->>'fill_only' is distinct from 'true' or not(item?'expected_current') then raise exception 'Only protected empty-field fills allowed' using errcode='42501';end if;
 end loop;
 -- Reuse the real CRM whitelist, source checks, relatives/record merge guards and CAS.
 perform public.crm_apply_document_fields(j.document_id,selections);
 insert into crm_private.splav_events(job_id,actor_id,initiated_by,operation) values(j.id,auth.uid(),j.initiated_by,'fields_reconciled');
end $$;

create function public.crm_splav_mark_review(job_id uuid,token uuid,warnings jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare j crm_private.splav_jobs;d public.documents;
begin
 j:=crm_private.splav_lock_job(job_id,token);
 if j.stage<>'ocr_saved' or jsonb_typeof(warnings) is distinct from 'array' or jsonb_array_length(warnings)>200 or octet_length(warnings::text)>100000 then raise exception 'Invalid review warnings';end if;
 update public.documents set verification_status='Потребує перевірки',ai_warnings=(
  select coalesce(jsonb_agg(value),'[]'::jsonb) from (select distinct value from jsonb_array_elements(coalesce(ai_warnings,'[]'::jsonb)||warnings)) retained
 ) where id=j.document_id returning * into d;
 update crm_private.splav_jobs set current_source=crm_private.splav_source(d),updated_at=clock_timestamp() where id=j.id;
 insert into crm_private.splav_events(job_id,actor_id,initiated_by,operation) values(j.id,auth.uid(),j.initiated_by,'review_requested');
end $$;

create function public.crm_splav_finish(job_id uuid,token uuid,outcome jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare j crm_private.splav_jobs;
begin
 j:=crm_private.splav_lock_job(job_id,token);
 if j.stage<>'ocr_saved' or jsonb_typeof(outcome) is distinct from 'object' or outcome->>'state' not in ('completed','needs_review') or outcome->>'state' is null or octet_length(outcome::text)>100000 then raise exception 'Invalid completion';end if;
 update crm_private.splav_jobs set state=outcome->>'state',stage='finished',result=outcome,
  leased_by=null,lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=j.id;
 insert into crm_private.splav_events(job_id,actor_id,initiated_by,operation) values(j.id,auth.uid(),j.initiated_by,'finished');
end $$;

create function public.crm_splav_job_status(job_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j crm_private.splav_jobs;
begin
 if crm_private.is_processor() or not exists(select 1 from public.crm_staff where user_id=auth.uid() and active) then raise exception 'Human staff required' using errcode='42501';end if;
 select * into j from crm_private.splav_jobs where id=job_id;
 if not found then return null;end if;
 -- No lease token, original contents, password or caller-provided author in the result.
 return jsonb_build_object('id',j.id,'document_id',j.document_id,'state',j.state,'stage',j.stage,
  'initiated_by',j.initiated_by,'updated_at',j.updated_at,'result',j.result);
end $$;

create function public.crm_splav_candidate_jobs(candidate_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if crm_private.is_processor() or not exists(select 1 from public.crm_staff where user_id=auth.uid() and active) then raise exception 'Human staff required' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',j.id,'document_id',j.document_id,'state',j.state)),'[]'::jsonb)
  from (select distinct on(q.document_id) q.* from crm_private.splav_jobs q join public.documents d on d.id=q.document_id and d.candidate_id=q.candidate_id
   where q.candidate_id=crm_splav_candidate_jobs.candidate_id and d.deleted_at is null
    and q.current_source->>'storage_path'=d.storage_path
    and q.current_source->'ai_processed_at'=coalesce(to_jsonb(d.ai_processed_at),'null'::jsonb)
   order by q.document_id,q.created_at desc,q.id desc) j);
end $$;

-- Requirement derivation may run only as a trigger of an authorized leased write.
-- The same SECURITY DEFINER helper remains forbidden as a direct processor RPC.
do $$ declare definition text; fn regprocedure;
begin
 fn:=to_regprocedure('public.sync_candidate_document_requirements(uuid)');
 if fn is not null then
  definition:=pg_get_functiondef(fn);
  if position('if crm_private.is_processor() then' in definition)=0 then raise exception 'Missing processor guard on requirements helper';end if;
  definition:=replace(definition,'if crm_private.is_processor() then',
    'if crm_private.is_processor() and (pg_trigger_depth()=0 or not crm_private.splav_case_allowed(p_candidate_id)) then');
  execute definition;
 end if;
end $$;

-- All capabilities are explicit; private tables/functions are not API endpoints.
revoke all on function public.crm_splav_enqueue(uuid),public.crm_splav_claim(),public.crm_splav_validate(uuid,uuid),public.crm_splav_start_provider(uuid,uuid) from public,anon;
grant execute on function public.crm_splav_enqueue(uuid),public.crm_splav_claim(),public.crm_splav_validate(uuid,uuid),public.crm_splav_start_provider(uuid,uuid) to authenticated;
revoke all on function public.crm_splav_persist(uuid,uuid,uuid,jsonb),public.crm_splav_apply_fields(uuid,uuid,jsonb),public.crm_splav_mark_review(uuid,uuid,jsonb),public.crm_splav_finish(uuid,uuid,jsonb),public.crm_splav_job_status(uuid) from public,anon;
grant execute on function public.crm_splav_persist(uuid,uuid,uuid,jsonb),public.crm_splav_apply_fields(uuid,uuid,jsonb),public.crm_splav_mark_review(uuid,uuid,jsonb),public.crm_splav_finish(uuid,uuid,jsonb),public.crm_splav_job_status(uuid) to authenticated;
revoke all on function public.crm_splav_candidate_jobs(uuid) from public,anon;
grant execute on function public.crm_splav_candidate_jobs(uuid) to authenticated;
revoke all on function public.crm_splav_release_waiting(uuid,uuid) from public,anon;
grant execute on function public.crm_splav_release_waiting(uuid,uuid) to authenticated;
commit;
