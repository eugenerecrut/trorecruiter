const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require(process.env.CRM_TEST_PGLITE||'./sql-runtime/node_modules/@electric-sql/pglite');
const pilot=require('../military-autopilot.js');
const root=path.join(__dirname,'..'),id=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
(async()=>{const db=new PGlite();let checks=0;
const file=name=>fs.readFileSync(path.join(root,name),'utf8');
const actor=async n=>db.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${id(n)}'`);
const owner=async()=>db.exec('reset role');
const call=async(name,args=[])=>{const r=await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as value`,args);return r.rows[0].value;};
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create schema crm_private;create schema storage;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,storage to authenticated;grant execute on function auth.uid() to authenticated;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}',banned_until timestamptz);
 create table public.crm_staff(user_id uuid primary key,display_name text,role text,active boolean default true,
 constraint crm_staff_role_check check(role in ('owner','lead','recruiter','observer')));
 create table public.crm_activity(id int);create table public.document_ai_runs(id int);
 create table public.candidate_document_requirements(id int,candidate_id uuid);
 create table storage.objects(id int,bucket_id text,name text);`);
 await db.exec(file('tests/fixtures/splav-schema.sql'));
 const names=['crm_staff','candidates','documents','personal_files','crm_activity','crm_archive','document_ai_runs','candidate_document_requirements','document_requirements'];
 for(const name of names){await db.exec(`alter table public.${name} enable row level security;
 create policy permissive on public.${name} for all to authenticated using(true) with check(true);
 grant select,insert,update,delete on public.${name} to authenticated;`);}
 await db.exec(`alter table storage.objects enable row level security;create policy permissive on storage.objects for all to authenticated using(true) with check(true);grant all on storage.objects to authenticated;`);
 await db.exec(file('supabase/migrations/20261016122542_repair_document_sync_utf8_literals.sql'));
 await db.exec(file('supabase/migrations/20261023061609_splav_processor_isolation.sql'));
 await db.exec(file('supabase/migrations/20261023061646_splav_durable_jobs.sql'));
 await db.exec(file('supabase/migrations/20261021141727_military_autopilot_final_report.sql'));
 await db.exec(file('supabase/migrations/20261023144450_splav_zone_request_receipts.sql'));
 await db.exec(file('supabase/migrations/20261023154533_splav_zone_coordinator_checkpoints.sql'));
 await db.exec(`insert into auth.users(id) values('${id(1)}'),('${id(2)}'),('${id(3)}');
 insert into public.crm_staff values('${id(1)}','Reader','recruiter',true),('${id(2)}','Worker','processor',true),('${id(3)}','Inactive','recruiter',false);
 insert into public.candidates(id,profile_data) values('${id(10)}','{"service_type":"За мобілізацією","manual":"preserve"}');
 insert into public.document_requirements(id,document_type,ai_enabled) values('${id(30)}','Автобіографія друкована',true);
 insert into public.documents(id,candidate_id,storage_path,version_group_id,version_number,document_type,requirement_id,ai_extracted,verification_status)
 values('${id(20)}','${id(10)}','source.pdf','${id(20)}',1,'Автобіографія друкована','${id(30)}','{}','Не перевірено');`);
 const hash='a'.repeat(64),full={x:0,y:0,w:1,h:1},zone={x:.1,y:.1,w:.5,h:.2};
 const open=(recover=false)=>call('crm_zone_coordinator_open',[id(20),hash,recover]);
 await actor(2);await assert.rejects(open(),/Active human/);checks++;
 await actor(3);await assert.rejects(open(),/Active human/);checks++;
 await db.exec("reset role;set role anon;set request.jwt.claim.sub=''");await assert.rejects(open(),/permission denied/);checks++;
 await actor(1);
 await assert.rejects(db.query('select * from crm_private.zone_coordinators'),/permission denied/);checks++;
 await assert.rejects(db.query('select * from crm_private.zone_coordinator_steps'),/permission denied/);checks++;
 let saved=await open(),version=saved.version;assert.equal(version,0);checks++;
 const state=pilot.create(2,{source:saved.source});
 const checkpoint=async snapshot=>{version=await call('crm_zone_coordinator_save',[saved.id,version,snapshot]);};
 let modelCalls=0;
 const reader=async task=>{
  let box=full;
  if(task.mode==='zone'){const b=task.box,x=Math.max(0,b.x-.015),y=Math.max(0,b.y-.015);box={x,y,w:Math.min(1,b.x+b.w+.015)-x,h:Math.min(1,b.y+b.h+.015)-y};}
  const args=[saved.id,version,id(20),task.mode,task.page,box,'b'.repeat(64)];
  await assert.rejects(call('crm_zone_coordinator_save',[saved.id,version-1,state.snapshot()]),/already advanced/);checks++;
  const receipt=await call('crm_zone_coordinator_begin',args);
  if(receipt.state==='completed')return receipt.result;
  assert.equal(receipt.state,'accepted');checks++;
  const duplicate=await call('crm_zone_coordinator_begin',[...args.slice(0,-1),'c'.repeat(64)]);
  assert.equal(duplicate.state,'dispatched');assert.equal(duplicate.receipt,undefined);checks+=2;
  modelCalls++;
  const result={mode:task.mode,review_only:true,source:{document_id:id(20),page:task.page,box,render_sha256:'b'.repeat(64)},
   ...(task.mode==='overview'?{zones:[{label:'Запис',box:zone}]}:{rows:[{fields:[{value:'synthetic',legibility:'clear'}]}]})};
  await call('crm_zone_finish',[receipt.id,receipt.receipt,result]);return result;
 };
 await state.run({read:reader,checkpoint,limit:1});assert.equal(modelCalls,1);assert.equal(version,2);checks+=2;
 const reopened=await open();assert.deepEqual(reopened.snapshot,state.snapshot());assert.equal(reopened.reports.length,1);checks+=2;
 const resumed=pilot.restore(reopened.snapshot,{source:reopened.source});version=reopened.version;
 await resumed.run({read:reader,checkpoint});assert.equal(modelCalls,4);assert.equal(resumed.tasks.length,0);checks+=2;
 const completed=await open();assert.equal(completed.reports.length,4);assert.equal(completed.snapshot.completed,4);checks+=2;
 // Stale before-dispatch checkpoints do not grant another tab permission to send.
 await assert.rejects(call('crm_zone_coordinator_save',[saved.id,0,{...state.snapshot(),in_flight:state.tasks[0],attempts:2}]),/already advanced/);checks++;
 const altered=structuredClone(completed.snapshot);altered.source.file_sha256='f'.repeat(64);
 await assert.rejects(call('crm_zone_coordinator_save',[saved.id,completed.version,altered]),/Invalid coordinator/);checks++;
 // A lost acknowledgement after completion may be replayed without a new capability.
 assert.equal(await call('crm_zone_coordinator_save',[saved.id,completed.version-1,completed.snapshot]),completed.version);checks++;
 // Separate source revision: crash before begin can safely rearm and fences the old tab.
 await owner();await db.query('update public.documents set ai_processed_at=now() where id=$1',[id(20)]);await actor(1);
 const next=await open();const p=pilot.create(1,{source:next.source});let before;
 await assert.rejects(p.run({read:async()=>({zones:[]}),checkpoint:async(s,e)=>{
  if(e.phase==='before_dispatch'){before=s;next.version=await call('crm_zone_coordinator_save',[next.id,next.version,s]);}else throw Error('crash');
 }}));
 const recovered=await open(true);assert.equal(recovered.snapshot.in_flight,null);assert.equal(recovered.snapshot.attempts,0);checks+=2;
 await assert.rejects(call('crm_zone_coordinator_begin',[next.id,next.version,id(20),'overview',1,full,'d'.repeat(64)]),/version changed/);checks++;
 // A completed receipt survives a crash before the after-step checkpoint.
 let progress=recovered;
 const cold=pilot.restore(progress.snapshot,{source:progress.source});
 await assert.rejects(cold.run({checkpoint:async(s,e)=>{
  if(e.phase==='before_dispatch')progress.version=await call('crm_zone_coordinator_save',[progress.id,progress.version,s]);else throw Error('crash after paid result');
 },read:async()=>{
  const receipt=await call('crm_zone_coordinator_begin',[progress.id,progress.version,id(20),'overview',1,full,'e'.repeat(64)]);
  const result={mode:'overview',review_only:true,zones:[],source:{document_id:id(20),page:1,box:full,render_sha256:'e'.repeat(64)}};
  await call('crm_zone_finish',[receipt.id,receipt.receipt,result]);return result;
 }}));
 const coldOpen=await open(true);assert(coldOpen.snapshot.in_flight);assert.equal(coldOpen.in_flight_response.state,'completed');checks+=2;
 const coldResume=pilot.restore(coldOpen.snapshot,{source:coldOpen.source});let forbiddenCalls=0;
 await coldResume.run({read:async()=>{forbiddenCalls++;return{};},resolveInFlight:async()=>coldOpen.in_flight_response,
  checkpoint:async s=>{coldOpen.version=await call('crm_zone_coordinator_save',[coldOpen.id,coldOpen.version,s]);}});
 assert.equal(forbiddenCalls,0);assert.equal(coldResume.tasks.length,0);checks+=2;
 // A pending receipt must never be rearmed automatically.
 await owner();await db.query("update public.documents set ai_processed_at=ai_processed_at+interval '1 second' where id=$1",[id(20)]);await actor(1);
 const pendingOpen=await open();const pendingState=pilot.create(1,{source:pendingOpen.source});
 await assert.rejects(pendingState.run({checkpoint:async(s,e)=>{
  if(e.phase==='before_dispatch')pendingOpen.version=await call('crm_zone_coordinator_save',[pendingOpen.id,pendingOpen.version,s]);else throw Error('transport lost');
 },read:async()=>{
  await call('crm_zone_coordinator_begin',[pendingOpen.id,pendingOpen.version,id(20),'overview',1,full,'f'.repeat(64)]);
  throw Error('uncertain');
 }}));
 const pendingReload=await open(true);assert(pendingReload.snapshot.in_flight);assert.equal(pendingReload.in_flight_response.state,'dispatched');checks+=2;
 const pendingResume=pilot.restore(pendingReload.snapshot,{source:pendingReload.source});
 assert.equal((await pendingResume.run({read:async()=>{throw Error('must not dispatch');},resolveInFlight:async()=>null})).blocked,true);checks++;
 await owner();
 assert.equal((await db.query('select profile_data from public.candidates')).rows[0].profile_data.service_type,'За мобілізацією');checks++;
 assert.deepEqual((await db.query('select ai_extracted from public.documents')).rows[0].ai_extracted,{});checks++;
 console.log('PASS:',checks,'coordinator SQL checks with the actual shared planner; no live AI.');
}finally{await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
