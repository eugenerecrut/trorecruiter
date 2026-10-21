-- Explicit completion only; original OCR and other relatives remain unchanged.
create or replace function public.crm_complete_relative_name(p_document_id uuid,p_index integer,p_expected_current text,p_expected_ai jsonb,p_name text)
returns void language plpgsql security invoker set search_path='' as $$
declare d public.documents;c public.candidates;p jsonb;r jsonb;source_row jsonb;matches integer;old_name text;new_name text;owner_name text;
begin
 if not exists(select 1 from public.crm_staff where user_id=auth.uid() and active) then raise exception 'Потрібна активна сесія';end if;
 select * into d from public.documents where id=p_document_id for update;
 if not found or d.deleted_at is not null or d.verification_status is distinct from 'Підтверджено' then raise exception 'Потрібен доступний підтверджений документ';end if;
 if d.ai_extracted is distinct from p_expected_ai then raise exception 'AI-дані змінилися';end if;
 if exists(select 1 from public.documents where version_group_id=d.version_group_id and version_number>d.version_number and deleted_at is null) then raise exception 'Документ замінено новою версією';end if;
 select * into c from public.candidates where id=d.candidate_id for update;
 if not found then raise exception 'Кандидат недоступний';end if;
 p:=coalesce(c.profile_data,'{}');
 if p->>'merged_into' is not null or p->'workflow'->>'archived_at' is not null then raise exception 'Об’єднана або архівна картка';end if;
 if p_index is null or p_index<0 or p_index>=coalesce(jsonb_array_length(p->'relatives'),0) then raise exception 'Родича не знайдено';end if;
 r:=p->'relatives'->p_index;
 if r->>'full_name' is distinct from p_expected_current then raise exception 'Дані родича змінилися';end if;
 if r->>'confirmed_by_user'='true' or r->>'manually_confirmed'='true' or r->'field_confirmations'->>'full_name'='true' or r->'field_sources'->'full_name'='null'::jsonb then raise exception 'ПІБ підтверджено вручну; доповнення заблоковано';end if;
 old_name:=lower(regexp_replace(btrim(p_expected_current),'\s+',' ','g'));new_name:=lower(regexp_replace(btrim(p_name),'\s+',' ','g'));
 if length(p_name)>240 or length(old_name)<5 or left(new_name,length(old_name)+1)<>old_name||' ' or cardinality(regexp_split_to_array(new_name,'\s+'))<>cardinality(regexp_split_to_array(old_name,'\s+'))+1 then raise exception 'Дозволено лише доповнити ПІБ одним словом';end if;
 owner_name:=lower(regexp_replace(btrim(coalesce(d.ai_extracted->>'full_name',d.ai_extracted->'personal'->>'full_name','')),'\s+',' ','g'));
 if owner_name<>lower(regexp_replace(btrim(coalesce(c.name_nominative,c.full_name)),'\s+',' ','g')) then raise exception 'Потрібна звірка власника документа';end if;
 select count(*),jsonb_agg(x)->0 into matches,source_row from jsonb_array_elements(coalesce(d.ai_extracted->'relatives',d.ai_extracted->'family'->'relatives','[]')) x
 where x->>'full_name'=p_name and lower(coalesce(x->>'relationship',x->>'relation',''))=lower(coalesce(r->>'relationship',r->>'relation','')) and coalesce(x->>'requires_review','false')<>'true';
 if matches<>1 then raise exception 'ПІБ або спорідненість не підтверджені джерелом';end if;
 if nullif(r->>'birth_date','') is not null and nullif(source_row->>'birth_date','') is not null and r->>'birth_date'<>source_row->>'birth_date' then raise exception 'Дата народження родича не збігається';end if;
 if coalesce(r->>'source_document_id','')<>d.id::text and coalesce(r->'field_sources'->>'full_name','')<>d.id::text and not(nullif(r->>'birth_date','') is not null and r->>'birth_date'=source_row->>'birth_date') then raise exception 'Недостатньо ознак відповідності родича';end if;
 r:=r||jsonb_build_object('full_name',p_name,'field_sources',coalesce(r->'field_sources','{}')||jsonb_build_object('full_name',d.id::text),'field_confirmations',coalesce(r->'field_confirmations','{}')||jsonb_build_object('full_name',true),'name_completion',jsonb_build_object('previous',p_expected_current,'document_id',d.id,'confirmed_by',auth.uid(),'confirmed_at',now()));
 perform set_config('crm.source_document_id',d.id::text,true);
 update public.candidates set profile_data=jsonb_set(p,array['relatives',p_index::text],r),updated_at=clock_timestamp() where id=c.id;
 perform set_config('crm.source_document_id','',true);
end $$;
revoke all on function public.crm_complete_relative_name(uuid,integer,text,jsonb,text) from public;
grant execute on function public.crm_complete_relative_name(uuid,integer,text,jsonb,text) to authenticated;
