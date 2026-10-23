import test from 'node:test';
import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
import {rasterDimensions, readBoundedPDF, grayPNG, MAX_PDF_BYTES, MAX_PIXELS} from '../supabase/functions/_shared/pdf-raster.js';

test('page geometry preserves portrait and rotated landscape proportions within budget', () => {
  for (const [w, h] of [[595, 842], [842, 595], [1, 14400], [14400, 1], [14400, 14400]]) {
    const size = rasterDimensions(w, h);
    assert.ok(size.width * size.height <= MAX_PIXELS);
    assert.ok(size.width <= 1800 && size.height <= 3600);
    if (w > 10 && h > 10) assert.ok(Math.abs(size.width / size.height - w / h) < 0.003);
  }
  for (const bad of [0, -1, NaN, Infinity, 14401]) assert.throws(() => rasterDimensions(bad, 842));
});

test('PDF input checks both declared and actual size and signature', async () => {
  const body = () => new Blob(['%PDF-1.7\nsynthetic']).stream();
  const bytes = await readBoundedPDF(body(), null);
  assert.equal(new TextDecoder().decode(bytes), '%PDF-1.7\nsynthetic');
  await assert.rejects(readBoundedPDF(body(), MAX_PDF_BYTES + 1));
  await assert.rejects(readBoundedPDF(body(), 5));
  await assert.rejects(readBoundedPDF(body(), 100));
  await assert.rejects(readBoundedPDF(new Blob(['wrong']).stream(), 5));
  await assert.rejects(readBoundedPDF(body(), 'invalid'));
});

test('PNG encoder produces valid chunks, checksums and exact grayscale rows', async () => {
  const image = await grayPNG(new Uint8Array([0, 255, 40, 80]), 2, 2);
  assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  let offset = 8, types = [], payload;
  while (offset < image.length) {
    const view = new DataView(image.buffer, image.byteOffset + offset);
    const length = view.getUint32(0), type = new TextDecoder().decode(image.subarray(offset + 4, offset + 8));
    types.push(type);
    let crc = 0xffffffff;
    for (const byte of image.subarray(offset + 4, offset + 8 + length)) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    assert.equal(view.getUint32(length + 8), (crc ^ 0xffffffff) >>> 0);
    if (type === 'IHDR') { assert.equal(view.getUint32(8), 2); assert.equal(view.getUint32(12), 2); }
    if (type === 'IDAT') payload = image.subarray(offset + 8, offset + 8 + length);
    offset += length + 12;
  }
  assert.deepEqual(types, ['IHDR', 'IDAT', 'IEND']);
  assert.deepEqual([...inflateSync(payload)], [0, 0, 255, 0, 40, 80]);
  await assert.rejects(grayPNG(new Uint8Array(3), 2, 2));
  await assert.rejects(grayPNG(new Uint8Array(0), MAX_PIXELS + 1, 1));
});
