import { reviewID } from '../_shared/id-validation.js';
import '../_shared/document-data-policy.js';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { reconcileDocument } from '../_shared/sync-runtime.js';
const cors={'Access-Control-Allow-Origin':'https://eugenerecrut.github.io','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json; charset=utf-8'}});
async function processDocument(req:Request){
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
  let id:string|undefined,snapshot:any=null;
  const stale=()=>json({error:'Стан документа вже змінено під час розпізнавання. Оновіть картку, щоб побачити чинні дані.',code:'STALE_DOCUMENT'},409);
  // All success/error writes compare the same initial revision. Never let an old
  // request overwrite a newer AI result, manual review, moved or deleted file.
  const persist=async(patch:Record<string,unknown>)=>{
    if(!snapshot)return {data:[],error:null};
    let query=sb.from('documents').update(patch).eq('id',snapshot.id).eq('candidate_id',snapshot.candidate_id).eq('storage_path',snapshot.storage_path).is('deleted_at',null);
    query=snapshot.ai_processed_at==null?query.is('ai_processed_at',null):query.eq('ai_processed_at',snapshot.ai_processed_at);
    for(const field of ['document_type','requirement_id','verification_status','verified_at','file_hash'])query=snapshot[field]==null?query.is(field,null):query.eq(field,snapshot[field]);
    return await query.select('id,ai_processed_at');
  };
  try{
    const body=await req.json();id=body.document_id;
    if(!id)return json({error:'document_id required'},400);
    const {data:doc,error:de}=await sb.from('documents').select('*').eq('id',id).single();
    if(de||!doc)throw new Error('Документ не знайдено');
    if(doc.deleted_at)return json({error:'Видалений документ не можна розпізнавати'},409);
    const newer=await sb.from('documents').select('id').eq('version_group_id',doc.version_group_id).gt('version_number',doc.version_number).limit(1);
    if(newer.error)throw newer.error;if(newer.data?.length)return json({error:'Архівну версію не можна розпізнавати повторно'},409);
    const crActive=await sb.from('candidates').select('profile_data').eq('id',doc.candidate_id).single();if(crActive.error||!crActive.data)return json({error:'Картка кандидата недоступна'},403);
    const profile=crActive.data.profile_data||{};if(profile.merged_into||profile.workflow?.archived_at)return json({error:'Об’єднана або архівна картка: потрібна окрема звірка'},409);
    const requirementGuard=doc.requirement_id?await sb.from('document_requirements').select('ai_enabled').eq('id',doc.requirement_id).maybeSingle():{data:null,error:null};if(requirementGuard.error)throw requirementGuard.error;if(requirementGuard.data?.ai_enabled===false)return json({error:'Для цього документа AI вимкнено'},409);
    snapshot=doc;
    const r=await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/ai-classify-document`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':authorization,'apikey':key},body:JSON.stringify({document_id:doc.id})});
    const raw=await r.text();let result:any;
    try{result=JSON.parse(raw)}catch{result={error:'AI повернув неструктуровану відповідь',http_status:r.status,raw_text:raw}}
    if(!r.ok||result.error){
      const update=await persist({processing_status:'AI помилка',notes:String(result.error||'Помилка AI'),ai_raw_response:result,ai_model:result.model||null,ai_processed_at:new Date().toISOString()});
      if(update.error)throw update.error;if(!update.data?.length)return stale();
      return json({error:result.error||'Помилка AI',provider_errors:Array.isArray(result.provider_errors)?result.provider_errors:[]},502);
    }
    const requirement=doc.requirement_id?await sb.from('document_requirements').select('document_type').eq('id',doc.requirement_id).maybeSingle():{data:null,error:null};
    if(requirement.error)throw requirement.error;
    const policy=(globalThis as any).CRMDocumentPolicy.normalize({...doc,ai_document_type:result.document_type,ai_extracted:result.extracted},requirement.data?.document_type);
    const ex=policy.extracted;
    const normalizedType=policy.type||result.document_type||doc.document_type;
    const matchedRequirement=requirement.data?.document_type===normalizedType?{data:{id:doc.requirement_id},error:null}:await sb.from('document_requirements').select('id').eq('document_type',normalizedType).limit(1).maybeSingle();
    if(matchedRequirement.error)throw matchedRequirement.error;
    if(/рнокпп|іпн|ідентифікаційн(?:ий|ого)\s*(?:код|номер)|платника\s*податків|податков(?:ий|ого)\s*номер/iu.test(String(result.document_type||doc.document_type)))ex.passport_data=null;
    const isID = /^(?:ID)$|(?:ID|ІД)[\s-]*картк/iu.test(String(normalizedType));
    let candidate = {};
    if(isID){
      const cr=await sb.from('candidates').select('full_name,name_nominative,birth_date,rnokpp,profile_data').eq('id',doc.candidate_id).single();
      if(cr.error||!cr.data)throw new Error('Не вдалося звірити власника ID-картки');
      candidate=cr.data;
    }
    const check=reviewID({...result,extracted:ex,document_type:normalizedType},candidate);
    if(result.review_required){ex.meta={...(ex.meta||{}),requires_review:true};}
    const typeMismatch=!!requirement.data?.document_type&&requirement.data.document_type!==normalizedType;
    const reviewRequired=check.blocked||!!result.review_required||typeMismatch;
    const warnings=[...new Set([...(Array.isArray(result.warnings)?result.warnings:[]),...policy.warnings,...check.issues,...(typeMismatch?['AI визначив інший тип: '+normalizedType+'. Звірте тип документа.']:[])])];
    const patch={requirement_id:matchedRequirement.data?.id||null,document_type:normalizedType,document_name:normalizedType,status:'Завантажено',ai_raw_response:result,ai_model:result.model||null,ai_processed_at:new Date().toISOString(),ai_document_type:normalizedType,ai_confidence:result.confidence??null,ai_candidate_name:result.candidate_name||ex.full_name||null,ai_extracted:ex,ai_warnings:warnings,processing_status:'AI оброблено',verification_status:reviewRequired?'Потребує перевірки':'Не перевірено',notes:`${reviewRequired?'AI REVIEW REQUIRED':'AI OK'} model=${result.model||''}`};
    const update=await persist(patch);
    if(update.error)throw update.error;if(!update.data?.length)return stale();
    let reconciliation;
    try{reconciliation=await reconcileDocument(sb,id,update.data[0].ai_processed_at);}
    catch{console.error('splav-reconciliation-failed');reconciliation={state:'failed',auto_filled:0,conflict_count:0,reasons:['Розпізнавання збережено, але узгодження даних не завершено. Потрібна повторна перевірка без нового AI.']};}
    const sync_result={...reconciliation,version:1,document_id:id,source_revision:update.data[0].ai_processed_at};
    return json({...result,ok:true,documentId:id,persistence_version:1,document_revision:update.data[0].ai_processed_at,document_type:normalizedType,extracted:ex,warnings,review_required:reviewRequired,sync_result});
  }catch(error){
    console.error('process-id-document',error);
    if(snapshot){const update=await persist({processing_status:'AI помилка',notes:'Обробку не завершено',ai_raw_response:{error:'Обробку не завершено'},ai_model:null,ai_processed_at:new Date().toISOString()});if(!update.error&&!update.data?.length)return stale();}
    return json({error:'Помилка обробки документа'},500);
  }
}
Deno.serve(req=>{
  const task=processDocument(req);
  // Keep accepted work tracked after a client disconnect, within Edge runtime limits.
  (globalThis as any).EdgeRuntime?.waitUntil(task.catch(()=>undefined));
  return task;
});
