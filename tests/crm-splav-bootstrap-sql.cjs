// Real bootstrap SQL with local Vault/Cron API substitutes. Never stores real secrets.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require(process.env.CRM_TEST_PGLITE||'./sql-runtime/node_modules/@electric-sql/pglite');
(async()=>{const db=new PGlite();let checks=0;const id='00000000-0000-0000-0000-000000000002',password='Aa9!'+'a'.repeat(60),dispatch='b'.repeat(96),key='public-test-'.repeat(12);
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema crm_private;create schema vault;create schema cron;create schema extensions;
 create table auth.users(id uuid,email text,raw_app_meta_data jsonb,banned_until timestamptz);
 create table public.crm_staff(user_id uuid,role text,active boolean);
 create table crm_private.splav_settings(singleton boolean primary key,enabled boolean);insert into crm_private.splav_settings values(true,false);
 create table crm_private.splav_jobs(state text,stage text,leased_by uuid,lease_token uuid,lease_until timestamptz,updated_at timestamptz);
 create table vault.secrets(id uuid primary key default gen_random_uuid(),name text unique,secret text,description text);
 create view vault.decrypted_secrets as select id,name,secret as decrypted_secret from vault.secrets;
 create function vault.create_secret(value text,secret_name text,description text) returns uuid language plpgsql as $$declare result uuid;begin insert into vault.secrets(name,secret,description) values(secret_name,value,description) returning id into result;return result;end$$;
 create function vault.update_secret(secret_id uuid,value text,secret_name text,description text) returns void language sql as $$update vault.secrets set secret=value,name=secret_name where id=secret_id$$;
 create table cron.job(jobid bigint generated always as identity primary key,jobname text unique,schedule text,command text);
 create function cron.schedule(name text,period text,sql text) returns bigint language plpgsql as $$declare result bigint;begin insert into cron.job(jobname,schedule,command) values(name,period,sql) on conflict(jobname) do update set schedule=excluded.schedule,command=excluded.command returning jobid into result;return result;end$$;
 create function cron.unschedule(wanted bigint) returns boolean language plpgsql as $$begin delete from cron.job where jobid=wanted;return found;end$$;`);
 const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261023052535_splav_worker_bootstrap.sql'),'utf8').replace(/^create extension .*;\r?\n/gm,'');
 await db.exec(migration);
 await db.query("insert into auth.users values($1,'splav-worker@trorecruiter.invalid','{\"crm_account_type\":\"splav_processor\"}',null)",[id]);await db.query("insert into public.crm_staff values($1,'processor',false)",[id]);
 const configure=()=>db.query('select public.crm_splav_configure_worker($1,$2,$3,$4,$5)',[id,password,dispatch,key,'https://vhfysipxorlhuiaatxqi.supabase.co']);
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(configure(),/permission denied/);await assert.rejects(db.query('select public.crm_splav_worker_bootstrap()'),/permission denied/);await assert.rejects(db.query('select * from vault.decrypted_secrets'),/permission denied/);checks+=3;await db.exec('reset role');}
 await db.exec('set role service_role');await configure();checks++;
 const first=(await db.query('select public.crm_splav_worker_bootstrap() as result')).rows[0].result;assert.equal(first.password,password);assert.equal(first.dispatch_secret,dispatch);assert.equal(first.has_work,false);checks+=3;
 await db.exec('reset role');assert.equal((await db.query('select count(*)::int as n from vault.secrets')).rows[0].n,3);checks++;
 const command=(await db.query('select command from cron.job')).rows[0].command;for(const secret of [password,dispatch,key]){assert(!command.includes(secret));checks++;}assert(command.includes('vault.decrypted_secrets'));checks++;
 assert.equal((await db.query('select active from public.crm_staff')).rows[0].active,true);checks++;
 await db.exec("insert into crm_private.splav_jobs(state,stage) values('queued','waiting')");await db.exec('set role service_role');assert.equal((await db.query('select public.crm_splav_worker_bootstrap() as result')).rows[0].result.has_work,true);checks++;
 await assert.rejects(configure(),/inactive before activation/);checks++;
 await db.exec('reset role');await db.query("update crm_private.splav_jobs set state='running',stage='provider_started',leased_by=$1,lease_token=gen_random_uuid(),lease_until=now()+interval '10 minutes'",[id]);
 await db.exec('set role service_role');await db.query('select public.crm_splav_disable_worker()');checks++;
 assert.equal((await db.query('select public.crm_splav_worker_bootstrap() as result')).rows[0].result,null);checks++;
 const status=(await db.query('select public.crm_splav_worker_status() as result')).rows[0].result;assert.equal(status.active,false);assert.equal(status.enabled,false);assert(!JSON.stringify(status).includes(password));checks+=3;
 await db.exec('reset role');assert.equal((await db.query('select count(*)::int as n from cron.job')).rows[0].n,0);checks++;
 const stopped=(await db.query('select * from crm_private.splav_jobs')).rows[0];assert.equal(stopped.state,'uncertain');assert.equal(stopped.lease_token,null);checks+=2;
 await db.query("update auth.users set raw_app_meta_data='{}'");await db.exec('set role service_role');await assert.rejects(configure(),/verified and inactive/);checks++;
 console.log(`СПЛАВ bootstrap: ${checks} PostgreSQL checks passed`);
}finally{await db.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
