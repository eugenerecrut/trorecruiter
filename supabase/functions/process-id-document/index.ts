import { reviewID } from '../_shared/id-validation.js';
import '../_shared/document-data-policy.js';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { reconcileDocument } from '../_shared/sync-runtime.js';
import {finishQueueWithContinuation,continuationPDFMetadata} from '../_shared/splav-continuation.mjs';
import {continuationRolloutPolicy} from '../_shared/splav-continuation-rollout.js';
import {getLibrary} from '../_shared/pdfium-library.mjs';
import '../_shared/military-zone.js';
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
  const {data:staff,error:staffError}=await sb.from('crm_staff').select('active,role').eq('user_id',auth.user.id).single();
  if(staffError||!staff?.active)return json({error:'Користувач неактивний'},403);
  let body:any;
  try{body=await req.json();}catch{return json({error:'Некоректний JSON запиту'},400);}
  let queue:any=null;
  if(staff.role==='processor'&&body?.action==='recheck_saved')return json({error:'Повторна звірка доступна лише працівнику CRM'},403);
  if(staff.role==='processor'){
    if(!body?.job_id||!body?.lease_token)return json({error:'Фоновий виконавець може працювати лише через чергу СПЛАВ',code:'PROCESSOR_QUEUE_REQUIRED'},403);
    const access=await sb.rpc('crm_splav_validate',{job_id:body.job_id,token:body.lease_token});
    if(access.error||access.data?.document_id!==body.document_id)return json({error:'Доручення СПЛАВ недійсне або прострочене',code:'INVALID_SPLAV_LEASE'},403);
    queue={job_id:body.job_id,lease_token:body.lease_token,stage:access.data.stage};
  }else if(body?.job_id||body?.lease_token)return json({error:'Виконання черги доступне лише СПЛАВ'},403);
  let id:string|undefined,snapshot:any=null,providerReceipt:string|null=null;
  const stale=()=>json({error:'Стан документа вже змінено під час розпізнавання. Оновіть картку, щоб побачити чинні дані.',code:'STALE_DOCUMENT'},409);
  // All success/error writes compare the same initial revision. Never let an old
  // request overwrite a newer AI result, manual review, moved or deleted file.
  const persist=async(patch:Record<string,unknown>)=>{
    if(!snapshot)return {data:[],error:null};
    if(queue){const result=await sb.rpc('crm_splav_persist',{job_id:queue.job_id,token:queue.lease_token,provider_receipt:providerReceipt,patch});return {data:result.data?[result.data]:[],error:result.error};}
    let query=sb.from('documents').update(patch).eq('id',snapshot.id).eq('candidate_id',snapshot.candidate_id).eq('storage_path',snapshot.storage_path).is('deleted_at',null);
    query=snapshot.ai_processed_at==null?query.is('ai_processed_at',null):query.eq('ai_processed_at',snapshot.ai_processed_at);
    for(const field of ['document_type','requirement_id','verification_status','verified_at','file_hash'])query=snapshot[field]==null?query.is(field,null):query.eq(field,snapshot[field]);
    return await query.select('id,ai_processed_at');
  };
  const reconcileSaved=async(revision:string)=>{
    let reconciliation;
    try{
      reconciliation=await reconcileDocument(sb,id,revision,queue);
      if(queue&&['completed','needs_review'].includes(reconciliation.state)){
        const rollout=continuationRolloutPolicy({jobId:queue.job_id,documentId:id,globalEnabled:Deno.env.get('SPLAV_ROOT_ZONE_CONTINUATION_V1')==='true'});
        reconciliation=await finishQueueWithContinuation({client:sb,queue,outcome:reconciliation,
          enabled:rollout.enabled,metadata:async()=>{
            const fresh=await sb.from('documents').select('*').eq('id',id).single();if(fresh.error||!fresh.data)throw Error('Continuation source unavailable');
            const d=fresh.data;
            if(!(globalThis as any).CRMMilitaryZoneContract?.family(d.document_type,d.ai_document_type)||!(d.mime_type==='application/pdf'||/\.pdf$/i.test(d.storage_path||'')))return null;
            const metadata=await continuationPDFMetadata({client:sb,document:d,backend:Deno.env.get('SUPABASE_URL')!,getLibrary});
            return metadata&&metadata.pages<=rollout.maxPages?metadata:null;
          }});
      }
    }catch{console.error('splav-reconciliation-failed');reconciliation={state:'failed',auto_filled:0,conflict_count:0,reasons:['Розпізнавання збережено, але узгодження даних не завершено. Потрібна повторна перевірка без нового AI.']};}
    return {...reconciliation,version:1,document_id:id,source_revision:revision};
  };
  try{
    id=body.document_id;
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
    if(body.action==='recheck_saved'){
      if(!body.expected_revision||body.expected_revision!==doc.ai_processed_at)return stale();
      if(profile.workflow?.archive_lock)return json({error:'Справу заблоковано'},409);
      const requirement=await sb.from('document_requirements').select('id,document_type,ai_enabled,active').eq('active',true).eq('document_type','Військовий облік (витяг Резерв+ / приписне)').limit(1).maybeSingle();
      if(requirement.error)throw requirement.error;
      const proposed=(globalThis as any).CRMDocumentPolicy.savedReview(doc,requirement.data);
      if(!proposed.eligible)return json({error:proposed.reason,code:'SAVED_REVIEW_BLOCKED'},409);
      const cr=await sb.from('candidates').select('*').eq('id',doc.candidate_id).single();if(cr.error||!cr.data)return json({error:'Картка недоступна'},403);
      const planner=(globalThis as any).CRMDocumentSync,crosscheck=(globalThis as any).CRMDocumentCrosscheck;
      const report=planner.plan({...doc,...proposed.patch},cr.data);
      if(crosscheck)crosscheck.guard(report,await crosscheck.load(sb,cr.data));
      if(!report.supported||report.blockedReason||proposed.reviewFields.some((field:string)=>!report.rows.some((r:any)=>r.key===field&&r.action==='leave'&&r.incoming!=null))||report.rows.some((r:any)=>r.action==='conflict')||report.selections.length)return json({error:'Є нові, відмінні або неперевірені дані. Потрібна звірка полів.',code:'SAVED_REVIEW_BLOCKED'},409);
      const update=await persist(proposed.patch);if(update.error)throw update.error;if(!update.data?.length)return stale();
      return json({ok:true,rechecked:true,documentId:id,document_revision:update.data[0].ai_processed_at,matched_fields:report.rows.filter((r:any)=>r.incoming!=null&&r.action==='leave').length,auto_filled:0});
    }
    if(queue?.stage==='ocr_saved'){
      const sync_result=await reconcileSaved(doc.ai_processed_at);
      return json({...doc.ai_raw_response,ok:true,documentId:id,persistence_version:1,document_revision:doc.ai_processed_at,
        document_type:doc.document_type,extracted:doc.ai_extracted,warnings:doc.ai_warnings||[],confidence:doc.ai_confidence,sync_result});
    }
    const r=await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/ai-classify-document`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':authorization,'apikey':key},body:JSON.stringify({document_id:doc.id,...(queue?{job_id:queue.job_id,lease_token:queue.lease_token}:{})})});
    const raw=await r.text();let result:any;
    try{result=JSON.parse(raw)}catch{result={error:'AI повернув неструктуровану відповідь',http_status:r.status,raw_text:raw}}
    providerReceipt=result.provider_receipt||null;delete result.provider_receipt;
    if(queue&&!providerReceipt){
      await sb.rpc('crm_splav_release_waiting',{job_id:queue.job_id,token:queue.lease_token});
      return json({error:result.error||'Право на збереження результату AI не підтверджено',code:result.code||'SPLAV_DISPATCH_UNCERTAIN'},409);
    }
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
    const sync_result=await reconcileSaved(update.data[0].ai_processed_at);
    return json({...result,ok:true,documentId:id,persistence_version:1,document_revision:update.data[0].ai_processed_at,document_type:normalizedType,extracted:ex,warnings,review_required:reviewRequired,sync_result});
  }catch(error){
    console.error('process-id-document',error);
    if(queue&&!providerReceipt){await sb.rpc('crm_splav_release_waiting',{job_id:queue.job_id,token:queue.lease_token});return json({error:'Опрацювання буде відновлено без непідтвердженого платного повтору'},503);}
    if(body?.action==='recheck_saved')return json({error:'Звірку не завершено; збережений OCR не змінено'},500);
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
