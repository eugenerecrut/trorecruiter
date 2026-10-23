import test from 'node:test';
import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
import {renderPDFZone, cropGray, zoneRasterBox} from '../supabase/functions/_shared/pdf-zone-raster.mjs';
const bytes = new TextEncoder().encode('%PDF-synthetic');
function fixture({pages = 3, fail = false, malformed = false} = {}) {
  const calls = {load: 0, page: null, close: 0, destroy: 0};
  return {calls, getLibrary: async () => ({loadDocument: async () => {calls.load++; return {
    getPageCount: () => pages, destroy: () => {calls.destroy++;}, getPage: index => {calls.page = index; return {
      getOriginalSize: () => ({originalWidth: 1800, originalHeight: 1000}), close: () => {calls.close++;},
      render: async ({width, height}) => {if (fail) throw Error('private details'); return {width, height,
        data: new Uint8Array(malformed ? 1 : width * height).map((_, n) => n % 251)};}
    };}
  };}})};
}
test('crop uses outward pixel rounding and retains exact rows without modifying original', () => {
  const bitmap = {width: 4, height: 3, data: Uint8Array.from({length: 12}, (_, n) => n)};
  const crop = cropGray(bitmap, {x: .26, y: .34, w: .24, h: .32});
  assert.deepEqual(crop.pixel_box, {x: 1, y: 1, w: 1, h: 1}); assert.deepEqual([...crop.data], [5]);
  crop.data[0] = 99; assert.equal(bitmap.data[5], 5);
  for (const b of [{x: -.1,y:0,w:1,h:1},{x:0,y:0,w:0,h:1},{x:0,y:0,w:2,h:1},null]) assert.throws(() => cropGray(bitmap, b));
  assert.throws(() => cropGray({...bitmap, data: new Uint8Array(1)}, {x:0,y:0,w:1,h:1}));
});
test('same browser/SQL context is applied once and clips all edges', () => {
  assert.deepEqual(zoneRasterBox('zone',{x:0,y:0,w:1,h:1}),{x:0,y:0,w:1,h:1});
  const b=zoneRasterBox('zone',{x:.1,y:.2,w:.3,h:.4});
  for(const [key,value] of Object.entries({x:.085,y:.185,w:.33,h:.43}))assert.ok(Math.abs(b[key]-value)<1e-12);
  assert.throws(() => zoneRasterBox('overview',{x:0,y:0,w:.5,h:1}));
});
test('selects requested page; returns exact PNG and original hashes with source geometry', async () => {
  const f=fixture(), result=await renderPDFZone({bytes,page:3,mode:'zone',box:{x:.1,y:.2,w:.3,h:.4},getLibrary:f.getLibrary});
  assert.equal(f.calls.page,2);assert.equal(f.calls.close,1);assert.equal(f.calls.destroy,1);
  assert.equal(result.metrics.page,3);assert.equal(result.metrics.pages,3);assert.equal(result.metrics.ai_requests,0);
  const hash=async data=>Buffer.from(await crypto.subtle.digest('SHA-256',data)).toString('hex');
  assert.equal(result.metrics.file_sha256,await hash(bytes));assert.equal(result.metrics.render_sha256,await hash(result.png));
  let offset=8, scan;
  while(offset<result.png.length){const len=new DataView(result.png.buffer,result.png.byteOffset+offset).getUint32(0);
    if(new TextDecoder().decode(result.png.subarray(offset+4,offset+8))==='IDAT')scan=inflateSync(result.png.subarray(offset+8,offset+8+len));offset+=len+12;}
  const {pixel_box:p,width,height}=result.metrics;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)assert.equal(scan[y*(width+1)+x+1],((p.y+y)*1800+p.x+x)%251);
});
test('original mismatch and malformed task fail before loading; page/bitmap errors always clean up', async () => {
  const f=fixture();await assert.rejects(renderPDFZone({bytes,getLibrary:f.getLibrary,expected_sha256:'0'.repeat(64)}));assert.equal(f.calls.load,0);
  for(const page of [0,201,1.5])await assert.rejects(renderPDFZone({bytes,page,getLibrary:f.getLibrary}));assert.equal(f.calls.load,0);
  const missing=fixture({pages:1});await assert.rejects(renderPDFZone({bytes,page:2,getLibrary:missing.getLibrary}));assert.equal(missing.calls.destroy,1);assert.equal(missing.calls.close,0);
  for(const options of [{fail:true},{malformed:true}]){const a=fixture(options);await assert.rejects(renderPDFZone({bytes,getLibrary:a.getLibrary}));assert.equal(a.calls.close,1);assert.equal(a.calls.destroy,1);}
});
