import test from 'node:test';
import assert from 'node:assert/strict';
import {createRenderProbe} from '../supabase/functions/splav-render-probe/core.mjs';
const owner = {id: '7c74b122-3940-40a8-a32f-fe2b6776c173', active: true, role: 'admin'};
const request = (extra = {}) => new Request('https://example.test/render', {method: 'POST',
  headers: {'content-type': 'application/pdf', ...extra}, body: '%PDF-synthetic'});
function fixture(actor = owner, options = {}) {
  const calls = {auth: 0, load: 0, close: 0, destroy: 0};
  const handler = createRenderProbe({authorize: async () => {calls.auth++; return actor;}, getLibrary: async () => ({
    loadDocument: async () => {calls.load++; if (options.wait) await options.wait;
      return {getPageCount: () => options.pages ?? 1, destroy: () => {calls.destroy++;},
        getPage: () => ({getOriginalSize: () => ({originalWidth: 595, originalHeight: 842}),
          close: () => {calls.close++;}, render: async ({width, height}) => {
            if (options.fail) throw Error('synthetic failure');
            return {width, height, data: new Uint8Array(width * height)};
          }})};}
  })});
  return {handler, calls};
}
test('anonymous, inactive, non-owner and processor requests cannot load a PDF', async () => {
  for (const actor of [null, {...owner, active: false}, {...owner, id: 'other'}, {...owner, role: 'processor'}]) {
    const {handler, calls} = fixture(actor);
    assert.ok([401, 403].includes((await handler(request())).status));
    assert.equal(calls.load, 0);
  }
});
test('owner gets a bounded PNG and non-sensitive metrics, with cleanup', async () => {
  const {handler, calls} = fixture();
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  const metrics = JSON.parse(response.headers.get('x-splav-render-metrics'));
  assert.equal(metrics.ai_requests, 0);
  assert.equal(metrics.pages, 1);
  assert.equal(metrics.width, 1800);
  assert.equal(calls.close, 1); assert.equal(calls.destroy, 1);
  assert.equal(JSON.stringify(metrics).includes('synthetic'), false);
});
test('invalid inputs and unsupported page counts release the lock', async () => {
  const {handler, calls} = fixture(owner, {pages: 201});
  assert.equal((await handler(request({'x-splav-page': '200'}))).status, 400);
  assert.equal((await handler(request({'content-type': 'text/plain'}))).status, 415);
  assert.equal((await handler(request())).status, 422);
  assert.equal((await handler(request())).status, 422);
  assert.equal(calls.destroy, 2);
  assert.equal(calls.close, 0);
});
test('render failure releases page, document and lock', async () => {
  const {handler, calls} = fixture(owner, {fail: true});
  assert.equal((await handler(request())).status, 422);
  assert.equal((await handler(request())).status, 422);
  assert.equal(calls.close, 2); assert.equal(calls.destroy, 2);
});
test('concurrent renders in one isolate are refused before loading another document', async () => {
  let release;
  const wait = new Promise(resolve => {release = resolve;});
  const {handler, calls} = fixture(owner, {wait});
  const first = handler(request());
  while (!calls.load) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal((await handler(request())).status, 429);
  release(); assert.equal((await first).status, 200);
  assert.equal(calls.load, 1);
});
test('owner can prepare a selected page and bounded zone through the existing endpoint', async () => {
  const {handler,calls}=fixture(owner,{pages:3});
  const response=await handler(request({'x-splav-page':'2','x-splav-box':JSON.stringify({x:.1,y:.2,w:.3,h:.4})}));
  assert.equal(response.status,200);
  const metrics=JSON.parse(response.headers.get('x-splav-render-metrics'));
  assert.equal(metrics.page,3);assert.equal(metrics.mode,'zone');assert.ok(metrics.width<1800);
  assert.match(metrics.file_sha256,/^[a-f0-9]{64}$/);assert.match(metrics.render_sha256,/^[a-f0-9]{64}$/);
  assert.equal(calls.close,1);assert.equal(calls.destroy,1);assert.equal(metrics.ai_requests,0);
});
test('invalid crop and digest do not load; mismatched digest fails closed and permits next request', async () => {
  const {handler,calls}=fixture();
  for(const box of ['not-json','null',JSON.stringify({x:-1,y:0,w:1,h:1}),'x'.repeat(201)]){
    assert.equal((await handler(request({'x-splav-box':box}))).status,400);
  }
  assert.equal((await handler(request({'x-splav-sha256':'bad'}))).status,400);
  assert.equal(calls.load,0);
  assert.equal((await handler(request({'x-splav-sha256':'0'.repeat(64)}))).status,422);
  assert.equal(calls.load,0);
  assert.equal((await handler(request())).status,200);
});
