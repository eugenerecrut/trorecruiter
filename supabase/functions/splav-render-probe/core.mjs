import {readBoundedPDF, rasterDimensions, grayPNG} from '../_shared/pdf-raster.js';

const OWNER = '7c74b122-3940-40a8-a32f-fe2b6776c173';
const ORIGIN = 'https://eugenerecrut.github.io';
export function createRenderProbe({authorize, getLibrary}) {
  let busy = false;
  const headers = {'Access-Control-Allow-Origin': ORIGIN, 'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization,apikey,x-client-info,content-type,x-splav-page',
    'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Expose-Headers': 'x-splav-render-metrics',
    'Cache-Control': 'no-store'};
  const fail = (status, error) => new Response(JSON.stringify({error}), {
    status, headers: {...headers, 'Content-Type': 'application/json'}});
  return async function handle(req) {
    if (req.headers.get('origin') && req.headers.get('origin') !== ORIGIN) return fail(403, 'Недозволене джерело запиту');
    if (req.method === 'OPTIONS') return new Response(null, {status: 204, headers});
    if (req.method !== 'POST') return fail(405, 'Очікується POST');
    try {
      const actor = await authorize(req.headers.get('authorization') || '');
      if (!actor) return fail(401, 'Увійдіть до CRM');
      if (actor.id !== OWNER || actor.active !== true || actor.role === 'processor') return fail(403, 'Діагностика доступна лише активному власнику CRM');
    } catch { return fail(401, 'Не вдалося перевірити доступ'); }
    if (busy) return fail(429, 'Рендер уже виконується. Спробуйте пізніше.');
    if (req.headers.get('content-type')?.split(';')[0] !== 'application/pdf') return fail(415, 'Потрібен PDF');
    const rawPage = req.headers.get('x-splav-page') ?? '0';
    if (!/^\d{1,3}$/.test(rawPage) || Number(rawPage) > 199) return fail(400, 'Номер сторінки поза межами');
    busy = true;
    let doc, page;
    const start = performance.now();
    try {
      const bytes = await readBoundedPDF(req.body, req.headers.get('content-length'));
      const readAt = performance.now(), library = await getLibrary(), initAt = performance.now();
      doc = await library.loadDocument(bytes);
      const pages = doc.getPageCount(), index = Number(rawPage);
      if (!Number.isInteger(pages) || pages < 1 || pages > 200 || index >= pages) return fail(422, 'PDF повинен мати від 1 до 200 сторінок; перевірте вибрану сторінку');
      page = doc.getPage(index);
      const original = page.getOriginalSize();
      const size = rasterDimensions(original.originalWidth, original.originalHeight), loadAt = performance.now();
      const bitmap = await page.render({...size, colorSpace: 'Gray', render: 'bitmap'}), renderAt = performance.now();
      if (bitmap.width !== size.width || bitmap.height !== size.height) throw new Error('Unexpected bitmap geometry');
      const png = await grayPNG(bitmap.data, bitmap.width, bitmap.height), end = performance.now();
      if (png.length > 4 * 1024 * 1024) return fail(413, 'Зображення сторінки перевищило бюджет 4 МіБ');
      const metrics = {pages, page: index + 1, width: size.width, height: size.height, pdf_bytes: bytes.length,
        png_bytes: png.length, read_ms: Math.round(readAt - start), init_ms: Math.round(initAt - readAt),
        load_ms: Math.round(loadAt - initAt), render_ms: Math.round(renderAt - loadAt),
        encode_ms: Math.round(end - renderAt), total_ms: Math.round(end - start), ai_requests: 0};
      return new Response(png, {headers: {...headers, 'Content-Type': 'image/png',
        'x-splav-render-metrics': JSON.stringify(metrics)}});
    } catch {
      return fail(422, 'Не вдалося підготувати сторінку. Перевірте PDF (до 20 МіБ), захист паролем і розмір сторінки. AI не запускався.');
    } finally {
      try { page?.close(); } catch { /* Still destroy the document. */ }
      try { doc?.destroy(); } catch { /* Never retain a busy lock after cleanup failure. */ }
      busy = false;
    }
  };
}
