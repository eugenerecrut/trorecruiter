-- Append independent education/work records; retain per-field relative provenance. No table/column changes.
-- Based on inspected live RPC hash ee947d2dbc71d22a1fd8be53e31a17be.
CREATE OR REPLACE FUNCTION public.crm_apply_document_fields(document_id uuid, selections jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare doc public.documents; candidate public.candidates; pf public.personal_files; item jsonb; key text; target text; cp jsonb:='{}';fp jsonb:='{}'; profile jsonb; has_profile boolean:=false; current_value jsonb; warning text; old_relative jsonb; new_relative jsonb; relative_key text; relative_index integer; new_record jsonb; source_rows jsonb; source_record jsonb; record_index integer; date_key text; checked_date date; incoming_value jsonb; value_key text; source_value text; expected_value text; source_key text;
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
      if item->>'key'<>'version' or item->>'incoming' not in ('1','2','3') then raise exception 'Невідома версія синхронізації';end if;
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
              if relative_key='field_sources' and jsonb_typeof(old_relative->'field_sources')='object' then
                if jsonb_typeof(new_relative->'field_sources') is distinct from 'object' then raise exception 'Не можна видаляти джерела родича';end if;
                for source_key in select jsonb_object_keys(old_relative->'field_sources') loop
                  if old_relative->'field_sources'->source_key not in ('null'::jsonb,'""'::jsonb) and old_relative->'field_sources'->source_key is distinct from new_relative->'field_sources'->source_key then raise exception 'Не можна змінювати збережене джерело поля родича';end if;
                end loop;
                continue;
              end if;
              if old_relative->relative_key not in ('null'::jsonb,'""'::jsonb) and old_relative->relative_key is distinct from new_relative->relative_key then
                raise exception 'Не можна змінювати збережені дані родича';
              end if;
            end loop;
            relative_index:=relative_index+1;
          end loop;
        elsif target='profile' and key in ('education_records','work_records','work_events') and item->>'merge_records'='true' then
          if jsonb_typeof(item->'incoming') is distinct from 'array' or jsonb_typeof(coalesce(nullif(current_value,'null'::jsonb),'[]'::jsonb)) is distinct from 'array' then raise exception 'Некоректні структуровані записи';end if;
          relative_index:=0;
          for old_relative in select value from jsonb_array_elements(coalesce(nullif(current_value,'null'::jsonb),'[]'::jsonb)) loop
            if (item->'incoming')->relative_index is distinct from old_relative then raise exception 'Не можна змінювати збережені записи освіти або роботи';end if;
            relative_index:=relative_index+1;
          end loop;
        elsif target='profile' and key in ('military_rank_records','combat_records','awards','reserve_training_records') and item->>'merge_records'='true' then
          if jsonb_typeof(item->'incoming')<>'array' or jsonb_typeof(coalesce(nullif(current_value,'null'::jsonb),'[]'::jsonb))<>'array' then raise exception 'Некоректні військові записи';end if;
          relative_index:=0;
          for old_relative in select value from jsonb_array_elements(coalesce(nullif(current_value,'null'::jsonb),'[]'::jsonb)) loop
            if (item->'incoming')->relative_index is distinct from old_relative then raise exception 'Не можна змінювати збережені військові записи';end if;
            relative_index:=relative_index+1;
          end loop;
        elsif target='profile' and key in ('military_oath','military_discharge') and current_value='{}'::jsonb then
          null;
        elsif current_value is not null and current_value<>'null'::jsonb and btrim(coalesce(current_value#>>'{}',''))<>'' then
          raise exception 'Не можна перезаписувати заповнене поле %',key;
        end if;
      end if;
    elsif item->>'fill_only'='true' then raise exception 'Потрібне поточне значення для безпечної синхронізації';
    end if;
    if target='profile' and key='relatives' and item->>'relative_sources'='true' then
      relative_index:=0;
      for new_relative in select value from jsonb_array_elements(item->'incoming') loop
        old_relative:=current_value->relative_index;
        if new_relative ? 'field_sources' then
          if jsonb_typeof(new_relative->'field_sources') is distinct from 'object' then raise exception 'Некоректні джерела родича';end if;
          for source_key in select jsonb_object_keys(new_relative->'field_sources') loop
            if coalesce(new_relative->'field_sources'->source_key,'null'::jsonb) not in ('null'::jsonb,'""'::jsonb) and coalesce(old_relative->'field_sources'->source_key,'null'::jsonb) in ('null'::jsonb,'""'::jsonb) and new_relative->'field_sources'->>source_key is distinct from doc.id::text then raise exception 'Некоректне нове джерело поля родича';end if;
          end loop;
        end if;
        relative_index:=relative_index+1;
      end loop;
    end if;
    if target='profile' and key in ('education_records','work_records','work_events') and item->>'merge_records'='true' then
      if item->>'structured_records' is distinct from 'true' or item->>'fill_only' is distinct from 'true' or not(item ? 'expected_ai') or not(item ? 'expected_current') then raise exception 'Потрібна захищена синхронізація структурованих записів';end if;
      if jsonb_typeof(item->'incoming') is distinct from 'array' or jsonb_array_length(item->'incoming')>500 then raise exception 'Некоректні структуровані записи';end if;
      if doc.verification_status is distinct from 'Підтверджено' and (doc.ai_confidence is null or doc.ai_confidence<0.85 or doc.ai_confidence>1) then raise exception 'Потрібна перевірка впевненості AI';end if;
      if key='education_records' and (coalesce(doc.document_type,'')||' '||coalesce(doc.ai_document_type,'')) !~* '(диплом|атестат|освіт)' then raise exception 'Освіта має надходити з освітнього документа';end if;
      if key in ('work_records','work_events') and (coalesce(doc.document_type,'')||' '||coalesce(doc.ai_document_type,'')) !~* '(трудов|застрахован|військов|квит|наказ|офіцер)' then raise exception 'Невідповідний документ для періодів діяльності';end if;
      record_index:=jsonb_array_length(coalesce(nullif(current_value,'null'::jsonb),'[]'::jsonb));
      for new_record in select value from jsonb_array_elements(item->'incoming') with ordinality r(value,n) where n>record_index loop
        if jsonb_typeof(new_record) is distinct from 'object' or new_record->>'source_document_id' is distinct from doc.id::text or new_record->>'requires_review'='true' or new_record->>'confirmed_by_user'='true' then raise exception 'Некоректне джерело структурованого запису';end if;
      end loop;
    end if;
    if target='profile' and key in ('military_oath','military_discharge','military_rank_records','combat_records','awards','reserve_training_records') then
      if item->>'structured_military' is distinct from 'true' or item->>'fill_only' is distinct from 'true' or not(item ? 'expected_ai') or not(item ? 'expected_current') then raise exception 'Потрібна захищена синхронізація військових відомостей';end if;
      if (coalesce(doc.document_type,'')||' '||coalesce(doc.ai_document_type,'')) !~* '(військов|офіцера|Резерв|приписн|наказ|нагород|бойов|присяг|збор)' or (coalesce(doc.document_type,'')||' '||coalesce(doc.ai_document_type,'')) ~* '(УБД|учасника бойових дій)' then raise exception 'Невідповідний тип джерела військових відомостей';end if;
      if doc.verification_status is distinct from 'Підтверджено' and (doc.ai_confidence is null or doc.ai_confidence<0.85 or doc.ai_confidence>1) then raise exception 'Потрібна перевірка впевненості AI';end if;
      if key in ('military_rank_records','combat_records','awards','reserve_training_records') then
        if item->>'merge_records' is distinct from 'true' or jsonb_typeof(item->'incoming')<>'array' or jsonb_array_length(item->'incoming')>500 then raise exception 'Некоректний масив військових відомостей';end if;
        record_index:=jsonb_array_length(coalesce(nullif(current_value,'null'::jsonb),'[]'::jsonb));
      else
        if jsonb_typeof(item->'incoming')<>'object' then raise exception 'Некоректні військові реквізити';end if;
        record_index:=0;
      end if;
      incoming_value:=case when key in ('military_rank_records','combat_records','awards','reserve_training_records') then item->'incoming' else jsonb_build_array(item->'incoming') end;
      for new_record in select value from jsonb_array_elements(incoming_value) with ordinality r(value,n) where n>record_index loop
        if jsonb_typeof(new_record)<>'object' or new_record->>'source_document_id' is distinct from doc.id::text or new_record->>'accepted_by_ai' is distinct from 'true' or new_record->>'requires_review' is distinct from 'false' or coalesce(new_record->>'confirmed_by_user','false')<>'false' or coalesce(new_record->>'crossed_out','false')<>'false' then raise exception 'Некоректне джерело або підтвердження військового запису';end if;
        if jsonb_typeof(new_record->'source_pages') is distinct from 'array' or jsonb_array_length(new_record->'source_pages')=0 or btrim(coalesce(new_record->>'raw_text',''))='' or length(new_record->>'raw_text')>2000 then raise exception 'Потрібні сторінка та цитата військового запису';end if;
        if exists(select 1 from jsonb_array_elements_text(new_record->'source_pages') p where p !~ '^[1-9][0-9]{0,2}$' and p<>'1000') then raise exception 'Некоректні сторінки джерела';end if;
        source_rows:=coalesce(nullif(doc.ai_extracted->key,'null'::jsonb),doc.ai_extracted->'service'->key);
        if key in ('military_rank_records','combat_records','awards','reserve_training_records') then
          if coalesce(new_record->>'source_record_index','') !~ '^[0-9]{1,3}$' or jsonb_typeof(source_rows) is distinct from 'array' then raise exception 'Немає вихідного запису AI';end if;
          source_record:=source_rows->((new_record->>'source_record_index')::integer);
        else source_record:=source_rows;end if;
        if source_record is null or source_record='null'::jsonb or btrim(coalesce(source_record->>'raw_text','')) is distinct from new_record->>'raw_text' or source_record->>'requires_review'='true' or source_record->>'crossed_out'='true' or source_record->>'legibility' in ('low','unreadable') then raise exception 'Вихідний запис AI потребує звірки';end if;
        if exists(select 1 from jsonb_array_elements_text(new_record->'source_pages') pg(value) where not(coalesce(pg.value=source_record->>'page',false) or exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(source_record->'source_pages')='array' then source_record->'source_pages' else '[]'::jsonb end) sp(value) where sp.value=pg.value))) then raise exception 'Сторінки не збігаються з джерелом AI';end if;
        for value_key in select jsonb_object_keys(new_record) loop
          if value_key in ('source_document_id','source_pages','raw_text','source_record_index','requires_review','accepted_by_ai') then continue;end if;
          source_value:=source_record->>value_key;
          if key='military_rank_records' and value_key in ('date','order_date') then source_value:=coalesce(source_record->>value_key,source_record->>case when value_key='date' then 'order_date' else 'date' end);end if;
          if value_key='order_issuer' then source_value:=coalesce(nullif(source_value,''),source_record->>'unit');end if;
          source_value:=lower(regexp_replace(btrim(coalesce(source_value,'')),'\s+',' ','g'));
          expected_value:=lower(regexp_replace(btrim(coalesce(new_record->>value_key,'')),'\s+',' ','g'));
          if value_key='unit' and source_value ~ '^[аa][0-9]{4}$' then source_value:='а'||substring(source_value from 2);end if;
          if value_key='order_issuer' and source_value ~ '^[аa][0-9]{4}$' then source_value:='а'||substring(source_value from 2);end if;
          if source_value is distinct from expected_value then raise exception 'Значення військового запису відрізняється від AI: %',value_key;end if;
        end loop;
        for date_key in select unnest(array['date','order_date','start_date','end_date']) loop
          if new_record->>date_key is not null then
            if new_record->>date_key !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Неповна військова дата';end if;
            checked_date:=(new_record->>date_key)::date;
            if to_char(checked_date,'YYYY-MM-DD')<>new_record->>date_key then raise exception 'Некоректна військова дата';end if;
          end if;
        end loop;
        if new_record->>'end_date'<new_record->>'start_date' then raise exception 'Некоректний період';end if;
        if key='military_oath' and (new_record->>'date' is null or coalesce(new_record->>'unit','') !~ '^А[0-9]{4}$') then raise exception 'Неповні відомості присяги';end if;
        if key='military_discharge' and (btrim(coalesce(new_record->>'basis',''))='' or new_record->>'order_date' is null or btrim(coalesce(new_record->>'order_number',''))='' or coalesce(new_record->>'unit','') !~ '^А[0-9]{4}$') then raise exception 'Неповні відомості звільнення';end if;
        if key='military_rank_records' and (btrim(coalesce(new_record->>'rank',''))='' or new_record->>'order_date' is null or btrim(coalesce(new_record->>'order_number',''))='') then raise exception 'Неповний наказ про звання';end if;
        if key='combat_records' and (btrim(coalesce(new_record->>'location',''))='' or new_record->>'start_date' is null or new_record->>'end_date' is null) then raise exception 'Неповний бойовий період';end if;
        if key='awards' and (btrim(coalesce(new_record->>'name',''))='' or btrim(coalesce(new_record->>'order_issuer',''))='' or btrim(coalesce(new_record->>'order_number',''))='' or new_record->>'order_date' is null) then raise exception 'Неповні відомості нагороди';end if;
        if key='reserve_training_records' and (coalesce(new_record->>'unit','') !~ '^А[0-9]{4}$' or btrim(coalesce(new_record->>'position',''))='' or new_record->>'start_date' is null or new_record->>'end_date' is null or new_record->>'order_date' is null or btrim(coalesce(new_record->>'order_number',''))='') then raise exception 'Неповні відомості зборів';end if;
      end loop;
    end if;
    if target='profile' and key in ('driver_license','ubd_certificate','marriage_record') then
      if jsonb_typeof(item->'incoming')<>'object' or item->'incoming'->>'source_document_id' is distinct from doc.id::text then raise exception 'Некоректне джерело реквізитів';end if;
    end if;
    if target='profile' and key='registration_records' and jsonb_typeof(item->'incoming')<>'array' then raise exception 'Некоректні адресні записи';end if;
    if target='profile' and key in ('passport_number','passport_series','passport_issuer','passport_issue_date','passport_expiry_date') and not coalesce(doc.document_type,'') ~* '(паспорт|ID|ІД[ -]*карт)' and not coalesce(doc.ai_document_type,'') ~* '(паспорт|ID|ІД[ -]*карт)' then raise exception 'Паспортні поля дозволені лише з паспорта';end if;
    if target='profile' and key like 'military_%' and exists(select 1 from public.document_requirements r where r.id=doc.requirement_id and r.document_type ~* '(УБД|учасника бойових дій)') then raise exception 'УБД не є військово-обліковим документом';end if;
    if target='candidate' and key=any(array['full_name','name_nominative','name_genitive','birth_date','birth_place','rnokpp','phone','email','sex','marital_status','has_children','worked_before','served_before','military_rank','military_specialty','civilian_profession','desired_position','tcc']) then cp:=cp||jsonb_build_object(key,item->'incoming');
    elsif target='file' and key=any(array['address','education','work_history','military_service_history','children_info']) then fp:=fp||jsonb_build_object(key,item->'incoming');
    elsif target='profile' and key=any(array['military_oath','military_discharge','military_rank_records','combat_records','awards','reserve_training_records','driver_license','ubd_certificate','registration_records','criminal_record_details','marriage_record','name_history','shpk','tariff_grade','recruiter_name','military_unit','desired_unit','recommender_unit','signatory','criminal_record_info','service_type','bio_education_claims','bio_work_claims','bio_service_claims','bio_document_date','bio_employment_status','identity_document_type','birth_certificate','passport_number','passport_issuer','passport_issue_date','passport_expiry_date','passport_series','citizenship','unzr','registered_address','relatives','military_document_number','military_document_type','military_registration_date','military_registration_category','military_registration_status','vlk_certificate_number','vlk_date','vlk_conclusion','vlk_category','vlk_next_date','vlk_commission','military_registry_number','military_document_expiry_date','military_data_updated_at','military_deferment_type','military_deferment_until','military_registration_removal_reason','military_training_status','work_records','work_events','education_records','education_level','education_institution','education_specialty_code','education_specialty','education_qualification','education_year','education_start_date','education_end_date','education_diploma_series','education_diploma_number','education_diploma_issue_date','education_supplement_number','education_supplement_issue_date']) then profile:=profile||jsonb_build_object(key,item->'incoming');has_profile:=true;
    else raise exception 'Поле не дозволене для перенесення';end if;
  end loop;
  perform set_config('crm.source_document_id',doc.id::text,true);
  if has_profile then cp:=cp||jsonb_build_object('profile_data',profile);end if;
  if cp<>'{}' or fp<>'{}' then cp:=cp||jsonb_build_object('updated_at',clock_timestamp());end if;
  for key in select jsonb_object_keys(cp) loop
    execute format('update public.candidates set %1$I=(jsonb_populate_record(null::public.candidates,$1)).%1$I where id=$2',key) using cp,doc.candidate_id;
  end loop;
  if fp<>'{}' then
    fp:=fp||jsonb_build_object('updated_at',clock_timestamp());
    insert into public.personal_files(candidate_id) values(doc.candidate_id) on conflict(candidate_id) do nothing;
    perform 1 from public.personal_files where candidate_id=doc.candidate_id for update;
    for key in select jsonb_object_keys(fp) loop
      execute format('update public.personal_files set %1$I=(jsonb_populate_record(null::public.personal_files,$1)).%1$I where candidate_id=$2',key) using fp,doc.candidate_id;
    end loop;
  end if;
  perform set_config('crm.source_document_id','',true);
end $function$
