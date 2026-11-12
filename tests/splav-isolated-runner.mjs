import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {runIsolatedStep} from '../supabase/functions/_shared/splav-isolated-runner.mjs';

const id=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
const bytes=new TextEncoder().encode('synthetic fixture');
const now=1_800_000_000_000;
const scope={rootId:id(1),jobId:id(2),documentId:id(3),executorId:id(4),sha256:createHash('sha256').update(bytes).digest('hex')};
function fixture(overrides={}){
 const calls=[];
 const options={scope,now:()=>now,
  authorizeSource:async()=>{calls.push('authorize');return new Date(now+1000).toISOString();},
  readSource:async s=>{assert.equal(s.documentId,scope.documentId);calls.push('source');return bytes;},
  claim:async s=>{assert.equal(s.jobId,scope.jobId);calls.push('claim');return id(5);},
  check:async s=>{assert.equal(s.lease,id(5));calls.push('check');return new Date(now+1000).toISOString();},
  execute:async ({signal,bytes:input})=>{assert(!signal.aborted);assert.deepEqual(input,bytes);calls.push('execute');return {state:'finished'};},...overrides};
 return {options,calls};
}
test('only the exact file and lease reach the isolated executor',async()=>{
 const {options,calls}=fixture();
 assert.deepEqual(await runIsolatedStep(options),{state:'finished'});
 assert.deepEqual(calls,['authorize','source','claim','check','execute']);
});
test('revoked or expired permission prevents even the source read',async()=>{
 for(const cutoff of [null,new Date(now).toISOString()]){
  const {options,calls}=fixture({authorizeSource:async()=>cutoff});
  assert.deepEqual(await runIsolatedStep(options),{state:'denied'});
  assert.deepEqual(calls,[]);
 }
});
test('wrong source never claims work; missing or expired lease never executes',async()=>{
 for(const extra of [{readSource:async()=>null},{readSource:async()=>new Uint8Array([1])},
  {claim:async()=>null},{check:async()=>null},{check:async()=>new Date(now).toISOString()}]){
  const {options,calls}=fixture(extra);
  assert.deepEqual(await runIsolatedStep(options),{state:'denied'});
  assert(!calls.includes('execute'));
  if(extra.readSource)assert(!calls.includes('claim'));
 }
});
