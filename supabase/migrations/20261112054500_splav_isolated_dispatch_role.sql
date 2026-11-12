begin;
-- Group for the dedicated runner. Provision its login separately, after verifying access.
create role crm_splav_isolated_dispatch
  nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;

create schema crm_splav_dispatch;
revoke all on schema crm_splav_dispatch from public,anon,authenticated;
grant usage on schema crm_splav_dispatch to crm_splav_isolated_dispatch;

create function crm_splav_dispatch.source(uuid,uuid,uuid,text,uuid) returns jsonb
language sql volatile security definer set search_path='' as $$
 select crm_private.splav_isolated_source($1,$2,$3,$4,$5)
$$;
revoke all on function crm_splav_dispatch.source(uuid,uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function crm_splav_dispatch.source(uuid,uuid,uuid,text,uuid) to crm_splav_isolated_dispatch;

create function crm_splav_dispatch.claim(uuid,uuid,uuid,text,uuid) returns uuid
language sql volatile security definer set search_path='' as $$
 select crm_private.splav_isolated_claim($1,$2,$3,$4,$5)
$$;
revoke all on function crm_splav_dispatch.claim(uuid,uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function crm_splav_dispatch.claim(uuid,uuid,uuid,text,uuid) to crm_splav_isolated_dispatch;

create function crm_splav_dispatch.step_deadline(uuid,uuid,uuid,text,uuid,uuid) returns timestamptz
language sql volatile security definer set search_path='' as $$
 select crm_private.splav_isolated_step_deadline($1,$2,$3,$4,$5,$6)
$$;
revoke all on function crm_splav_dispatch.step_deadline(uuid,uuid,uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function crm_splav_dispatch.step_deadline(uuid,uuid,uuid,text,uuid,uuid) to crm_splav_isolated_dispatch;

create function crm_splav_dispatch.next(uuid,uuid,text,uuid) returns jsonb
language sql volatile security definer set search_path='' as $$
 select crm_private.splav_isolated_next($1,$2,$3,$4)
$$;
revoke all on function crm_splav_dispatch.next(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function crm_splav_dispatch.next(uuid,uuid,text,uuid) to crm_splav_isolated_dispatch;

create function crm_splav_dispatch.close_terminal(uuid,uuid,text,uuid) returns boolean
language sql volatile security definer set search_path='' as $$
 select crm_private.splav_isolated_close_terminal($1,$2,$3,$4)
$$;
revoke all on function crm_splav_dispatch.close_terminal(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function crm_splav_dispatch.close_terminal(uuid,uuid,text,uuid) to crm_splav_isolated_dispatch;

-- The dispatcher never receives direct access to the queue or to permits.
do $$
begin
  if has_schema_privilege('crm_splav_isolated_dispatch','crm_private','USAGE') then
    raise exception 'Isolated dispatcher inherited private schema access';
  end if;
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='crm_private' and c.relkind in ('r','p','v','m','f')
      and has_table_privilege('crm_splav_isolated_dispatch',c.oid,
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  ) then
    raise exception 'Isolated dispatcher inherited private table access';
  end if;
end $$;
commit;
