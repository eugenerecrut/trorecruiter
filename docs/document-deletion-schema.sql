alter table public.documents add column deleted_at timestamptz, add column deleted_by uuid, add column deleted_by_name text;
CREATE OR REPLACE FUNCTION crm_private.guard_document()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); parent public.documents; newest integer;
begin
  if actor is null then raise exception 'Потрібна авторизована сесія' using errcode='42501'; end if;
  if tg_op='INSERT' then
    new.uploaded_by:=actor; new.created_at:=now();
    new.deleted_at:=null;new.deleted_by:=null;new.deleted_by_name:=null;
    new.verified_by:=null;new.verified_at:=null;new.checked_by:=null;new.checked_at:=null;
    if new.replaces_document_id is not null then
      select * into parent from public.documents where id=new.replaces_document_id for update;
      if parent.deleted_at is not null then raise exception 'Спочатку відновіть видалений документ';end if;
      if not found or parent.candidate_id is distinct from new.candidate_id then raise exception 'Версія має належати тому самому кандидату'; end if;
      -- Lock the original version to serialize replacements of the whole version group.
      perform 1 from public.documents where version_group_id=parent.version_group_id and version_number=1 for update;
      select max(version_number) into newest from public.documents where version_group_id=parent.version_group_id;
      if newest<>parent.version_number then raise exception 'Цю версію вже замінено. Оновіть список документів'; end if;
      new.version_group_id:=parent.version_group_id;new.version_number:=newest+1;
    else new.version_group_id:=gen_random_uuid();new.version_number:=1;
    end if;
  else
    if (new.deleted_at is null) is distinct from (old.deleted_at is null) then
      if not exists(select 1 from public.crm_staff where user_id=actor and active and role in ('owner','lead','recruiter')) then raise exception 'Недостатньо прав для видалення або відновлення' using errcode='42501';end if;
      if (to_jsonb(new)-array['deleted_at','deleted_by','deleted_by_name']) is distinct from (to_jsonb(old)-array['deleted_at','deleted_by','deleted_by_name']) then raise exception 'Видалення та відновлення виконуються окремою дією';end if;
      if new.deleted_at is not null then
        new.deleted_at:=clock_timestamp();new.deleted_by:=actor;
        select display_name into new.deleted_by_name from public.crm_staff where user_id=actor;
      else new.deleted_by:=null;new.deleted_by_name:=null;end if;
    elsif new.deleted_at is distinct from old.deleted_at or new.deleted_by is distinct from old.deleted_by or new.deleted_by_name is distinct from old.deleted_by_name then
      raise exception 'Відповідального за видалення встановлює сервер' using errcode='42501';
    elsif old.deleted_at is not null then raise exception 'Видалений документ доступний лише в історії' using errcode='42501';
    end if;
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
end $function$
;
create function public.crm_set_document_deleted(document_id uuid, deleted boolean)
returns uuid language plpgsql security invoker set search_path='' as $$
declare result uuid;
begin
  if deleted is null then raise exception 'Вкажіть дію';end if;
  update public.documents set deleted_at=case when deleted then clock_timestamp() else null end
  where id=document_id and (deleted_at is not null) is distinct from deleted returning id into result;
  if result is null then raise exception 'Документ вже змінився або недоступний. Оновіть список';end if;
  return result;
end $$;
revoke all on function public.crm_set_document_deleted(uuid,boolean) from public,anon;
grant execute on function public.crm_set_document_deleted(uuid,boolean) to authenticated;
CREATE OR REPLACE FUNCTION public.crm_apply_document_fields(document_id uuid, selections jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare doc public.documents; candidate public.candidates; pf public.personal_files; item jsonb; key text; target text; cp jsonb:='{}';fp jsonb:='{}'; profile jsonb; has_profile boolean:=false;
begin
  if not exists(select 1 from public.crm_staff where user_id=auth.uid() and active) then raise exception 'Потрібна активна авторизована сесія';end if;
  select * into doc from public.documents where id=document_id for update;
  if not found then raise exception 'Документ не знайдено';end if;
  if doc.deleted_at is not null then raise exception 'Не можна переносити дані з видаленого документа';end if;
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
end $function$
;CREATE OR REPLACE FUNCTION crm_private.record_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if tg_table_name='documents' and delta?'deleted_at' then
    act:=case when after_row->>'deleted_at' is null then 'document_restored' else 'document_deleted' end;
    delta:=delta||jsonb_build_object('file_name',jsonb_build_object('before',before_row->'file_name','after',after_row->'file_name'));
  end if;
  insert into public.crm_activity(candidate_id,document_id,actor_id,actor_name,action,changes,source_document_id)
    values(candidate,doc,actor,actor_label,act,delta,nullif(current_setting('crm.source_document_id',true),'')::uuid);
  if tg_table_name='documents' and tg_op<>'DELETE' and (after_row->>'ai_raw_response' is not null or after_row->>'ai_extracted' is not null or after_row->>'processing_status'='AI помилка') and (delta?'ai_raw_response' or delta?'ai_extracted' or delta?'ai_processed_at' or (delta?'processing_status' and after_row->>'processing_status'='AI помилка')) then
    insert into public.document_ai_runs(document_id,candidate_id,actor_id,actor_name,processed_at,model,result)
     values(new.id,new.candidate_id,actor,actor_label,new.ai_processed_at,new.ai_model,coalesce(new.ai_raw_response,jsonb_build_object('extracted',new.ai_extracted,'document_type',new.ai_document_type,'warnings',new.ai_warnings,'error',case when new.processing_status='AI помилка' then new.notes else null end)));
  end if;
  return coalesce(new,old);
end $function$
;