import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';
const origin='https://eugenerecrut.github.io';
const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Content-Type':'application/json'};
const respond=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
// Compatibility endpoint only. Retained archives use the existing candidate
// workflow; legacy clients must never remove originals or candidate records.
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 if(req.method!=='POST')return respond({error:'Method not allowed'},405);
 const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
 try{
  const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
  const user=await admin.auth.getUser(token);if(user.error||!user.data.user)return respond({error:'Увійдіть повторно'},401);
  const publicKey=Deno.env.get('SUPABASE_ANON_KEY')||Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  if(!publicKey)return respond({error:'Не налаштовано перевірку доступу CRM'},500);
  const session=createClient(Deno.env.get('SUPABASE_URL')!,publicKey,{global:{headers:{Authorization:'Bearer '+token}},auth:{persistSession:false}});
  const staff=await session.from('crm_staff').select('active,role').eq('user_id',user.data.user.id).maybeSingle();
  if(staff.error)return respond({error:'Не вдалося перевірити доступ працівника CRM'},500);
  if(!staff.data?.active||!['owner','lead','recruiter'].includes(staff.data.role))return respond({error:'Доступ лише активним працівникам CRM'},403);
  const body=await req.json(),candidateId=body.candidate_id;
  if(!/^[0-9a-f-]{36}$/i.test(candidateId||'')||body.confirm_delete_originals!==true)return respond({error:'Некоректний запит старого клієнта. Оновіть CRM.'},400);
  const retained=await admin.from('candidates').select('profile_data').eq('id',candidateId).maybeSingle();
  if(retained.error)throw retained.error;
  if(retained.data?.profile_data?.workflow?.archived_at)return respond({error:'Справа вже в архіві зі збереженими оригіналами. Видалення за старою схемою заборонено.'},409);
  const record=await admin.from('crm_archive').select('id,state').eq('candidate_id',candidateId).maybeSingle();
  if(record.error)throw record.error;
  if(record.data?.state==='Готово')return respond({archive_id:record.data.id,state:'Готово'});
  return respond({error:'Незворотне архівування більше не використовується. Оновіть CRM і відправте справу в архів зі збереженням оригіналів.'},409);
 }catch(e){const message=(e as {message?:string})?.message||String(e);console.error('ARCHIVE_LEGACY_REJECTED',message);return respond({error:message},400);}
});
