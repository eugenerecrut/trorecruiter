import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';

test('migration policy accepts only a current root or its recorded continuation',async()=>{
 const require=createRequire(new URL('./sql-runtime/package.json',import.meta.url));
 const path=process.env.SPLAV_PGLITE_MODULE;
 const {PGlite}=path?await import(pathToFileURL(path).href):require('@electric-sql/pglite');
 const db=new PGlite();
 const id=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0'),hash='a'.repeat(64);
 try{
  await db.exec(`create role anon;create role authenticated;create schema crm_private;
   create table crm_private.splav_jobs(id uuid primary key,kind text,document_id uuid,state text,stage text,
    original_source jsonb,current_source jsonb,result jsonb,
    leased_by uuid,lease_token uuid,lease_until timestamptz,attempts int default 0,updated_at timestamptz);`);
  await db.exec(await readFile(new URL('../supabase/migrations/20261112050343_splav_isolated_permit.sql',import.meta.url),'utf8'));
  const source=JSON.stringify({storage_path:'synthetic.pdf',revision:'original'});
  for(const [job,kind,doc] of [[1,'root',9],[2,'zone',9],[3,'zone',9],[4,'root',8]]){
   await db.query("insert into crm_private.splav_jobs(id,kind,document_id,state,stage,original_source,current_source) values($1,$2,$3,'queued','waiting',$4,$4)",[id(job),kind,id(doc),source]);
  }
  await db.query("insert into crm_private.splav_isolated_permits(root_job_id,document_id,file_sha256,root_source,expires_at,executor_id) values($1,$2,$3,$4,now()+interval '5 minutes',$5)",[id(1),id(9),hash,source,id(7)]);
  const allowed=async(job,h=hash)=>(await db.query('select crm_private.splav_isolated_deadline($1,$2,$3,$4) is not null as allowed',[id(1),id(job),id(9),h])).rows[0].allowed;
  assert.equal(await allowed(1),true);
  assert.equal(await allowed(1,'b'.repeat(64)),false);
  assert.equal(await allowed(2),false);
  const claim=async(job,executor=7)=>(await db.query('select crm_private.splav_isolated_claim($1,$2,$3,$4,$5) as token',[id(1),id(job),id(9),hash,id(executor)])).rows[0].token;
  assert.equal(await claim(1,8),null);
  assert.equal(await claim(4),null);
  assert.match(await claim(1),/^[a-f0-9-]{36}$/);
  assert.equal(await claim(1),null);
  await db.query("update crm_private.splav_jobs set stage='finished',state='completed',result=$2 where id=$1",[id(1),JSON.stringify({continuation:{job_id:id(2)}})]);
  assert.equal(await allowed(1),false);
  assert.equal(await allowed(2),true);
  assert.equal(await allowed(3),false);
  assert.equal(await allowed(4),false);
  await db.query('update crm_private.splav_jobs set current_source=$2 where id=$1',[id(2),JSON.stringify({storage_path:'replacement.pdf'})]);
  assert.equal(await allowed(2),false);
  await db.query('update crm_private.splav_jobs set current_source=$2 where id=$1',[id(2),source]);
  assert.equal(await claim(3),null);
  const token=await claim(2);
  assert.match(token,/^[a-f0-9-]{36}$/);
  const step=async(executor=7,key=token,h=hash)=>(await db.query(
   'select crm_private.splav_isolated_step_deadline($1,$2,$3,$4,$5,$6) is not null as allowed',
   [id(1),id(2),id(9),h,id(executor),key])).rows[0].allowed;
  assert.equal(await step(),true);
  assert.equal(await step(8),false);
  assert.equal(await step(7,id(99)),false);
  assert.equal(await step(7,token,'b'.repeat(64)),false);
  assert.deepEqual((await db.query(`select j.attempts,j.lease_until<=p.expires_at as bounded
   from crm_private.splav_jobs j cross join crm_private.splav_isolated_permits p
   where j.state='running'`)).rows,[{attempts:1,bounded:true}]);
  await db.exec('update crm_private.splav_isolated_permits set closed_at=now()');
  assert.equal(await allowed(2),false);
  assert.equal(await step(),false);
  await db.exec("update crm_private.splav_isolated_permits set closed_at=null,created_at=now()-interval '2 minutes',expires_at=now()-interval '1 minute'");
  assert.equal(await allowed(2),false);
  assert.equal(await step(),false);
  assert.equal((await db.query("select has_function_privilege('authenticated','crm_private.splav_isolated_deadline(uuid,uuid,uuid,text)','execute') as allowed")).rows[0].allowed,false);
  assert.equal((await db.query("select has_function_privilege('authenticated','crm_private.splav_isolated_claim(uuid,uuid,uuid,text,uuid)','execute') as allowed")).rows[0].allowed,false);
  assert.equal((await db.query("select has_function_privilege('authenticated','crm_private.splav_isolated_step_deadline(uuid,uuid,uuid,text,uuid,uuid)','execute') as allowed")).rows[0].allowed,false);
 }finally{await db.close();}
});

// Prototype only. No connection to Supabase and no change to production RPCs.
test('isolated SPLAV lease rejects other jobs, wrong versions and expired permits',async()=>{
 const require=createRequire(new URL('./sql-runtime/package.json',import.meta.url));
 const path=process.env.SPLAV_PGLITE_MODULE;
 const {PGlite}=path?await import(pathToFileURL(path).href):require('@electric-sql/pglite');
 const db=new PGlite();
 try{
  await db.exec(`
   create table jobs(id int primary key, document_id int, sha text, parent_id int, continuation_id int,
    state text default 'queued', attempts int default 0, lease_until timestamptz);
   create table permit(root_id int, document_id int, sha text, expires_at timestamptz, closed boolean default false);
   insert into jobs(id,document_id,sha,parent_id,continuation_id) values
    (1,901,repeat('a',64),null,null),(2,900,repeat('b',64),null,4),
    (3,900,repeat('b',64),2,null),(4,900,repeat('b',64),2,null);
   insert into permit values(2,900,repeat('b',64),now()+interval '5 minutes',false);
   insert into jobs(id,document_id,sha) values(5,902,repeat('b',64));
  `);
  const claim=async id=>(await db.query(`
   update jobs j set state='running',attempts=j.attempts+1,lease_until=least(p.expires_at,clock_timestamp()+interval '10 minutes')
   from permit p join jobs root on root.id=p.root_id
   where j.id=$1 and j.state='queued' and not p.closed and p.expires_at>clock_timestamp()
    and root.document_id=p.document_id and root.sha=p.sha and j.document_id=p.document_id and j.sha=p.sha
    and ((j.id=root.id and j.parent_id is null)
     or (root.state='finished' and j.id=root.continuation_id and j.parent_id=root.id))
   returning j.id,j.lease_until<=p.expires_at as bounded`,[id])).rows;
  for(const id of [1,3,4,5])assert.deepEqual(await claim(id),[]);
  await db.exec("update jobs set sha=repeat('c',64) where id=2");
  assert.deepEqual(await claim(2),[]);
  await db.exec("update jobs set sha=repeat('b',64) where id=2");
  assert.deepEqual(await claim(2),[{id:2,bounded:true}]);
  assert.deepEqual(await claim(2),[]);
  await db.exec("update jobs set state='finished' where id=2");
  assert.deepEqual(await claim(3),[]);
  assert.deepEqual(await claim(4),[{id:4,bounded:true}]);
  await db.exec("update jobs set state='queued' where id=4; update permit set expires_at=now()-interval '1 second'");
  assert.deepEqual(await claim(4),[]);
  await db.exec("update permit set closed=true,expires_at=now()+interval '1 minute'");
  assert.deepEqual(await claim(4),[]);
  assert.deepEqual((await db.query('select id,attempts from jobs order by id')).rows,
   [{id:1,attempts:0},{id:2,attempts:1},{id:3,attempts:0},{id:4,attempts:1},{id:5,attempts:0}]);
 }finally{await db.close();}
});
