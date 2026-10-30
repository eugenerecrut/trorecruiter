// Real browser modules and upload loop; simulated Storage/Edge/RPC, no network.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{webcrypto}=require('node:crypto');
const root=path.join(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const name='ТЕСТЕНКО Іван Петрович';
function queueView(rpc){
 const status={textContent:'Початковий стан'},tracked=[];
 const c=vm.createContext({activeDocumentsCandidateId:'a',activeDocumentsReadOnly:false,supabaseClient:{rpc},document:{getElementById:id=>id==='docBatchStatus'?status:id==='documentRows'?{dataset:{splavCandidate:'a'}}:null},trackSplavJob:(...args)=>tracked.push(args)});
 const src=read('documents.js');vm.runInContext(src.slice(src.indexOf('async function resumeSplavJobs('),src.indexOf('function acceptedServerReconciliation(')),c);
 return {c,status,tracked};
}
test('resumed queue separates historical outcomes from current document questions',async()=>{
 const {c,status,tracked}=queueView(async()=>({data:[{id:'old',state:'needs_review'},{id:'old2',state:'uncertain'},{id:'new',state:'running'}]}));
 await c.resumeSplavJobs('a');assert.deepEqual(tracked,[['new','a']]);assert.match(status.textContent,/У фоновій черзі: 1/);assert(!status.textContent.includes('Потребують звірки:'));
});
test('finished jobs do not become active questions on reopening',async()=>{
 const {c,status,tracked}=queueView(async()=>({data:[{id:'old',state:'needs_review'}]}));await c.resumeSplavJobs('a');assert.match(status.textContent,/активних фонових завдань немає/);assert.equal(tracked.length,0);
});
test('RPC failures and malformed results show unknown queue state without retrying AI',async()=>{
 for(const reply of [()=>{throw Error('offline')},()=>({error:{message:'denied'}}),()=>({data:null})]){
  const {c,status,tracked}=queueView(async()=>reply());await c.resumeSplavJobs('a');assert.match(status.textContent,/тимчасово недоступний/);assert(!status.textContent.includes('завдань немає'));assert.equal(tracked.length,0);
 }
});
test('late queue response cannot update a different or newly archived view',async()=>{
 for(const change of [c=>{c.activeDocumentsCandidateId='b'},c=>{c.activeDocumentsReadOnly=true}]){
  let resolve;const {c,status,tracked}=queueView(()=>new Promise(r=>resolve=r));const request=c.resumeSplavJobs('a');change(c);resolve({data:[{id:'new',state:'queued'}]});await request;assert.equal(status.textContent,'Початковий стан');assert.equal(tracked.length,0);
 }
});
function setup(options={}){
 const state={candidate:{id:'c',full_name:name,birth_date:'1990-01-01',rnokpp:'1234567890',worked_before:true,served_before:false,profile_data:{service_type:'За мобілізацією'}},docs:[],uploads:[],calls:[],browserPatches:[],automations:0,rpcs:0};
 const responses={
  'birth.pdf':{document_type:'Свідоцтво про народження',extracted:{full_name:name,birth_date:'1990-01-01',birth_place:'Дніпро',relatives:[{relationship:'Мати',full_name:'ТЕСТЕНКО Олена Петрівна',birth_date:'1970-01-01'}]}},
  'diploma.pdf':{document_type:'Копія диплома',extracted:{education_records:[{owner_full_name:name,owner_birth_date:'1990-01-01',degree:'кваліфікований робітник',institution:'Тестове училище',diploma_number:'123',diploma_series:'К',diploma_present:true,graduation_year:2008}]}},
  'work.pdf':{document_type:'Трудова книжка',extracted:{full_name:name,work_events:[{kind:'hire',employer:'Тестове підприємство',position:'Водій',event_date:'2010-01-01'},{kind:'dismissal',employer:'Тестове підприємство',position:'Водій',event_date:'2012-01-01'}]}},
  'rl.pdf':{document_type:'Рекомендаційний лист',extracted:{full_name:name,service:{military_specialty:'225256А',shpk:'сола aT в',service_type:'За контрактом'}}},
  'other.pdf':{document_type:'Свідоцтво про народження',extracted:{full_name:'ІНШЕНКО Петро Іванович',birth_place:'Чуже місце'}},
 };
 const requirements=[...new Set(Object.values(responses).map(r=>r.document_type))].map((document_type,i)=>({id:'r'+i,document_type}));
 const client={storage:{from:()=>({upload:async(p,f)=>{state.uploads.push({p,name:f.name});return {}},remove:async()=>({})})},functions:{invoke:async(fn,{body})=>{
  state.calls.push(body.document_id);const d=state.docs.find(d=>d.id===body.document_id);
  if(options.stale){Object.assign(d,{processing_status:'AI оброблено',ai_extracted:{new_result:'preserve'}});return {error:{message:'Стан документа вже змінено'}};}
  if(d.file_name==='fail.pdf'){d.processing_status='AI помилка';return {error:{message:'Тестова помилка AI'}};}
  const data={ok:true,persistence_version:1,documentId:d.id,confidence:0.99,...responses[d.file_name]};
  // Match the authoritative server contract; the browser must not save this again.
  Object.assign(d,{document_type:data.document_type,ai_extracted:structuredClone(data.extracted),processing_status:'AI оброблено',ai_confidence:data.confidence,ai_warnings:[]});
  if(options.serverSync){const report=options.serverSync==='failed'?null:await c.CRMDocumentSync.automate(client,d.id);data.document_revision='server-revision';data.sync_result={version:1,document_id:d.id,source_revision:options.badSyncRevision?'wrong':'server-revision',state:report?(report.needsRecruiter?'needs_review':'completed'):'failed',reasons:report?report.reasons:['Узгодження потребує повторної перевірки'],auto_filled:report?.autoFilled||0};}
  if(options.legacy)delete data.persistence_version;
  return {data};
 }},from(table){let filters=[],insert,patch;const q={select(){return q},eq(k,v){filters.push([k,v]);return q},insert(v){insert=v;return q},update(v){patch=v;return q},single:run,maybeSingle:run,then(a,b){return run().then(a,b)}};
  async function run(){let data;if(table==='documents'){
   if(insert){data={...structuredClone(insert),id:'d'+(state.docs.length+1)};state.docs.push(data);}
   else data=state.docs.find(d=>filters.every(([k,v])=>d[k]===v));
  }else data=state.candidate;
  if(!data)return {error:{message:'Тестовий запис не знайдено'}};
  if(patch){state.browserPatches.push(structuredClone(patch));Object.assign(data,structuredClone(patch));}return {data:structuredClone(data)};
  }return q;
 },async rpc(fn,{document_id,selections}){
  if(fn==='crm_splav_enqueue_autopilot'){state.autopilotRequests=(state.autopilotRequests||0)+1;return options.queue?{data:{id:'job-'+document_id,state:'queued',zone_authorized:true}}:{error:{code:'PGRST202',message:'Function not available'}};}
  if(fn==='crm_splav_enqueue')return options.queue?{data:{id:'job-'+document_id,state:'queued'}}:{error:{code:'55000',message:'SPLAV_QUEUE_DISABLED'}};
  const doc=state.docs.find(d=>d.id===document_id);assert(doc);assert.equal(fn,'crm_apply_document_fields');
  for(const s of selections){assert.deepEqual(JSON.parse(JSON.stringify(s.expected_ai)),doc.ai_extracted);if(['sync_guard','sync_conflict'].includes(s.target))continue;const dest=s.target==='candidate'?state.candidate:state.candidate.profile_data;assert.deepEqual(JSON.parse(JSON.stringify(dest[s.key]??null)),JSON.parse(JSON.stringify(s.expected_current)));}
  for(const s of selections){if(s.target==='sync_guard')continue;if(s.target==='sync_conflict'){doc.ai_warnings=[...new Set([...(doc.ai_warnings||[]),'[CRM AI sync] '+s.incoming])];continue;}const dest=s.target==='candidate'?state.candidate:state.candidate.profile_data;dest[s.key]=structuredClone(s.incoming);}
  state.rpcs++;return {};
 }};
 const elements={'#docFileInput':{files:[]},'#docUploadStatus':{textContent:''},'#closeDocModal':{},'#docUploadButton':{}};
 const modal={dataset:{candidateId:'c',...(options.autopilot?{autopilot:'true'}:{})},querySelector:s=>elements[s],querySelectorAll:()=>[]};
 const c=vm.createContext({console,structuredClone,crypto:webcrypto,TextEncoder,URL,supabaseClient:client,CRMWorkspace:{busy:false},CRMUploadPDF:{isJPEG:()=>false,prepare:async f=>f},DOC_MAX_SIZE:20e6,DOC_BUCKET:'test',AI_DOC_FUNCTION:'test-ai',document:{getElementById:id=>id==='documentModal'?modal:null},getCurrentUser:async()=>({id:'u'}),getCandidates:async()=>[structuredClone(state.candidate)],getDocumentRequirements:async()=>requirements,alert:m=>{throw Error(m)}});c.window=c;
 for(const f of ['supabase/functions/_shared/document-data-policy.js','education-document.js','work-document.js','document-ai-sync.js','candidate-field-registry.js','service-record-readiness.js','crm-service-record.js'])vm.runInContext(read(f),c);
 const automate=c.CRMDocumentSync.automate;c.CRMDocumentSync.automate=async(...args)=>{state.automations++;return automate(...args)};
 c.documentAIError=async e=>e.message;c.findCandidateByName=()=>null;
 const src=read('documents.js');vm.runInContext(src.slice(src.indexOf('async function classifyStoredDocument('),src.indexOf('let scannerBatchFiles=')),c);
 async function upload(names){elements['#docFileInput'].files=names.map(n=>({name:n,type:'application/pdf',size:100,arrayBuffer:async()=>new TextEncoder().encode(n).buffer}));await c.uploadSelectedDocuments();return elements['#docUploadStatus'].textContent;}
 return {c,state,upload};
}
test('batch upload classifies, persists facts, isolates exceptions, reloads and feeds service record',async()=>{
 const {c,state,upload}=setup();const report=await upload(['birth.pdf','diploma.pdf','fail.pdf','work.pdf','rl.pdf','other.pdf','birth.pdf']);
 assert.equal(state.docs.length,6);assert.equal(state.calls.length,6);assert.equal(state.uploads.length,6);assert(report.includes('точний дублікат'));assert(report.includes('Тестова помилка AI'));
 assert.equal(state.docs.find(d=>d.file_name==='fail.pdf').processing_status,'AI помилка');
 assert.equal(state.candidate.birth_place,'Дніпро');assert.equal(state.candidate.military_specialty,'225256А');assert.equal(state.candidate.profile_data.service_type,'За мобілізацією');assert.equal(state.candidate.profile_data.shpk,undefined);
 assert.equal(state.candidate.profile_data.relatives.length,1);assert.equal(state.candidate.profile_data.education_records.length,1);assert.equal(state.candidate.profile_data.education_records[0].degree,'професійна');assert.equal(state.candidate.profile_data.work_records.length,1);
 const other=state.docs.find(d=>d.file_name==='other.pdf');assert.equal(other.verification_status,'Потребує перевірки');assert(!JSON.stringify(state.candidate).includes('Чуже місце'));
 const reloaded=JSON.parse(JSON.stringify(state.candidate)),before=JSON.stringify(reloaded);await c.CRMDocumentSync.sync(c.supabaseClient,state.docs[0].id);assert.equal(JSON.stringify(state.candidate),before);
 const readiness=c.CRMServiceReadiness.review(reloaded,{},state.docs);assert.equal(readiness.ready,true);
 const model=c.CRMServiceRecord.model(reloaded,{}),value=k=>model.fields.find(f=>f.key===k)?.value;
 assert(value('education_civil').includes('Тестове училище'));assert(value('parents').includes('ТЕСТЕНКО Олена'));assert.equal(value('not_served'),'Військову службу не проходив');assert(value('work_0_2').includes('Тестове підприємство'));assert(value('work_0_3').includes('Водій'));
 if(process.env.CRM_PIPELINE_PDF==='1'){
  const modules=process.env.CRM_NODE_MODULES||'C:/Users/eugen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
  c.PDFLib=require(path.join(modules,'pdf-lib'));c.fontkit=require(process.env.CRM_FONTKIT_MODULE||path.join(root,'tmp/fontkit.cjs'));c.Blob=Blob;c.loadExternalScript=async()=>{};
  c.fetch=async url=>{const bytes=fs.readFileSync(path.join(root,new URL(url).pathname));return {ok:true,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}};
  // pdf-lib validates plain-object prototypes; execute renderer in its Node realm.
  new Function('window','PDFLib','loadExternalScript','fetch',read('crm-service-record.js'))(c,c.PDFLib,c.loadExternalScript,c.fetch);
  const blob=await c.CRMServiceRecord.create(c.CRMServiceRecord.model(reloaded,{})),bytes=Buffer.from(await blob.arrayBuffer());
  const pdf=await c.PDFLib.PDFDocument.load(bytes),blank=await c.PDFLib.PDFDocument.load(fs.readFileSync(path.join(root,'templates/service-record/blank.pdf')));
  assert.equal(pdf.getPageCount(),10);assert.deepEqual(pdf.getPages().map(p=>p.getSize()),blank.getPages().map(p=>p.getSize()));
  if(process.env.CRM_PIPELINE_PDF_OUTPUT)fs.writeFileSync(process.env.CRM_PIPELINE_PDF_OUTPUT,bytes);
 }
});

test('stale AI response cannot make the browser mark a newer success as failed',async()=>{const {state,upload}=setup({stale:true});const report=await upload(['birth.pdf']);assert(report.includes('Стан документа вже змінено'));assert.equal(state.docs.length,1);assert.equal(state.docs[0].processing_status,'AI оброблено');assert.equal(state.docs[0].ai_extracted.new_result,'preserve');assert.equal(state.browserPatches.length,0);});
test('old server contract fails safely without browser AI writes or another upload',async()=>{const {state,upload}=setup({legacy:true});const report=await upload(['birth.pdf']);assert(report.includes('Потрібно оновити сервер СПЛАВ'));assert.equal(state.docs.length,1);assert.equal(state.calls.length,1);assert.equal(state.browserPatches.length,0);});

test('source-bound server reconciliation prevents a second browser transfer',async()=>{const {state,upload}=setup({serverSync:true});const result=await upload(['birth.pdf']);assert(result.includes('розпізнано й узгоджено'));assert.equal(state.automations,1);assert.equal(state.candidate.birth_place,'Дніпро');assert.equal(state.docs.length,1);});
test('mismatched reconciliation metadata falls back to the existing guarded planner',async()=>{const {state,upload}=setup({serverSync:true,badSyncRevision:true});await upload(['birth.pdf']);assert.equal(state.automations,2);assert.equal(state.candidate.profile_data.relatives.length,1);});
test('server reconciliation failure stays visible without a silent second application',async()=>{const {state,upload}=setup({serverSync:'failed'});const result=await upload(['birth.pdf']);assert(result.includes('Узгодження потребує повторної перевірки'));assert.equal(state.automations,0);assert.equal(state.docs[0].processing_status,'AI оброблено');});
test('manual retry also consumes the source-bound server outcome without duplicate sync',async()=>{const {c,state,upload}=setup({serverSync:true});await upload(['birth.pdf']);state.automations=0;const alerts=[];c.alert=m=>alerts.push(m);c.activeDocumentsCandidateId='c';c.reloadDocumentView=async()=>{};c.reviewDocumentData=async()=>{};const src=read('documents.js');vm.runInContext(src.slice(src.indexOf('async function retryDocumentAI('),src.indexOf('async function openDocument(')),c);await c.retryDocumentAI('d1');assert.equal(state.automations,1);assert(alerts.some(m=>m.includes('СПЛАВ завершив')));assert.equal(state.candidate.profile_data.relatives.length,1);});

test('enabled background queue accepts uploaded files without waiting for OCR or invoking it in the browser',async()=>{const {state,upload}=setup({queue:true});const message=await upload(['birth.pdf','diploma.pdf']);assert.equal(state.docs.length,2);assert.equal(state.calls.length,0);assert.equal(state.automations,0);assert.equal(state.browserPatches.length,0);assert.match(message,/фонової черги/);assert.match(message,/вкладку можна закрити/);});

test('explicit upload delegation queues the complete bounded pipeline without browser AI',async()=>{
 const {c,state,upload}=setup({queue:true,autopilot:true});const message=await upload(['birth.pdf','diploma.pdf']);
 assert.equal(state.autopilotRequests,2);assert.equal(state.docs.length,2);assert.equal(state.calls.length,0);assert.equal(state.automations,0);assert.equal(state.browserPatches.length,0);assert.match(message,/детальне читання та звірку/);
 assert.equal(c.document.getElementById('documentModal').querySelector('#docUploadButton').textContent,'Передано СПЛАВ');
});
test('missing autopilot server leaves the original saved and never silently falls back to paid browser processing',async()=>{
 const {state,upload}=setup({autopilot:true});const message=await upload(['birth.pdf']);
 assert.equal(state.docs.length,1);assert.equal(state.autopilotRequests,1);assert.equal(state.calls.length,0);assert.equal(state.automations,0);assert.match(message,/Сервер ще не оновлено/);assert.match(message,/не запускалося/);
 assert.equal(state.docs[0].processing_status,'AI очікує');
 const context=vm.createContext({window:{}});vm.runInContext(read('document-state.js'),context);
 assert.equal(context.window.CRMDocumentState.fileState(state.docs[0]),'Очікує опрацювання СПЛАВ');
});
test('UI waits for the queued child instead of reporting root completion as the final result',async()=>{
 const source=read('documents.js'),timers=[],calls=[],status={textContent:''},rootId='11111111-1111-4111-8111-111111111111',childId='22222222-2222-4222-8222-222222222222';let reloads=0;
 const c=vm.createContext({activeDocumentsCandidateId:'c',activeDocumentsReadOnly:false,CRMWorkspace:{busy:false},setTimeout:fn=>timers.push(fn),reloadDocumentView:async()=>reloads++,document:{getElementById:id=>id==='documentRows'?{dataset:{splavCandidate:'c'}}:status},supabaseClient:{rpc:async(name,{job_id})=>{calls.push(job_id);return {data:job_id===rootId?{state:'needs_review',result:{continuation:{state:'queued',job_id:childId}}}:{state:'needs_review',result:{status:'complete_with_gaps'}}};}}});
 vm.runInContext(source.slice(source.indexOf('const splavTrackedJobs='),source.indexOf('async function resumeSplavJobs')),c);
 c.trackSplavJob(rootId,'c');await timers.shift()();assert.equal(reloads,0);assert.equal(timers.length,1);assert.match(status.textContent,/триває детальне читання/);
 await timers.shift()();assert.deepEqual(calls,[rootId,childId]);assert.equal(reloads,1);assert.equal(timers.length,0);assert.match(status.textContent,/потрібна звірка/);
});
test('late queue response cannot update a different candidate or start tracking its child',async()=>{
 const source=read('documents.js'),timers=[],status={textContent:'unchanged'};let resolve,reloads=0;const pending=new Promise(r=>resolve=r);
 const c=vm.createContext({activeDocumentsCandidateId:'a',activeDocumentsReadOnly:false,CRMWorkspace:{busy:false},setTimeout:fn=>timers.push(fn),reloadDocumentView:async()=>reloads++,document:{getElementById:()=>status},supabaseClient:{rpc:async()=>pending}});
 vm.runInContext(source.slice(source.indexOf('const splavTrackedJobs='),source.indexOf('async function resumeSplavJobs')),c);
 c.trackSplavJob('root','a');const turn=timers.shift()();c.activeDocumentsCandidateId='b';resolve({data:{state:'needs_review',result:{continuation:{state:'queued',job_id:'22222222-2222-4222-8222-222222222222'}}}});await turn;
 assert.equal(reloads,0);assert.equal(timers.length,0);assert.equal(status.textContent,'unchanged');
});


test('excluded source retry hides confirmed and AI-disabled documents and escapes identifiers',()=>{
 const c=vm.createContext({docEscape:s=>String(s).replaceAll('"','&quot;')});const src=read('documents.js');
 vm.runInContext(src.slice(src.indexOf('function excludedDocumentRetryHtml('),src.indexOf('async function showDocuments(')),c);
 const d={id:'source"1',requirement_id:'r',verification_status:'Не перевірено'};
 assert.match(c.excludedDocumentRetryHtml(d,[{id:'r',ai_enabled:true}]),/source&quot;1/);
 assert.equal(c.excludedDocumentRetryHtml({...d,verification_status:'Підтверджено'},[]),'');
 assert.equal(c.excludedDocumentRetryHtml(d,[{id:'r',ai_enabled:false}]),'');
});
test('excluded source retry uses existing queued action, workspace guard and busy lock',async()=>{
 const calls=[],alerts=[],c=vm.createContext({CRMWorkspace:{busy:false},retryDocumentAI:async id=>calls.push(id),alert:m=>alerts.push(m)}),src=read('documents.js');
 vm.runInContext(src.slice(src.indexOf('async function retryExcludedDocument('),src.indexOf('async function showDocuments(')),c);
 const b={disabled:false,isConnected:true,dataset:{excludedRetry:'source'}};
 await c.retryExcludedDocument(b,async()=>false);assert.equal(calls.length,0);
 c.CRMWorkspace.busy=true;await c.retryExcludedDocument(b,async()=>true);assert.equal(calls.length,0);
 c.CRMWorkspace.busy=false;await c.retryExcludedDocument(b,async()=>true);assert.deepEqual(calls,['source']);assert.equal(b.disabled,false);assert.equal(c.CRMWorkspace.busy,false);
 c.retryDocumentAI=async()=>{throw Error('queue unavailable')};await c.retryExcludedDocument(b,async()=>true);assert.deepEqual(alerts,['queue unavailable']);assert.equal(c.CRMWorkspace.busy,false);
});

test('saved review button and request reuse the guarded Edge action without OCR or queue calls',async()=>{
 const src=read('documents.js'),calls=[],alerts=[];
 const c=vm.createContext({docEscape:String,AI_DOC_FUNCTION:'process-id-document',activeDocumentsCandidateId:null,alert:m=>alerts.push(m),documentAIError:async e=>e.message,supabaseClient:{from:()=>{const q={select:()=>q,eq:()=>q,single:async()=>({data:{id:'d',candidate_id:'c',ai_processed_at:'revision'}})};return q},functions:{invoke:async(fn,args)=>{calls.push({fn,args});return {data:{rechecked:true,matched_fields:11}}}}}});
 vm.runInContext(src.slice(src.indexOf('function savedReviewButtonHtml('),src.indexOf('function excludedDocumentRetryHtml(')),c);
 assert.match(c.savedReviewButtonHtml({id:'d',processing_status:'AI оброблено',verification_status:'Не перевірено',ai_raw_response:{document_type:'Витяг з Резерв+'}}),/data-doc-recheck/);
 assert.equal(c.savedReviewButtonHtml({id:'d',processing_status:'AI оброблено',verification_status:'Підтверджено',ai_raw_response:{document_type:'Витяг з Резерв+'}}),'');
 await c.recheckSavedDocument('d');assert.equal(calls.length,1);assert.equal(calls[0].args.body.action,'recheck_saved');assert.equal(calls[0].args.body.expected_revision,'revision');assert(alerts[0].includes('без нового AI'));
});

test('processing metrics render only bounded valid counters and escape provider text',()=>{
 const src=read('documents.js'),c=vm.createContext({docEscape:v=>String(v).replaceAll('<','&lt;')});vm.runInContext(src.slice(src.indexOf('function documentProcessingMetricsHtml('),src.indexOf('function documentFileHtml(')),c);
 assert.equal(c.documentProcessingMetricsHtml({}), '');assert.equal(c.documentProcessingMetricsHtml({ai_raw_response:{processing_metrics:{version:1,http_requests:-1}}}), '');
 const html=c.documentProcessingMetricsHtml({ai_raw_response:{processing_metrics:{version:1,http_requests:2,provider_attempts:1,duration_ms:1000,attempts:[{provider:'<script>',model:'model',http_status:200,response_parsed:true}]}}});assert(html.includes('&lt;script>'));assert(!html.includes('<script>'));assert(html.includes('HTTP-спроб: 2'));assert(html.includes('не є підтвердженням списання'));
});
