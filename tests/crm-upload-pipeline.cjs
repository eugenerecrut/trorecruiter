// Real browser modules and upload loop; simulated Storage/Edge/RPC, no network.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{webcrypto}=require('node:crypto');
const root=path.join(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const name='ТЕСТЕНКО Іван Петрович';
function setup(options={}){
 const state={candidate:{id:'c',full_name:name,birth_date:'1990-01-01',rnokpp:'1234567890',worked_before:true,served_before:false,profile_data:{service_type:'За мобілізацією'}},docs:[],uploads:[],calls:[],browserPatches:[],rpcs:0};
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
  const doc=state.docs.find(d=>d.id===document_id);assert(doc);assert.equal(fn,'crm_apply_document_fields');
  for(const s of selections){assert.deepEqual(JSON.parse(JSON.stringify(s.expected_ai)),doc.ai_extracted);if(['sync_guard','sync_conflict'].includes(s.target))continue;const dest=s.target==='candidate'?state.candidate:state.candidate.profile_data;assert.deepEqual(JSON.parse(JSON.stringify(dest[s.key]??null)),JSON.parse(JSON.stringify(s.expected_current)));}
  for(const s of selections){if(s.target==='sync_guard')continue;if(s.target==='sync_conflict'){doc.ai_warnings=[...new Set([...(doc.ai_warnings||[]),'[CRM AI sync] '+s.incoming])];continue;}const dest=s.target==='candidate'?state.candidate:state.candidate.profile_data;dest[s.key]=structuredClone(s.incoming);}
  state.rpcs++;return {};
 }};
 const elements={'#docFileInput':{files:[]},'#docUploadStatus':{textContent:''},'#closeDocModal':{},'#docUploadButton':{}};
 const modal={dataset:{candidateId:'c'},querySelector:s=>elements[s],querySelectorAll:()=>[]};
 const c=vm.createContext({console,structuredClone,crypto:webcrypto,TextEncoder,URL,supabaseClient:client,CRMWorkspace:{busy:false},CRMUploadPDF:{isJPEG:()=>false,prepare:async f=>f},DOC_MAX_SIZE:20e6,DOC_BUCKET:'test',AI_DOC_FUNCTION:'test-ai',document:{getElementById:id=>id==='documentModal'?modal:null},getCurrentUser:async()=>({id:'u'}),getCandidates:async()=>[structuredClone(state.candidate)],getDocumentRequirements:async()=>requirements,alert:m=>{throw Error(m)}});c.window=c;
 for(const f of ['supabase/functions/_shared/document-data-policy.js','education-document.js','work-document.js','document-ai-sync.js','candidate-field-registry.js','service-record-readiness.js','crm-service-record.js'])vm.runInContext(read(f),c);
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
