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
    if target='candidate' and key=any(array['full_name','name_nominative','name_genitive','birth_date','birth_place','rnokpp','phone','email','sex','marital_status','has_children','worked_before','served_before','military_rank','military_specialty','civilian_profession','desired_position','tcc']) then cp:=cp||jsonb_build_object(key,item->'incoming');
    elsif target='file' and key=any(array['address','education','work_history','military_service_history','children_info']) then fp:=fp||jsonb_build_object(key,item->'incoming');
    elsif target='profile' and key=any(array['criminal_record_info','service_type','bio_education_claims','bio_work_claims','bio_service_claims','bio_document_date','bio_employment_status','identity_document_type','birth_certificate','passport_number','passport_issuer','passport_issue_date','passport_expiry_date','passport_series','citizenship','unzr','registered_address','relatives','military_document_number','military_document_type','military_registration_date','military_registration_category','military_registration_status','vlk_certificate_number','vlk_date','vlk_conclusion','vlk_category','vlk_next_date','vlk_commission','military_registry_number','military_document_expiry_date','military_data_updated_at','military_deferment_type','military_deferment_until','military_registration_removal_reason','military_training_status','work_records','work_events','education_records','education_level','education_institution','education_specialty_code','education_specialty','education_qualification','education_year','education_start_date','education_end_date','education_diploma_series','education_diploma_number','education_diploma_issue_date','education_supplement_number','education_supplement_issue_date']) then profile:=profile||jsonb_build_object(key,item->'incoming');has_profile:=true;
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
