// Bounded raster primitives. No AI requests, persistence or candidate data access.
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export const MAX_PIXELS = 5_000_000;

export function rasterDimensions(width, height) {
  if (![width, height].every(n => Number.isFinite(n) && n > 0 && n <= 14400)) {
    throw new Error('Unsupported PDF page dimensions');
  }
  const scale = Math.min(1800 / width, 1800 / height * 2, Math.sqrt(MAX_PIXELS / (width * height)));
  const result = {width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale))};
  if (result.width * result.height > MAX_PIXELS) throw new Error('Page exceeds raster budget');
  return result;
}

export async function readBoundedPDF(body, contentLength) {
  if (!body) throw new Error('Empty PDF');
  const declared = contentLength == null ? null : Number(contentLength);
  if (declared !== null && (!Number.isSafeInteger(declared) || declared < 5 || declared > MAX_PDF_BYTES)) {
    throw new Error('PDF must be between 5 bytes and 20 MiB');
  }
  const bytes = new Uint8Array(declared ?? MAX_PDF_BYTES);
  const reader = body.getReader();
  let count = 0;
  try {
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      if (count + value.length > bytes.length) throw new Error('PDF exceeds declared size or 20 MiB');
      bytes.set(value, count); count += value.length;
    }
    if (declared !== null && count !== declared) throw new Error('Incomplete PDF upload');
    if (count < 5 || String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') throw new Error('Expected a PDF file');
    return bytes.subarray(0, count);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
}

const crcTable = Uint32Array.from({length: 256}, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function pngChunk(type, data) {
  const out = new Uint8Array(data.length + 12), view = new DataView(out.buffer);
  view.setUint32(0, data.length); out.set(new TextEncoder().encode(type), 4); out.set(data, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < out.length - 4; i++) crc = crcTable[(crc ^ out[i]) & 255] ^ (crc >>> 8);
  view.setUint32(out.length - 4, (crc ^ 0xffffffff) >>> 0);
  return out;
}
export async function grayPNG(pixels, width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
      width * height > MAX_PIXELS || !(pixels instanceof Uint8Array) || pixels.length !== width * height) {
    throw new Error('Invalid bounded grayscale image');
  }
  const scan = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++) scan.set(pixels.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  const compressed = new Uint8Array(await new Response(new Blob([scan]).stream()
    .pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  const head = new Uint8Array(13), view = new DataView(head.buffer);
  view.setUint32(0, width); view.setUint32(4, height); head[8] = 8;
  const chunks = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', head),
    pngChunk('IDAT', compressed), pngChunk('IEND', new Uint8Array())];
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}
