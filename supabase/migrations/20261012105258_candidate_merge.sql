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
end $function$;
drop function if exists public.crm_merge_candidates(uuid,uuid,timestamptz,timestamptz,uuid[]);
create or replace function public.crm_merge_candidates(source_id uuid,target_id uuid,source_updated timestamptz,target_updated timestamptz,expected_document_ids uuid[],document_moves jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $merge$
declare s public.candidates; t public.candidates; sp jsonb; tp jsonb; backup jsonb; kv record; ids uuid[]; sf public.personal_files; tf public.personal_files; file_patch jsonb:='{}'; v jsonb; doc public.documents; new_path text;
begin
 if not exists(select 1 from public.crm_staff where user_id=auth.uid() and active and role in ('owner','lead')) then raise exception 'Об’єднання доступне начальнику та власнику CRM' using errcode='42501';end if;
 if source_id=target_id then raise exception 'Потрібні дві різні справи';end if;
 perform 1 from public.candidates where id in(source_id,target_id) order by id for update;
 select * into strict s from public.candidates where id=source_id;select * into strict t from public.candidates where id=target_id;
 if s.updated_at is distinct from source_updated or t.updated_at is distinct from target_updated then raise exception 'Справа змінилася. Відкрийте попередній перегляд знову';end if;
 if s.rnokpp !~ '^\d{10}$' or s.rnokpp is null or s.rnokpp is distinct from t.rnokpp or s.birth_date is distinct from t.birth_date then raise exception 'Для об’єднання потрібні однакові РНОКПП та дата народження';end if;
 if s.profile_data->>'merged_into' is not null or t.profile_data->>'merged_into' is not null or s.profile_data->'workflow'->>'archive_lock' is not null or t.profile_data->'workflow'->>'archive_lock' is not null then raise exception 'Справа вже об’єднана або архівується';end if;
 perform 1 from public.documents where candidate_id in(source_id,target_id) order by id for update;
 select array_agg(id order by id) into ids from public.documents where candidate_id in(source_id,target_id);
 if coalesce(ids,'{}') is distinct from (select coalesce(array_agg(x order by x),'{}') from unnest(expected_document_ids) x) then raise exception 'Перелік документів змінився. Оновіть попередній перегляд';end if;
 select * into sf from public.personal_files where candidate_id=source_id for update;select * into tf from public.personal_files where candidate_id=target_id for update;
 sp:=coalesce(s.profile_data,'{}');tp:=coalesce(t.profile_data,'{}');
 if jsonb_typeof(sp)='string' then sp:=(sp#>>'{}')::jsonb;end if;if jsonb_typeof(tp)='string' then tp:=(tp#>>'{}')::jsonb;end if;
 backup:=jsonb_build_object('source_id',s.id,'source_candidate',to_jsonb(s),'source_file',to_jsonb(sf),'source_requirements',(select jsonb_agg(to_jsonb(r)) from public.candidate_document_requirements r where candidate_id=s.id),'document_ids',ids,'merged_by',auth.uid(),'merged_at',now());
 for kv in select key,value from jsonb_each(sp) loop
 if kv.key not in ('merged_into','merged_cases','workflow') and kv.value not in ('null'::jsonb,'""'::jsonb,'[]'::jsonb,'{}'::jsonb) and (not tp?kv.key or tp->kv.key in ('null'::jsonb,'""'::jsonb,'[]'::jsonb,'{}'::jsonb)) then tp:=jsonb_set(tp,array[kv.key],kv.value,true);end if;end loop;
 tp:=jsonb_set(tp,'{merged_cases}',coalesce(tp->'merged_cases','[]')||jsonb_build_array(backup),true);
 update public.candidates set profile_data=tp,military_specialty=coalesce(nullif(btrim(t.military_specialty),''),s.military_specialty),birth_place=coalesce(nullif(btrim(t.birth_place),''),s.birth_place),tcc=coalesce(nullif(btrim(t.tcc),''),s.tcc),email=coalesce(nullif(btrim(t.email),''),s.email),civilian_profession=coalesce(nullif(btrim(t.civilian_profession),''),s.civilian_profession),updated_at=now() where id=t.id;
 if tf.id is null then insert into public.personal_files(candidate_id) values(t.id);select * into tf from public.personal_files where candidate_id=t.id;end if;
 for kv in select key,value from jsonb_each(to_jsonb(sf)) loop
 if kv.key not in ('id','candidate_id','created_at','updated_at') and kv.value not in ('null'::jsonb,'""'::jsonb) and (to_jsonb(tf)->kv.key is null or to_jsonb(tf)->kv.key in ('null'::jsonb,'""'::jsonb)) then file_patch:=file_patch||jsonb_build_object(kv.key,kv.value);end if;end loop;
 for kv in select key,value from jsonb_each(file_patch) loop execute format('update public.personal_files set %I=(jsonb_populate_record(null::public.personal_files,$1)).%I where candidate_id=$2',kv.key,kv.key) using file_patch,t.id;end loop;
 perform set_config('crm.merge_source',s.id::text,true);perform set_config('crm.merge_target',t.id::text,true);
 if jsonb_typeof(document_moves)<>'object' then raise exception 'Некоректний перелік копій';end if;
 for doc in select * from public.documents where candidate_id=s.id loop
  new_path:=document_moves->>doc.id::text;
  if new_path is null or new_path not like t.id::text||'/merged/'||doc.id::text||'/%' or new_path like '%..%' then raise exception 'Невірний шлях копії';end if;
  if not exists(select 1 from storage.objects o where o.bucket_id='candidate-documents' and o.name=new_path and (o.metadata->>'size')::bigint=doc.file_size) then raise exception 'Копію файла не підтверджено у Storage';end if;
  update public.documents set candidate_id=t.id,storage_path=new_path where id=doc.id;
 end loop;
 perform set_config('crm.merge_source','',true);perform set_config('crm.merge_target','',true);
 if exists(select 1 from public.documents where candidate_id=s.id) or coalesce((select array_agg(id order by id) from public.documents where candidate_id=t.id),'{}') is distinct from coalesce(ids,'{}') then raise exception 'Перенесення документів не завершено';end if;
 update public.candidates set profile_data=sp||jsonb_build_object('merged_into',t.id,'merged_at',now(),'merged_by',auth.uid()),updated_at=now() where id=s.id;
 return jsonb_build_object('candidate_id',t.id,'documents',coalesce(array_length(ids,1),0),'source_preserved',true);
end $merge$;
revoke all on function public.crm_merge_candidates(uuid,uuid,timestamptz,timestamptz,uuid[],jsonb) from public;
grant execute on function public.crm_merge_candidates(uuid,uuid,timestamptz,timestamptz,uuid[],jsonb) to authenticated;
