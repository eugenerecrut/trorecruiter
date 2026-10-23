const {test}=require('node:test'),assert=require('node:assert/strict');
const email='splav-worker@trorecruiter.invalid';
async function setup(options={}){
 const {createHandler,OWNER_ID}=await import('../supabase/functions/crm-user-admin/user-admin-core.mjs');
 const calls=[];const users=options.existing?[options.existing]:[];
 const admin={auth:{getUser:async()=>({data:{user:{id:options.foreign?'other':OWNER_ID}}}),admin:{
  listUsers:async()=>({data:{users}}),createUser:async body=>{calls.push(body);const user={id:'worker',...body};users.push(user);return {data:{user}};}
 }},from:()=>({select:()=>({eq:()=>({single:async()=>({data:options.badRole?{role:'recruiter',active:true}:{role:'processor',active:false}})})})})};
 const handler=createHandler(()=>admin,()=> 'test');
 return {calls,invoke:async()=>{const response=await handler(new Request('https://test',{method:'POST',headers:{Authorization:'Bearer test'},body:JSON.stringify({action:'provision_splav'})}));return {response,data:await response.json()};}};
}
test('only owner can provision; processor/recruiter cannot reach Auth Admin operations',async()=>{const s=await setup({foreign:true});assert.equal((await s.invoke()).response.status,403);assert.equal(s.calls.length,0);});
test('provision creates a banned processor with a server-generated password and exposes no credential',async()=>{
 const s=await setup(),r=await s.invoke();assert.equal(r.response.status,200);assert.deepEqual(r.data.worker,{id:'worker',display_name:'СПЛАВ',role:'processor',active:false,ready:false});
 assert.equal(s.calls[0].app_metadata.crm_account_type,'splav_processor');assert.equal(s.calls[0].ban_duration,'876000h');assert.equal(s.calls[0].password.length,96);assert(!JSON.stringify(r.data).includes(s.calls[0].password));
 const again=await s.invoke();assert.equal(again.response.status,200);assert.equal(s.calls.length,1);
});
test('existing human login is never converted or changed',async()=>{const s=await setup({existing:{id:'human',email,app_metadata:{}}});assert.equal((await s.invoke()).response.status,409);assert.equal(s.calls.length,0);});
test('unexpected role or activation fails closed without trying to repair access',async()=>{const s=await setup({badRole:true});assert.equal((await s.invoke()).response.status,409);assert.equal(s.calls.length,1);});
