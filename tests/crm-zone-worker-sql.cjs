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
 await db.exec(file('supabase/migrations/20261023162403_splav_delegated_zone_worker.sql'));
 await db.exec("update crm_private.splav_settings set enabled=true");
 await db.exec(`update public.documents set verification_status='Підтверджено',ai_processed_at='2026-10-15T00:00:00Z',ai_extracted='{"manual_field":"preserve"}' where id='${id(20)}'`);
 await db.exec(`alter table public.crm_activity add column candidate_id uuid,add column document_id uuid,add column actor_id uuid,add column actor_name text,add column action text,add column changes jsonb,add column source_document_id uuid;
 alter table public.document_ai_runs add column document_id uuid,add column candidate_id uuid,add column actor_id uuid,add column actor_name text,add column processed_at timestamptz,add column model text,add column result jsonb;`);
 await db.exec(file('tests/fixtures/splav-zone-document-triggers.sql'));
 await db.exec(file('supabase/migrations/20261023193100_splav_zone_metadata_provenance.sql'));
 await db.exec(file('supabase/migrations/20261023195033_splav_scoped_single_step_canary.sql'));
 const qualityPermissionsBefore=(await db.query("select prosecdef,proconfig,proacl::text acl from pg_proc where oid='public.crm_splav_zone_step(uuid,uuid,text,jsonb)'::regprocedure")).rows[0];
 await db.exec(file('supabase/migrations/'+fs.readdirSync(path.join(__dirname,'../supabase/migrations')).find(name=>name.endsWith('_splav_zone_quality_verdict.sql'))));
 assert.deepEqual((await db.query("select prosecdef,proconfig,proacl::text acl from pg_proc where oid='public.crm_splav_zone_step(uuid,uuid,text,jsonb)'::regprocedure")).rows[0],qualityPermissionsBefore);checks++;
 await db.exec(file('supabase/migrations/'+fs.readdirSync(path.join(__dirname,'../supabase/migrations')).find(name=>name.endsWith('_splav_zone_quality_verdict.sql'))));
 await db.exec(`create trigger crm_guard_document before insert or update on public.documents for each row execute function crm_private.guard_document();
 create trigger crm_activity_documents after insert or update or delete on public.documents for each row execute function crm_private.record_activity();`);
 const hash='a'.repeat(64),full={x:0,y:0,w:1,h:1};
 await actor(1);const c=await call('crm_zone_coordinator_open',[id(20),hash,false]);
 assert.equal(await call('crm_zone_background_ready'),false);checks++;
 await assert.rejects(call('crm_splav_zone_enqueue',[c.id,1]),/disabled/);checks++;
 await owner();await db.exec("update crm_private.splav_settings set zones_enabled=true");await actor(1);
 const job=await call('crm_splav_zone_enqueue',[c.id,1]);assert.equal(job.kind,'zone');checks++;
 assert.equal((await call('crm_splav_zone_enqueue',[c.id,1])).id,job.id);checks++;
 await assert.rejects(call('crm_zone_coordinator_open',[id(20),hash,true]),/Background zonal job active/);checks++;
 await actor(3);await assert.rejects(call('crm_splav_zone_enqueue',[c.id,1]),/disabled/);checks++;
 await db.exec("reset role;set role anon;set request.jwt.claim.sub=''");await assert.rejects(call('crm_zone_background_ready'),/permission denied/);checks++;
 await actor(1);
 await assert.rejects(call('crm_splav_zone_claim'),/Processor required/);checks++;
 await actor(2);assert.equal(await call('crm_splav_claim'),null);checks++;
 let lease=await call('crm_splav_zone_claim');assert.equal(lease.id,job.id);checks++;
 assert.equal(await call('crm_splav_zone_claim'),null);checks++;
 await assert.rejects(call('crm_splav_validate',[lease.id,lease.lease_token]),/Invalid or expired/);checks++;
 await assert.rejects(call('crm_splav_zone_step',[lease.id,id(999),'load',{}]),/Invalid zonal lease/);checks++;
 await assert.rejects(call('crm_zone_begin',[id(20),{},'overview',1,full,hash]),/Human reader/);checks++;
 await assert.rejects(call('crm_zone_coordinator_open',[id(20),hash,false]),/Human reader/);checks++;
 await assert.rejects(db.query('select * from crm_private.zone_requests'),/permission denied/);checks++;
 await assert.rejects(call('crm_splav_start_provider',[lease.id,lease.lease_token]),/Invalid or expired/);checks++;
 assert.equal((await db.query("update public.candidates set profile_data='{}' returning id")).rows.length,0);checks++;
 assert.equal((await db.query("update public.documents set ai_extracted='{}' returning id")).rows.length,0);checks++;
 const step=async(op,data={})=>call('crm_splav_zone_step',[lease.id,lease.lease_token,op,data]);
 await owner();await db.exec(`insert into public.candidates(id,profile_data) values('${id(11)}','{}');insert into public.documents(id,candidate_id,storage_path) values('${id(21)}','${id(11)}','other.pdf');`);await actor(2);
 assert.equal((await db.query('select id from public.documents where id=$1',[id(21)])).rows.length,0);checks++;
 await owner();await db.exec(`update public.crm_staff set active=false where user_id='${id(1)}'`);await actor(2);await assert.rejects(step('validate'),/source changed/);checks++;
 await owner();await db.exec(`update public.crm_staff set active=true where user_id='${id(1)}';update crm_private.splav_settings set zones_enabled=false`);await actor(2);await assert.rejects(step('validate'),/queue disabled/);checks++;
 assert.equal((await db.query('select id from public.documents where id=$1',[id(20)])).rows.length,0);checks++;
 await owner();await db.exec('update crm_private.splav_settings set zones_enabled=true');await actor(2);
 let context=await step('load');const state=pilot.restore(context.snapshot,{source:context.source});
 let reads=0;
 await state.run({limit:1,checkpoint:async snapshot=>{context.version=await step('save',{version:context.version,snapshot});},read:async task=>{
  const receipt=await step('begin',{version:context.version,mode:task.mode,page:task.page,box:full,render_sha256:hash});
  assert.equal(receipt.state,'accepted');checks++;reads++;
  const duplicate=await step('begin',{version:context.version,mode:task.mode,page:task.page,box:full,render_sha256:'b'.repeat(64)});
  assert.equal(duplicate.state,'dispatched');assert.equal(duplicate.receipt,undefined);checks+=2;
  const forged=state.snapshot();forged.in_flight=null;forged.completed++;forged.tasks=[];
  await assert.rejects(step('save',{version:context.version,snapshot:forged}),/Durable receipt/);checks++;
  const result={review_only:true,mode:'overview',zones:[],quality_issues:[],source:{document_id:id(20),page:1,box:full,render_sha256:hash}};
  await step('finish',{request_id:receipt.id,receipt:receipt.receipt,result});return result;
 }});
 assert.equal(reads,1);assert.equal(state.tasks.length,0);checks+=2;
 await step('final');await assert.rejects(step('load'),/Invalid zonal lease/);checks++;
 await owner();assert.equal((await db.query('select state from crm_private.splav_jobs where id=$1',[job.id])).rows[0].state,'completed');checks++;
 assert.deepEqual((await db.query('select profile_data from public.candidates where id=$1',[id(10)])).rows[0].profile_data,{manual:'preserve',service_type:'За мобілізацією'});checks++;
 assert.equal((await db.query("select ai_extracted->'_military_zone_report'->>'status' status from public.documents where id=$1",[id(20)])).rows[0].status,'complete');checks++;
 assert.deepEqual((await db.query("select ai_extracted-'_military_zone_report' as original,verification_status from public.documents where id=$1",[id(20)])).rows[0],{original:{manual_field:'preserve'},verification_status:'Підтверджено'});checks++;
 assert.equal((await db.query("select ai_processed_at='2026-10-15T00:00:00Z'::timestamptz as same from public.documents where id=$1",[id(20)])).rows[0].same,true);checks++;
 assert.equal((await db.query('select count(*)::int n from public.document_ai_runs where document_id=$1',[id(20)])).rows[0].n,0);checks++;
 assert.equal((await db.query('select count(*)::int n from public.crm_activity where document_id=$1',[id(20)])).rows[0].n,1);checks++;
 async function fresh(n){await owner();await db.query(`insert into public.documents(id,candidate_id,storage_path,version_group_id,version_number,document_type,requirement_id,ai_extracted,verification_status)
  values($1,$2,$3,$1,1,'Автобіографія друкована',$4,'{}','Не перевірено')`,[id(n),id(10),'source-'+n+'.pdf',id(30)]);
  await actor(1);const co=await call('crm_zone_coordinator_open',[id(n),hash,false]);const j=await call('crm_splav_zone_enqueue',[co.id,1]);await actor(2);lease=await call('crm_splav_zone_claim');assert.equal(lease.id,j.id);checks++;return {j,co};}
 for(const completed of [false,true]){
  const {j}=await fresh(completed?23:22);let ctx=await step('load');const p=pilot.restore(ctx.snapshot,{source:ctx.source});
  await assert.rejects(p.run({checkpoint:async(s,e)=>{if(e.phase==='after_step')throw Error('checkpoint transport lost');ctx.version=await step('save',{version:ctx.version,snapshot:s});},read:async()=>{
   const r=await step('begin',{version:ctx.version,mode:'overview',page:1,box:full,render_sha256:hash});
   const result={review_only:true,mode:'overview',zones:[],quality_issues:[],source:{document_id:id(completed?23:22),page:1,box:full,render_sha256:hash}};
   if(completed)await step('finish',{request_id:r.id,receipt:r.receipt,result});
   return result;
  }}));checks++;
  const oldToken=lease.lease_token;await owner();await db.query("update crm_private.splav_jobs set lease_until=now()-interval '1 second' where id=$1",[j.id]);await actor(2);
  lease=await call('crm_splav_zone_claim');assert.notEqual(lease.lease_token,oldToken);checks++;
  await assert.rejects(call('crm_splav_zone_step',[lease.id,oldToken,'load',{}]),/Invalid zonal lease/);checks++;
  ctx=await step('load');const restored=pilot.restore(ctx.snapshot,{source:ctx.source});let paid=0;
  const result=await restored.run({read:async()=>{paid++;return{};},resolveInFlight:async()=>completed?ctx.in_flight_response:null,checkpoint:async s=>{ctx.version=await step('save',{version:ctx.version,snapshot:s});}});
  assert.equal(paid,0);assert.equal(result.blocked,!completed);checks+=2;
  await step(completed?'final':'block');
  await owner();assert.equal((await db.query('select state from crm_private.splav_jobs where id=$1',[j.id])).rows[0].state,completed?'completed':'uncertain');checks++;
 }

 // Full one-page cycles with six zones, cold planner restoration and a new lease per step.
 // No HTTP/AI: synthetic receipts travel through the actual production SQL functions.
 const {zoneRasterBox:fullCycleRasterBox}=await import('../supabase/functions/_shared/pdf-zone-raster.mjs');
 for(const withAlternatives of [false,true]){
  const number=withAlternatives?81:80,{j,co}=await fresh(number),expectedSteps=withAlternatives?13:7;
  const zones=Array.from({length:6},(_,i)=>({label:'Synthetic zone '+i,box:{x:.1,y:.05+i*.12,w:.3,h:.08}}));
  const beforeCycle=(await db.query("select ai_extracted,verification_status,ai_processed_at from public.documents where id=$1",[id(number)])).rows[0];
  const seenSteps=new Set();let calls=0,answer;
  for(;;){
   let ctx=await step('load');const planner=pilot.restore(ctx.snapshot,{source:ctx.source});
   const summary=await planner.run({limit:1,checkpoint:async snapshot=>{ctx.version=await step('save',{version:ctx.version,snapshot});},read:async task=>{
    const signature=JSON.stringify([task.mode,task.page,task.box||full]);assert(!seenSteps.has(signature),'No duplicate dispatch after cold restoration');seenSteps.add(signature);checks++;
    const crop=fullCycleRasterBox(task.mode,task.box||full);
    const receipt=await step('begin',{version:ctx.version,mode:task.mode,page:task.page,box:crop,render_sha256:hash});assert.equal(receipt.state,'accepted');checks++;
    const field={key:'birth_place',value:'Synthetic place',legibility:'clear',...(withAlternatives&&!task.retry?{alternatives:['Another place']}:{})};
    const result={review_only:true,mode:task.mode,...(task.mode==='overview'?{zones,quality_issues:[]}:{rows:[{fields:[field]}]}),source:{document_id:id(number),page:task.page,box:crop,render_sha256:hash,file_sha256:hash}};
    assert.equal((await step('finish',{request_id:receipt.id,receipt:receipt.receipt,result})).state,'completed');checks++;calls++;return result;
   }});
   assert.equal(summary.calls,1);assert.equal(summary.blocked,false);assert.equal(planner.errors.length,0,JSON.stringify(planner.errors));checks+=3;
   if(summary.done){answer=await step('final');break;}
   assert(calls<expectedSteps,'Bounded full cycle');checks++;
   const oldLease=lease.lease_token;await step('yield');await assert.rejects(step('load'),/Invalid zonal lease/);checks++;
   lease=await call('crm_splav_zone_claim');assert.equal(lease.id,j.id);assert.notEqual(lease.lease_token,oldLease);checks+=2;
  }
  assert.equal(calls,expectedSteps);assert.equal(answer.status,withAlternatives?'complete_with_gaps':'complete');checks+=2;
  await owner();
  const stored=(await db.query('select state from crm_private.splav_jobs where id=$1',[j.id])).rows[0];assert.equal(stored.state,withAlternatives?'needs_review':'completed');checks++;
  const snapshot=(await db.query('select snapshot from crm_private.zone_coordinators where id=$1',[co.id])).rows[0].snapshot;
  assert.equal(snapshot.attempts,expectedSteps);assert.equal(snapshot.completed,expectedSteps);assert.deepEqual(snapshot.tasks,[]);assert.deepEqual(snapshot.errors,[]);checks+=4;
  assert.equal((await db.query('select count(*)::int n from crm_private.zone_coordinator_steps where coordinator_id=$1',[co.id])).rows[0].n,expectedSteps);checks++;
  const afterCycle=(await db.query("select ai_extracted,verification_status,ai_processed_at from public.documents where id=$1",[id(number)])).rows[0],finalReport=afterCycle.ai_extracted._military_zone_report;
  assert.equal(finalReport.reports.length,expectedSteps);assert.equal(finalReport.status,answer.status);delete afterCycle.ai_extracted._military_zone_report;assert.deepEqual(afterCycle,beforeCycle);checks+=3;
  assert.deepEqual((await db.query('select profile_data from public.candidates where id=$1',[id(10)])).rows[0].profile_data,{manual:'preserve',service_type:'За мобілізацією'});checks++;
 }

 await owner();await db.query("update public.documents set ai_processed_at=now(),verification_status='Не перевірено' where id=$1",[id(20)]);await actor(1);
 const root=await call('crm_splav_enqueue',[id(20)]);await actor(2);const rootLease=await call('crm_splav_claim');assert.equal(rootLease.id,root.id);checks++;
 await assert.rejects(call('crm_splav_zone_step',[rootLease.id,rootLease.lease_token,'load',{}]),/Invalid zonal lease/);checks++;
 assert.equal((await call('crm_splav_validate',[rootLease.id,rootLease.lease_token])).document_id,id(20));checks++;
 await owner();const beforePrimary=(await db.query('select count(*)::int n from public.document_ai_runs where document_id=$1',[id(20)])).rows[0].n;
 await db.query("update public.documents set ai_extracted=ai_extracted||'{\"new_primary\":\"value\"}' where id=$1",[id(20)]);
 assert.equal((await db.query('select count(*)::int n from public.document_ai_runs where document_id=$1',[id(20)])).rows[0].n,beforePrimary+1);checks++;
 // The scoped canary works with global zones OFF, for one coordinator/budget only.
 await db.exec(`update crm_private.splav_jobs set state='completed',leased_by=null,lease_token=null,lease_until=null where state='running';
 update crm_private.splav_settings set zones_enabled=false;`);
 await db.query(`insert into public.documents(id,candidate_id,storage_path,version_group_id,version_number,document_type,requirement_id,ai_extracted,verification_status)
 values($1,$2,'canary.pdf',$1,1,'Автобіографія друкована',$3,'{"preserve":true}','Підтверджено')`,[id(50),id(10),id(30)]);
 await actor(1);const ca=await call('crm_zone_coordinator_open',[id(50),hash,false]);
 await assert.rejects(call('crm_splav_zone_canary_enqueue',[ca.id,1]),/Active owner/);checks++;
 await owner();await db.exec(`update public.crm_staff set role='owner' where user_id='${id(1)}'`);await actor(1);
 const cj=await call('crm_splav_zone_canary_enqueue',[ca.id,1]);assert.equal(cj.kind,'zone');checks++;
 assert.equal(await call('crm_zone_background_ready'),false);checks++;
 await assert.rejects(call('crm_splav_zone_enqueue',[ca.id,1,2600]),/disabled/);checks++;
 await assert.rejects(call('crm_splav_zone_canary_enqueue',[ca.id,1]),/already consumed/);checks++;
 await owner();let settings=(await db.query('select zones_enabled,zone_canary_coordinator from crm_private.splav_settings')).rows[0];
 assert.equal(settings.zones_enabled,false);assert.equal(settings.zone_canary_coordinator,ca.id);checks+=2;
 await actor(2);assert.equal(await call('crm_splav_claim'),null);checks++;
 lease=await call('crm_splav_zone_claim');assert.equal(lease.id,cj.id);checks++;
 const cx=await step('load'),canary=pilot.restore(cx.snapshot,{source:cx.source});assert.equal(canary.snapshot().budget,1);checks++;
 const cr=await canary.run({limit:1,checkpoint:async s=>{cx.version=await step('save',{version:cx.version,snapshot:s});},read:async()=>{
  const receipt=await step('begin',{version:cx.version,mode:'overview',page:1,box:full,render_sha256:hash});
  const result={contract:'pdf-native-overview-1',review_only:true,requires_review:true,ai_requests:0,mode:'overview',zones:[{box:{x:.1,y:.1,w:.5,h:.2},label:'Текстовий блок 1'}],source:{document_id:id(50),page:1,box:full,render_sha256:hash,origin:'server_text_layer',provider:'PDFium · без AI'}};
  await step('finish',{request_id:receipt.id,receipt:receipt.receipt,result});return result;
 }});assert.equal(cr.calls,1);assert.equal(cr.budget_exhausted,true);checks+=2;
 await step('hold');await owner();settings=(await db.query('select zones_enabled,zone_canary_coordinator from crm_private.splav_settings')).rows[0];
 const nativeReceipt=(await db.query('select result from crm_private.zone_requests where document_id=$1',[id(50)])).rows[0].result;
 assert.equal(nativeReceipt.ai_requests,0);assert.equal(nativeReceipt.source.origin,'server_text_layer');checks+=2;
 assert.equal(settings.zones_enabled,false);assert.equal(settings.zone_canary_coordinator,null);checks+=2;
 assert.deepEqual((await db.query('select ai_extracted,verification_status from public.documents where id=$1',[id(50)])).rows[0],{ai_extracted:{preserve:true},verification_status:'Підтверджено'});checks++;
 await actor(2);assert.equal(await call('crm_splav_zone_claim'),null);checks++;
 await assert.rejects(step('load'),/Invalid zonal lease/);checks++;
 // Saved summaries are human-only, source-bound, and exclude private receipts/payloads.
 await owner();await db.exec(file('supabase/migrations/20261023202606_splav_zone_status_summary.sql'));
 await actor(1);const status=await call('crm_splav_job_status',[cj.id]);
 assert.equal(status.zone_summary.attempts,1);assert.equal(status.zone_summary.budget,1);checks+=2;
 assert(!JSON.stringify(status).includes('lease_token'));assert(!JSON.stringify(status).includes('render_sha256'));checks+=2;
 await actor(2);await assert.rejects(call('crm_splav_job_status',[cj.id]),/Human staff/);checks++;
 await actor(3);await assert.rejects(call('crm_splav_job_status',[cj.id]),/Human staff/);checks++;
 await owner();await db.query("update crm_private.zone_requests set state='failed',result=$1 where id=(select request_id from crm_private.zone_coordinator_steps where coordinator_id=$2 limit 1)",[{code:'ZONE_RESULT_UNCERTAIN',error:'SECRET',provider_errors:[{provider:'OpenAI',error:'OpenAI: HTTP 429'},{provider:'Gemini',diagnosis:'MAX_TOKENS',error:'SECRET'},{provider:'SECRET',diagnosis:'SECRET'}]},ca.id]);
 await actor(1);const failure=await call('crm_splav_job_status',[cj.id]);
 assert.equal(failure.zone_summary.providers[0].http_status,429);assert.equal(failure.zone_summary.providers[1].diagnosis,'MAX_TOKENS');checks+=2;
 assert(!JSON.stringify(failure).includes('SECRET'));checks++;
 await owner();await db.exec(file('supabase/migrations/20261024061103_splav_saved_zone_results.sql'));
 // A manual successful receipt is not linked to coordinator_steps but must survive reopening.
 await db.query(`insert into crm_private.zone_requests(document_id,source,source_key,request_key,initiated_by,mode,page,box,render_sha256,state,result)
 select document_id,source,'manual-source','manual-request',$2,'zone',1,$3,$4,'completed',$5 from crm_private.zone_coordinators where id=$1`,[ca.id,id(1),full,hash,{review_only:true,mode:'zone',source:{document_id:id(50),page:1,render_sha256:hash},rows:[{fields:[{key:'vlk_conclusion',raw_text:'сержант поліції',value:'сержант поліції',legibility:'clear'}]}]}]);
 await actor(1);const restored=await call('crm_splav_job_status',[cj.id]);assert.equal(restored.zone_reports.length,1);checks++;
 assert.equal(restored.zone_reports[0].source.document_id,id(50));checks++;
 assert(!JSON.stringify(restored.zone_reports).includes('manual-source'));assert(!JSON.stringify(restored.zone_reports).includes('receipt'));checks+=2;
 await actor(2);await assert.rejects(call('crm_splav_job_status',[cj.id]),/Human staff/);checks++;
 await owner();await db.query(`insert into crm_private.zone_requests(document_id,source,source_key,request_key,initiated_by,mode,page,box,render_sha256,state,result)
 select document_id,source||'{"ai_document_type":"wrong-source"}'::jsonb,'stale-source','stale-request',$2,'zone',1,$3,$4,'completed',$5 from crm_private.zone_coordinators where id=$1`,[ca.id,id(1),full,hash,{review_only:true,source:{document_id:id(50)},raw_text:'MUST_NOT_RETURN'}]);
 await actor(1);assert(!JSON.stringify(await call('crm_splav_job_status',[cj.id])).includes('MUST_NOT_RETURN'));checks++;
 await owner();await db.query(`update crm_private.zone_requests set result=result||jsonb_build_object('padding',repeat('x',1800001)) where request_key='manual-request'`);
 await actor(1);const huge=await call('crm_splav_job_status',[cj.id]);assert.equal(huge.zone_reports_truncated,true);assert.equal(huge.zone_reports.length,0);checks+=2;
 await owner();await db.query(`update crm_private.zone_requests set result=result-'padding' where request_key='manual-request'`);
 await actor(1);
 await owner();await db.query(`update public.documents set ai_extracted=ai_extracted||'{"new_revision":true}'::jsonb where id=$1`,[id(50)]);await actor(1);
 const changed=await call('crm_splav_job_status',[cj.id]);assert.equal(changed.zone_summary.source_changed,true);assert.equal(changed.zone_reports.length,0);checks+=2;
 await owner();await db.exec("set role anon;set request.jwt.claim.sub=''");await assert.rejects(call('crm_splav_job_status',[cj.id]),/permission denied|Human staff/);checks++;
 // Native-only control uses the same owner/lease scope and denies AI/final writes in SQL.
 await owner();await db.exec(file('supabase/migrations/20261024110557_splav_native_only_canary.sql'));
 await actor(1);
 await db.query(`insert into public.documents(id,candidate_id,storage_path,version_group_id,version_number,document_type,requirement_id,ai_extracted,verification_status)
 values($1,$2,'native-control.pdf',$1,1,'Автобіографія друкована',$3,'{"manual":"preserve"}','Підтверджено')`,[id(60),id(10),id(30)]);
 await actor(1);const nc=await call('crm_zone_coordinator_open',[id(60),hash,false]);
 await actor(3);await assert.rejects(call('crm_splav_zone_native_canary_enqueue',[nc.id,1]),/Active owner/);checks++;
 await actor(2);await assert.rejects(call('crm_splav_zone_native_canary_enqueue',[nc.id,1]),/Active owner/);checks++;
 await owner();await db.exec("set role anon;set request.jwt.claim.sub=''");await assert.rejects(call('crm_splav_zone_native_canary_enqueue',[nc.id,1]),/permission denied/);checks++;
 await actor(1);const nj=await call('crm_splav_zone_native_canary_enqueue',[nc.id,1]);assert.equal(nj.native_only,true);checks++;
 await actor(2);lease=await call('crm_splav_zone_claim');assert.equal(lease.id,nj.id);checks++;
 const nx=await step('load');assert.equal(nx.native_only,true);checks++;
 await assert.rejects(step('validate',{native_only:false}),/AI disabled/);checks++;
 await assert.rejects(step('final'),/cannot finalize/);checks++;
 const np=pilot.restore(nx.snapshot,{source:nx.source});await np.run({limit:1,checkpoint:async s=>{nx.version=await step('save',{version:nx.version,snapshot:s,native_only:false});},read:async()=>{
  const receipt=await step('begin',{version:nx.version,mode:'overview',page:1,box:full,render_sha256:hash});
  const result={review_only:true,requires_review:true,mode:'overview',ai_requests:0,zones:[{label:'Текстовий блок 1',box:{x:.1,y:.1,w:.5,h:.2}}],source:{document_id:id(60),page:1,box:full,render_sha256:hash,origin:'server_text_layer'}};
  await step('finish',{request_id:receipt.id,receipt:receipt.receipt,result});return result;
 }});
 await assert.rejects(step('validate'),/AI disabled/);checks++;
 await assert.rejects(step('final'),/cannot finalize/);checks++;
 await step('hold');await owner();
 assert.equal((await db.query('select result from crm_private.splav_jobs where id=$1',[nj.id])).rows[0].result.native_only,true);checks++;
 assert.deepEqual((await db.query('select ai_extracted,verification_status from public.documents where id=$1',[id(60)])).rows[0],{ai_extracted:{manual:'preserve'},verification_status:'Підтверджено'});checks++;
 const nativeSettings=(await db.query('select zones_enabled,zone_canary_coordinator from crm_private.splav_settings')).rows[0];assert.equal(nativeSettings.zones_enabled,false);assert.equal(nativeSettings.zone_canary_coordinator,null);checks+=2;
 await actor(1);await assert.rejects(call('crm_splav_zone_native_canary_enqueue',[nc.id,1]),/already consumed/);checks++;
 // Invalid/oversized saved overviews are retained and completed with gaps, never silently truncated.
 await owner();await db.exec('update crm_private.splav_settings set zones_enabled=true');
 for(const n of [61,62]){
  await fresh(n);const ctx=await step('load'),p=pilot.restore(ctx.snapshot,{source:ctx.source});
  await p.run({checkpoint:async snapshot=>{ctx.version=await step('save',{version:ctx.version,snapshot});},read:async()=>{
   const receipt=await step('begin',{version:ctx.version,mode:'overview',page:1,box:full,render_sha256:hash});
   const result={review_only:true,mode:'overview',zones:n===61?Array.from({length:7},(_,i)=>({box:{x:0,y:i/10,w:.1,h:.05}})):[{box:{x:0,y:0,w:2,h:1}}],source:{document_id:id(n),page:1,box:full,render_sha256:hash}};
   await step('finish',{request_id:receipt.id,receipt:receipt.receipt,result});return result;
  }});
  assert.equal(p.snapshot().errors[0].code,n===61?'ZONE_OVERVIEW_TOO_MANY_ZONES':'ZONE_OVERVIEW_INVALID');checks++;
  const finished=await step('final');assert.equal(finished.status,'complete_with_gaps');checks++;
 }
 const {zoneRasterBox}=await import('../supabase/functions/_shared/pdf-zone-raster.mjs');
 for(const n of [63,64]){
  await fresh(n);const ctx=await step('load'),p=pilot.restore(ctx.snapshot,{source:ctx.source});let reads=0;
  await p.run({checkpoint:async snapshot=>{ctx.version=await step('save',{version:ctx.version,snapshot});},read:async task=>{
   reads++;const box=zoneRasterBox(task.mode,task.box||full),receipt=await step('begin',{version:ctx.version,mode:task.mode,page:1,box,render_sha256:hash});
   const result={review_only:true,mode:task.mode,...(task.mode==='overview'?{zones:[{box:n===63?full:{x:.2,y:.2,w:.2,h:.2}}]}:{rows:n===63?[]:[{fields:[{value:null,legibility:'uncertain'}]}]}),source:{document_id:id(n),page:1,box,render_sha256:hash}};
   await step('finish',{request_id:receipt.id,receipt:receipt.receipt,result});return result;
  }});
  assert.equal(reads,n===63?2:3,JSON.stringify(p.snapshot()));checks++;
  assert.equal(p.snapshot().errors[0].code,n===63?'ZONE_NO_READABLE_FIELDS':'ZONE_FIELDS_UNCERTAIN');checks++;
  assert.equal((await step('final')).status,'complete_with_gaps');checks++;
 }
 await owner();await db.exec(file('supabase/migrations/20261024121203_splav_zone_source_navigation.sql'));
 const sourceJob=(await db.query('select id from crm_private.splav_jobs where document_id=$1',[id(64)])).rows[0].id;
 await actor(1);const navigable=await call('crm_splav_job_status',[sourceJob]);assert.equal(navigable.zone_binding.document_id,id(64));assert.equal(navigable.zone_binding.file_sha256,hash);checks+=2;
 assert.deepEqual(Object.keys(navigable.zone_binding).sort(),['document_id','file_sha256','revision']);checks++;
 await actor(2);await assert.rejects(call('crm_splav_job_status',[sourceJob]),/Human staff/);checks++;
 await owner();await db.exec("set role anon;set request.jwt.claim.sub=''");await assert.rejects(call('crm_splav_job_status',[sourceJob]),/permission denied|Human staff/);checks++;
 await actor(1);await db.query("update public.documents set verification_status='Підтверджено' where id=$1",[id(64)]);
 await actor(1);const replacedSourceStatus=await call('crm_splav_job_status',[sourceJob]);assert.equal(replacedSourceStatus.zone_binding,null);assert.equal(replacedSourceStatus.zone_reports.length,0);checks+=2;

 await owner();
 const definition=(await db.query("select pg_get_functiondef('public.crm_splav_zone_step(uuid,uuid,text,jsonb)'::regprocedure) as body")).rows[0].body;
 const verdict=definition.slice(definition.indexOf('status:=case')+8,definition.indexOf("  report:=jsonb_build_object",definition.indexOf('status:=case'))).trim().replace(/;$/,'').replace("c.snapshot->'errors'",'$2::jsonb');
 const vm=require('node:vm'),viewContext={window:{}};vm.createContext(viewContext);vm.runInContext(file('military-zone-review.js'),viewContext);
 const reading=viewContext.window.CRMMilitaryZoneReview.readingSummary;
 const good={value:'Example',legibility:'clear'},zone=rows=>({mode:'zone',rows}),sample=field=>zone([{fields:[field]}]);
 const spaces=Array.from(' \t\n\r\f\v').concat([0x00a0,0x1680,0x2000,0x2001,0x2002,0x2003,0x2004,0x2005,0x2006,0x2007,0x2008,0x2009,0x200a,0x2028,0x2029,0x202f,0x205f,0x3000,0xfeff].map(n=>String.fromCharCode(n)));
 const samples=[sample(good),sample({...good,value:0}),sample({...good,value:false}),sample({...good,alternatives:[]}),sample({...good,alternatives:['Other']}),sample({...good,value:null}),sample({legibility:'clear'}),sample({...good,legibility:'uncertain'}),zone([]),zone([{fields:[good]},{fields:[]}]),zone([{fields:[good]},{}]),zone([{fields:null}]),zone([{fields:[good]},null]),...spaces.map(value=>sample({...good,value}))];
 for(const report of samples){const summary=reading(report),expected=!summary.count||summary.uncertain||summary.empty_rows?'complete_with_gaps':'complete';const actual=(await db.query('select '+verdict+' as status from (select $1::jsonb as reports) input',[JSON.stringify([report]),JSON.stringify([])])).rows[0].status;assert.equal(actual,expected,JSON.stringify(report));checks++;}
 const errorsVerdict=(await db.query('select '+verdict+' as status from (select $1::jsonb as reports) input',[JSON.stringify([sample(good)]),JSON.stringify([{code:'failed'}])])).rows[0].status;assert.equal(errorsVerdict,'complete_with_gaps');checks++;


 // Draft one-page canary: exactly one owner-scoped document, budget 13, global zones OFF.
 await owner();const pageMigration=file('supabase/migrations/'+fs.readdirSync(path.join(__dirname,'../supabase/migrations')).find(name=>name.endsWith('_splav_single_page_control.sql')));await db.exec(pageMigration);await db.exec(pageMigration);
 await db.exec(file('supabase/migrations/'+fs.readdirSync(path.join(__dirname,'../supabase/migrations')).find(name=>name.endsWith('_splav_explicit_page_rerun.sql'))));
 const aclBeforePlan=(await db.query("select oid::regprocedure::text signature,proacl::text acl,prosecdef,proconfig from pg_proc where oid in ('public.crm_splav_zone_step(uuid,uuid,text,jsonb)'::regprocedure,'public.crm_splav_job_status(uuid)'::regprocedure) order by 1")).rows;
 const nativePlanMigration=file('supabase/migrations/'+fs.readdirSync(path.join(__dirname,'../supabase/migrations')).find(name=>name.endsWith('_splav_biography_page_plan.sql')));await db.exec(nativePlanMigration);await db.exec(nativePlanMigration);
 const aclAfterPlan=(await db.query("select oid::regprocedure::text signature,proacl::text acl,prosecdef,proconfig from pg_proc where oid in ('public.crm_splav_zone_step(uuid,uuid,text,jsonb)'::regprocedure,'public.crm_splav_job_status(uuid)'::regprocedure) order by 1")).rows;assert.deepEqual(aclAfterPlan,aclBeforePlan);checks++;

 await db.exec('update crm_private.splav_settings set zones_enabled=false');
 for(const n of [90,91,92])await db.query("insert into public.documents(id,candidate_id,storage_path,version_group_id,version_number,document_type,requirement_id,ai_extracted,verification_status) values($1,$2,$3,$1,1,'Автобіографія друкована',$4,'{}','Не перевірено')",[id(n),id(10),'page-control-'+n+'.pdf',id(30)]);
 await actor(1);const pageCoordinator=await call('crm_zone_coordinator_open',[id(90),hash,false]),otherCoordinator=await call('crm_zone_coordinator_open',[id(91),hash,false]),holdCoordinator=await call('crm_zone_coordinator_open',[id(92),hash,false]);
 for(const pages of [0,2,200,null]){await assert.rejects(call('crm_splav_zone_page_canary_enqueue',[pageCoordinator.id,pages]),/exactly one page/);checks++;}
 await owner();await db.exec('update crm_private.splav_settings set zones_enabled=true');await actor(1);
 await assert.rejects(call('crm_splav_zone_page_canary_enqueue',[pageCoordinator.id,1]),/global zones off/);checks++;
 const unrelated=await call('crm_splav_zone_enqueue',[otherCoordinator.id,1]);
 await owner();await db.exec("update crm_private.splav_settings set zones_enabled=false;update public.crm_staff set role='recruiter' where user_id='"+id(1)+"'");await actor(1);
 await assert.rejects(call('crm_splav_zone_page_canary_enqueue',[pageCoordinator.id,1]),/Active owner/);checks++;
 await owner();await db.exec("update public.crm_staff set role='owner',active=false where user_id='"+id(1)+"'");await actor(1);await assert.rejects(call('crm_splav_zone_page_canary_enqueue',[pageCoordinator.id,1]),/Active owner/);checks++;
 await actor(2);await assert.rejects(call('crm_splav_zone_page_canary_enqueue',[pageCoordinator.id,1]),/Active owner/);checks++;
 await owner();await db.exec("set role anon;set request.jwt.claim.sub=''");await assert.rejects(call('crm_splav_zone_page_canary_enqueue',[pageCoordinator.id,1]),/permission denied/);checks++;
 await owner();await db.exec("update public.crm_staff set active=true where user_id='"+id(1)+"'");await actor(1);
 const pageJob=await call('crm_splav_zone_page_canary_enqueue',[pageCoordinator.id,1]);
 await assert.rejects(call('crm_splav_zone_page_canary_enqueue',[pageCoordinator.id,1]),/already consumed/);checks++;
 await assert.rejects(call('crm_splav_zone_page_canary_enqueue',[holdCoordinator.id,1]),/unused allowance/);checks++;
 await actor(2);lease=await call('crm_splav_zone_claim');assert.equal(lease.id,pageJob.id);assert.notEqual(lease.id,unrelated.id);checks+=2;
 await owner();assert.equal((await db.query("select has_function_privilege('anon','public.crm_splav_zone_page_canary_enqueue(uuid,integer)','EXECUTE') allowed")).rows[0].allowed,false);assert.equal((await db.query("select has_function_privilege('authenticated','crm_private.zone_canary_enqueue_core(uuid,integer,integer)','EXECUTE') allowed")).rows[0].allowed,false);checks+=2;await actor(2);
 let pageCalls=0;
 for(;;){let ctx=await step('load');const p=pilot.restore(ctx.snapshot,{source:ctx.source});assert.equal(p.snapshot().budget,13);assert.equal(p.snapshot().pages,1);checks+=2;
  await assert.rejects(step('save',{version:ctx.version,snapshot:{...ctx.snapshot,budget:14}}));checks++;
  const result=await p.run({limit:1,checkpoint:async snapshot=>{ctx.version=await step('save',{version:ctx.version,snapshot});},read:async task=>{
   const crop=zoneRasterBox(task.mode,task.box||full),r=await step('begin',{version:ctx.version,mode:task.mode,page:1,box:crop,render_sha256:hash});assert.equal(r.state,'accepted');checks++;
   const report={review_only:true,mode:task.mode,...(task.mode==='overview'?{zones:Array.from({length:6},(_,i)=>({box:{x:.1,y:.05+i*.12,w:.3,h:.08}}))}:{rows:[{fields:[{value:'Synthetic',legibility:'clear',...(task.retry?{}:{alternatives:['Other']})}]}]}),source:{document_id:id(90),page:1,box:crop,render_sha256:hash}};
   await step('finish',{request_id:r.id,receipt:r.receipt,result:report});pageCalls++;return report;
  }});
  if(result.done){assert.equal((await step('final')).status,'complete_with_gaps');checks++;break;}
  assert(pageCalls<13);checks++;await step('yield');lease=await call('crm_splav_zone_claim');assert.equal(lease.id,pageJob.id);checks++;
 }
 assert.equal(pageCalls,13);checks++;
 await owner();const pageSettings=(await db.query('select zones_enabled,zone_canary_coordinator from crm_private.splav_settings')).rows[0];assert.equal(pageSettings.zones_enabled,false);assert.equal(pageSettings.zone_canary_coordinator,null);checks+=2;
 await actor(2);assert.equal(await call('crm_splav_zone_claim'),null);checks++; // unrelated queued job remains out of scope
 await actor(1);await assert.rejects(call('crm_splav_zone_page_canary_enqueue',[pageCoordinator.id,1]),/already consumed/);checks++;
 const heldPage=await call('crm_splav_zone_page_canary_enqueue',[holdCoordinator.id,1]);await actor(2);lease=await call('crm_splav_zone_claim');assert.equal(lease.id,heldPage.id);checks++;await step('hold');
 await owner();assert.equal((await db.query('select zone_canary_coordinator from crm_private.splav_settings')).rows[0].zone_canary_coordinator,null);checks++;
 assert.equal((await db.query('select state from crm_private.splav_jobs where id=$1',[unrelated.id])).rows[0].state,'queued');checks++;


 await db.query("insert into public.documents(id,candidate_id,storage_path,version_group_id,version_number,document_type,requirement_id,ai_extracted,verification_status) values($1,$2,'old-one-step.pdf',$1,1,'Автобіографія друкована',$3,'{}','Не перевірено')",[id(93),id(10),id(30)]);
 await actor(1);const oldModeCoordinator=await call('crm_zone_coordinator_open',[id(93),hash,false]),oldModeJob=await call('crm_splav_zone_canary_enqueue',[oldModeCoordinator.id,1]);
 await assert.rejects(call('crm_splav_zone_page_canary_enqueue',[oldModeCoordinator.id,1]),/already consumed/);checks++;
 await actor(2);lease=await call('crm_splav_zone_claim');assert.equal(lease.id,oldModeJob.id);assert.equal((await step('load')).snapshot.budget,1);checks+=2;await step('hold');


 await owner();await db.query("insert into public.documents(id,candidate_id,storage_path,version_group_id,version_number,document_type,requirement_id,ai_extracted,verification_status) values($1,$2,'native-page-plan.pdf',$1,1,'Автобіографія друкована',$3,'{}','Не перевірено')",[id(94),id(10),id(30)]);
 const candidatePlanBefore=(await db.query('select to_jsonb(c) value from public.candidates c where id=$1',[id(10)])).rows[0].value;
 await actor(1);const nativePlanCoordinator=await call('crm_zone_coordinator_open',[id(94),hash,false]),nativePlanJob=await call('crm_splav_zone_page_canary_enqueue',[nativePlanCoordinator.id,1]);
 await actor(2);lease=await call('crm_splav_zone_claim');assert.equal(lease.id,nativePlanJob.id);checks++;
 let nativePlanCalls=0;
 for(;;){let ctx=await step('load');assert.equal(ctx.document.document_type,'Автобіографія друкована');checks++;const p=pilot.restore(ctx.snapshot,{source:ctx.source});
  const result=await p.run({limit:1,checkpoint:async snapshot=>{ctx.version=await step('save',{version:ctx.version,snapshot});},read:async task=>{
   const crop=zoneRasterBox(task.mode,task.box||full),receipt=await step('begin',{version:ctx.version,mode:task.mode,page:1,box:crop,render_sha256:hash});assert.equal(receipt.state,'accepted');checks++;
   const proposed=[.1,.4,.8].map(y=>({kind:'text',box:{x:.1,y,w:.5,h:.05}}));
   const report={review_only:true,mode:task.mode,...(task.mode==='overview'?{...pilot.nativeReadingPlan(proposed,{documentType:ctx.document.document_type,singlePageControl:ctx.snapshot.budget===13&&ctx.snapshot.pages===1}),ai_requests:0}:{rows:[{fields:[{key:'other',value:'Synthetic',legibility:'clear'}]}]}),source:{document_id:id(94),page:1,box:crop,render_sha256:hash}};
   if(task.mode==='zone'){assert.deepEqual(task.box,full);checks++;}
   await step('finish',{request_id:receipt.id,receipt:receipt.receipt,result:report});nativePlanCalls++;return report;
  }});
  if(result.done){assert.equal((await step('final')).status,'complete');checks++;break;}
  await step('yield');lease=await call('crm_splav_zone_claim');assert.equal(lease.id,nativePlanJob.id);checks++;
 }
 assert.equal(nativePlanCalls,2);checks++;await owner();const nativeSaved=(await db.query('select ai_extracted from public.documents where id=$1',[id(94)])).rows[0].ai_extracted._military_zone_report;
 assert.equal(nativeSaved.reports[0].reading_plan.original_zones.length,3);assert.equal(nativeSaved.reports[0].zones.length,1);assert.equal((await db.query('select zone_canary_coordinator from crm_private.splav_settings')).rows[0].zone_canary_coordinator,null);assert.deepEqual((await db.query('select to_jsonb(c) value from public.candidates c where id=$1',[id(10)])).rows[0].value,candidatePlanBefore);checks+=4;

 await owner();await db.query("insert into public.documents(id,candidate_id,storage_path,version_group_id,version_number,document_type,requirement_id,ai_extracted,verification_status) values($1,$2,'native-limit.pdf',$1,1,'Автобіографія друкована',$3,'{}','Не перевірено')",[id(95),id(10),id(30)]);
 await actor(1);const limitCoordinator=await call('crm_zone_coordinator_open',[id(95),hash,false]),limitJob=await call('crm_splav_zone_page_canary_enqueue',[limitCoordinator.id,1]);await actor(2);lease=await call('crm_splav_zone_claim');assert.equal(lease.id,limitJob.id);checks++;
 let limitContext=await step('load');const limitedPilot=pilot.restore(limitContext.snapshot,{source:limitContext.source});await limitedPilot.run({limit:1,checkpoint:async snapshot=>{limitContext.version=await step('save',{version:limitContext.version,snapshot});},read:async task=>{
  const crop=zoneRasterBox(task.mode,task.box||full),receipt=await step('begin',{version:limitContext.version,mode:task.mode,page:1,box:crop,render_sha256:hash});
  await step('finish',{request_id:receipt.id,receipt:receipt.receipt,result:{error:'Bounded result not accepted',code:'ZONE_RESULT_UNCERTAIN',automatic_retry:false,provider_errors:[{provider:'OpenRouter',diagnosis:'OUTPUT_LIMIT_EXCEEDED'}]}});const error=Error('Bounded output rejected');error.code='ZONE_RESULT_UNCERTAIN';throw error;
 }});await step('hold');await actor(1);const limitStatus=await call('crm_splav_job_status',[limitJob.id]);assert.equal(limitStatus.zone_summary.providers[0].diagnosis,'OUTPUT_LIMIT_EXCEEDED');assert.equal(limitStatus.zone_summary.code,'ZONE_RESULT_UNCERTAIN');checks+=2;
 // An explicit second run uses the same unchanged source, independent budget and
 // receipt namespace. Nothing from the old run is reset or charged a second time.
 await owner();
 const retainedRun=(await db.query(`select to_jsonb(j) job,to_jsonb(c) coordinator,
 (select jsonb_agg(to_jsonb(r) order by r.id) from crm_private.zone_coordinator_steps x join crm_private.zone_requests r on r.id=x.request_id where x.coordinator_id=c.id) receipts
 from crm_private.splav_jobs j join crm_private.zone_coordinators c on c.id=j.coordinator_id where j.id=$1`,[nativePlanJob.id])).rows[0];
 const candidateRerunBefore=(await db.query('select to_jsonb(c) value from public.candidates c where id=$1',[id(10)])).rows[0].value;
 const documentRerunBefore=(await db.query("select to_jsonb(d)-'ai_extracted' value,ai_extracted-'_military_zone_report' ocr from public.documents d where id=$1",[id(94)])).rows[0];
 for(const actorId of [1,2,3]){
  await owner();if(actorId===1)await db.exec("update public.crm_staff set role='recruiter' where user_id='"+id(1)+"'");await actor(actorId);
  await assert.rejects(call('crm_splav_zone_page_rerun_enqueue',[nativePlanJob.id,id(1000),'Compare reading plan']),/Active owner/);checks++;
 }
 await owner();await db.exec("update public.crm_staff set role='owner' where user_id='"+id(1)+"';set role anon;set request.jwt.claim.sub=''");
 await assert.rejects(call('crm_splav_zone_page_rerun_enqueue',[nativePlanJob.id,id(1000),'Compare reading plan']),/permission denied/);checks++;
 await actor(1);
 for(const [run,reason] of [[null,'Reason'],[id(0),'Reason'],[id(1000),''],[id(1000),'x'.repeat(501)]]){await assert.rejects(call('crm_splav_zone_page_rerun_enqueue',[nativePlanJob.id,run,reason]),/identity and reason/);checks++;}
 await assert.rejects(call('crm_splav_zone_page_rerun_enqueue',[limitJob.id,id(1000),'Compare reading plan']),/Finished prior/);checks++;
 const rerun=await call('crm_splav_zone_page_rerun_enqueue',[nativePlanJob.id,id(1000),'Compare reading plan']);assert.notEqual(rerun.id,nativePlanJob.id);checks++;
 await owner();await db.exec("update public.crm_staff set role='owner',active=true where user_id='"+id(3)+"'");await actor(3);
 await assert.rejects(call('crm_splav_zone_page_rerun_enqueue',[nativePlanJob.id,id(1000),'Compare reading plan']),/already assigned/);checks++;
 await owner();await db.exec("update public.crm_staff set role='recruiter',active=false where user_id='"+id(3)+"'");await actor(1);
 assert.equal((await call('crm_splav_zone_page_rerun_enqueue',[nativePlanJob.id,id(1000),'Compare reading plan'])).id,rerun.id);checks++;
 await assert.rejects(call('crm_splav_zone_page_rerun_enqueue',[nativePlanJob.id,id(1000),'Different reason']),/already assigned/);checks++;
 await assert.rejects(call('crm_splav_zone_page_rerun_enqueue',[nativePlanJob.id,id(1001),'Another run']),/active work/);checks++;
 await actor(2);lease=await call('crm_splav_zone_claim');assert.equal(lease.id,rerun.id);checks++;
 let rerunCalls=0;const newReceiptIds=[];
 for(;;){let ctx=await step('load');assert.notEqual(ctx.id,nativePlanCoordinator.id);assert.equal(ctx.source.document_id,id(94));assert.equal(ctx.source.file_sha256,hash);checks+=3;
  const p=pilot.restore(ctx.snapshot,{source:ctx.source});assert.equal(p.snapshot().budget,13);checks++;
  await p.run({limit:1,checkpoint:async snapshot=>{ctx.version=await step('save',{version:ctx.version,snapshot});},read:async task=>{
   const crop=zoneRasterBox(task.mode,task.box||full),r=await step('begin',{version:ctx.version,mode:task.mode,page:1,box:crop,render_sha256:hash});
   assert.equal(r.state,'accepted');newReceiptIds.push(r.id);checks++;
   await assert.rejects(step('finish',{request_id:retainedRun.receipts[0].id,receipt:retainedRun.receipts[0].receipt,result:retainedRun.receipts[0].result}),/outside delegated step/);checks++;
   const repeated=await step('begin',{version:ctx.version,mode:task.mode,page:1,box:crop,render_sha256:hash});assert.equal(repeated.id,r.id);assert.equal(repeated.state,'dispatched');assert.equal(repeated.receipt,undefined);checks+=3;
   const report={review_only:true,mode:task.mode,...(task.mode==='overview'?{zones:[{kind:'text',box:full}]}:{rows:[{fields:[{key:'other',value:'New run only',legibility:'clear'}]}]}),source:{document_id:id(94),page:1,box:crop,render_sha256:hash}};
   await step('finish',{request_id:r.id,receipt:r.receipt,result:report});rerunCalls++;return report;
  }});
  if(!p.snapshot().tasks.length){await step('final');break;}
  await step('yield');lease=await call('crm_splav_zone_claim');assert.equal(lease.id,rerun.id);checks++;
 }
 assert.equal(rerunCalls,2);assert(!retainedRun.receipts.some(r=>newReceiptIds.includes(r.id)));checks+=2;
 await actor(1);const oldView=await call('crm_splav_job_status',[nativePlanJob.id]),newView=await call('crm_splav_job_status',[rerun.id]);
 assert.equal(oldView.zone_reports.length,2);assert.equal(newView.zone_reports.length,2);assert.equal(newView.zone_run.id,id(1000));assert.equal(newView.zone_run.previous_job_id,nativePlanJob.id);checks+=4;
 assert(!oldView.zone_reports.some(r=>r.rows?.some(row=>row.fields.some(f=>f.value==='New run only'))));checks++;
 assert.equal((await call('crm_splav_zone_page_rerun_enqueue',[nativePlanJob.id,id(1000),'Compare reading plan'])).id,rerun.id);checks++;
 await owner();
 const retainedAfter=(await db.query(`select to_jsonb(j) job,to_jsonb(c) coordinator,
 (select jsonb_agg(to_jsonb(r) order by r.id) from crm_private.zone_coordinator_steps x join crm_private.zone_requests r on r.id=x.request_id where x.coordinator_id=c.id) receipts
 from crm_private.splav_jobs j join crm_private.zone_coordinators c on c.id=j.coordinator_id where j.id=$1`,[nativePlanJob.id])).rows[0];
 assert.deepEqual(retainedAfter,retainedRun);checks++;
 assert.deepEqual((await db.query('select to_jsonb(c) value from public.candidates c where id=$1',[id(10)])).rows[0].value,candidateRerunBefore);checks++;
 assert.deepEqual((await db.query("select to_jsonb(d)-'ai_extracted' value,ai_extracted-'_military_zone_report' ocr from public.documents d where id=$1",[id(94)])).rows[0],documentRerunBefore);checks++;
 assert.equal((await db.query('select zone_canary_coordinator from crm_private.splav_settings')).rows[0].zone_canary_coordinator,null);checks++;
 await db.exec('update crm_private.splav_settings set zones_enabled=true');await actor(1);
 await assert.rejects(call('crm_splav_zone_page_rerun_enqueue',[nativePlanJob.id,id(1003),'Global queue on']),/global zones off/);checks++;
 await owner();await db.exec('update crm_private.splav_settings set zones_enabled=false');
 for(const signature of ['crm_private.worker_crm_zone_coordinator_resume(uuid,text,boolean,uuid)','crm_private.worker_crm_zone_run_begin(uuid,jsonb,text,integer,jsonb,text,uuid)']){
  assert.equal((await db.query("select has_function_privilege('authenticated',$1,'EXECUTE') allowed",[signature])).rows[0].allowed,false);checks++;
 }
 await db.query("update public.documents set ai_processed_at='2026-10-25T00:00:00Z' where id=$1",[id(94)]);await actor(1);
 assert.equal((await call('crm_splav_job_status',[rerun.id])).zone_reports.length,0);checks++;
 await assert.rejects(call('crm_splav_zone_page_rerun_enqueue',[nativePlanJob.id,id(1002),'Changed source']),/source changed/);checks++;
 // Atomic root-to-zone continuation: real migration, no network or AI.
 await owner();await db.exec(file('supabase/migrations/20261027180109_splav_atomic_zone_continuation.sql'));
 await db.exec(`update crm_private.splav_settings set enabled=true,zones_enabled=true,zone_canary_coordinator=null;
 insert into public.documents(id,candidate_id,storage_path,version_group_id,version_number,document_type,requirement_id,ai_extracted,verification_status,processing_status,ai_processed_at,mime_type,file_size)
 values('${id(200)}','${id(10)}','continuation.pdf','${id(200)}',1,'Автобіографія друкована','${id(30)}','{}','Не перевірено','AI оброблено','2026-10-27','application/pdf',100);
 insert into crm_private.splav_jobs(id,document_id,candidate_id,initiated_by,original_source,current_source,state,stage,leased_by,lease_token,lease_until)
 select '${id(201)}',id,candidate_id,'${id(1)}',crm_private.splav_source(d),crm_private.splav_source(d),'running','ocr_saved','${id(2)}','${id(202)}',now()+interval '10 minutes' from public.documents d where id='${id(200)}';`);
 const continuation={state:'needs_review',auto_filled:0,conflict_count:1,zone_eligible:true};
 const handoff=(digest=hash,pages=1,outcome=continuation,token=id(202))=>call('crm_splav_continue_zone',[id(201),token,outcome,digest,pages]);
 const unchanged=(await db.query("select ai_extracted,ai_processed_at,verification_status from public.documents where id=$1",[id(200)])).rows[0];
 await actor(1);await assert.rejects(handoff(),/Invalid or expired/);checks++;
 await actor(2);await assert.rejects(handoff(hash,1,continuation,id(999)),/Invalid or expired/);checks++;
 for(const pages of [0,5,null]){await assert.rejects(handoff(hash,pages),/Invalid continuation/);checks++;}
 await assert.rejects(handoff('bad'),/Invalid continuation/);checks++;
 await assert.rejects(handoff(hash,1,{state:'needs_review',zone_eligible:false}),/Eligible saved OCR/);checks++;
 await owner();await db.exec('update crm_private.splav_settings set zones_enabled=false');await actor(2);await assert.rejects(handoff(),/disabled/);checks++;
 await owner();await db.exec('update crm_private.splav_settings set zones_enabled=true');
 // A failure at parent finish rolls back the newly created child and coordinator.
 await db.exec(`create function crm_private.test_reject_parent_finish() returns trigger language plpgsql as $$begin if new.id='${id(201)}' and new.stage='finished' then raise exception 'synthetic parent failure';end if;return new;end$$;
 create trigger test_parent_failure before update on crm_private.splav_jobs for each row execute function crm_private.test_reject_parent_finish();`);
 await actor(2);await assert.rejects(handoff(),/synthetic parent failure/);checks++;
 await owner();assert.equal((await db.query('select count(*)::int n from crm_private.zone_coordinators where document_id=$1',[id(200)])).rows[0].n,0);checks++;
 await db.exec('drop trigger test_parent_failure on crm_private.splav_jobs');await actor(2);
 const continued=await handoff();assert.equal(continued.state,'queued');assert.equal(continued.budget,13);checks+=2;
 await owner();const parent=(await db.query('select state,stage,result,lease_token from crm_private.splav_jobs where id=$1',[id(201)])).rows[0];
 assert.equal(parent.stage,'finished');assert.equal(parent.lease_token,null);assert.equal(parent.result.continuation.job_id,continued.job_id);checks+=3;
 assert.deepEqual((await db.query("select ai_extracted,ai_processed_at,verification_status from public.documents where id=$1",[id(200)])).rows[0],unchanged);checks++;
 const child=(await db.query('select initiated_by,kind,state from crm_private.splav_jobs where id=$1',[continued.job_id])).rows[0];assert.equal(child.initiated_by,id(1));assert.equal(child.kind,'zone');assert.equal(child.state,'queued');checks+=3;
 await actor(2);await assert.rejects(handoff(),/Invalid or expired/);checks++;
 await owner();assert.equal((await db.query("select count(*)::int n from crm_private.splav_jobs where document_id=$1 and kind='zone'",[id(200)])).rows[0].n,1);checks++;
 assert.equal((await db.query("select has_function_privilege('anon','public.crm_splav_continue_zone(uuid,uuid,jsonb,text,integer)','EXECUTE') allowed")).rows[0].allowed,false);checks++;
 // Re-open only a synthetic parent to exercise existing-history preservation.
 await db.query("update crm_private.splav_jobs set state='running',stage='ocr_saved',leased_by=$2,lease_token=$3,lease_until=now()+interval '10 minutes' where id=$1",[id(201),id(2),id(202)]);
 const childCount=(await db.query("select count(*)::int n from crm_private.splav_jobs where kind='zone' and document_id=$1",[id(200)])).rows[0].n;
 await actor(2);const skipped=await handoff();assert.equal(skipped.reason,'existing_zone_history');checks++;
 await owner();assert.equal((await db.query("select count(*)::int n from crm_private.splav_jobs where kind='zone' and document_id=$1",[id(200)])).rows[0].n,childCount);checks++;
 // Finalize a continued child only after a fresh, case-bound comparison.
 await owner();await db.exec(file('supabase/migrations/20261028040337_splav_post_zone_crosscheck.sql'));
 await db.query("update crm_private.splav_jobs set result=jsonb_set(result,'{continuation}', $2::jsonb) where id=$1",[id(201),JSON.stringify(continued)]);
 await db.query("update crm_private.splav_jobs set state='running',leased_by=$2,lease_token=$3,lease_until=now()+interval '10 minutes' where id=$1",[continued.job_id,id(2),id(203)]);
 const finalStep=(op,data={})=>call('crm_splav_zone_step',[continued.job_id,id(203),op,data]);
 await actor(2);const loaded=await finalStep('load');assert.equal(loaded.crosscheck_binding.parent_job_id,id(201));checks++;
 const comparison={contract:'splav-post-zone-1',binding:loaded.crosscheck_binding,status:'needs_review',checked:1,issues:[{key:'birth_place',status:'conflict',source_ids:[id(200)]}]};
 await assert.rejects(finalStep('final'),/crosscheck required/);checks++;
 await owner();await db.query("update crm_private.zone_coordinators set snapshot=jsonb_set(snapshot,'{tasks}','[]') where id=(select coordinator_id from crm_private.splav_jobs where id=$1)",[continued.job_id]);
 await actor(2);await assert.rejects(finalStep('final',{crosscheck:{...comparison,binding:{...comparison.binding,documents_revision:'stale'}}}),/crosscheck required/);checks++;
 await owner();await db.query("update public.candidates set profile_data=profile_data||jsonb_build_object('manual_new','preserve') where id=$1",[id(10)]);
 await actor(2);await assert.rejects(finalStep('final',{crosscheck:comparison}),/crosscheck required/);checks++;
 const refreshed=await finalStep('load');comparison.binding=refreshed.crosscheck_binding;
 await assert.rejects(finalStep('final',{crosscheck:{...comparison,status:'matched'}}),/crosscheck required/);checks++;
 await assert.rejects(finalStep('final',{crosscheck:{...comparison,issues:[{key:'test',status:'conflict',source_ids:[id(999999)]}]}}),/Foreign crosscheck source/);checks++;
 await owner();await db.query("update public.documents set notes='synthetic concurrent edit' where id=$1",[id(200)]);await actor(2);
 await assert.rejects(finalStep('final',{crosscheck:comparison}),/crosscheck required/);checks++;comparison.binding=(await finalStep('load')).crosscheck_binding;
 const final=await finalStep('final',{crosscheck:comparison});assert.equal(final.status,'complete_with_gaps');checks++;
 await owner();const parentFinal=(await db.query('select result from crm_private.splav_jobs where id=$1',[id(201)])).rows[0].result;
 assert.equal(parentFinal.continuation.state,'needs_review');assert.equal(parentFinal.continuation.crosscheck.issues[0].key,'birth_place');checks+=2;
 assert.equal((await db.query('select state from crm_private.splav_jobs where id=$1',[continued.job_id])).rows[0].state,'needs_review');checks++;
 assert.equal((await db.query("select profile_data->>'manual_new' value from public.candidates where id=$1",[id(10)])).rows[0].value,'preserve');checks++;
 assert.equal((await db.query("select has_function_privilege('authenticated','crm_private.splav_case_fingerprint(uuid)','EXECUTE') allowed")).rows[0].allowed,false);checks++;
 // New explicit upload consent never backfills or extends the old root queue.
 await owner();const queueBeforeConsent=(await db.query('select id,state,result from crm_private.splav_jobs order by id')).rows;
 await db.exec(file('supabase/migrations/20261030035134_splav_authorized_upload_continuation.sql'));
 assert.deepEqual((await db.query('select id,state,result from crm_private.splav_jobs order by id')).rows,queueBeforeConsent);checks++;
 await db.exec(`insert into public.documents(id,candidate_id,storage_path,version_group_id,version_number,document_type,requirement_id,ai_extracted,verification_status,processing_status,mime_type,file_size)
 values('${id(700)}','${id(10)}','consent-old.pdf','${id(700)}',1,'Автобіографія друкована','${id(30)}','{}','Не перевірено','AI очікує','application/pdf',100),
 ('${id(701)}','${id(10)}','consent-new.pdf','${id(701)}',1,'Автобіографія друкована','${id(30)}','{}','Не перевірено','AI очікує','application/pdf',100);`);
 const sourceBefore=(await db.query('select to_jsonb(d) data from public.documents d where id in ($1,$2) order by id',[id(700),id(701)])).rows;
 for(const who of [2,3]){await actor(who);await assert.rejects(call('crm_splav_enqueue_autopilot',[id(701)]),/Human delegation/);checks++;}
 await db.exec("reset role;set role anon;set request.jwt.claim.sub=''");await assert.rejects(call('crm_splav_enqueue_autopilot',[id(701)]),/permission denied/);checks++;
 await actor(1);const legacy=await call('crm_splav_enqueue',[id(700)]);
 const notUpgraded=await call('crm_splav_enqueue_autopilot',[id(700)]);assert.equal(notUpgraded.id,legacy.id);assert.equal(notUpgraded.zone_authorized,false);checks+=2;
 await owner();assert.equal((await db.query('select result from crm_private.splav_jobs where id=$1',[legacy.id])).rows[0].result,null);checks++;
 await db.exec('update crm_private.splav_settings set zones_enabled=false');await actor(1);
 await assert.rejects(call('crm_splav_enqueue_autopilot',[id(701)]),/DISABLED/);checks++;
 await owner();await db.exec('update crm_private.splav_settings set zones_enabled=true');await actor(1);
 const authorized=await call('crm_splav_enqueue_autopilot',[id(701)]);assert.equal(authorized.zone_authorized,true);checks++;
 await owner();const consentJob=(await db.query('select * from crm_private.splav_jobs where id=$1',[authorized.id])).rows[0];
 const consent=consentJob.result.zone_authorization;
 assert.equal(consent.actor_id,id(1));assert.equal(consent.job_id,authorized.id);assert.equal(consent.document_id,id(701));assert.equal(consent.max_pages,1);assert.equal(consent.budget,13);checks+=5;
 assert.equal(Date.parse(consent.expires_at)-Date.parse(consent.granted_at),86400000);checks++;
 assert.equal((await db.query("select count(*)::int n from crm_private.splav_events where job_id=$1 and operation='zone_continuation_authorized'",[authorized.id])).rows[0].n,1);checks++;
 await actor(1);assert.equal((await call('crm_splav_enqueue_autopilot',[id(701)])).id,authorized.id);checks++;
 await owner();assert.deepEqual((await db.query('select result from crm_private.splav_jobs where id=$1',[authorized.id])).rows[0].result,consentJob.result);checks++;
 assert.equal((await db.query('select count(*)::int n from crm_private.splav_jobs where document_id=$1',[id(701)])).rows[0].n,1);checks++;
 assert.deepEqual((await db.query('select to_jsonb(d) data from public.documents d where id in ($1,$2) order by id',[id(700),id(701)])).rows,sourceBefore);checks++;
 await db.query("update crm_private.splav_jobs set state='running',leased_by=$2,lease_token=$3,lease_until=now()+interval '10 minutes' where id=$1",[authorized.id,id(2),id(702)]);
 await actor(2);assert.deepEqual((await call('crm_splav_validate',[authorized.id,id(702)])).zone_authorization,consent);checks++;
 await assert.rejects(call('crm_splav_validate',[authorized.id,id(999)]),/Invalid or expired/);checks++;
 await owner();await db.query("update crm_private.splav_jobs set result=jsonb_set(result,'{zone_authorization,source_key}','\"wrong\"') where id=$1",[authorized.id]);await actor(2);
 assert.equal((await call('crm_splav_validate',[authorized.id,id(702)])).zone_authorization,null);checks++;
 await owner();await db.query('update crm_private.splav_jobs set result=$2 where id=$1',[authorized.id,consentJob.result]);
 await db.query('update public.crm_staff set active=false where user_id=$1',[id(1)]);await actor(2);
 await assert.rejects(call('crm_splav_validate',[authorized.id,id(702)]),/Delegation revoked/);checks++;
 await owner();assert.equal((await db.query("select has_function_privilege('anon','public.crm_splav_enqueue_autopilot(uuid)','EXECUTE') allowed")).rows[0].allowed,false);checks++;
 console.log('PASS:',checks,'delegated zonal worker SQL checks; no live AI.');
}finally{await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
