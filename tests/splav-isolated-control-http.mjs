import test from 'node:test';
import assert from 'node:assert/strict';
import {createIsolatedControlHandler} from '../supabase/functions/splav-isolated-control/handler.mjs';

const key='a'.repeat(64);
const config={SPLAV_ISOLATED_DISPATCH:key,SPLAV_ISOLATED_ROOT:'root',SPLAV_ISOLATED_DOCUMENT:'document',
 SPLAV_ISOLATED_EXECUTOR:'executor',SPLAV_ISOLATED_SHA256:'hash',SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'test'};
const request=(supplied=key,body)=>new Request('https://test.example/control',{
 method:'POST',headers:{'x-splav-isolated-dispatch':supplied},body
});
test('denied and unconfigured requests never touch the database',async()=>{
 const h=createIsolatedControlHandler({env:k=>config[k],withQuery:async()=>assert.fail('Unexpected query')});
 assert.equal((await h(request('b'.repeat(64)))).status,403);
 assert.equal((await h(request(key,'{"rootId":"other"}'))).status,400);
 const absent=createIsolatedControlHandler({env:k=>k==='SPLAV_ISOLATED_ROOT'?undefined:config[k],withQuery:async()=>assert.fail('Unexpected query')});
 assert.equal((await absent(request())).status,503);
});
test('dispatch scope comes only from server configuration',async()=>{
 let calls=0;
 const h=createIsolatedControlHandler({env:k=>config[k],withQuery:run=>run(()=>{}),
  advance:async opts=>{calls++;assert.deepEqual(opts.scope,{rootId:'root',documentId:'document',executorId:'executor',sha256:'hash'});return {state:'running'};}});
 const r=await h(request());assert.equal(r.status,200);assert.deepEqual(await r.json(),{state:'running'});assert.equal(calls,1);
});
