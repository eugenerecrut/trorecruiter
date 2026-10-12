-- No table/column changes: serialize identity checks before candidate inserts.
create or replace function crm_private.prevent_duplicate_candidate()
returns trigger language plpgsql security invoker set search_path='' as $$
declare key_name text; duplicate_id uuid;
begin
 if tg_op='UPDATE' and new.full_name is not distinct from old.full_name and new.birth_date is not distinct from old.birth_date and new.rnokpp is not distinct from old.rnokpp then return new;end if;
 perform pg_advisory_xact_lock(710124400::bigint);
 key_name:=regexp_replace(lower(btrim(new.full_name)),'\s+',' ','g');
 select c.id into duplicate_id from public.candidates c
 where c.id<>new.id and c.profile_data->>'merged_into' is null
 and ((new.rnokpp ~ '^\d{10}$' and c.rnokpp=new.rnokpp)
 or (new.birth_date is not null and new.birth_date=c.birth_date and
 (regexp_replace(lower(btrim(c.full_name)),'\s+',' ','g')=key_name
 or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(c.profile_data->'name_history')='array' then c.profile_data->'name_history' else '[]'::jsonb end) h where h->>'verified'='true' and regexp_replace(lower(btrim(h->>'previous_full_name')),'\s+',' ','g')=key_name)))) limit 1;
 if duplicate_id is not null then raise exception 'Кандидат уже існує. Відкрийте наявну справу.' using errcode='23505';end if;
 return new;
end $$;
revoke all on function crm_private.prevent_duplicate_candidate() from public;
drop trigger if exists crm_prevent_duplicate_candidate on public.candidates;
create trigger crm_prevent_duplicate_candidate before insert or update of full_name,birth_date,rnokpp on public.candidates for each row execute function crm_private.prevent_duplicate_candidate();
