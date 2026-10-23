import test from 'node:test';import assert from 'node:assert/strict';
import planner from '../military-autopilot.js';
import {createZoneWorker} from '../supabase/functions/splav-zone-worker/core.mjs';
const id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',token='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',doc='cccccccc-cccc-cccc-cccc-cccccccccccc';
const bytes=new TextEncoder().encode('%PDF-synthetic');
async function fixture(options={}){
 const hash=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
 const context={id:doc,version:0,source:{document_id:doc,file_sha256:options.hashMismatch?'0'.repeat(64):hash,revision:'r1'},document:{id:doc,storage_path:'source.pdf'},reports:[]};
 context.snapshot=planner.create(1,{source:context.source,budget:options.budget??2600}).snapshot();
 const calls=[],ai=[],rpc=[];let failed=false;
 const client={rpc:async(name,payload)=>{assert.equal(name,'crm_splav_zone_step');assert.equal(payload.p_job,id);assert.equal(payload.p_token,token);rpc.push(payload.p_operation);
  const op=payload.p_operation;
  if(options.denied)return {error:{message:'denied'}};
  if(op==='load')return {data:structuredClone(context)};
  if(op==='save'){
   if(options.checkpointLoss&&!failed&&payload.p_data.snapshot.completed===1){failed=true;return {error:{message:'synthetic lost write'}};}
   if(context.in_flight_response?.state==='dispatched'&&payload.p_data.snapshot.completed>context.snapshot.completed)return {error:{message:'receipt incomplete'}};
   context.snapshot=structuredClone(payload.p_data.snapshot);return {data:++context.version};
  }
  return {data:{}};
 },storage:{from:bucket=>{assert.equal(bucket,'candidate-documents');return {createSignedUrl:async path=>{calls.push(path);return {data:{signedUrl:options.foreign?'https://foreign.invalid/secret':'https://test.supabase.co/storage/v1/object/sign/candidate-documents/source.pdf?token=synthetic'}};}};}}};
 const dependencies={planner,env:key=>({SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'public'})[key],createClient:(_url,key,opts)=>{assert.equal(key,'public');assert.equal(opts.global.headers.Authorization,'Bearer processor');return client;},
 getLibrary:async()=>({loadDocument:async()=>({getPageCount:()=>options.pages??1,destroy(){},getPage:()=>({getOriginalSize:()=>({originalWidth:1800,originalHeight:100}),close(){},render:async({width,height})=>({width,height,data:new Uint8Array(width*height)})})})}),
 fetchImpl:async(url,init)=>{
  if(url.includes('/storage/'))return new Response(bytes,{headers:{'content-length':String(bytes.length)}});
  assert.equal(url,'https://test.supabase.co/functions/v1/ai-military-zone');
  const body=JSON.parse(init.body);assert.equal(body.job_id,id);assert.equal(body.lease_token,token);assert.equal(body.coordinator_version,context.version);ai.push(body.mode);
  context.in_flight_response={state:'dispatched'};
  if(options.transport)throw Error('accepted but transport lost');
  const result={review_only:true,mode:body.mode,zones:body.mode==='overview'?[{box:{x:.1,y:.1,w:.4,h:.2},label:'row'}]:undefined,rows:body.mode==='zone'?[{fields:[{value:'synthetic',legibility:'clear'}]}]:undefined};
  context.in_flight_response={state:'completed',result};return Response.json(result);
 }};
 const invoke=()=>createZoneWorker(dependencies)(new Request('https://test/worker',{method:'POST',headers:{Authorization:'Bearer processor'},body:JSON.stringify({job_id:id,lease_token:token})}));
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
