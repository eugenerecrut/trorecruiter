import {MAX_PDF_BYTES, MAX_PIXELS, rasterDimensions, grayPNG} from './pdf-raster.js';
import {nativePageZones} from './pdf-native-zones.mjs';

const full = {x: 0, y: 0, w: 1, h: 1};
export function zoneRasterBox(mode = 'overview', box = full) {
  if (!['overview', 'zone'].includes(mode)) throw Error('Invalid render mode');
  if (!box || typeof box !== 'object' || Array.isArray(box) || Object.keys(box).length !== 4 ||
      !['x', 'y', 'w', 'h'].every(k => Number.isFinite(box[k])) || box.x < 0 || box.y < 0 ||
      box.w <= 0 || box.h <= 0 || box.x + box.w > 1.000001 || box.y + box.h > 1.000001) throw Error('Invalid render box');
  if (mode === 'overview') {
    if (Object.keys(full).some(k => box[k] !== full[k])) throw Error('Overview requires a full page');
    return {...full};
  }
  // Same context as the existing browser reader and coordinator SQL dispatch.
  const x = Math.max(0, box.x - .015), y = Math.max(0, box.y - .015);
  return {x, y, w: Math.min(1, box.x + box.w + .015) - x, h: Math.min(1, box.y + box.h + .015) - y};
}

export function cropGray(bitmap, box) {
  const {width, height, data} = bitmap || {};
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
      width * height > MAX_PIXELS || !(data instanceof Uint8Array) || data.length !== width * height) throw Error('Invalid grayscale bitmap');
  zoneRasterBox('zone', box); // Validate without expanding again.
  const left = Math.floor(box.x * width), top = Math.floor(box.y * height);
  const right = Math.min(width, Math.ceil((box.x + box.w) * width)), bottom = Math.min(height, Math.ceil((box.y + box.h) * height));
  const w = right - left, h = bottom - top;
  if (w < 1 || h < 1) throw Error('Empty crop');
  const pixels = new Uint8Array(w * h);
  for (let row = 0; row < h; row++) pixels.set(data.subarray((top + row) * width + left, (top + row) * width + right), row * w);
  return {width: w, height: h, data: pixels, pixel_box: {x: left, y: top, w, h}};
}

const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
// One bounded page, no credentials, AI, persistence, scheduler or candidate writes.
// The calling adapter must serialize access to its WASM instance and authorize the source.
export async function renderPDFZone({bytes, page: number = 1, mode = 'overview', box = full, expected_sha256, getLibrary}) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 5 || bytes.length > MAX_PDF_BYTES ||
      String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-' || !Number.isInteger(number) || number < 1 || number > 200) throw Error('Invalid PDF source or page');
  const sourceBox = zoneRasterBox(mode, box), start = performance.now(), originalHash = await digest(bytes);
  if (expected_sha256 !== undefined && (!/^[a-f0-9]{64}$/.test(expected_sha256) || expected_sha256 !== originalHash)) throw Error('PDF original digest changed');
  let doc, page;
  try {
    const library = await getLibrary(), initAt = performance.now();
    doc = await library.loadDocument(bytes);
    const pages = doc.getPageCount();
    if (!Number.isInteger(pages) || pages < 1 || pages > 200 || number > pages) throw Error('PDF page unavailable');
    page = doc.getPage(number - 1);
    const original = page.getOriginalSize(), size = rasterDimensions(original.originalWidth, original.originalHeight), loadAt = performance.now();
    const bitmap = await page.render({...size, colorSpace: 'Gray', render: 'bitmap'}), renderAt = performance.now();
    if (bitmap.width !== size.width || bitmap.height !== size.height) throw Error('Unexpected bitmap geometry');
    const crop = cropGray(bitmap, sourceBox), png = await grayPNG(crop.data, crop.width, crop.height);
    // Both the existing Edge body cap and base64 data-URL cap must be respected.
    if (png.length > 4 * 1024 * 1024 || 22 + Math.ceil(png.length / 3) * 4 > 5500000) throw Error('Rendered fragment exceeds AI transport budget');
    const renderHash = await digest(png), end = performance.now();
    const native_zones=mode==='overview'?nativePageZones(page,original):null;
    return {png, native_zones, metrics: {pages, page: number, mode, box: sourceBox, pixel_box: crop.pixel_box,
      width: crop.width, height: crop.height, page_width: size.width, page_height: size.height,
      file_sha256: originalHash, render_sha256: renderHash, pdf_bytes: bytes.length, png_bytes: png.length,
      init_ms: Math.round(initAt - start), load_ms: Math.round(loadAt - initAt), render_ms: Math.round(renderAt - loadAt),
      encode_ms: Math.round(end - renderAt), total_ms: Math.round(end - start), ai_requests: 0}};
  } finally {
    try { page?.close(); } catch { /* Document still must be released. */ }
    try { doc?.destroy(); } catch { /* Adapter still releases its busy lock. */ }
  }
}
