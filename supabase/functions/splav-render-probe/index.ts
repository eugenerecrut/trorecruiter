import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import {getLibrary} from '../_shared/pdfium-library.mjs';
import {createRenderProbe} from './core.mjs';

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
