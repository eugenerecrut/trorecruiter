import test from 'node:test';import assert from 'node:assert/strict';
import planner from '../military-autopilot.js';
import {createZoneWorker} from '../supabase/functions/splav-zone-worker/core.mjs';
const id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',token='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',doc='cccccccc-cccc-cccc-cccc-cccccccccccc';
const bytes=new TextEncoder().encode('%PDF-synthetic');
async function fixture(options={}){
 const hash=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
 const context={id:doc,version:0,native_only:options.nativeOnly===true,source:{document_id:doc,file_sha256:options.hashMismatch?'0'.repeat(64):hash,revision:'r1'},document:{id:doc,storage_path:'source.pdf'},reports:[]};
 context.snapshot=planner.create(1,{source:context.source,budget:options.budget??2600}).snapshot();
 const calls=[],ai=[],rpc=[];let failed=false;
 const client={rpc:async(name,payload)=>{assert.equal(name,'crm_splav_zone_step');assert.equal(payload.p_job,id);assert.equal(payload.p_token,token);rpc.push(payload.p_operation);
  const op=payload.p_operation;
  if(options.denied)return {error:{message:'denied'}};
  if(op==='final')return {data:options.finalResult===undefined?{status:'complete'}:options.finalResult};
  if(op==='load')return {data:structuredClone(context)};
  if(op==='begin'){
   if(options.nativeUncertain){context.in_flight_response={state:'dispatched'};return {data:{state:'dispatched'}};}
   if(options.nativeCached)return {data:{state:'completed',result:options.nativeCached}};
   context.in_flight_response={state:'dispatched'};return {data:{state:'accepted',id:doc,receipt:token}};
  }
  if(op==='finish'){assert.equal(payload.p_data.result.ai_requests,0);context.in_flight_response={state:'completed',result:structuredClone(payload.p_data.result)};return {data:{state:'completed'}};}
  if(op==='save'){
   if(options.checkpointLoss&&!failed&&payload.p_data.snapshot.completed===1){failed=true;return {error:{message:'synthetic lost write'}};}
   if(context.in_flight_response?.state==='dispatched'&&payload.p_data.snapshot.completed>context.snapshot.completed)return {error:{message:'receipt incomplete'}};
   context.snapshot=structuredClone(payload.p_data.snapshot);return {data:++context.version};
  }
  return {data:{}};
 },storage:{from:bucket=>{assert.equal(bucket,'candidate-documents');return {createSignedUrl:async path=>{calls.push(path);return {data:{signedUrl:options.foreign?'https://foreign.invalid/secret':'https://test.supabase.co/storage/v1/object/sign/candidate-documents/source.pdf?token=synthetic'}};}};}}};
 const heap=new Float32Array(32),put=values=>heap.set(values,4),module={HEAPF32:heap,wasmExports:{malloc:()=>16,free(){}},_FPDFPage_GetRotation:()=>0,_FPDFPage_GetAnnotCount:()=>0,
  _FPDFPage_GetMediaBox:()=>{put([0,0,1800,100]);return 1;},_FPDFPage_GetCropBox:()=>{put([0,0,1800,100]);return 1;},_FPDFPageObj_GetBounds:i=>{put([100,80-i*15,500,90-i*15]);return 1;}};
 const native=options.native?{module,pageIdx:1,getObjectCount:()=>options.graphics?4:3,getObject:i=>({type:options.graphics&&i===3?'path':'text',objectIdx:i,getText:()=> 'Synthetic native paragraph containing enough characters.'})}:{};
 const dependencies={planner,env:key=>({SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'public'})[key],createClient:(_url,key,opts)=>{assert.equal(key,'public');assert.equal(opts.global.headers.Authorization,'Bearer processor');return client;},
 getLibrary:async()=>({loadDocument:async()=>({getPageCount:()=>options.pages??1,destroy(){},getPage:()=>({...native,getOriginalSize:()=>({originalWidth:1800,originalHeight:100}),close(){},render:async({width,height})=>({width,height,data:new Uint8Array(width*height)})})})}),
 fetchImpl:async(url,init)=>{
  if(url.includes('/storage/'))return new Response(bytes,{headers:{'content-length':String(bytes.length)}});
  assert.equal(url,'https://test.supabase.co/functions/v1/ai-military-zone');
  const body=JSON.parse(init.body);assert.equal(body.job_id,id);assert.equal(body.lease_token,token);assert.equal(body.coordinator_version,context.version);ai.push(body.mode);
  context.in_flight_response={state:'dispatched'};
  if(options.transport)throw Error('accepted but transport lost');
  const result={review_only:true,mode:body.mode,zones:body.mode==='overview'?[{box:{x:.1,y:.1,w:.4,h:.2},label:'row'}]:undefined,rows:body.mode==='zone'?[{fields:[{value:'synthetic',legibility:'clear'}]}]:undefined};
  context.in_flight_response={state:'completed',result};return Response.json(result);
 }};
 const invoke=(extra={})=>createZoneWorker(dependencies)(new Request('https://test/worker',{method:'POST',headers:{Authorization:'Bearer processor'},body:JSON.stringify({job_id:id,lease_token:token,...extra})}));
 return {invoke,context,ai,rpc,calls};
}
test('invalid/denied lease makes no source or AI request',async()=>{
 const f=await fixture({denied:true});assert.equal((await f.invoke()).status,403);assert.deepEqual(f.calls,[]);assert.deepEqual(f.ai,[]);
});
test('one leased invocation executes one new AI step and restores next step using same planner',async()=>{
 const f=await fixture();assert.equal((await f.invoke()).status,200);assert.deepEqual(f.ai,['overview']);assert.equal(f.rpc.at(-1),'yield');
 f.context.in_flight_response=null;assert.equal((await f.invoke()).status,200);assert.deepEqual(f.ai,['overview','zone']);assert.equal(f.rpc.at(-1),'final');
});
test('lost checkpoint restores durable result without a second overview',async()=>{
 const f=await fixture({checkpointLoss:true});assert.equal((await f.invoke()).status,503);assert.deepEqual(f.ai,['overview']);
 assert.equal((await f.invoke()).status,200);assert.deepEqual(f.ai,['overview','zone']);assert.equal(f.rpc.at(-1),'final');
});
test('unknown dispatched result blocks a second AI request after cold restart',async()=>{
 const f=await fixture({transport:true});assert.equal((await f.invoke()).status,503);assert.deepEqual(f.ai,['overview']);
 assert.equal((await f.invoke()).status,200);assert.deepEqual(f.ai,['overview']);assert.equal(f.rpc.at(-1),'block');
});
test('changed digest, page count or foreign signed URL never reaches AI',async()=>{
 for(const options of [{hashMismatch:true},{pages:2},{foreign:true}]){const f=await fixture(options);await f.invoke();assert.deepEqual(f.ai,[]);}
});

 test('canary budget stops after one new step before reading proposed zones',async()=>{const f=await fixture({budget:1});assert.equal((await f.invoke()).status,200);assert.deepEqual(f.ai,['overview']);assert.equal(f.rpc.at(-1),'hold');assert.equal(f.context.snapshot.attempts,1);});

test('native overview uses the same begin/finish ledger with zero AI and preserves one-step budgets',async()=>{
 const f=await fixture({native:true,budget:1});assert.equal((await f.invoke()).status,200);assert.deepEqual(f.ai,[]);assert(f.rpc.includes('begin'));assert(f.rpc.includes('finish'));assert.equal(f.rpc.at(-1),'hold');assert.equal(f.context.snapshot.attempts,1);assert.equal(f.context.in_flight_response.result.source.origin,'server_text_layer');
});
test('native-only mixed page persists graphic review zones without AI or finalization',async()=>{
 const f=await fixture({native:true,graphics:true,nativeOnly:true,budget:1});
 assert.equal((await f.invoke()).status,200);assert.deepEqual(f.ai,[]);
 const result=f.context.in_flight_response.result;
 assert.equal(result.page_type,'native_text_with_graphics');assert.equal(result.zones.filter(z=>z.kind==='other').length,1);
 assert.equal(result.quality_issues.length,1);assert.equal(result.ai_requests,0);
 assert.equal(f.rpc.at(-1),'hold');assert(!f.rpc.includes('final'));assert(!f.rpc.includes('yield'));
});
test('lost native checkpoint restores its saved zones without another AI overview',async()=>{
 const f=await fixture({native:true,checkpointLoss:true});assert.equal((await f.invoke()).status,503);assert.deepEqual(f.ai,[]);assert.equal((await f.invoke()).status,200);assert.deepEqual(f.ai,['zone']);assert.equal(f.rpc.filter(x=>x==='begin').length,1);
});
test('native overview never replaces an existing cached or uncertain receipt',async()=>{
 const cached={review_only:true,mode:'overview',zones:[],source:{provider:'OpenRouter'}};
 const a=await fixture({native:true,nativeCached:cached});assert.equal((await a.invoke()).status,200);assert.deepEqual(a.ai,[]);assert(!a.rpc.includes('finish'));
 const b=await fixture({native:true,nativeUncertain:true});await b.invoke();assert.deepEqual(b.ai,[]);assert(!b.rpc.includes('finish'));assert.equal((await b.invoke()).status,200);assert.equal(b.rpc.at(-1),'block');assert.deepEqual(b.ai,[]);
});

test('persisted native-only control blocks scans and zone tasks without AI or final document writes',async()=>{
 for(const native of [false,true]){const f=await fixture({nativeOnly:true,native,budget:1});assert.equal((await f.invoke({native_only:false})).status,200);assert.deepEqual(f.ai,[]);assert.equal(f.rpc.at(-1),'hold');assert(!f.rpc.includes('final'));assert(!f.rpc.includes('yield'));if(!native)assert.equal(f.context.snapshot.errors[0].code,'NATIVE_VISUAL_REVIEW_REQUIRED');}
 const f=await fixture({nativeOnly:true});f.context.snapshot.tasks=[{mode:'zone',page:1,box:{x:.1,y:.1,w:.2,h:.2}}];await f.invoke();assert.deepEqual(f.ai,[]);assert.deepEqual(f.calls,[]);assert.equal(f.rpc.at(-1),'hold');
});
test('native-only restriction survives checkpoint loss and recovery without a paid zone',async()=>{
 const f=await fixture({native:true,nativeOnly:true,checkpointLoss:true,budget:1});assert.equal((await f.invoke()).status,503);assert.equal((await f.invoke()).status,200);assert.deepEqual(f.ai,[]);assert.equal(f.rpc.at(-1),'hold');assert(!f.rpc.includes('final'));
});

test('final response follows persisted report verdict instead of queue exhaustion',async()=>{
 for(const [saved,state,status] of [[{status:'complete'},'finished','complete'],[{status:'complete_with_gaps'},'needs_review','complete_with_gaps'],[{},'needs_review','unconfirmed'],[null,'needs_review','unconfirmed'],[{status:'unknown'},'needs_review','unconfirmed']]){
  const f=await fixture({finalResult:saved});await f.invoke();f.context.in_flight_response=null;
  const response=await f.invoke();assert.equal(response.status,200);assert.deepEqual(await response.json(),{state,report_status:status});
  assert.equal(f.rpc.filter(op=>op==='final').length,1);assert.equal(f.rpc.at(-1),'final');assert(!f.rpc.includes('retry'));assert.deepEqual(f.ai,['overview','zone']);
 }
});
