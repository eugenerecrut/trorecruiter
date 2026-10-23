const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require(process.env.CRM_TEST_PGLITE||'./sql-runtime/node_modules/@electric-sql/pglite');
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
 await db.exec(file('supabase/migrations/20261023050513_splav_processor_isolation.sql'));
 await db.exec(file('supabase/migrations/20261023051257_splav_durable_jobs.sql'));
 await db.exec(`insert into auth.users(id) values('${id(1)}'),('${id(2)}'),('${id(3)}');
 insert into public.crm_staff values('${id(1)}','Human','recruiter',true),('${id(2)}','СПЛАВ','processor',true),('${id(3)}','Other','recruiter',true);
 insert into public.candidates(id,full_name,profile_data) values('${id(10)}','Candidate','{"service_type":"За мобілізацією","manual":"preserve"}'),('${id(11)}','Other','{}');
 insert into public.documents(id,candidate_id,storage_path,version_group_id,version_number,status,verification_status,document_type,processing_status,ai_extracted)
 values('${id(20)}','${id(10)}','${id(10)}/source.pdf','${id(20)}',1,'Завантажено','Не перевірено','Диплом','AI очікує','{}'),
 ('${id(21)}','${id(10)}','${id(10)}/other.pdf','${id(21)}',1,'Завантажено','Не перевірено','Паспорт','AI оброблено','{}'),
 ('${id(22)}','${id(11)}','${id(11)}/other.pdf','${id(22)}',1,'Завантажено','Не перевірено','Диплом','AI очікує','{}');
 insert into storage.objects values(1,'candidate-documents','${id(10)}/source.pdf'),(2,'candidate-documents','${id(10)}/other.pdf'),(3,'candidate-documents','${id(11)}/other.pdf');`);
 await actor(1);await assert.rejects(call('crm_splav_enqueue',[id(20)]),/SPLAV_QUEUE_DISABLED/);checks++;
 await owner();await db.exec('update crm_private.splav_settings set enabled=true');
 await actor(1);const queued=await call('crm_splav_enqueue',[id(20)]),again=await call('crm_splav_enqueue',[id(20)]);assert.equal(queued.id,again.id);checks++;
 await assert.rejects(call('crm_splav_claim'),/Processor required/);checks++;
 await actor(2);await assert.rejects(call('crm_splav_enqueue',[id(22)]),/Human delegation required/);checks++;
 const job=await call('crm_splav_claim');assert.equal(job.id,queued.id);assert.equal(job.document_id,id(20));checks+=2;
 assert.equal(await call('crm_splav_claim'),null);checks++;
 assert.deepEqual((await db.query('select id from public.candidates')).rows.map(x=>x.id),[id(10)]);checks++;
 assert.equal((await db.query('select id from public.documents')).rows.length,2);checks++;
 assert.deepEqual((await db.query('select id from storage.objects')).rows.map(x=>x.id),[1]);checks++;
 assert.equal((await db.query("update public.candidates set phone='forged' returning id")).rows.length,0);checks++;
 assert.equal((await db.query('delete from public.documents returning id')).rows.length,0);checks++;
 await assert.rejects(db.query('select * from crm_private.splav_jobs'),/permission denied/);checks++;
 await assert.rejects(call('crm_splav_validate',[job.id,id(999)]),/Invalid or expired/);checks++;
 await call('crm_splav_validate',[job.id,job.lease_token]);checks++;
 const receipt=await call('crm_splav_start_provider',[job.id,job.lease_token]);assert(receipt);checks++;
 await assert.rejects(call('crm_splav_start_provider',[job.id,job.lease_token]),/already consumed/);checks++;
 await assert.rejects(call('crm_splav_persist',[job.id,job.lease_token,id(999),{}]),/Provider receipt required/);checks++;
 await assert.rejects(call('crm_splav_release_waiting',[job.id,job.lease_token]),/Provider already dispatched/);checks++;
 assert.equal((await call('crm_splav_validate',[job.id,job.lease_token])).stage,'provider_started');checks++;
 await assert.rejects(call('crm_splav_persist',[job.id,job.lease_token,receipt,{candidate_id:id(11)}]),/field not allowed/);checks++;
 const extraction={full_name:'Candidate',citizenship:'Україна'};
 const persisted=await call('crm_splav_persist',[job.id,job.lease_token,receipt,{ai_extracted:extraction,processing_status:'AI оброблено',verification_status:'Не перевірено'}]);assert.equal(persisted.id,id(20));assert(persisted.ai_processed_at);checks+=2;
 await assert.rejects(call('crm_splav_persist',[job.id,job.lease_token,receipt,{ai_extracted:{}}]),/not authorized/);checks++;
 const selection={target:'profile',key:'citizenship',incoming:'Україна',expected_current:null,expected_ai:extraction,fill_only:true};
 await assert.rejects(call('crm_splav_apply_fields',[job.id,job.lease_token,[{...selection,fill_only:false}]]),/Only protected/);checks++;
 await assert.rejects(call('crm_splav_apply_fields',[job.id,job.lease_token,[{...selection,expected_ai:{}}]]),/OCR source changed/);checks++;
 await call('crm_splav_apply_fields',[job.id,job.lease_token,[selection]]);checks++;
 const candidate=(await db.query('select profile_data from public.candidates')).rows[0].profile_data;
 assert.equal(candidate.citizenship,'Україна');assert.equal(candidate.service_type,'За мобілізацією');assert.equal(candidate.manual,'preserve');checks+=3;
 await assert.rejects(call('crm_splav_apply_fields',[job.id,job.lease_token,[{...selection,key:'service_type',incoming:'За контрактом',expected_current:'За мобілізацією'}]]),/перезаписувати/);checks++;
 // Direct legacy RPC cannot bypass the restrictive UPDATE policy even while reads are leased.
 await assert.rejects(call('crm_apply_document_fields',[id(20),[{...selection,key:'service_type',incoming:'forged',fill_only:false}]]),/permission|row-level security|Документ не знайдено/);checks++;
 await call('crm_splav_mark_review',[job.id,job.lease_token,['Потрібна звірка']]);checks++;
 await call('crm_splav_finish',[job.id,job.lease_token,{state:'needs_review',auto_filled:1}]);checks++;
 assert.equal((await db.query('select id from public.candidates')).rows.length,0);checks++;
 await assert.rejects(call('crm_splav_validate',[job.id,job.lease_token]),/Invalid or expired/);checks++;
 await actor(1);const status=await call('crm_splav_job_status',[job.id]);assert.equal(status.state,'needs_review');assert(!('lease_token' in status));checks+=2;
 const pendingJobs=await call('crm_splav_candidate_jobs',[id(10)]);assert.equal(pendingJobs[0].id,job.id);assert(!JSON.stringify(pendingJobs).includes(job.lease_token));checks+=2;
 await owner();const events=(await db.query('select actor_id,initiated_by from crm_private.splav_events')).rows;assert(events.length>=3);assert(events.every(e=>e.actor_id===id(2)&&e.initiated_by===id(1)));checks+=2;
 // Simulate a lost paid response. The expired job is never sent to the provider again.
 await actor(1);const second=await call('crm_splav_enqueue',[id(22)]);await actor(2);const paid=await call('crm_splav_claim');assert.equal(paid.id,second.id);checks++;
 await call('crm_splav_start_provider',[paid.id,paid.lease_token]);await owner();await db.query("update crm_private.splav_jobs set lease_until=now()-interval '1 second' where id=$1",[paid.id]);await actor(2);
 assert.equal(await call('crm_splav_claim'),null);checks++;
 await owner();assert.equal((await db.query('select state from crm_private.splav_jobs where id=$1',[paid.id])).rows[0].state,'uncertain');checks++;
 // Saved OCR may resume reconciliation without another provider call.
 await actor(1);const resume=await call('crm_splav_enqueue',[id(21)]);await actor(2);const before=await call('crm_splav_claim');assert.equal(before.id,resume.id);
 const recoveryReceipt=await call('crm_splav_start_provider',[before.id,before.lease_token]);await call('crm_splav_persist',[before.id,before.lease_token,recoveryReceipt,{ai_extracted:{},processing_status:'AI оброблено',verification_status:'Не перевірено'}]);
 await owner();await db.query("update crm_private.splav_jobs set lease_until=now()-interval '1 second' where id=$1",[before.id]);await actor(2);const resumed=await call('crm_splav_claim');assert.equal(resumed.id,before.id);assert.equal(resumed.stage,'ocr_saved');assert.notEqual(resumed.lease_token,before.lease_token);checks+=3;
 await assert.rejects(call('crm_splav_start_provider',[resumed.id,resumed.lease_token]),/already consumed/);checks++;
 await owner();await db.query('update public.crm_staff set active=false where user_id=$1',[id(1)]);await actor(2);await assert.rejects(call('crm_splav_validate',[resumed.id,resumed.lease_token]),/Delegation revoked/);assert.equal((await db.query('select id from public.candidates')).rows.length,0);checks+=2;
 const resetCase=async()=>{
  await owner();await db.exec('delete from crm_private.splav_events;delete from crm_private.splav_jobs;delete from public.crm_archive');
  await db.query('delete from public.documents where id=$1',[id(23)]);
  await db.exec('update public.crm_staff set active=true');
  await db.query("update public.candidates set profile_data='{\"service_type\":\"За мобілізацією\"}' where id=$1",[id(10)]);
  await db.query("update public.documents set candidate_id=$1,storage_path=$2,deleted_at=null,verified_at=null,verification_status='Не перевірено',ai_processed_at=null,ai_extracted='{}',processing_status='AI обробка' where id=$3",[id(10),id(10)+'/source.pdf',id(20)]);
  await actor(1);await call('crm_splav_enqueue',[id(20)]);await actor(2);return call('crm_splav_claim');
 };
 for(const change of [
  "update public.documents set deleted_at=now() where id='"+id(20)+"'",
  "update public.documents set candidate_id='"+id(11)+"' where id='"+id(20)+"'",
  "update public.documents set storage_path='changed.pdf' where id='"+id(20)+"'",
  "update public.documents set verification_status='Підтверджено',verified_at=now() where id='"+id(20)+"'",
  "update public.documents set ai_processed_at=now() where id='"+id(20)+"'",
  "update public.candidates set profile_data='{\"merged_into\":\"other\"}' where id='"+id(10)+"'",
  "update public.candidates set profile_data='{\"workflow\":{\"archived_at\":\"2026-10-23\"}}' where id='"+id(10)+"'",
  "update public.candidates set profile_data='{\"workflow\":{\"archive_lock\":\"locked\"}}' where id='"+id(10)+"'",
  "insert into public.crm_archive(candidate_id) values('"+id(10)+"')",
  "insert into public.documents(id,candidate_id,version_group_id,version_number) values('"+id(23)+"','"+id(10)+"','"+id(20)+"',2)",
  "update public.crm_staff set active=false where user_id='"+id(1)+"'",
  "update public.crm_staff set active=false where user_id='"+id(2)+"'",
  "update crm_private.splav_jobs set lease_until=now()-interval '1 second'"
 ]){
  const delegated=await resetCase();await owner();await db.exec(change);await actor(2);
  await assert.rejects(call('crm_splav_validate',[delegated.id,delegated.lease_token]),/Superseded|Inactive|revoked|expired/);checks++;
  assert.equal((await db.query('select id from public.candidates')).rows.length,0);checks++;
 }
 let retry=await resetCase();const retryId=retry.id;
 for(let attempt=1;attempt<=3;attempt++){
  await call('crm_splav_release_waiting',[retry.id,retry.lease_token]);checks++;
  if(attempt<3){const old=retry;retry=await call('crm_splav_claim');assert.equal(retry.id,retryId);assert.notEqual(retry.lease_token,old.lease_token);checks+=2;}
 }
 assert.equal(await call('crm_splav_claim'),null);checks++;
 await actor(1);assert.equal((await call('crm_splav_job_status',[retryId])).state,'needs_review');checks++;
 console.log(`СПЛАВ durable queue: ${checks} PostgreSQL checks passed`);
}finally{await db.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
