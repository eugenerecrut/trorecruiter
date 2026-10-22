// Isolated PostgreSQL WASM only. Never connects to a Supabase project.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {PGlite}=require(process.env.CRM_TEST_PGLITE||'./sql-runtime/node_modules/@electric-sql/pglite');
const root=path.join(__dirname,'..'),ids={user:'00000000-0000-0000-0000-000000000001',candidate:'00000000-0000-0000-0000-000000000002',doc:'00000000-0000-0000-0000-000000000003',group:'00000000-0000-0000-0000-000000000004'};
(async()=>{const db=new PGlite();let checks=0;
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
 create table public.crm_staff(user_id uuid,active boolean);
 create table public.candidates(id uuid primary key,updated_at timestamptz,profile_data jsonb,owner_id uuid);
 create table public.documents(id uuid primary key,candidate_id uuid,document_type text,version_group_id uuid,version_number integer,storage_path text,file_hash text,deleted_at timestamptz,processing_status text,ai_extracted jsonb);
 alter table public.candidates enable row level security;alter table public.documents enable row level security;alter table public.crm_staff enable row level security;
 create policy staff on public.crm_staff for select to authenticated using(user_id=auth.uid());
 create policy candidate on public.candidates for all to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
 create policy document on public.documents for all to authenticated using(exists(select 1 from public.candidates c where c.id=candidate_id)) with check(exists(select 1 from public.candidates c where c.id=candidate_id));
 grant select on public.crm_staff to authenticated;grant select,update on public.candidates,public.documents to authenticated;
 insert into public.crm_staff values('${ids.user}',true);
 insert into public.candidates values('${ids.candidate}','2026-10-22','{"service_type":"За мобілізацією","manual":"preserve"}','${ids.user}');
 insert into public.documents values('${ids.doc}','${ids.candidate}','ID','${ids.group}',1,'c/doc.pdf','hash',null,'AI готово','{"phone":"222","relatives":[{"full_name":"Тестова Олена"}]}');`);
 await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261022181656_review_decision_source_snapshot.sql'),'utf8'));
 const ai=async()=>(await db.query('select ai_extracted from public.documents where id=$1',[ids.doc])).rows[0].ai_extracted;
 const decision={target:'candidate',key:'phone',current:'111',incoming:'222',reason:'different',action:'keep_card',reviewed_by:'forged',reviewed_at:'1900-01-01',source_binding:{version:1,context_id:'forged'}};
 const call=async(snapshot,options={})=>db.query('select public.crm_keep_document_value($1,$2,$3::jsonb,$4::timestamptz,$5::jsonb)',[ids.doc,options.candidate||ids.candidate,JSON.stringify(snapshot),options.date||'2026-10-22',JSON.stringify(Object.hasOwn(options,"decision")?options.decision:decision)]);
 const originalCandidate=(await db.query('select * from public.candidates')).rows;
 await db.exec(`set role authenticated;set request.jwt.claim.sub='${ids.user}'`);
 await call(await ai());let first=await ai(),context=first._crm_review_context;
 assert.equal(first._crm_review_decisions[0].reviewed_by,ids.user);assert.notEqual(first._crm_review_decisions[0].reviewed_at,'1900-01-01');assert.notEqual(context.id,'forged');checks+=3;
 assert.equal(first._crm_review_decisions[0].source_binding.context_id,context.id);assert(!('_crm_review_context' in context.source.extraction));assert(!('_crm_review_decisions' in context.source.extraction));checks+=3;
 await call(first,{decision:{...decision,key:'relatives.0.full_name'}});let second=await ai();assert.equal(second._crm_review_decisions.length,2);assert.deepEqual(second._crm_review_context,context);checks+=2;
 await call(second);assert.deepEqual(await ai(),second);checks++;
 // Feed the real server-generated JSON directly into the real CRM matcher.
 const c={};c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(root,'crm-intake.js'),'utf8'),c);
 const doc=(await db.query('select * from public.documents')).rows[0];assert(c.CRMReviewDecision.matches(doc,second._crm_review_decisions[0],decision,{id:ids.candidate}));checks++;
 await assert.rejects(call(first),/Документ змінився/);await assert.rejects(call(second,{date:'2026-10-21'}),/Дані картки змінилися/);checks+=2;
 for(const change of [null,[],{action:'keep_card',target:'candidate',key:'x;drop'}]){await assert.rejects(call(second,{decision:change}),/Некоректне рішення/);checks++;}
 await db.query("update public.documents set ai_extracted=jsonb_set(ai_extracted,'{relatives,0,full_name}','\"Тестова Олена Петрівна\"') where id=$1",[ids.doc]);let changed=await ai();doc.ai_extracted=changed;assert(!c.CRMReviewDecision.matches(doc,second._crm_review_decisions[0],decision,{id:ids.candidate}));checks++;
 await call(changed);const third=await ai();assert.notEqual(third._crm_review_context.id,context.id);assert.equal(third._crm_review_decisions.length,3);assert.equal(third._crm_review_decisions[0].source_binding.context_id,context.id);checks+=3;
 assert.deepEqual((await db.query('select * from public.candidates')).rows,originalCandidate);checks++;
 await db.exec('reset role;update public.crm_staff set active=false;set role authenticated');await assert.rejects(call(third),/Потрібна активна сесія/);checks++;
 await db.exec('reset role;update public.crm_staff set active=true;set role anon');await assert.rejects(call(third),/permission denied/);checks++;
 await db.exec(`reset role;set role authenticated;set request.jwt.claim.sub='00000000-0000-0000-0000-000000000099'`);await assert.rejects(call(third),/Потрібна активна сесія/);checks++;
 await db.exec(`reset role;insert into public.crm_staff values('00000000-0000-0000-0000-000000000099',true);set role authenticated`);await assert.rejects(call(third),/Дані картки змінилися/);checks++;
 await db.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${ids.user}'`);
 for(const profile of [{merged_into:'other'},{workflow:{archived_at:'2026-10-22'}}]){await db.query('update public.candidates set profile_data=$1::jsonb',[JSON.stringify(profile)]);await assert.rejects(call(third),/Об’єднана або архівна/);checks++;}
 await db.query("update public.candidates set profile_data='{}'");
 for(const status of ['AI помилка','AI обробка']){await db.query('update public.documents set processing_status=$1',[status]);await assert.rejects(call(third),/Документ недоступний/);checks++;}
 await db.exec("update public.documents set processing_status='AI готово',deleted_at=now()");await assert.rejects(call(third),/Документ недоступний/);checks++;
 await db.exec(`reset role;update public.documents set deleted_at=null;insert into public.documents(id,candidate_id,version_group_id,version_number) values('00000000-0000-0000-0000-000000000005','${ids.candidate}','${ids.group}',2);set role authenticated`);await assert.rejects(call(third),/новою версією/);checks++;
 console.log('Isolated PostgreSQL review source checks: '+checks+' PASS');
}finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
