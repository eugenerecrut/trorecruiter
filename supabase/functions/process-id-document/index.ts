import { reviewID } from '../_shared/id-validation.js';
import { createClient } from 'npm:@supabase/supabase-js@2';
const cors={'Access-Control-Allow-Origin':'https://eugenerecrut.github.io','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json; charset=utf-8'}});
Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  const key=Deno.env.get('SUPABASE_ANON_KEY')||Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  const authorization=req.headers.get('Authorization');
  if(!key||!authorization)return json({error:'Потрібна авторизація'},401);
  const sb=createClient(Deno.env.get('SUPABASE_URL')!,key,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}});
  const {data:auth,error:authError}=await sb.auth.getUser();
  if(authError||!auth.user)return json({error:'Потрібна чинна сесія'},401);
  const {data:staff,error:staffError}=await sb.from('crm_staff').select('active').eq('user_id',auth.user.id).single();
  if(staffError||!staff?.active)return json({error:'Користувач неактивний'},403);
  let id:string|undefined;
  try{
    const body=await req.json();id=body.document_id;
    if(!id)return json({error:'document_id required'},400);
    const {data:doc,error:de}=await sb.from('documents').select('*').eq('id',id).single();
    if(de||!doc)throw new Error('Документ не знайдено');
    if(doc.deleted_at)return json({error:'Видалений документ не можна розпізнавати'},409);
    const newer=await sb.from('documents').select('id').eq('version_group_id',doc.version_group_id).gt('version_number',doc.version_number).limit(1);
    if(newer.error)throw newer.error;if(newer.data?.length)return json({error:'Архівну версію не можна розпізнавати повторно'},409);
    const {data:s,error:se}=await sb.storage.from('candidate-documents').createSignedUrl(doc.storage_path,600);
    if(se||!s?.signedUrl)throw new Error('Не вдалося відкрити оригінал');
    const r=await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/ai-classify-document`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':authorization,'apikey':key},body:JSON.stringify({file_url:s.signedUrl,file_name:doc.file_name,text:''})});
    const raw=await r.text();let result:any;
    try{result=JSON.parse(raw)}catch{result={error:'AI повернув неструктуровану відповідь',http_status:r.status,raw_text:raw}}
    if(!r.ok||result.error){
      const update=await sb.from('documents').update({processing_status:'AI помилка',notes:String(result.error||'Помилка AI'),ai_raw_response:result,ai_model:result.model||null,ai_processed_at:new Date().toISOString()}).eq('id',id).select('id');
      if(update.error)throw update.error;if(!update.data?.length)throw new Error('Результат не збережено');
      return json({error:result.error||'Помилка AI'},502);
    }
    const ex=structuredClone(result.extracted||{});
    if(/рнокпп|іпн|ідентифікаційн(?:ий|ого)\s*(?:код|номер)|платника\s*податків|податков(?:ий|ого)\s*номер/iu.test(String(result.document_type||doc.document_type)))ex.passport_data=null;
    const isID = /^(?:ID)$|(?:ID|ІД)[\s-]*картк/iu.test(String(result.document_type||doc.document_type||''));
    let candidate = {};
    if(isID){
      const cr=await sb.from('candidates').select('full_name,name_nominative,birth_date,rnokpp,profile_data').eq('id',doc.candidate_id).single();
      if(cr.error||!cr.data)throw new Error('Не вдалося звірити власника ID-картки');
      candidate=cr.data;
    }
    const check=reviewID({...result,document_type:result.document_type||doc.document_type},candidate);
    const warnings=[...new Set([...(Array.isArray(result.warnings)?result.warnings:[]),...check.issues])];
    const patch={ai_raw_response:result,ai_model:result.model||null,ai_processed_at:new Date().toISOString(),ai_document_type:result.document_type||doc.document_type,ai_confidence:result.confidence??null,ai_candidate_name:result.candidate_name||ex.full_name||null,ai_extracted:ex,ai_warnings:warnings,processing_status:'AI оброблено',verification_status:check.blocked?'Потребує перевірки':'Не перевірено',notes:`${check.blocked?'AI REVIEW REQUIRED':'AI OK'} model=${result.model||''}`};
    const update=await sb.from('documents').update(patch).eq('id',id).select('id');
    if(update.error)throw update.error;if(!update.data?.length)throw new Error('Результат не збережено');
    return json({ok:true,documentId:id,...result,extracted:ex,warnings,review_required:check.blocked});
  }catch(error){
    console.error('process-id-document',error);
    if(id)await sb.from('documents').update({processing_status:'AI помилка',notes:'Обробку не завершено',ai_raw_response:{error:'Обробку не завершено'},ai_model:null,ai_processed_at:new Date().toISOString()}).eq('id',id);
    return json({error:'Помилка обробки документа'},500);
  }
});
