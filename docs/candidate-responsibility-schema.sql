create schema if not exists crm_private;
revoke all on schema crm_private from public;

create table public.crm_staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null check (role in ('owner','lead','recruiter','observer')),
  active boolean not null default true
);
alter table public.crm_staff enable row level security;
revoke all on public.crm_staff from anon, authenticated;
grant select on public.crm_staff to authenticated;
create policy crm_staff_read on public.crm_staff for select to authenticated using ((select auth.uid()) is not null);
insert into public.crm_staff(user_id,display_name,role)
select id,coalesce(nullif(raw_user_meta_data->>'full_name',''),case when email='eugeneogane@gmail.com' then 'Папанов Євген Олексадрович (Jackson)' else split_part(email,'@',1) end),
case when email='eugeneogane@gmail.com' then 'owner' when email='vsovin@trorecruiter.invalid' then 'lead' when email='mkovalchuk@trorecruiter.invalid' then 'recruiter' else 'observer' end
from auth.users;

create function crm_private.sync_staff() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' then
    insert into public.crm_staff(user_id,display_name,role) values(new.id,coalesce(nullif(new.raw_user_meta_data->>'full_name',''),split_part(new.email,'@',1)),'recruiter');
  else
    update public.crm_staff set display_name=coalesce(nullif(new.raw_user_meta_data->>'full_name',''),display_name),active=(new.banned_until is null or new.banned_until<=now()) where user_id=new.id;
  end if;
  return new;
end $$;
revoke all on function crm_private.sync_staff() from public;
create trigger crm_staff_sync after insert or update of raw_user_meta_data,banned_until on auth.users for each row execute function crm_private.sync_staff();

alter table public.candidates add column responsible_recruiter_id uuid references public.crm_staff(user_id);
alter table public.documents add column version_group_id uuid not null default gen_random_uuid(),add column version_number integer not null default 1,
 add column replaces_document_id uuid references public.documents(id),
 add column ai_raw_response jsonb,add column ai_model text,add column ai_processed_at timestamptz;
create index documents_version_group_idx on public.documents(version_group_id,version_number desc);
create unique index documents_version_unique_idx on public.documents(version_group_id,version_number);
create index documents_replaces_idx on public.documents(replaces_document_id);
create index candidates_responsible_idx on public.candidates(responsible_recruiter_id);

create table public.crm_activity (
  id uuid primary key default gen_random_uuid(), candidate_id uuid,document_id uuid,
  actor_id uuid,actor_name text not null,action text not null,occurred_at timestamptz not null default now(),
  changes jsonb not null,source_document_id uuid
);
create table public.document_ai_runs (
  id uuid primary key default gen_random_uuid(),document_id uuid not null,candidate_id uuid,
  actor_id uuid,actor_name text not null,processed_at timestamptz,recorded_at timestamptz not null default now(),
  model text,result jsonb not null,is_legacy boolean not null default false
);
create index crm_activity_candidate_idx on public.crm_activity(candidate_id,occurred_at desc);
create index document_ai_runs_document_idx on public.document_ai_runs(document_id,recorded_at desc);
alter table public.crm_activity enable row level security;
alter table public.document_ai_runs enable row level security;
revoke all on public.crm_activity,public.document_ai_runs from anon,authenticated;
grant select on public.crm_activity,public.document_ai_runs to authenticated;
create policy crm_activity_read on public.crm_activity for select to authenticated using (exists(select 1 from public.crm_staff where user_id=(select auth.uid()) and active));
create policy document_ai_runs_read on public.document_ai_runs for select to authenticated using (exists(select 1 from public.crm_staff where user_id=(select auth.uid()) and active));

create function crm_private.guard_candidate() returns trigger language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); allowed boolean;
begin
  if (tg_op='INSERT' and new.responsible_recruiter_id is not null) or (tg_op='UPDATE' and new.responsible_recruiter_id is distinct from old.responsible_recruiter_id) then
    select role in ('owner','lead') and active into allowed from public.crm_staff where user_id=actor;
    if not coalesce(allowed,false) then raise exception 'Призначати рекрутера може лише власник або Совін' using errcode='42501'; end if;
    if new.responsible_recruiter_id is not null and not exists(select 1 from public.crm_staff where user_id=new.responsible_recruiter_id and active and role in ('lead','recruiter')) then raise exception 'Виберіть активного рекрутера'; end if;
  end if;
  return new;
end $$;
revoke all on function crm_private.guard_candidate() from public;
create trigger crm_guard_candidate before insert or update on public.candidates for each row execute function crm_private.guard_candidate();

create function crm_private.guard_document() returns trigger language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); parent public.documents; newest integer;
begin
  if actor is null then raise exception 'Потрібна авторизована сесія' using errcode='42501'; end if;
  if tg_op='INSERT' then
    new.uploaded_by:=actor; new.created_at:=now();
    new.verified_by:=null;new.verified_at:=null;new.checked_by:=null;new.checked_at:=null;
    if new.replaces_document_id is not null then
      select * into parent from public.documents where id=new.replaces_document_id for update;
      if not found or parent.candidate_id is distinct from new.candidate_id then raise exception 'Версія має належати тому самому кандидату'; end if;
      -- Lock the original version to serialize replacements of the whole version group.
      perform 1 from public.documents where version_group_id=parent.version_group_id and version_number=1 for update;
      select max(version_number) into newest from public.documents where version_group_id=parent.version_group_id;
      if newest<>parent.version_number then raise exception 'Цю версію вже замінено. Оновіть список документів'; end if;
      new.version_group_id:=parent.version_group_id;new.version_number:=newest+1;
    else new.version_group_id:=gen_random_uuid();new.version_number:=1;
    end if;
  else
    if new.uploaded_by is distinct from old.uploaded_by or new.created_at is distinct from old.created_at or new.storage_path is distinct from old.storage_path or new.candidate_id is distinct from old.candidate_id or new.version_group_id is distinct from old.version_group_id or new.version_number<>old.version_number or new.replaces_document_id is distinct from old.replaces_document_id then
      raise exception 'Автор і файл незмінні. Завантажте нову версію документа' using errcode='42501';
    end if;
    if exists(select 1 from public.documents where version_group_id=old.version_group_id and version_number>old.version_number) then raise exception 'Архівна версія доступна лише для перегляду'; end if;
    if new.verification_status is distinct from old.verification_status then
      if new.verification_status='Підтверджено' then new.verified_by:=actor;new.verified_at:=now();new.checked_by:=actor;new.checked_at:=now();
      else new.verified_by:=null;new.verified_at:=null;new.checked_by:=null;new.checked_at:=null;end if;
    elsif new.verified_by is distinct from old.verified_by or new.verified_at is distinct from old.verified_at or new.checked_by is distinct from old.checked_by or new.checked_at is distinct from old.checked_at then raise exception 'Автор перевірки встановлюється сервером' using errcode='42501';
    end if;
  end if;
  if (tg_op='INSERT' and new.ai_extracted is not null) or (tg_op='UPDATE' and (new.ai_raw_response is distinct from old.ai_raw_response or new.ai_extracted is distinct from old.ai_extracted or new.ai_processed_at is distinct from old.ai_processed_at)) then new.ai_processed_at:=clock_timestamp(); end if;
  return new;
end $$;
revoke all on function crm_private.guard_document() from public;
create trigger crm_guard_document before insert or update on public.documents for each row execute function crm_private.guard_document();

create function crm_private.record_activity() returns trigger language plpgsql security definer set search_path='' as $$
declare before_row jsonb:=case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end;
 after_row jsonb:=case when tg_op='DELETE' then '{}'::jsonb else to_jsonb(new) end;
 delta jsonb; actor uuid:=auth.uid(); actor_label text; candidate uuid; doc uuid; act text;
begin
  select display_name into actor_label from public.crm_staff where user_id=actor;
  actor_label:=coalesce(actor_label,case when actor is null then 'Система' else actor::text end);
  select coalesce(jsonb_object_agg(k,jsonb_build_object('before',before_row->k,'after',after_row->k)),'{}'::jsonb) into delta
    from (select jsonb_object_keys(before_row||after_row) k) keys where before_row->k is distinct from after_row->k and k not in ('updated_at');
  if delta='{}'::jsonb then return coalesce(new,old);end if;
  candidate:=(case when tg_table_name='candidates' then coalesce(after_row->>'id',before_row->>'id') else coalesce(after_row->>'candidate_id',before_row->>'candidate_id') end)::uuid;
  doc:=case when tg_table_name='documents' then coalesce(after_row->>'id',before_row->>'id')::uuid else null end;
  act:=tg_table_name||'_'||lower(tg_op);
  if tg_table_name='candidates' and delta?'responsible_recruiter_id' then act:='recruiter_assigned'; end if;
  if tg_table_name='documents' and tg_op='INSERT' then act:=case when after_row->>'replaces_document_id' is null then 'document_uploaded' else 'document_replaced' end; end if;
  if tg_table_name='documents' and tg_op='UPDATE' and delta?'verification_status' then act:='document_verified'; end if;
  insert into public.crm_activity(candidate_id,document_id,actor_id,actor_name,action,changes,source_document_id)
    values(candidate,doc,actor,actor_label,act,delta,nullif(current_setting('crm.source_document_id',true),'')::uuid);
  if tg_table_name='documents' and tg_op<>'DELETE' and (after_row->>'ai_raw_response' is not null or after_row->>'ai_extracted' is not null or after_row->>'processing_status'='AI помилка') and (delta?'ai_raw_response' or delta?'ai_extracted' or delta?'ai_processed_at' or (delta?'processing_status' and after_row->>'processing_status'='AI помилка')) then
    insert into public.document_ai_runs(document_id,candidate_id,actor_id,actor_name,processed_at,model,result)
     values(new.id,new.candidate_id,actor,actor_label,new.ai_processed_at,new.ai_model,coalesce(new.ai_raw_response,jsonb_build_object('extracted',new.ai_extracted,'document_type',new.ai_document_type,'warnings',new.ai_warnings,'error',case when new.processing_status='AI помилка' then new.notes else null end)));
  end if;
  return coalesce(new,old);
end $$;
revoke all on function crm_private.record_activity() from public;
create trigger crm_activity_candidates after insert or update or delete on public.candidates for each row execute function crm_private.record_activity();
create trigger crm_activity_documents after insert or update or delete on public.documents for each row execute function crm_private.record_activity();
create trigger crm_activity_files after insert or update or delete on public.personal_files for each row execute function crm_private.record_activity();

-- Preserve existing recognition results without inventing historical authors, models or timestamps.
insert into public.document_ai_runs(document_id,candidate_id,actor_name,model,result,is_legacy)
select id,candidate_id,'Архівний результат (автор невідомий)',null,jsonb_build_object('extracted',ai_extracted,'document_type',ai_document_type,'warnings',ai_warnings,'confidence',ai_confidence),true
from public.documents where ai_extracted is not null;

-- AI must not modify a candidate before the recruiter selects the values.
drop trigger if exists trg_sync_document_ai_relatives on public.documents;
drop policy "Authenticated recruiters can update documents" on public.documents;
create policy crm_team_update_documents on public.documents for update to authenticated
 using (exists(select 1 from public.crm_staff where user_id=(select auth.uid()) and active))
 with check (exists(select 1 from public.crm_staff where user_id=(select auth.uid()) and active));

create function public.crm_apply_document_fields(document_id uuid, selections jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare doc public.documents; candidate public.candidates; pf public.personal_files; item jsonb; key text; target text; cp jsonb:='{}';fp jsonb:='{}'; profile jsonb; has_profile boolean:=false;
begin
  if not exists(select 1 from public.crm_staff where user_id=auth.uid() and active) then raise exception 'Потрібна активна авторизована сесія';end if;
  select * into doc from public.documents where id=document_id;
  if not found then raise exception 'Документ не знайдено';end if;
  if exists(select 1 from public.documents where version_group_id=doc.version_group_id and version_number>doc.version_number) then raise exception 'Не можна переносити дані з архівної версії';end if;
  if jsonb_typeof(selections)<>'array' or jsonb_array_length(selections)>100 then raise exception 'Некоректні поля';end if;
  select * into candidate from public.candidates where id=doc.candidate_id for update;
  if not found then raise exception 'Кандидата не знайдено';end if;
  profile:=coalesce(candidate.profile_data,'{}');
  if jsonb_typeof(profile)='string' then profile:=(profile#>>'{}')::jsonb;end if;
  for item in select value from jsonb_array_elements(selections) loop
    key:=item->>'key';target:=item->>'target';
    if target='candidate' and key=any(array['full_name','name_nominative','name_genitive','birth_date','birth_place','rnokpp','phone','email','sex','marital_status','has_children','worked_before','served_before','military_rank','civilian_profession','desired_position','tcc']) then cp:=cp||jsonb_build_object(key,item->'incoming');
    elsif target='file' and key=any(array['education','work_history','military_service_history','children_info']) then fp:=fp||jsonb_build_object(key,item->'incoming');
    elsif target='profile' and key=any(array['identity_document_type','birth_certificate','passport_number','passport_issuer','passport_issue_date','passport_expiry_date','passport_series','citizenship','unzr','registered_address','relatives']) then profile:=profile||jsonb_build_object(key,item->'incoming');has_profile:=true;
    else raise exception 'Поле не дозволене для перенесення';end if;
  end loop;
  perform set_config('crm.source_document_id',doc.id::text,true);
  if has_profile then cp:=cp||jsonb_build_object('profile_data',profile);end if;
  for key in select jsonb_object_keys(cp) loop
    execute format('update public.candidates set %1$I=(jsonb_populate_record(null::public.candidates,$1)).%1$I where id=$2',key) using cp,doc.candidate_id;
  end loop;
  if fp<>'{}' then
    insert into public.personal_files(candidate_id) values(doc.candidate_id) on conflict(candidate_id) do nothing;
    perform 1 from public.personal_files where candidate_id=doc.candidate_id for update;
    for key in select jsonb_object_keys(fp) loop
      execute format('update public.personal_files set %1$I=(jsonb_populate_record(null::public.personal_files,$1)).%1$I where candidate_id=$2',key) using fp,doc.candidate_id;
    end loop;
  end if;
  perform set_config('crm.source_document_id','',true);
end $$;
revoke all on function public.crm_apply_document_fields(uuid,jsonb) from public,anon;
grant execute on function public.crm_apply_document_fields(uuid,jsonb) to authenticated;
