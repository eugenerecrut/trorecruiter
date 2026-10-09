-- Function-only migration: same signature, caller RLS and existing audit triggers.
CREATE OR REPLACE FUNCTION public.crm_apply_document_fields(document_id uuid, selections jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare doc public.documents; candidate public.candidates; pf public.personal_files; item jsonb; key text; target text; cp jsonb:='{}';fp jsonb:='{}'; profile jsonb; has_profile boolean:=false; current_value jsonb; warning text; old_relative jsonb; new_relative jsonb; relative_key text; relative_index integer;
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
    if item ? 'expected_ai' and item->'expected_ai' is distinct from doc.ai_extracted then
      raise exception 'Результат AI змінився. Оновіть перегляд синхронізації';
    end if;
    if target='sync_guard' then
      if item->>'key'<>'version' or item->>'incoming'<>'1' then raise exception 'Невідома версія синхронізації';end if;
      continue;
    end if;
    if target='sync_conflict' then
      warning:='[CRM AI sync] ' || (item->>'incoming');
      if length(warning)>12000 then raise exception 'Надто довге повідомлення конфлікту';end if;
      if not coalesce(doc.ai_warnings,'[]'::jsonb) @> jsonb_build_array(warning) then
        doc.ai_warnings:=coalesce(doc.ai_warnings,'[]'::jsonb)||jsonb_build_array(warning);
        update public.documents set ai_warnings=doc.ai_warnings where id=doc.id;
      end if;
      continue;
    end if;
    if item ? 'expected_current' then
      if target='candidate' then current_value:=to_jsonb(candidate)->key;
      elsif target='profile' then current_value:=profile->key;
      elsif target='file' then
        select to_jsonb(f)->key into current_value from public.personal_files f where candidate_id=doc.candidate_id for update;
      else raise exception 'Невідомий отримувач';end if;
      if coalesce(current_value,'null'::jsonb) is distinct from item->'expected_current' then
        raise exception 'Поле % змінилося. Оновіть перегляд синхронізації',key;
      end if;
      if item->>'fill_only'='true' then
        if target in ('profile','candidate') and profile->'form_data'->key is not null and profile->'form_data'->key<>'null'::jsonb and btrim(coalesce(profile->'form_data'->>key,''))<>'' then
          raise exception 'Потрібно зберегти раніше заповнене поле %',key;
        end if;
        if target='candidate' and key='military_specialty' and btrim(coalesce(profile->>'military_specialty',''))<>'' then
          raise exception 'Потрібно зберегти раніше заповнений ВОС';
        end if;
        if key='relatives' and target='profile' and item->>'merge_relatives'='true' then
          if jsonb_typeof(item->'incoming')<>'array' then raise exception 'Некоректні родичі';end if;
          relative_index:=0;
          for old_relative in select value from jsonb_array_elements(coalesce(nullif(current_value,'null'::jsonb),'[]'::jsonb)) loop
            new_relative:=(item->'incoming')->relative_index;
            if new_relative is null then raise exception 'Не можна видаляти родичів';end if;
            for relative_key in select jsonb_object_keys(old_relative) loop
              if old_relative->relative_key not in ('null'::jsonb,'""'::jsonb) and old_relative->relative_key is distinct from new_relative->relative_key then
                raise exception 'Не можна змінювати збережені дані родича';
              end if;
            end loop;
            relative_index:=relative_index+1;
          end loop;
        elsif current_value is not null and current_value<>'null'::jsonb and btrim(coalesce(current_value#>>'{}',''))<>'' then
          raise exception 'Не можна перезаписувати заповнене поле %',key;
        end if;
      end if;
    elsif item->>'fill_only'='true' then raise exception 'Потрібне поточне значення для безпечної синхронізації';
    end if;
    if target='candidate' and key=any(array['full_name','name_nominative','name_genitive','birth_date','birth_place','rnokpp','phone','email','sex','marital_status','has_children','worked_before','served_before','military_rank','military_specialty','civilian_profession','desired_position','tcc']) then cp:=cp||jsonb_build_object(key,item->'incoming');
    elsif target='file' and key=any(array['address','education','work_history','military_service_history','children_info']) then fp:=fp||jsonb_build_object(key,item->'incoming');
    elsif target='profile' and key=any(array['shpk','tariff_grade','recruiter_name','military_unit','desired_unit','recommender_unit','signatory','criminal_record_info','service_type','bio_education_claims','bio_work_claims','bio_service_claims','bio_document_date','bio_employment_status','identity_document_type','birth_certificate','passport_number','passport_issuer','passport_issue_date','passport_expiry_date','passport_series','citizenship','unzr','registered_address','relatives','military_document_number','military_document_type','military_registration_date','military_registration_category','military_registration_status','vlk_certificate_number','vlk_date','vlk_conclusion','vlk_category','vlk_next_date','vlk_commission','military_registry_number','military_document_expiry_date','military_data_updated_at','military_deferment_type','military_deferment_until','military_registration_removal_reason','military_training_status','work_records','work_events','education_records','education_level','education_institution','education_specialty_code','education_specialty','education_qualification','education_year','education_start_date','education_end_date','education_diploma_series','education_diploma_number','education_diploma_issue_date','education_supplement_number','education_supplement_issue_date']) then profile:=profile||jsonb_build_object(key,item->'incoming');has_profile:=true;
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
