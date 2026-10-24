import {readBoundedPDF} from '../_shared/pdf-raster.js';
import {renderPDFZone, zoneRasterBox} from '../_shared/pdf-zone-raster.mjs';

const OWNER = '7c74b122-3940-40a8-a32f-fe2b6776c173';
const ORIGIN = 'https://eugenerecrut.github.io';
export function createRenderProbe({authorize, getLibrary}) {
  let busy = false;
  const headers = {'Access-Control-Allow-Origin': ORIGIN, 'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization,apikey,x-client-info,content-type,x-splav-page,x-splav-box,x-splav-sha256',
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
    const rawBox = req.headers.get('x-splav-box'), expected = req.headers.get('x-splav-sha256');
    let box, mode = rawBox === null ? 'overview' : 'zone';
    try {
      if (rawBox !== null) { if (rawBox.length > 200) throw Error(); box = JSON.parse(rawBox); }
      zoneRasterBox(mode, box);
      if (expected !== null && !/^[a-f0-9]{64}$/.test(expected)) throw Error();
    } catch { return fail(400, 'Некоректна зона або контрольна сума'); }
    busy = true;
    const start = performance.now();
    try {
      const bytes = await readBoundedPDF(req.body, req.headers.get('content-length'));
      const readAt = performance.now();
      const {png, metrics, native_zones} = await renderPDFZone({bytes, page: Number(rawPage) + 1, mode, box, expected_sha256: expected ?? undefined, getLibrary});
      // Geometry only: no extracted text or Unicode labels in HTTP headers.
      metrics.native_zones=(native_zones||[]).map(zone=>({box:zone.box}));
      metrics.native_zone_status=mode==='zone'?'not_requested':native_zones?.length?'native_text':'visual_review_required';
      metrics.read_ms = Math.round(readAt - start); metrics.total_ms = Math.round(performance.now() - start);
      return new Response(png, {headers: {...headers, 'Content-Type': 'image/png',
        'x-splav-render-metrics': JSON.stringify(metrics)}});
    } catch {
      return fail(422, 'Не вдалося підготувати сторінку. Перевірте PDF (до 20 МіБ), захист паролем і розмір сторінки. AI не запускався.');
    } finally {
      busy = false;
    }
  };
}
