// Isolated PostgreSQL only. No Supabase connection or real candidate data.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {PGlite}=require(process.env.CRM_TEST_PGLITE||'./sql-runtime/node_modules/@electric-sql/pglite');
const root=path.join(__dirname,'..'),migration=fs.readdirSync(path.join(root,'supabase/migrations')).find(name=>name.endsWith('_retained_archive_write_guard.sql'));
const user='00000000-0000-0000-0000-000000000001',other='00000000-0000-0000-0000-000000000002',a='00000000-0000-0000-0000-000000000003',b='00000000-0000-0000-0000-000000000004',doc='00000000-0000-0000-0000-000000000005';
(async()=>{const db=new PGlite();let checks=0;try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema crm_private;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
 grant usage on schema auth,crm_private to authenticated,service_role;grant execute on all functions in schema auth to authenticated,service_role;
 create table public.crm_staff(user_id uuid primary key,active boolean,role text);
 create table public.candidates(id uuid primary key,full_name text,profile_data jsonb,recruitment_status text,updated_at timestamptz,owner_id uuid);
 create table public.documents(id uuid primary key,candidate_id uuid references public.candidates(id) on delete cascade,data text,verification_status text);
 create table public.personal_files(candidate_id uuid primary key references public.candidates(id) on delete cascade,data text);
 alter table public.candidates enable row level security;alter table public.documents enable row level security;alter table public.personal_files enable row level security;
 create policy candidate on public.candidates for all to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
 create policy document on public.documents for all to authenticated using(exists(select 1 from public.candidates c where c.id=candidate_id)) with check(exists(select 1 from public.candidates c where c.id=candidate_id));
 create policy personal on public.personal_files for all to authenticated using(exists(select 1 from public.candidates c where c.id=candidate_id)) with check(exists(select 1 from public.candidates c where c.id=candidate_id));
 grant select,insert,update,delete on public.candidates,public.documents,public.personal_files to authenticated,service_role;grant select on public.crm_staff to authenticated,service_role;
 insert into public.crm_staff values('${user}',true,'recruiter');
 insert into public.candidates values('${a}','Тестова справа','{"manual":"keep","workflow":{"stage":"В роботі"}}','В роботі','2026-01-01','${user}'),('${b}','Інша справа','{}','Новий','2026-01-01','${user}');
 insert into public.documents values('${doc}','${a}','original','Не перевірено');insert into public.personal_files values('${a}','manual personal data');`);
 const snapshot=async()=>JSON.stringify((await db.query("select (select jsonb_agg(to_jsonb(c) order by id) from public.candidates c) c,(select jsonb_agg(to_jsonb(d) order by id) from public.documents d) d,(select jsonb_agg(to_jsonb(p) order by candidate_id) from public.personal_files p) p")).rows);
 const before=await snapshot(),sql=fs.readFileSync(path.join(root,'supabase/migrations',migration),'utf8');await db.exec(sql);assert.equal(await snapshot(),before);checks++;
 await db.exec(`create trigger crm_archive_candidate_lock before update or delete on public.candidates for each row execute function crm_private.guard_archive_operation();
 create trigger crm_archive_document_lock before insert or update or delete on public.documents for each row execute function crm_private.guard_archive_operation();
 create trigger crm_archive_personal_lock before insert or update or delete on public.personal_files for each row execute function crm_private.guard_archive_operation();
 create function public.test_definer_write() returns void language sql security definer set search_path='' as $$update public.documents set data='definer' where id='${doc}'$$;
 revoke all on function public.test_definer_write() from public;grant execute on function public.test_definer_write() to authenticated;`);
 const role=async(name,id=user)=>db.exec(`reset role;set request.jwt.claim.role='${name}';set request.jwt.claim.sub='${id}';set role ${name};`);
 await role('authenticated');await db.query('update public.documents set data=$1 where id=$2',['active edit',doc]);checks++;
 const ctx={};ctx.window=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(root,'crm-workflow.js'),'utf8'),ctx);
 let candidate=(await db.query('select * from public.candidates where id=$1',[a])).rows[0];
 const archive=ctx.CRMWorkflow.completionPatch(candidate,{outcome:'Відмова кандидата',completion_date:'2026-01-01',reason:'Тест'},[],[],'2026-01-02');
 const archivedProfile={...candidate.profile_data,workflow:{...candidate.profile_data.workflow,...archive,archived_by:user,changed_by:user}};
 await db.query('update public.candidates set profile_data=$1::jsonb,recruitment_status=$2 where id=$3',[JSON.stringify(archivedProfile),archive.outcome,a]);checks++;
 const archivedSnapshot=await snapshot();
 for(const statement of [
  `update public.candidates set full_name='changed' where id='${a}'`,`delete from public.candidates where id='${a}'`,
  `update public.documents set verification_status='Підтверджено' where id='${doc}'`,`delete from public.documents where id='${doc}'`,
  `insert into public.documents values('00000000-0000-0000-0000-000000000009','${a}','new',null)`,
  `update public.documents set candidate_id='${b}' where id='${doc}'`,
  `update public.personal_files set data='changed' where candidate_id='${a}'`,`delete from public.personal_files where candidate_id='${a}'`,
  `insert into public.personal_files values('${a}','new')`,`select public.test_definer_write()`
 ]){await assert.rejects(db.exec(statement),/архів/i);checks++;}
 assert.equal(await snapshot(),archivedSnapshot);checks++;
 await role('service_role');for(const statement of [`update public.documents set data='worker' where id='${doc}'`,`delete from public.candidates where id='${a}'`]){await assert.rejects(db.exec(statement),/архів/i);checks++;}
 // Both source and target are checked when moving a document.
 await db.query('insert into public.documents values($1,$2,$3,null)',['00000000-0000-0000-0000-000000000010',b,'active']);
 await assert.rejects(db.query('update public.documents set candidate_id=$1 where candidate_id=$2',[a,b]),/архів/i);checks++;
 await role('authenticated');candidate=(await db.query('select * from public.candidates where id=$1',[a])).rows[0];
 const restore=ctx.CRMWorkflow.restorePatch(candidate,'2026-01-03'),restored={...candidate.profile_data,workflow:{...candidate.profile_data.workflow,...restore,changed_by:user,restored_by:user}};
 const restoreRow=profile=>db.query('update public.candidates set profile_data=$1::jsonb,recruitment_status=$2 where id=$3',[JSON.stringify(profile),'В роботі',a]);
 await assert.rejects(restoreRow({...restored,manual:'overwritten'}),/Архівна/i);checks++;
 await assert.rejects(restoreRow({...restored,workflow:{...restored.workflow,restored_by:other}}),/Архівна/i);checks++;
 await assert.rejects(restoreRow({...restored,workflow:{...restored.workflow,archive_previous_stage:'ВЛК'}}),/Архівна/i);checks++;
 await assert.rejects(restoreRow({...restored,workflow:{...restored.workflow,stage:'ВЛК'}}),/Архівна/i);checks++;
 await assert.rejects(db.query('update public.candidates set full_name=$1,profile_data=$2::jsonb,recruitment_status=$3 where id=$4',['overwrite',JSON.stringify(restored),'В роботі',a]),/Архівна/i);checks++;
 await db.exec(`reset role;set request.jwt.claim.role='';update public.crm_staff set active=false where user_id='${user}'`);
 await role('authenticated');await assert.rejects(restoreRow(restored),/Архівна/i);checks++;
 await db.exec(`reset role;set request.jwt.claim.role='';update public.crm_staff set active=true where user_id='${user}'`);
 await role('authenticated',other);assert.equal((await restoreRow(restored)).affectedRows,0);checks++;
 await role('authenticated');await restoreRow(restored);checks++;
 const after=(await db.query('select * from public.candidates where id=$1',[a])).rows[0];assert.equal(after.profile_data.manual,'keep');assert.equal(after.profile_data.workflow.archived_at,null);assert.equal(after.profile_data.workflow.last_archive.reason,'Тест');checks+=3;
 await db.exec(`update public.documents set verification_status='Підтверджено' where id='${doc}'`);checks++;
 // Preserve the legacy cleanup lock for ordinary users and its server access.
 await role('service_role');await db.exec(`update public.candidates set profile_data=jsonb_set(profile_data,'{workflow,archive_lock}','"legacy"') where id='${a}'`);
 await role('authenticated');await assert.rejects(db.exec(`update public.documents set data='blocked' where id='${doc}'`),/Зміни заблоковано/);checks++;
 await role('service_role');await db.exec(`update public.documents set data='legacy server' where id='${doc}'`);checks++;
 assert(sql.includes('order by c.id for no key update'));assert(sql.includes('security invoker'));assert(sql.includes("set search_path=''")&&!sql.includes('security definer'));checks+=3;
 console.log('PASS: '+checks+' retained archive SQL checks; no real database connection.');
}finally{await db.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
