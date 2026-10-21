-- Human-confirmed, document-scoped examples in existing JSON; no new tables or grants on data.
create or replace function public.crm_confirm_military_zone_examples(p_document_id uuid,p_source jsonb,p_examples jsonb)
returns integer language plpgsql security invoker set search_path='' as $$
declare d public.documents; examples jsonb; e jsonb; item jsonb; added integer:=0; n numeric;
begin
 if auth.uid() is null or not exists(select 1 from public.crm_staff where user_id=auth.uid() and active) then raise exception 'Потрібна активна сесія';end if;
 select * into d from public.documents where id=p_document_id for update;
 if not found or d.deleted_at is not null then raise exception 'Документ недоступний';end if;
 if d.document_type !~* 'військов(ий|ого) квит|посвідчення офіцера' then raise exception 'Непідтриманий документ';end if;
 if exists(select 1 from public.documents where version_group_id=d.version_group_id and version_number>d.version_number and deleted_at is null) then raise exception 'Відкрийте останню версію';end if;
 if jsonb_typeof(d.ai_extracted) is distinct from 'object' then raise exception 'Спочатку потрібне основне розпізнавання';end if;
 if p_source->>'document_id' is distinct from p_document_id::text or coalesce(p_source->>'render_sha256','') !~ '^[a-f0-9]{64}$' or coalesce(p_source->>'page','') !~ '^[0-9]{1,3}$' then raise exception 'Некоректне джерело';end if;
 if (p_source->>'page')::integer not between 1 and 200 then raise exception 'Некоректна сторінка';end if;
 if jsonb_typeof(p_source->'box') is distinct from 'object' then raise exception 'Некоректна зона';end if;
 foreach item in array array[p_source->'box'->'x',p_source->'box'->'y',p_source->'box'->'w',p_source->'box'->'h'] loop
  if jsonb_typeof(item) is distinct from 'number' then raise exception 'Некоректна зона';end if;
  n:=(item#>>'{}')::numeric;if n<0 or n>1 then raise exception 'Некоректна зона';end if;
 end loop;
 if (p_source#>>'{box,w}')::numeric<=0 or (p_source#>>'{box,h}')::numeric<=0 or (p_source#>>'{box,x}')::numeric+(p_source#>>'{box,w}')::numeric>1.001 or (p_source#>>'{box,y}')::numeric+(p_source#>>'{box,h}')::numeric>1.001 then raise exception 'Некоректна зона';end if;
 if jsonb_typeof(p_examples) is distinct from 'array' or jsonb_array_length(p_examples) not between 1 and 30 then raise exception 'Некоректні приклади';end if;
 examples:=coalesce(d.ai_extracted->'_military_zone_learning','[]');if jsonb_typeof(examples)<>'array' then raise exception 'Некоректний контейнер прикладів';end if;
 for e in select value from jsonb_array_elements(p_examples) loop
  if coalesce(e->>'key','') not in ('start_date','end_date','order_date','unit','position','military_specialty','order_number','rank') or length(trim(coalesce(e->>'raw_text',''))) not between 1 and 200 or length(trim(coalesce(e->>'value',''))) not between 1 and 200 then raise exception 'Некоректний навчальний приклад';end if;
  if exists(select 1 from jsonb_array_elements(examples) v where v->>'key'=e->>'key' and v->>'raw_text'=e->>'raw_text' and v->>'value'=e->>'value') then continue;end if;
  if jsonb_array_length(examples)>=200 then raise exception 'Досягнуто ліміт прикладів документа';end if;
  examples:=examples||jsonb_build_array(jsonb_build_object('key',e->>'key','raw_text',trim(e->>'raw_text'),'value',trim(e->>'value'),'source',p_source,'confirmed_by',auth.uid(),'confirmed_at',now()));added:=added+1;
 end loop;
 update public.documents set ai_extracted=jsonb_set(ai_extracted,'{_military_zone_learning}',examples) where id=p_document_id;
 if not found then raise exception 'Немає права зберегти приклади';end if;
 return added;
end;$$;
revoke all on function public.crm_confirm_military_zone_examples(uuid,jsonb,jsonb) from public;
grant execute on function public.crm_confirm_military_zone_examples(uuid,jsonb,jsonb) to authenticated;

create or replace function public.crm_military_zone_examples()
returns jsonb language sql stable security invoker set search_path='' as $$
 with recent as (
  select d.ai_extracted->'_military_zone_learning' examples from public.documents d
  where d.deleted_at is null and jsonb_typeof(d.ai_extracted->'_military_zone_learning')='array'
  and exists(select 1 from public.crm_staff where user_id=auth.uid() and active)
  order by d.created_at desc limit 100
 ), entries as (
  select v->>'key' key,v->>'raw_text' raw_text,v->>'value' value from recent cross join lateral jsonb_array_elements(examples) v
  where v->>'confirmed_by' is not null and v->>'confirmed_at' is not null
  and v->>'key' in ('start_date','end_date','order_date','unit','position','military_specialty','order_number','rank')
 ), consistent as (
  select key,raw_text,min(value) value from entries group by key,raw_text having count(distinct value)=1 order by key,raw_text limit 12
 ) select coalesce(jsonb_agg(jsonb_build_object('key',key,'raw_text',raw_text,'value',value)),'[]'::jsonb) from consistent;
$$;
revoke all on function public.crm_military_zone_examples() from public;
grant execute on function public.crm_military_zone_examples() to authenticated;

create or replace function public.crm_preserve_military_zone_learning()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if jsonb_typeof(old.ai_extracted->'_military_zone_learning')='array' and coalesce(jsonb_array_length(old.ai_extracted->'_military_zone_learning'),0)>0 and jsonb_typeof(new.ai_extracted)='object' and not(new.ai_extracted ? '_military_zone_learning') then
  new.ai_extracted:=jsonb_set(new.ai_extracted,'{_military_zone_learning}',old.ai_extracted->'_military_zone_learning');
 end if;
 return new;
end;$$;
revoke all on function public.crm_preserve_military_zone_learning() from public;
drop trigger if exists crm_preserve_military_zone_learning on public.documents;
create trigger crm_preserve_military_zone_learning before update of ai_extracted on public.documents for each row execute function public.crm_preserve_military_zone_learning();
