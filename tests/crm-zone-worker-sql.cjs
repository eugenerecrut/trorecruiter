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
 console.log('PASS:',checks,'delegated zonal worker SQL checks; no live AI.');
}finally{await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
