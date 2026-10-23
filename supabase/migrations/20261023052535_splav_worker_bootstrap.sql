-- No scheduler is created until the owner-authorized activation action.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create table crm_private.splav_worker(
 singleton boolean primary key default true check(singleton),user_id uuid not null,
 password_secret uuid not null,dispatch_secret uuid not null,public_key_secret uuid not null,
 project_url text not null,cron_job_id bigint
);
alter table crm_private.splav_worker enable row level security;
revoke all on crm_private.splav_worker from public,anon,authenticated;

create function public.crm_splav_configure_worker(worker_id uuid,worker_password text,dispatch_key text,public_key text,project_url text) returns void
language plpgsql security definer set search_path='' as $fn$
declare config crm_private.splav_worker;secret_name text;secret_value text;secret_id uuid;ids uuid[]:='{}';scheduler bigint;
begin
 if worker_password is null or dispatch_key is null or public_key is null or project_url is null or length(worker_password)<>64 or worker_password!~'^Aa9![0-9a-f]{60}$' or dispatch_key!~'^[0-9a-f]{96}$' or length(public_key)<30 or length(public_key)>5000
   or project_url!~'^https://[a-z0-9]{20}\.supabase\.co$' then raise exception 'Invalid worker bootstrap';end if;
 perform 1 from public.crm_staff s join auth.users u on u.id=s.user_id where s.user_id=worker_id and s.role='processor' and not s.active
   and u.raw_app_meta_data->>'crm_account_type'='splav_processor' and u.email='splav-worker@trorecruiter.invalid'
   and (u.banned_until is null or u.banned_until<=now()) for update of s;
 if not found then raise exception 'Worker must be verified and inactive before activation' using errcode='42501';end if;
 select * into config from crm_private.splav_worker where singleton for update;
 if found and config.user_id<>worker_id then raise exception 'Another processor is already configured';end if;
 for secret_name,secret_value in select * from (values('crm_splav_worker_password',worker_password),('crm_splav_dispatch',dispatch_key),('crm_splav_public_key',public_key)) secrets(name,value) loop
  secret_id:=case secret_name when 'crm_splav_worker_password' then config.password_secret when 'crm_splav_dispatch' then config.dispatch_secret else config.public_key_secret end;
  if secret_id is null then secret_id:=vault.create_secret(secret_value,secret_name,'СПЛАВ server-only bootstrap');
  else perform vault.update_secret(secret_id,secret_value,secret_name,'СПЛАВ server-only bootstrap');end if;
  ids:=array_append(ids,secret_id);
 end loop;
 insert into crm_private.splav_worker(singleton,user_id,password_secret,dispatch_secret,public_key_secret,project_url)
 values(true,worker_id,ids[1],ids[2],ids[3],project_url)
 on conflict(singleton) do update set password_secret=excluded.password_secret,dispatch_secret=excluded.dispatch_secret,public_key_secret=excluded.public_key_secret,project_url=excluded.project_url;
 -- Command text contains references, never a password, JWT or dispatch secret literal.
 select cron.schedule('crm-splav-worker','* * * * *',$cron$
   select net.http_post(url:=w.project_url||'/functions/v1/splav-worker',
    headers:=jsonb_build_object('Content-Type','application/json','apikey',k.decrypted_secret,'Authorization','Bearer '||k.decrypted_secret,'x-splav-dispatch',d.decrypted_secret),
    body:='{}'::jsonb,timeout_milliseconds:=10000)
   from crm_private.splav_worker w
   join vault.decrypted_secrets k on k.id=w.public_key_secret
   join vault.decrypted_secrets d on d.id=w.dispatch_secret
   join public.crm_staff s on s.user_id=w.user_id and s.active and s.role='processor'
   where exists(select 1 from crm_private.splav_settings where enabled)
    and exists(select 1 from crm_private.splav_jobs where state='queued' or (state='running' and lease_until<=now()))
    and not exists(select 1 from crm_private.splav_jobs where state='running' and lease_until>now())
 $cron$) into scheduler;
 update crm_private.splav_worker set cron_job_id=scheduler where singleton;
 update public.crm_staff set active=true where user_id=worker_id;
 update crm_private.splav_settings set enabled=true where singleton;
end $fn$;

create function public.crm_splav_worker_bootstrap() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('enabled',q.enabled,'email',u.email,'password',p.decrypted_secret,'dispatch_secret',d.decrypted_secret,
   'has_work',exists(select 1 from crm_private.splav_jobs where state='queued' or (state='running' and lease_until<=now())))
 from crm_private.splav_worker w
 join crm_private.splav_settings q on q.singleton=w.singleton
 join public.crm_staff s on s.user_id=w.user_id and s.role='processor' and s.active
 join auth.users u on u.id=w.user_id and u.raw_app_meta_data->>'crm_account_type'='splav_processor' and (u.banned_until is null or u.banned_until<=now())
 join vault.decrypted_secrets p on p.id=w.password_secret
 join vault.decrypted_secrets d on d.id=w.dispatch_secret
 where w.singleton and q.enabled
$$;

create function public.crm_splav_disable_worker() returns void
language plpgsql security definer set search_path='' as $$
declare config crm_private.splav_worker;
begin
 update crm_private.splav_settings set enabled=false where singleton;
 update crm_private.splav_jobs set state=case when stage='provider_started' then 'uncertain' else 'queued' end,
  leased_by=null,lease_token=null,lease_until=null,updated_at=clock_timestamp() where state='running';
 select * into config from crm_private.splav_worker where singleton for update;
 if found then
  update public.crm_staff set active=false where user_id=config.user_id and role='processor';
  if config.cron_job_id is not null then perform cron.unschedule(config.cron_job_id);end if;
  update crm_private.splav_worker set cron_job_id=null where singleton;
 end if;
end $$;

create function public.crm_splav_worker_status() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',s.user_id,'created',s.user_id is not null,'active',coalesce(s.active,false),
 'enabled',q.enabled,'configured',exists(select 1 from crm_private.splav_worker),
 'queued',(select count(*) from crm_private.splav_jobs where state='queued'),
 'running',(select count(*) from crm_private.splav_jobs where state='running'),
 'needs_review',(select count(*) from crm_private.splav_jobs where state in ('needs_review','uncertain')))
 from crm_private.splav_settings q left join public.crm_staff s on s.role='processor'
 and s.user_id in (select id from auth.users where email='splav-worker@trorecruiter.invalid' and raw_app_meta_data->>'crm_account_type'='splav_processor')
 where q.singleton
$$;

revoke all on function public.crm_splav_configure_worker(uuid,text,text,text,text),public.crm_splav_worker_bootstrap(),public.crm_splav_disable_worker() from public,anon,authenticated;
grant execute on function public.crm_splav_configure_worker(uuid,text,text,text,text),public.crm_splav_worker_bootstrap(),public.crm_splav_disable_worker() to service_role;
revoke all on function public.crm_splav_worker_status() from public,anon,authenticated;
grant execute on function public.crm_splav_worker_status() to service_role;
commit;
