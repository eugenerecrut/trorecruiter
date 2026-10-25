const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{stripTypeScriptTypes}=require('node:module');
const source=fs.readFileSync(require('node:path').join(__dirname,'../supabase/functions/archive-candidate/index.ts'),'utf8');
const id='00000000-0000-4000-8000-000000000001';
async function run(options={}){
 let handler;const calls=[];
 const client={auth:{getUser:async()=>options.unauthorized?{error:Error('unauthorized'),data:{}}:{data:{user:{id:'staff'}}}},from(table){calls.push(table);return {select(){return this;},update(){calls.push("error-log");return this;},eq(){return this;},async maybeSingle(){if(table==='crm_staff')return {data:{active:!options.inactive,role:options.processor?'processor':'recruiter'}};if(table==='candidates')return options.candidateError?{error:Error('candidate read failed')}:{data:options.missingCandidate?null:{profile_data:{workflow:options.retained?{archived_at:'2026-01-01',archive_mode:'retained'}:{}}}};if(table==='crm_archive')return {data:options.noRecord?null:{id:'old-archive',state:options.pending?'Очищення':'Готово'}};throw Error('Unexpected table '+table);}};},storage:{from(){calls.push('storage');throw Error('No storage operation is expected');}}};
 const ctx=vm.createContext({Request,Response,console:{error(){}},createClient:()=>client,Deno:{env:{get:k=>({SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-service-key',SUPABASE_ANON_KEY:'test-public-key'})[k]},serve:fn=>handler=fn}});
 vm.runInContext(stripTypeScriptTypes(source.replace(/^import .*;\r?$/gm,'')),ctx);
 const response=await handler(new Request('https://example.invalid/archive',{method:'POST',headers:{Authorization:'Bearer fake-session','Content-Type':'application/json'},body:JSON.stringify({candidate_id:id,confirm_delete_originals:options.confirm!==false})}));return {status:response.status,data:await response.json(),calls};
}
test('retained archive rejects legacy deletion before archive lookup or storage access',async()=>{
 const r=await run({retained:true});assert.equal(r.status,409);assert(r.data.error.includes('збереженими оригіналами'));assert.deepEqual(r.calls,['crm_staff','candidates']);
});
test('completed legacy PDF archives remain readable without a candidate row',async()=>{
 const r=await run({missingCandidate:true});assert.equal(r.status,200);assert.equal(r.data.state,'Готово');assert(!r.calls.includes('storage'));
});
test('candidate lookup failure stops the destructive path',async()=>{const r=await run({candidateError:true});assert.equal(r.status,400);assert.equal(r.data.error,'candidate read failed');assert(!r.calls.includes('storage'));});
test('authentication, staff restrictions and explicit legacy deletion confirmation remain intact',async()=>{
 for(const [options,status] of [[{unauthorized:true},401],[{inactive:true},403],[{processor:true},403],[{confirm:false},400]]){const r=await run(options);assert.equal(r.status,status);assert(!r.calls.includes('candidates'));assert(!r.calls.includes('storage'));}
});

test('new and unfinished legacy requests cannot access storage or delete any record',async()=>{for(const options of [{noRecord:true},{pending:true}]){const r=await run(options);assert.equal(r.status,409);assert(!r.calls.includes('storage'));assert(!r.calls.includes('error-log'));}});
