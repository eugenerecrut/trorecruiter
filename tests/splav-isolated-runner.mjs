import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createIsolatedStorageReader,createIsolatedStepDispatcher,runIsolatedStep} from '../supabase/functions/_shared/splav-isolated-runner.mjs';

const id=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
const bytes=new TextEncoder().encode('synthetic fixture');
const now=1_800_000_000_000;
const scope={rootId:id(1),jobId:id(2),documentId:id(3),executorId:id(4),sha256:createHash('sha256').update(bytes).digest('hex')};
function fixture(overrides={}){
 const calls=[];
 const options={scope,now:()=>now,
  authorizeSource:async()=>{calls.push('authorize');return {deadline:new Date(now+1000).toISOString(),path:'test/source.pdf'};},
  readSource:async path=>{assert.equal(path,'test/source.pdf');calls.push('source');return bytes;},
  claim:async s=>{assert.equal(s.jobId,scope.jobId);calls.push('claim');return id(5);},
  check:async s=>{assert.equal(s.lease,id(5));calls.push('check');return new Date(now+1000).toISOString();},
  execute:async ({signal,bytes:input})=>{assert(!signal.aborted);assert.deepEqual(input,bytes);calls.push('execute');return {state:'finished'};},...overrides};
 return {options,calls};
}
test('only the exact file and lease reach the isolated executor',async()=>{
 const {options,calls}=fixture();
 assert.deepEqual(await runIsolatedStep(options),{state:'finished'});
 assert.deepEqual(calls,['authorize','claim','check','source','check','execute']);
});
test('revoked or expired permission prevents even the source read',async()=>{
 for(const cutoff of [null,{deadline:new Date(now).toISOString(),path:'test/source.pdf'},
  {deadline:new Date(now+1000).toISOString(),path:'../unrelated.pdf'}]){
  const {options,calls}=fixture({authorizeSource:async()=>cutoff});
  assert.deepEqual(await runIsolatedStep(options),{state:'denied'});
  assert.deepEqual(calls,[]);
 }
});
test('Storage reader uses fixed private bucket and rejects unsafe paths without a request',async()=>{
 let count=0;
 const reader=createIsolatedStorageReader({projectURL:'https://example.supabase.co',publicKey:'public',processorJWT:'test',
  fetchImpl:async(url,options)=>{count++;assert.equal(url,'https://example.supabase.co/storage/v1/object/authenticated/candidate-documents/test/synthetic.pdf');
   assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer test');
   return new Response('%PDF-synthetic',{headers:{'content-length':'14'}});}});
 const signal=new AbortController().signal;
 for(const path of ['../outside.pdf','test/%2e%2e/outside.pdf','https://outside.example/test.pdf'])
  assert.equal(await reader(path,signal),null);
 assert.equal(new TextDecoder().decode(await reader('test/synthetic.pdf',signal)),'%PDF-synthetic');
 assert.equal(count,1);
});
test('dispatcher uses only the exact lease on the fixed root and zone endpoints',async()=>{
 const calls=[];
 const dispatch=createIsolatedStepDispatcher({projectURL:'https://example.supabase.co',publicKey:'public',processorJWT:'test',
  fetchImpl:async(url,o)=>{calls.push([url,JSON.parse(o.body)]);assert.equal(o.redirect,'error');return new Response(null,{status:202});}});
 const signal=new AbortController().signal,lease=id(5);
 assert.deepEqual(await dispatch({scope,lease,signal}),{state:'responded',status:202});
 assert.deepEqual(await dispatch({scope:{...scope,jobId:scope.rootId},lease,signal}),{state:'responded',status:202});
 assert.deepEqual(await dispatch({scope,lease:'invalid',signal}),{state:'denied'});
 assert.deepEqual(await dispatch({scope,lease,signal:AbortSignal.abort()}),{state:'denied'});
 assert.deepEqual(calls,[
  ['https://example.supabase.co/functions/v1/splav-zone-worker',{job_id:scope.jobId,lease_token:lease}],
  ['https://example.supabase.co/functions/v1/process-id-document',{job_id:scope.rootId,lease_token:lease,document_id:scope.documentId}]
 ]);
});
test('wrong source never executes; missing or expired lease never reads',async()=>{
 for(const extra of [{readSource:async()=>null},{readSource:async()=>new Uint8Array([1])},
  {claim:async()=>null},{check:async()=>null},{check:async()=>new Date(now).toISOString()}]){
  const {options,calls}=fixture(extra);
  assert.deepEqual(await runIsolatedStep(options),{state:'denied'});
  assert(!calls.includes('execute'));
  if(extra.claim||extra.check)assert(!calls.includes('source'));
 }
});
