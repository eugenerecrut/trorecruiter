const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PGlite}=require(process.env.CRM_TEST_PGLITE||'./sql-runtime/node_modules/@electric-sql/pglite');
(async()=>{const db=new PGlite();try{
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;create table public.crm_staff(user_id uuid,active boolean,role text);grant select on public.crm_staff to authenticated;create table public.whatsapp_messages(id int);create table public.whatsapp_settings(id int,api_token text);insert into public.whatsapp_settings values(1,'synthetic');alter table public.whatsapp_messages enable row level security;alter table public.whatsapp_settings enable row level security;grant select,insert,update on public.whatsapp_messages,public.whatsapp_settings to authenticated;create function public.crm_receive_whatsapp_message(text,text,text,text,text,bigint,text,text,text,jsonb) returns int language sql security definer as $$select 1$$;`);
await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261101064858_green_webhook_access.sql'),'utf8'));
await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261101065238_green_whatsapp_table_access.sql'),'utf8'));
assert.equal((await db.query("select has_table_privilege('anon','public.whatsapp_messages','select') allowed")).rows[0].allowed,false);
assert.equal((await db.query("select has_table_privilege('authenticated','public.whatsapp_messages','truncate') allowed")).rows[0].allowed,false);
for(const [role,expected] of [['anon',false],['authenticated',false],['service_role',true]])assert.equal((await db.query(`select has_function_privilege('${role}','public.crm_receive_whatsapp_message(text,text,text,text,text,bigint,text,text,text,jsonb)','execute') allowed`)).rows[0].allowed,expected);
const user='00000000-0000-4000-8000-000000000001';
for(const [role,active,read,write] of [['owner',true,true,true],['lead',true,true,true],['recruiter',true,true,false],['observer',true,false,false],['processor',true,false,false],['owner',false,false,false]]){
await db.exec(`reset role;delete from public.crm_staff;insert into public.crm_staff values('${user}',${active},'${role}');set role authenticated;set request.jwt.claim.sub='${user}';`);
assert.equal((await db.query('select * from public.whatsapp_settings')).rows.length,read?1:0);
assert.equal((await db.query("update public.whatsapp_settings set api_token='synthetic' returning id")).rows.length,write?1:0);
}
console.log('PASS WhatsApp server-only RPC and role/active settings access; isolated DB only');
}finally{await db.close()}})().catch(e=>{console.error(e);process.exitCode=1});
