-- Deny-by-default foundation. This migration neither creates nor activates a worker.
-- A later queue migration must explicitly grant leased-job capabilities.
begin;

alter table public.crm_staff drop constraint crm_staff_role_check;
alter table public.crm_staff add constraint crm_staff_role_check
  check(role in ('owner','lead','recruiter','observer','processor'));

-- Private, boolean-only predicate avoids policy recursion through crm_staff.
-- Inactive processors are still processors: disabling one must not restore human access.
create or replace function crm_private.is_processor() returns boolean
language sql stable security definer set search_path=''
as $$ select exists(select 1 from public.crm_staff where user_id=(select auth.uid()) and role='processor')
  or exists(select 1 from auth.users where id=(select auth.uid()) and raw_app_meta_data->>'crm_account_type'='splav_processor') $$;
revoke all on function crm_private.is_processor() from public, anon;
grant usage on schema crm_private to authenticated;
grant execute on function crm_private.is_processor() to authenticated;

-- Do not trust editable user_metadata to select a privileged account type.
-- Only the Auth Admin API can set raw_app_meta_data. Worker creation starts inactive.
create or replace function crm_private.sync_staff() returns trigger
language plpgsql security definer set search_path=''
as $$
begin
  if tg_op='INSERT' then
    if new.raw_app_meta_data->>'crm_account_type'='splav_processor' then
      insert into public.crm_staff(user_id,display_name,role,active)
        values(new.id,'СПЛАВ','processor',false);
    else
      insert into public.crm_staff(user_id,display_name,role)
        values(new.id,coalesce(nullif(new.raw_user_meta_data->>'full_name',''),split_part(new.email,'@',1)),'recruiter');
    end if;
  else
    -- Auth token refresh, metadata/password updates and unbanning cannot activate a worker.
    update public.crm_staff set
      display_name=case when role='processor' then 'СПЛАВ' else coalesce(nullif(new.raw_user_meta_data->>'full_name',''),display_name) end,
      active=case when role='processor' then active and (new.banned_until is null or new.banned_until<=now())
                  else (new.banned_until is null or new.banned_until<=now()) end
      where user_id=new.id;
  end if;
  return new;
end $$;

-- Restrictive gates AND with existing permissive policies; normal staff keep their access.
-- No GUC/claim can grant access here. Only a future reviewed migration may add scope.
do $$ declare rel text;
begin
  foreach rel in array array['candidates','documents','personal_files','crm_activity','crm_archive',
    'document_ai_runs','candidate_document_requirements','document_requirements'] loop
    execute format('create policy splav_processor_isolation on public.%I as restrictive for all to authenticated using (not (select crm_private.is_processor())) with check (not (select crm_private.is_processor()))',rel);
  end loop;
end $$;
create policy splav_processor_isolation on public.crm_staff as restrictive for all to authenticated
  using(not (select crm_private.is_processor()) or user_id=(select auth.uid()))
  with check(not (select crm_private.is_processor()));
create policy splav_processor_isolation on storage.objects as restrictive for all to authenticated
  using(not (select crm_private.is_processor())) with check(not (select crm_private.is_processor()));

-- Legacy exposed SECURITY DEFINER helpers must not become a path around RLS.
-- Preserve human behaviour and grants, but reject processor callers before original body.
do $$ declare fn record; definition text;
begin
  for fn in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f' and p.prosecdef
      and p.proname in ('sync_candidate_document_requirements','sync_document_ai_relatives_to_candidate')
      and p.prorettype<>'trigger'::regtype loop
    definition:=pg_get_functiondef(fn.oid);
    if position('begin' in lower(definition))=0 then raise exception 'Unexpected legacy function language';end if;
    definition:=regexp_replace(definition,'\mbegin\M',
      'begin if crm_private.is_processor() then raise exception ''Processor access denied'' using errcode=''42501''; end if;', 'i');
    execute definition;
  end loop;
end $$;

commit;
