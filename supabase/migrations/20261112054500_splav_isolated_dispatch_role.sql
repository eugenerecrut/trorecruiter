-- Group for the dedicated runner. Provision its login separately, after verifying access.
create role crm_splav_isolated_dispatch
  nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;

grant usage on schema crm_private to crm_splav_isolated_dispatch;
grant execute on function
  crm_private.splav_isolated_source(uuid,uuid,uuid,text,uuid),
  crm_private.splav_isolated_claim(uuid,uuid,uuid,text,uuid),
  crm_private.splav_isolated_step_deadline(uuid,uuid,uuid,text,uuid,uuid),
  crm_private.splav_isolated_next(uuid,uuid,text,uuid),
  crm_private.splav_isolated_close_terminal(uuid,uuid,text,uuid)
to crm_splav_isolated_dispatch;

-- The dispatcher never receives direct access to the queue or to permits.
do $$
begin
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='crm_private' and c.relkind in ('r','p','v','m','f')
      and has_table_privilege('crm_splav_isolated_dispatch',c.oid,
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  ) then
    raise exception 'Isolated dispatcher inherited private table access';
  end if;
end $$;
