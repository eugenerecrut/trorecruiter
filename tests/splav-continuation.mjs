import {AUTO_ZONE_ROLLOUT_APPROVED,CONTROLLED_ZONE_RUN,continuationRolloutPolicy} from '../supabase/functions/_shared/splav-continuation-rollout.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {finishQueueWithContinuation,continuationPDFMetadata} from '../supabase/functions/_shared/splav-continuation.mjs';
const outcome={state:'needs_review',zone_eligible:true},queue={job_id:'root',lease_token:'lease'},digest='a'.repeat(64);
function fixture(extra={}){const calls=[];let reads=0;return {calls,get reads(){return reads},args:{queue,outcome,enabled:true,metadata:async()=>{reads++;return {digest,pages:2}},client:{rpc:async(name,args)=>{calls.push({name,args});return {data:name==='crm_splav_continue_zone'?{state:'queued',job_id:'child',budget:26}:null}}},...extra}};}
test('disabled flag, completed result and blocked owner never read a file or enqueue',async()=>{for(const extra of [{enabled:false},{outcome:{state:'completed',zone_eligible:true}},{outcome:{state:'needs_review',zone_eligible:false}}]){const f=fixture(extra);await finishQueueWithContinuation(f.args);assert.equal(f.reads,0);assert.equal(f.calls[0].name,'crm_splav_finish');}});
test('eligible root uses one atomic handoff with original human lease, not separate finish',async()=>{const f=fixture();const r=await finishQueueWithContinuation(f.args);assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'crm_splav_continue_zone');assert.equal(f.calls[0].args.token,'lease');assert.equal(f.calls[0].args.p_pages,2);assert.equal(r.continuation.job_id,'child');});
test('transport failure leaves saved OCR for recovery and never falls through to finish',async()=>{const calls=[];await assert.rejects(finishQueueWithContinuation({...fixture().args,client:{rpc:async name=>{calls.push(name);throw Error('transport')}}}),/transport/);assert.deepEqual(calls,['crm_splav_continue_zone']);});
test('unsupported source or page limit records review without partial delegation',async()=>{for(const source of [null,{digest,pages:5},{digest:'wrong',pages:1}]){const f=fixture({metadata:async()=>source});const r=await finishQueueWithContinuation(f.args);assert.equal(f.calls[0].name,'crm_splav_finish');assert.equal(r.continuation.reason,'unsupported_source_or_page_limit');}});
test('metadata fetch failure does not silently finish or restart OCR',async()=>{const f=fixture({metadata:async()=>{throw Error('download failed')}});await assert.rejects(finishQueueWithContinuation(f.args),/download failed/);assert.equal(f.calls.length,0);});
test('unacknowledged handoff cannot be reported as queued',async()=>{await assert.rejects(finishQueueWithContinuation({...fixture().args,client:{rpc:async()=>({data:null})}}),/not acknowledged/);});
test('metadata rejects foreign Storage destination before fetching',async()=>{let fetched=false;await assert.rejects(continuationPDFMetadata({client:{storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:'https://foreign.invalid/file'}})})}},document:{storage_path:'source.pdf'},backend:'https://test.supabase.co',fetchImpl:async()=>{fetched=true}}),/Unexpected/);assert.equal(fetched,false);});

test('metadata reads bounded original, counts every page and destroys parser without AI',async()=>{
 let destroyed=0,loads=0;const original=new TextEncoder().encode('%PDF-synthetic');
 const client={storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:'https://test.supabase.co/storage/v1/object/sign/candidate-documents/source.pdf?token=synthetic'}})})}};
 const run=extra=>continuationPDFMetadata({client,document:{storage_path:'source.pdf',...extra},backend:'https://test.supabase.co',fetchImpl:async()=>new Response(original),getLibrary:async()=>({loadDocument:async bytes=>{loads++;assert.deepEqual(bytes,original);return{getPageCount:()=>4,destroy:()=>destroyed++}}})});
 const r=await run();assert.equal(r.pages,4);assert.match(r.digest,/^[a-f0-9]{64}$/);assert.equal(destroyed,1);
 await assert.rejects(run({file_hash:'b'.repeat(64)}),/original changed/);assert.equal(loads,1);
});

test('staged production package cannot activate automatically',()=>assert.equal(AUTO_ZONE_ROLLOUT_APPROVED,false));

const controlJob='11111111-1111-4111-8111-111111111111',controlDoc='22222222-2222-4222-8222-222222222222';
const scope={jobId:controlJob,documentId:controlDoc,notBefore:'2026-10-29T10:00:00Z',expiresAt:'2026-10-29T11:00:00Z'};
const controlArgs={jobId:controlJob,documentId:controlDoc,control:scope,now:Date.parse('2026-10-29T10:30:00Z')};
test('baseline cannot start a control and global env alone cannot enable rollout',()=>{
 assert.equal(CONTROLLED_ZONE_RUN,null);
 assert.equal(continuationRolloutPolicy({jobId:controlJob,documentId:controlDoc,globalEnabled:true}).enabled,false);
});
test('deployment scope allows exactly one root/document pair with one-page budget',()=>{
 assert.deepEqual(continuationRolloutPolicy(controlArgs),{enabled:true,maxPages:1});
 for(const extra of [{jobId:controlDoc},{documentId:controlJob},{jobId:undefined},{jobId:'root'},{control:null}])assert.equal(continuationRolloutPolicy({...controlArgs,...extra}).enabled,false);
});
test('expired, premature, malformed or unbounded control windows remain off',()=>{
 for(const extra of [{now:Date.parse(scope.expiresAt)},{now:Date.parse(scope.notBefore)-1},{now:NaN},{control:{...scope,expiresAt:'wrong'}},{control:{...scope,expiresAt:'2026-11-01T00:00:00Z'}},{control:{...scope,expiresAt:scope.notBefore}}])assert.equal(continuationRolloutPolicy({...controlArgs,...extra}).enabled,false);
});

const authorization={contract:'splav-zone-authorization-1',job_id:controlJob,document_id:controlDoc,max_pages:1,budget:13,granted_at:scope.notBefore,expires_at:scope.expiresAt};
test('only exact bounded human delegation opts a new root into automatic continuation',()=>{
 const args={jobId:controlJob,documentId:controlDoc,authorization,now:controlArgs.now};
 assert.deepEqual(continuationRolloutPolicy(args),{enabled:true,maxPages:1});
 for(const patch of [{contract:'other'},{job_id:controlDoc},{document_id:controlJob},{max_pages:4},{budget:52},{budget:'13'},{granted_at:'wrong'},{expires_at:'2026-11-01T00:00:00Z'}])assert.equal(continuationRolloutPolicy({...args,authorization:{...authorization,...patch}}).enabled,false);
 for(const now of [Date.parse(scope.notBefore)-1,Date.parse(scope.expiresAt),NaN])assert.equal(continuationRolloutPolicy({...args,now}).enabled,false);
 assert.equal(continuationRolloutPolicy({...args,authorization:undefined,globalEnabled:true}).enabled,false);
});
