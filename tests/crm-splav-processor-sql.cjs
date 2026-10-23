// Actual PostgreSQL policies/triggers, isolated in WASM. No production connection.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require(process.env.CRM_TEST_PGLITE||'./sql-runtime/node_modules/@electric-sql/pglite');
const root=path.join(__dirname,'..');
const human='00000000-0000-0000-0000-000000000001',bot='00000000-0000-0000-0000-000000000002',other='00000000-0000-0000-0000-000000000003';
const tables=['candidates','documents','personal_files','crm_activity','crm_archive','document_ai_runs','candidate_document_requirements','document_requirements'];
(async()=>{const db=new PGlite();let checks=0;
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create schema crm_private;create schema storage;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,storage to authenticated;grant execute on function auth.uid() to authenticated;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}',banned_until timestamptz);
 create table public.crm_staff(user_id uuid primary key references auth.users(id),display_name text,role text,active boolean default true,
 constraint crm_staff_role_check check(role in ('owner','lead','recruiter','observer')));
 alter table public.crm_staff enable row level security;
 create policy staff on public.crm_staff for all to authenticated using(true) with check(true);
 grant select,insert,update,delete on public.crm_staff to authenticated;
 create table storage.objects(id int primary key,name text);alter table storage.objects enable row level security;
 create policy storage on storage.objects for all to authenticated using(true) with check(true);
 grant select,insert,update,delete on storage.objects to authenticated;insert into storage.objects values(1,'private.pdf');`);
 for(const name of tables)await db.exec(`create table public.${name}(id int primary key,value text);
 alter table public.${name} enable row level security;
 create policy human on public.${name} for all to authenticated using(true) with check(true);
 grant select,insert,update,delete on public.${name} to authenticated;
 insert into public.${name} values(1,'manual');`);
 await db.exec(`create function public.sync_candidate_document_requirements(p_candidate_id uuid) returns void language plpgsql security definer as $$begin update public.candidates set value='changed';end$$;`);
 await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261023061609_splav_processor_isolation.sql'),'utf8'));
 await db.exec(`create trigger crm_staff_sync after insert or update on auth.users for each row execute function crm_private.sync_staff();`);
 await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[human,'human@test.invalid',{full_name:'Людина',crm_account_type:'splav_processor'}]);
 await db.query('insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values($1,$2,$3,$4)',[bot,'splav-worker@trorecruiter.invalid',{full_name:'forged'},{crm_account_type:'splav_processor'}]);
 await db.query('insert into auth.users(id,email) values($1,$2)',[other,'other@test.invalid']);
 const staff=async(id)=>(await db.query('select * from public.crm_staff where user_id=$1',[id])).rows[0];
 assert.equal((await staff(human)).role,'recruiter');assert.equal((await staff(human)).active,true);checks+=2;
 assert.equal((await staff(bot)).role,'processor');assert.equal((await staff(bot)).active,false);assert.equal((await staff(bot)).display_name,'СПЛАВ');checks+=3;
 await db.query("update auth.users set raw_user_meta_data='{}',banned_until=null where id=$1",[bot]);assert.equal((await staff(bot)).active,false);checks++;
 await db.exec(`set role authenticated;set request.jwt.claim.sub='${human}'`);
 for(const table of [...tables,'storage.objects']){
   const rel=table.includes('.')?table:'public.'+table;
   assert.equal((await db.query('select * from '+rel)).rows.length,1);checks++;
   await db.exec(`insert into ${rel} values(2,'human insert');update ${rel} set ${table.includes('.')?'name':'value'}='human edit' where id=2;delete from ${rel} where id=2`);checks++;
 }
 await db.exec(`reset role;update public.crm_staff set active=true where user_id='${bot}';set role authenticated;set request.jwt.claim.sub='${bot}'`);
 assert.equal((await db.query('select * from public.crm_staff')).rows.length,1);checks++;
 for(const table of [...tables,'storage.objects']){
   const rel=table.includes('.')?table:'public.'+table;
   assert.equal((await db.query('select * from '+rel)).rows.length,0);checks++;
   await assert.rejects(db.exec(`insert into ${rel} values(2,'forbidden')`),/row-level security/);checks++;
   assert.equal((await db.query(`update ${rel} set ${table.includes('.')?'name':'value'}='forbidden' returning *`)).rows.length,0);checks++;
   assert.equal((await db.query(`delete from ${rel} returning *`)).rows.length,0);checks++;
 }
 await assert.rejects(db.query('select public.sync_candidate_document_requirements($1)',[human]),/Processor access denied/);checks++;
 assert.equal((await db.query("update public.crm_staff set role='owner' returning user_id")).rows.length,0);checks++;
 assert.equal((await db.query('delete from public.crm_staff returning user_id')).rows.length,0);checks++;
 await assert.rejects(db.query("insert into public.crm_staff(user_id,role,active) values('00000000-0000-0000-0000-000000000099','owner',true)"),/row-level security/);checks++;
 // Spoofing JWT/app claims or an arbitrary GUC must not remove database-backed isolation.
 await db.exec(`set request.jwt.claim.role='owner';set crm.splav_write='true'`);
 assert.equal((await db.query('select * from public.candidates')).rows.length,0);checks++;
 await db.exec(`reset role;update public.crm_staff set role='recruiter' where user_id='${bot}';set role authenticated`);
 assert.equal((await db.query('select * from public.candidates')).rows.length,0);checks++;
 await db.exec(`reset role;update public.crm_staff set role='processor',active=false where user_id='${bot}';set role authenticated`);
 assert.equal((await db.query('select * from public.candidates')).rows.length,0);checks++;
 await db.exec(`reset role;update public.crm_staff set active=true where user_id='${bot}';update auth.users set banned_until=now()+interval '1 day' where id='${bot}'`);
 assert.equal((await staff(bot)).active,false);checks++;
 await db.exec(`update auth.users set banned_until=null where id='${bot}'`);assert.equal((await staff(bot)).active,false);checks++;
 for(const table of tables)assert.equal((await db.query('select value from public.'+table)).rows[0].value,'manual');checks+=tables.length;
 await db.exec(`set role authenticated;set request.jwt.claim.sub='${human}'`);
 await db.query('select public.sync_candidate_document_requirements($1)',[human]);assert.equal((await db.query('select value from public.candidates')).rows[0].value,'changed');checks++;
 await db.exec(`reset role;set role anon`);await assert.rejects(db.query('select crm_private.is_processor()'),/permission denied/);checks++;
 console.log(`СПЛАВ processor isolation: ${checks} PostgreSQL checks passed`);
}finally{await db.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
