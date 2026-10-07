import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import { PDFDocument } from 'https://esm.sh/pdf-lib@1.17.1';
const origin='https://eugenerecrut.github.io';
const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Content-Type':'application/json'};
const unsafePath=(path:string)=>path.includes('\\')||path.split('/').some(segment=>segment==='..'||segment==='.');
const respond=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 if(req.method!=='POST')return respond({error:'Method not allowed'},405);
 const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
 let candidateId:string|null=null;
 try{
  const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
  const user=await admin.auth.getUser(token);if(user.error||!user.data.user)return respond({error:'Увійдіть повторно'},401);
  const publicKey=Deno.env.get('SUPABASE_ANON_KEY')||Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  if(!publicKey)return respond({error:'Не налаштовано перевірку доступу CRM'},500);
  const session=createClient(Deno.env.get('SUPABASE_URL')!,publicKey,{global:{headers:{Authorization:'Bearer '+token}},auth:{persistSession:false}});
  const staff=await session.from('crm_staff').select('active,role').eq('user_id',user.data.user.id).maybeSingle();
  if(staff.error){console.error('ARCHIVE_STAFF_LOOKUP_FAILED',staff.error.code,staff.error.message);return respond({error:'Не вдалося перевірити доступ працівника CRM'},500);}
  if(staff.error||!staff.data?.active||!['owner','lead','recruiter'].includes(staff.data.role))return respond({error:'Доступ лише активним працівникам CRM'},403);
  const body=await req.json();candidateId=body.candidate_id;
  if(!/^[0-9a-f-]{36}$/i.test(candidateId||'')||body.confirm_delete_originals!==true)return respond({error:'Потрібне підтвердження видалення оригіналів'},400);
  let record=(await admin.from('crm_archive').select('*').eq('candidate_id',candidateId).maybeSingle()).data;
  if(record?.state==='Готово')return respond({archive_id:record.id,state:record.state});
  const path=record?.pdf_path||body.pdf_path;
  if(typeof path!=='string'||!path.startsWith(candidateId+'/packages/archive-')||unsafePath(path)||!path.endsWith('.pdf'))throw Error('Некоректний шлях PDF');
  const file=await admin.storage.from('candidate-documents').download(path);if(file.error)throw file.error;
  const bytes=new Uint8Array(await file.data.arrayBuffer());
  if(bytes.length<100||new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw Error('Архівний PDF відсутній або пошкоджений');
  const pdf=await PDFDocument.load(bytes);if(!pdf.getPageCount())throw Error('PDF не містить сторінок');
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
  if(digest!==(record?.pdf_sha256||body.pdf_sha256))throw Error('Контрольна сума PDF не збігається');
  if(!record){
   if(!Array.isArray(body.manifest)||body.manifest.some((d:{path:string})=>typeof d.path!=='string'||!d.path.startsWith(candidateId+'/')||unsafePath(d.path)))throw Error('Некоректний перелік оригіналів');
   const c=await admin.from('candidates').select('*').eq('id',candidateId).single();if(c.error)throw c.error;
   const w=c.data.profile_data?.workflow;
   if(w?.outcome==='Зарахований до ВЧ'){
    if(!w.order_number||!w.order_date)throw Error('Потрібні реквізити наказу');
    const d=await admin.from('documents').select('id,verification_status,deleted_at').eq('candidate_id',candidateId).eq('document_type','Припис про направлення').is('deleted_at',null).order('version_number',{ascending:false}).order('created_at',{ascending:false}).limit(1);
    if(d.error)throw d.error;if(d.data?.[0]?.verification_status!=='Підтверджено')throw Error('Припис відсутній або не перевірений');
   }
   const prepared=await admin.rpc('crm_prepare_archive',{p_id:candidateId,p_path:path,p_sha:digest,p_size:bytes.length,p_manifest:body.manifest,p_personal:body.personal_file??null,p_updated:body.candidate_updated_at,p_actor:user.data.user.id});
   if(prepared.error)throw prepared.error;record=Array.isArray(prepared.data)?prepared.data[0]:prepared.data;
  }
  if(!record||record.pdf_path!==path||record.pdf_sha256!==digest)throw Error('Інший працівник уже почав архівування. Продовжіть його через журнал «Архів».');
  // Collect every file under this case, including old versions and earlier packages.
  const paths:string[]=[];
  async function list(folder:string){for(let offset=0;;offset+=100){const r=await admin.storage.from('candidate-documents').list(folder,{limit:100,offset,sortBy:{column:'name',order:'asc'}});if(r.error)throw r.error;for(const entry of r.data){const p=folder+'/'+entry.name;if(entry.id){if(p!==path)paths.push(p)}else await list(p)}if(r.data.length<100)break}}
  for(let pass=0;pass<3;pass++){
   paths.length=0;await list(candidateId!);if(!paths.length)break;
   for(let i=0;i<paths.length;i+=100){const r=await admin.storage.from('candidate-documents').remove(paths.slice(i,i+100));if(r.error)throw r.error}
  }
  paths.length=0;await list(candidateId!);if(paths.length)throw Error('З’явилися нові файли. Продовжіть очищення через журнал «Архів».');
  const done=await admin.rpc('crm_finalize_archive',{p_id:candidateId});if(done.error)throw done.error;
  return respond({archive_id:record.id,state:'Готово'});
 }catch(e){const message=e instanceof Error?e.message:String(e);if(candidateId)await admin.from('crm_archive').update({error:message}).eq('candidate_id',candidateId).eq('state','Очищення');return respond({error:message},400)}
});
