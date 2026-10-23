const {test}=require('node:test'),assert=require('node:assert/strict');
const email='splav-worker@trorecruiter.invalid';
async function setup(options={}){
 const {createHandler,OWNER_ID}=await import('../supabase/functions/crm-user-admin/user-admin-core.mjs');
 const calls=[],ops=[];const users=options.existing?[options.existing]:[];let active=!!options.active;
 const admin={auth:{getUser:async()=>({data:{user:{id:options.foreign?'other':OWNER_ID}}}),admin:{
  listUsers:async()=>({data:{users}}),createUser:async body=>{calls.push(body);const user={id:'worker',...body};users.push(user);return {data:{user}};},
  updateUserById:async(id,patch)=>{ops.push({update:id,patch});return {data:{user:{id}}};}
 }},rpc:async(name,args)=>{ops.push({name,args});if(name==='crm_splav_worker_bootstrap')return {data:{email,password:'server-only'}};if(name==='crm_splav_configure_worker'){if(options.configureError)return {error:{message:'test SQL failure'}};active=true;}if(name==='crm_splav_disable_worker')active=false;return {data:{id:'worker',created:true,active,enabled:active,running:0}};},from:()=>({select:()=>({eq:()=>({single:async()=>({data:options.badRole?{role:'recruiter',active:true}:{role:'processor',active:false}})})})})};
 const processor={auth:{signInWithPassword:async()=>({data:{user:{id:'worker'}}}),signOut:async()=>{}},rpc:async()=>({error:{code:'42501'}}),functions:{invoke:async()=>({error:{context:{status:options.probeNetworkFailure?500:403}}})},storage:{from:()=>({list:async()=>({data:[],error:null})})},from:()=>{const q={select:()=>q,eq:()=>q,single:async()=>({data:{role:'processor',active:true}}),then:(a,b)=>Promise.resolve({count:0,error:null}).then(a,b)};return q;}};
 const handler=createHandler((_url,key)=>key==='service-test'?admin:processor,name=>({SUPABASE_SERVICE_ROLE_KEY:'service-test',SUPABASE_ANON_KEY:'public-test',SUPABASE_URL:'https://test.supabase.co'})[name]);
 return {calls,ops,invoke:async(action='provision_splav')=>{const response=await handler(new Request('https://test',{method:'POST',headers:{Authorization:'Bearer test'},body:JSON.stringify({action})}));return {response,data:await response.json()};}};
}
test('only owner can provision; processor/recruiter cannot reach Auth Admin operations',async()=>{const s=await setup({foreign:true});assert.equal((await s.invoke()).response.status,403);assert.equal(s.calls.length,0);});
test('provision creates a banned processor with a server-generated password and exposes no credential',async()=>{
 const s=await setup(),r=await s.invoke();assert.equal(r.response.status,200);assert.deepEqual(r.data.worker,{id:'worker',display_name:'СПЛАВ',role:'processor',active:false,ready:false});
 assert.equal(s.calls[0].app_metadata.crm_account_type,'splav_processor');assert.equal(s.calls[0].ban_duration,'876000h');assert.equal(s.calls[0].password.length,64);assert(!JSON.stringify(r.data).includes(s.calls[0].password));
 const again=await s.invoke();assert.equal(again.response.status,200);assert.equal(s.calls.length,1);
});
test('existing human login is never converted or changed',async()=>{const s=await setup({existing:{id:'human',email,app_metadata:{}}});assert.equal((await s.invoke()).response.status,409);assert.equal(s.calls.length,0);});
test('unexpected role or activation fails closed without trying to repair access',async()=>{const s=await setup({badRole:true});assert.equal((await s.invoke()).response.status,409);assert.equal(s.calls.length,1);});

const worker={id:'worker',email,app_metadata:{crm_account_type:'splav_processor'}};
test('activation creates secrets only on server, configures narrowly scoped worker and returns no secret',async()=>{const s=await setup({existing:worker});const r=await s.invoke('activate_splav');assert.equal(r.response.status,200);assert.equal(r.data.worker.enabled,true);const configured=s.ops.find(x=>x.name==='crm_splav_configure_worker');assert.equal(configured.args.worker_password.length,64);assert.equal(configured.args.dispatch_key.length,96);assert(!JSON.stringify(r.data).includes(configured.args.worker_password));assert(!JSON.stringify(r.data).includes(configured.args.dispatch_key));});
test('activation failure disables access and bans account instead of leaving partial activation',async()=>{const s=await setup({existing:worker,configureError:true});assert.equal((await s.invoke('activate_splav')).response.status,503);assert(s.ops.some(x=>x.name==='crm_splav_disable_worker'));assert.equal(s.ops.at(-1).patch.ban_duration,'876000h');});
test('repeated activation is idempotent and does not rotate an active credential',async()=>{const s=await setup({existing:worker,active:true});assert.equal((await s.invoke('activate_splav')).response.status,200);assert(!s.ops.some(x=>x.update||x.name==='crm_splav_configure_worker'));});
test('non-owner cannot inspect, activate or disable processor through admin API',async()=>{for(const action of ['status_splav','activate_splav','disable_splav','probe_splav']){const s=await setup({foreign:true,existing:worker});assert.equal((await s.invoke(action)).response.status,403);assert.equal(s.ops.length,0);}});

test('owner can verify real processor login and denied capabilities without receiving credentials',async()=>{const s=await setup({existing:worker});const r=await s.invoke('probe_splav');assert.equal(r.response.status,200);assert.equal(r.data.probe.idle_isolation,true);assert.equal(r.data.probe.admin_denied,true);assert(!JSON.stringify(r.data).includes('server-only'));});
test('a network or server error is not misreported as a permission denial',async()=>{const s=await setup({existing:worker,probeNetworkFailure:true});assert.equal((await s.invoke('probe_splav')).response.status,409);});
