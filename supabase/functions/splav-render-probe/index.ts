import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import {PDFiumLibrary} from '../_shared/vendor/pdfium-3.0.0.js';
import {createRenderProbe} from './core.mjs';

// Public, immutable-version asset only. No document content or credentials are sent to this host.
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@hyzyla/pdfium@3.0.0/dist/pdfium.wasm';
const WASM_HASH = 'beeaf5bbff216d555fecec7cd486072838c4632a2272d31b52ef1fd05008fe7c';
let libraryPromise: Promise<unknown> | null = null;
async function getLibrary() {
  if (!libraryPromise) libraryPromise = (async () => {
    const response = await fetch(WASM_URL, {signal: AbortSignal.timeout(15000), redirect: 'error'});
    if (!response.ok || !response.body) throw new Error('Renderer asset unavailable');
    const reader = response.body.getReader(), bytes = new Uint8Array(5298237);
    let offset = 0;
    try {
      for (;;) {
        const {done, value} = await reader.read(); if (done) break;
        if (offset + value.length > bytes.length) throw new Error('Renderer asset size mismatch');
        bytes.set(value, offset); offset += value.length;
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map(n => n.toString(16).padStart(2, '0')).join('');
    if (offset !== bytes.length || hash !== WASM_HASH) throw new Error('Renderer asset integrity mismatch');
    return PDFiumLibrary.init({wasmBinary: bytes});
  })().catch(error => { libraryPromise = null; throw error; });
  return libraryPromise;
}
Deno.serve(createRenderProbe({getLibrary, authorize: async (authorization: string) => {
  if (!authorization.startsWith('Bearer ')) return null;
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
    {global: {headers: {Authorization: authorization}}, auth: {persistSession: false}});
  const {data, error} = await client.auth.getUser();
  if (error || !data.user || data.user.is_anonymous) return null;
  const {data: staff, error: staffError} = await client.from('crm_staff')
    .select('role,active').eq('user_id', data.user.id).single();
  return staffError ? null : {id: data.user.id, ...staff};
}}));
