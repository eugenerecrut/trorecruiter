const {test}=require('node:test'),assert=require('node:assert/strict');
async function setup(options={}){
 const {createWorkerHandler}=await import('../supabase/functions/splav-worker/worker-core.mjs');
 const secret='a'.repeat(96),calls=[],tasks=[],logs=[];
 const job={id:'job',document_id:'doc',lease_token:'lease'};
 const createClient=(_url,key)=>{
  const isService=key==='service-test';
  return {rpc:async(name)=>{calls.push({key,name});if(isService){assert.equal(name,'crm_splav_worker_bootstrap');return {data:{dispatch_secret:secret,enabled:!options.disabled,has_work:!options.idle,email:'worker@test.invalid',password:'server-only'}};}assert.ok(['crm_splav_claim','crm_splav_zone_claim'].includes(name));return {data:name==='crm_splav_zone_claim'?(options.zone?{...job,kind:'zone'}:null):options.busy||options.zone?null:job};},
   auth:{signInWithPassword:async args=>{calls.push({login:true,key});assert.equal(key,'public-test');assert.equal(args.password,'server-only');return {data:{session:{access_token:'processor-jwt'}}};},signOut:async()=>{calls.push({logout:true});}}};
 };
 const handler=createWorkerHandler({createClient,env:name=>({SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'service-test',SUPABASE_ANON_KEY:'public-test'})[name],
  waitUntil:task=>tasks.push(task),log:event=>logs.push(event),fetchImpl:async(url,request)=>{calls.push({url,request});if(options.transport)throw Error('ambiguous');return Response.json({sensitive:'not logged'});}});
 return {calls,tasks,logs,invoke:async(headers={'x-splav-dispatch':secret})=>{const response=await handler(new Request('https://test',{method:'POST',headers,body:'{}'}));return {response,data:await response.json()};}};
}
test('worker rejects missing/wrong dispatch before any Auth login or provider operation',async()=>{
 const s=await setup();assert.equal((await s.invoke({})).response.status,403);assert.equal(s.calls.length,0);
 assert.equal((await s.invoke({'x-splav-dispatch':'b'.repeat(96)})).response.status,403);assert.equal(s.calls.length,1);
});
test('disabled/empty queue does not sign in or invoke processing',async()=>{for(const option of [{disabled:true},{idle:true}]){const s=await setup(option);assert.equal((await s.invoke()).data.state,'idle');assert.equal(s.calls.length,1);}});
test('claim is authenticated by processor; service role never reads or mutates candidate data',async()=>{
 const s=await setup(),r=await s.invoke();assert.equal(r.response.status,202);await Promise.all(s.tasks);
 const request=s.calls.find(x=>x.url)?.request;assert.equal(request.headers.Authorization,'Bearer processor-jwt');assert.equal(request.headers.apikey,'public-test');assert.deepEqual(JSON.parse(request.body),{document_id:'doc',job_id:'job',lease_token:'lease'});
 assert.equal(s.calls.filter(x=>x.key==='service-test').length,1);assert(!JSON.stringify(s.logs).includes('sensitive'));assert(!JSON.stringify(r.data).includes('lease'));
});
test('ambiguous transport does not retry paid processing or revoke a potentially running session',async()=>{const s=await setup({transport:true});assert.equal((await s.invoke()).response.status,202);await Promise.all(s.tasks);assert.equal(s.calls.filter(x=>x.url).length,1);assert(!s.calls.some(x=>x.logout));assert.equal(s.logs[0].event,'job_transport_uncertain');});
test('overlapping dispatcher without a lease performs no processing call',async()=>{const s=await setup({busy:true});assert.equal((await s.invoke()).data.state,'busy_or_idle');assert(!s.calls.some(x=>x.url));});

 test('dispatcher routes a delegated zone to its bounded worker',async()=>{const s=await setup({zone:true});assert.equal((await s.invoke()).response.status,202);await Promise.all(s.tasks);const call=s.calls.find(x=>x.url);assert(call.url.endsWith('/splav-zone-worker'));assert.deepEqual(JSON.parse(call.request.body),{job_id:'job',lease_token:'lease'});});
