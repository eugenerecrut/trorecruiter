-- Production trigger definitions, metadata only; no row data.
CREATE OR REPLACE FUNCTION crm_private.guard_document()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); parent public.documents; newest integer;
begin
  if actor is null then raise exception 'Потрібна авторизована сесія' using errcode='42501'; end if;
  if tg_op='UPDATE' and new.candidate_id is distinct from old.candidate_id then
    if current_setting('crm.merge_source',true)=old.candidate_id::text and current_setting('crm.merge_target',true)=new.candidate_id::text
       and exists(select 1 from public.crm_staff where user_id=actor and active and role in ('owner','lead'))
       and (to_jsonb(new)-array['candidate_id','storage_path'])=(to_jsonb(old)-array['candidate_id','storage_path'])
       and new.storage_path like new.candidate_id::text||'/%'
       and exists(select 1 from public.candidates s join public.candidates t on t.id=new.candidate_id where s.id=old.candidate_id and s.rnokpp ~ '^\d{10}$' and s.rnokpp=t.rnokpp and s.birth_date is not distinct from t.birth_date) then return new;
    end if;
    raise exception 'Власника документа можна змінити лише через контрольоване об’єднання справ' using errcode='42501';
  end if;
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
CREATE OR REPLACE FUNCTION crm_private.record_activity()
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
