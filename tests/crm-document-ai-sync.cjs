const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const root=path.resolve(__dirname,'..');
require('../supabase/functions/_shared/document-data-policy.js');
const sync=require('../document-ai-sync.js');
const uploadPDF={prepare:async file=>file,isJPEG:()=>false};
const candidate=()=>({id:'c1',full_name:'ТЕСТЕНКО Іван Петрович',birth_date:'1990-06-13',rnokpp:'1234567890',profile_data:{service_type:'За мобілізацією'}});
const document=(extracted,type='Рекомендаційний лист')=>({id:'d1',candidate_id:'c1',file_name:'test.pdf',document_type:type,ai_extracted:extracted});
const personal=()=>({full_name:'Тестенко Іван Петрович',birth_date:'1990-06-13',rnokpp:'1234567890'});
const service=()=>({military_specialty:'225256А',shpk:'солдат',tariff_grade:2,recruiter_name:'Сергій ТЕСТЕНКО',military_unit:'А7036',desired_position:'МЕХАНІК',signatory:'Іван ТЕСТЕНКО',desired_unit:'військова частина А7036',recommender_unit:'А7036',service_type:'за контрактом'});
function memory(c,d){
  const state={c:structuredClone(c),d:structuredClone(d),writes:0,rpcs:0,fail:null};
  const client={from(table){let id,patch,insert;const q={select(){return q},eq(k,v){id=v;return q},insert(v){insert=v;return q},update(v){patch=v;return q},single:run,maybeSingle:run,then(a,b){return run().then(a,b)}};
    async function run(){if(state.fail)return {error:{message:state.fail}};if(table==='documents'&&insert){state.d={...state.d,...insert};state.writes++}if(patch){Object.assign(table==='documents'?state.d:state.c,patch);state.writes++}return {data:structuredClone(table==='documents'?state.d:state.c),error:null};}return q;},
    storage:{from(){return {async upload(){return {error:null}},async remove(){return {error:null}}}}},
    async rpc(name,{document_id,selections}){
      state.rpcs++;assert.equal(name,'crm_apply_document_fields');assert.equal(document_id,state.d.id);
      // Transactional contract mock. SQL syntax and guards are checked separately below.
      for(const s of selections){if(JSON.stringify(s.expected_ai)!==JSON.stringify(state.d.ai_extracted))return {error:{message:'AI changed'}};
        if(['sync_guard','sync_conflict'].includes(s.target))continue;const current=(s.target==='candidate'?state.c:state.c.profile_data)[s.key]??null;
        if(JSON.stringify(current)!==JSON.stringify(s.expected_current))return {error:{message:'Concurrent edit'}};}
      for(const s of selections)if(s.target==='sync_guard')continue;else if(s.target==='sync_conflict'){const w='[CRM AI sync] '+s.incoming;state.d.ai_warnings=[...new Set([...(state.d.ai_warnings||[]),w])];}else (s.target==='candidate'?state.c:state.c.profile_data)[s.key]=structuredClone(s.incoming);
      state.writes++;return {error:null};
    }};
  return {state,client};
}
test('Flat and nested RL yield identical validated selections and preserve mobilization',()=>{
  const nested=sync.plan(document({personal:personal(),service:service()}),candidate());
  const flat=sync.plan(document({...personal(),...service()}),candidate());
  assert.deepEqual(nested.selections.map(({expected_ai,...s})=>s),flat.selections.map(({expected_ai,...s})=>s));
  for(const key of ['military_specialty','shpk','tariff_grade','recruiter_name','military_unit','signatory','desired_position'])assert(nested.selections.some(s=>s.key===key));
  assert.equal(nested.rows.find(r=>r.key==='service_type').action,'conflict');assert(!nested.selections.some(s=>s.key==='service_type'));
});
test('Invalid Parfionenko SHPK and mixed Latin OCR are rejected, valid VOS retained',()=>{
  const s={...service(),shpk:'сола aT в',full_name:'Мродвонеєко Masur Gpricobic',military_specialty:'218121'};
  const report=sync.plan(document({...personal(),...s}),candidate());
  assert.equal(report.rows.find(r=>r.key==='shpk').action,'conflict');assert(!report.selections.some(x=>x.key==='shpk'));
  assert(report.selections.some(x=>x.key==='military_specialty'));assert(!report.selections.some(x=>x.key==='full_name'));
});
test('Missing VOS stays missing; nested fallback supports flat nulls',()=>{
  const e={...personal(),service:service(),military_specialty:null};assert.equal(sync.flatten(e).military_specialty,'225256А');
  const s=service();delete s.military_specialty;assert(!sync.plan(document({...personal(),...s}),candidate()).selections.some(x=>x.key==='military_specialty'));
});
test('Manual and legacy form values remain unchanged',()=>{
  const c=candidate();c.military_specialty='790037А';c.profile_data.shpk='сержант';c.profile_data.form_data={tariff_grade:'5'};
  const p=sync.plan(document({...personal(),...service()}),c);for(const key of ['military_specialty','shpk','tariff_grade','service_type'])assert(!p.selections.some(s=>s.key===key));
});
test('Mismatched owner and another person warning block automatic sync',()=>{
  const d=document({...personal(),...service(),rnokpp:'0000000000'});assert.equal(sync.plan(d,candidate()).selections.length,0);
  d.ai_extracted.rnokpp='1234567890';d.ai_warnings=['У тексті згадано іншого кандидата'];assert.equal(sync.plan(d,candidate()).selections.length,0);
});
test('Birth certificate maps birth place, number, parents and partial dates without duplicates',()=>{
  const c=candidate();c.profile_data.relatives=[{relationship:'Мати',full_name:'ТЕСТЕНКО Олена Іванівна',phone:'manual',birth_date:'1976-11-02'}];
  const d=document({...personal(),birth_place:'м. Дніпро',document_number:'І-КИ № 123456',relatives:[{relation:'mother',full_name:'Тестенко Олена Іванівна',phone:'AI',birth_date:'1976-11-03'},{relation:'батько',full_name:'Тестенко Петро Іванович',birth_date:'1970-05'}]},'Свідоцтво про народження');
  const p=sync.plan(d,c);const rel=p.selections.find(s=>s.key==='relatives');assert.equal(rel.incoming.length,2);assert.equal(rel.incoming[0].phone,'manual');assert.equal(rel.incoming[0].birth_date,'1976-11-02');assert.equal(rel.incoming[1].relationship,'батько');assert.equal(rel.incoming[1].birth_date,'1970-05');
  assert(p.rows.some(r=>r.action==='conflict'&&r.key.endsWith('birth_date')));assert(p.selections.some(s=>s.key==='birth_place'));assert(p.selections.some(s=>s.key==='birth_certificate'));
  c.profile_data.relatives=rel.incoming;assert(!sync.plan(d,c).selections.some(s=>s.key==='relatives'));
});
test('Conflicting parent names, invalid dates and child certificates are not merged into candidate identity',()=>{
  const c=candidate();c.profile_data.relatives=[{relationship:'Мати',full_name:'Тестенко Олена Іванівна'}];
  const d=document({...personal(),relatives:[{relation:'мати',full_name:'Тестенко Ірина Іванівна'},{relation:'батько',full_name:'Тестенко Петро Іванович',birth_date:'1970-02-30'}]},'Свідоцтво про народження');
  const p=sync.plan(d,c);assert.equal(p.selections.find(s=>s.key==='relatives').incoming.length,2);assert(p.rows.filter(r=>r.action==='conflict').length===2);
  d.document_type='Свідоцтва про народження дітей';assert.equal(sync.plan(d,c).supported,false);
});
test('Preview makes no writes; apply persists and reload/re-upload are idempotent',async()=>{
  const {client,state}=memory(candidate(),document({personal:personal(),service:service(),relatives:[{relation:'мати',full_name:'Тестенко Олена Іванівна',birth_date:'1976-11-02'}]}));
  const p=await sync.preview(client,'d1');assert.equal(state.writes,0);await sync.apply(client,p);
  const after=await sync.preview(client,'d1');assert.equal(after.selections.length,0);assert.equal(state.c.profile_data.service_type,'За мобілізацією');
  const first=JSON.stringify(state.c);await sync.sync(client,'d1');assert.equal(JSON.stringify(state.c),first);assert.equal(state.c.profile_data.relatives.length,1);assert.equal(state.d.ai_warnings.length,1);
});
test('Concurrent manual edit, changed AI and read/write errors never report success',async()=>{
  const m=memory(candidate(),document({...personal(),...service()}));const p=await sync.preview(m.client,'d1');m.state.c.military_specialty='manual';await assert.rejects(sync.apply(m.client,p),e=>e.message==='Concurrent edit');assert.equal(m.state.c.profile_data.shpk,undefined);
  const n=memory(candidate(),document({...personal(),...service()}));const q=await sync.preview(n.client,'d1');n.state.d.ai_extracted.shpk='сержант';await assert.rejects(sync.apply(n.client,q),e=>e.message==='AI changed');
  n.state.fail='Read failed';await assert.rejects(sync.preview(n.client,'d1'),e=>e.message==='Read failed');
});
test('Active upload syncs exact document without redundant browser OCR',async()=>{
  const source=fs.readFileSync(path.join(root,'documents.js'),'utf8');const code=source.slice(source.indexOf('function acceptedServerReconciliation('),source.indexOf('function normName('))+source.slice(source.indexOf('async function processOneDocument('),source.indexOf('async function uploadSelectedDocuments('));
  const m=memory(candidate(),document({...personal(),...service()}));let invoked,ocr=0;const context={enqueueSplavDocument:async()=>null,CRMUploadPDF:uploadPDF,supabaseClient:m.client,DOC_MAX_SIZE:20e6,DOC_BUCKET:'candidate-documents',getDocumentRequirements:async()=>[{id:'r1',document_type:'Рекомендаційний лист'}],extractPdfText:async()=>'',pdfToImages:async()=>['image'],runOcr:async()=>{ocr++;return 'text'},classifyStoredDocument:async(id)=>{invoked=id;Object.assign(m.state.d,{processing_status:'AI оброблено',ai_extracted:{...personal(),...service()},ai_confidence:0.99});return {document_type:'Рекомендаційний лист',confidence:0.99,extracted:{...personal(),...service()}}},findCandidateByName:()=>null,document:{getElementById:()=>null},CRMDocumentSync:sync,console};vm.createContext(context);vm.runInContext(code,context);
  await context.processOneDocument({name:'test.pdf',type:'application/pdf',size:100},'r1',{id:'u1'},[], 'c1');assert.equal(invoked,'d1');assert.equal(m.state.writes,3);assert.equal(ocr,0);assert.equal(m.state.rpcs,1);assert.equal(m.state.c.military_specialty,'225256А');
});
test('Recommendation form supports both formats and saves canonical service/relative fields',async()=>{
  let extracted={...personal(),...service()};
  const ctx={CRMUploadPDF:uploadPDF,window:{CRMDocumentSync:sync,supabaseClient:{auth:{getSession:async()=>({data:{session:{access_token:'test'}}})},functions:{invoke:async()=>({data:{extracted}})}}},document:{getElementById:()=>null,querySelectorAll:()=>[]},structuredClone,console};vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(root,'recommendation-upload-fix.js'),'utf8'),ctx);
  const a=await ctx.window.aiExtractRecommendation('text');extracted={personal:personal(),service:service()};const b=await ctx.window.aiExtractRecommendation('text');assert.equal(a.military_specialty,b.military_specialty);assert.equal(a.shpk,'солдат');
  const save=fs.readFileSync(path.join(root,'script.js'),'utf8');assert(save.includes("military_specialty: String(fd.get('military_specialty')"));assert(save.includes("'shpk','tariff_grade','recruiter_name'"));assert(save.includes("form.__pskReadRelatives()"));
  assert(!fs.readFileSync(path.join(root,'ai-recommendation-bridge.js'),'utf8').includes(".eq('full_name',fullName)"));
});
test('RPC preserves authorization/RLS/audit, whitelist and atomic compare-and-set guards',()=>{
  const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261009155939_safe_document_ai_sync.sql'),'utf8');
  for(const fragment of ["public.crm_staff","auth.uid()","for update","expected_current","expected_ai","fill_only","Не можна змінювати збережені дані родича","crm.source_document_id","'shpk','tariff_grade','recruiter_name'","[CRM AI sync]"])assert(sql.includes(fragment),fragment);
  assert(!/security definer/i.test(sql));assert(!/create table|alter table|disable.*row level/i.test(sql));
});

test('recommendation refreshes 401 once and never duplicates non-auth provider failures',async()=>{
 for(const status of [401,503]){
  let calls=0,refreshes=0;const headers=[];
  const ctx={CRMUploadPDF:uploadPDF,window:{CRMDocumentSync:sync,supabaseClient:{auth:{getSession:async()=>({data:{session:{access_token:'old'}}}),refreshSession:async()=>{refreshes++;return {data:{session:{access_token:'fresh'}}}}},functions:{invoke:async(_name,options)=>{calls++;assert.equal(options.timeout,110000);headers.push(options.headers.Authorization);return calls===1||status!==401?{error:{message:'failed',context:{status,json:async()=>({error:'server failed'})}}}:{data:{extracted:{...personal(),...service()}}};}}}},document:{getElementById:()=>null,querySelectorAll:()=>[]},structuredClone,console};
  vm.createContext(ctx);vm.runInContext(read('recommendation-upload-fix.js'),ctx);
  if(status===401){await ctx.window.aiExtractRecommendation('text');assert.equal(calls,2);assert.equal(refreshes,1);assert.deepEqual(headers,['Bearer old','Bearer fresh']);}
  else{await assert.rejects(ctx.window.aiExtractRecommendation('text'),/тимчасово недоступний/);assert.equal(calls,1);assert.equal(refreshes,0);}
 }
});

test('recommendation form tries original after OCR failure and hides empty extraction',async()=>{
 const source=read('script.js'),code=source.slice(source.indexOf('function recommendationHasData('),source.indexOf('function safeFileName('));
 for(const mode of ['empty','vision','auth']){
  const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',value:'',hidden:false,classList:{add(){},remove(){}}});return nodes.get(id);};
  let invoked=0,rendered=0,filled=0,parsed=0;
  const ctx={recommendationRequestSequence:0,pendingRecommendationFile:null,pendingRecommendationText:'',CRMUploadPDF:uploadPDF,document:{getElementById:node},extractPdfText:async()=>{throw Error('OCR failed')},normalizeDocumentText:v=>v,aiExtractRecommendation:async()=>{invoked++;if(mode==='auth'){const e=Error('Сесія CRM завершилась');e.status=401;throw e;}return mode==='vision'?{full_name:candidate().full_name}:{full_name:''};},parseRecommendation:()=>{parsed++;return{}},renderExtraction:()=>rendered++,fillCandidateForm:()=>filled++,console:{warn(){},error(){}}};
  vm.createContext(ctx);vm.runInContext(code,ctx);
  await ctx.handleRecommendationFile({name:'test.pdf',type:'application/pdf',size:100});
  assert.equal(invoked,1);assert.equal(rendered,mode==='vision'?1:0);assert.equal(filled,mode==='vision'?1:0);assert.equal(parsed,0);
  if(mode==='auth')assert.match(node('ocrStatus').textContent,/Сесія CRM/);
  if(mode==='empty')assert.match(node('ocrStatus').textContent,/не знайшов придатних/);
 }
});

test('local fallback recognizes citizen/vacant-position RL punctuation without inventing rank',()=>{
 const s=read('script.js'),ctx={};vm.createContext(ctx);vm.runInContext(s.slice(s.indexOf('function normalizeLine('),s.indexOf('function renderExtraction(')),ctx);
 const text='ВІЙСЬКОВА ЧАСТИНА А0001. До командування військової частини А0001 звернувся громадянка ТЕСТОВА Олена Петрівна, з проханням проходження військової служби за контрактом. Тел. +380000000000. Вивчено 12.04.2000 р. н., ІПН 1234567890, яка мешкає за адресою: м. Приклад, вул. Тестова, 1. У військовій частині А0001 є потреба на вакантну посаду: ОПЕРАТОР ТЕСТОВОГО ПІДРОЗДІЛУ, ВОС 123456А, ШПК «СОЛДАТ», ТАРИФНИЙ РОЗРЯД 4.';
 const p=ctx.parseRecommendation(text);
 assert.equal(p.full_name,'ТЕСТОВА Олена Петрівна');assert.equal(p.birth_date,'2000-04-12');assert.equal(p.phone,'+380000000000');assert.equal(p.rnokpp,'1234567890');
 assert.equal(p.address,'м. Приклад, вул. Тестова, 1');assert.equal(p.military_unit,'А0001');assert.equal(p.desired_position,'ОПЕРАТОР ТЕСТОВОГО ПІДРОЗДІЛУ');assert.equal(p.shpk,'СОЛДАТ');assert.equal(p.military_specialty,'123456А');assert.equal(p.tariff_grade,'4');assert.equal(p.military_rank,'');
 assert.equal(ctx.parseRecommendation('Військова частина А0001 та військової частини А0002').military_unit,'','Ambiguous units are not guessed');
});

test('late preparation of an older recommendation cannot replace the selected file or result',async()=>{
 const s=read('script.js'),code=s.slice(s.indexOf('function recommendationHasData('),s.indexOf('function safeFileName('));
 let releaseA;const held=new Promise(resolve=>releaseA=resolve),rendered=[],invoked=[];
 const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',value:'',classList:{add(){},remove(){}}});return nodes.get(id);};
 const a={name:'a.pdf',type:'application/pdf',size:100},b={name:'b.pdf',type:'application/pdf',size:100};
 const ctx={recommendationRequestSequence:0,pendingRecommendationFile:null,pendingRecommendationText:'',document:{getElementById:node},CRMUploadPDF:{prepare:file=>file===a?held:Promise.resolve(file)},extractPdfText:async file=>'Текст '+file.name+' '.repeat(120),normalizeDocumentText:v=>v,aiExtractRecommendation:async text=>{invoked.push(text);return{full_name:'Новий результат'}},renderExtraction:p=>rendered.push(p.full_name),fillCandidateForm(){},console:{warn(){},error(){}}};
 vm.createContext(ctx);vm.runInContext(code,ctx);
 const first=ctx.handleRecommendationFile(a);await ctx.handleRecommendationFile(b);releaseA(a);await first;
 assert.equal(ctx.pendingRecommendationFile,b);assert.deepEqual(rendered,['Новий результат']);assert.equal(invoked.length,1);assert.match(invoked[0],/b.pdf/);
});

test('late AI response cannot overwrite the newer recommendation receipt',async()=>{
 let inserted;const pending=[];
 const a={name:'older.pdf',size:100,type:'application/pdf'},b={name:'newer.pdf',size:100,type:'application/pdf'};
 const client={auth:{getSession:async()=>({data:{session:{access_token:'test'}}})},functions:{invoke:()=>new Promise(resolve=>pending.push(resolve))},storage:{from:()=>({upload:async()=>({}),remove:async()=>({})})},from:()=>{const q={select(){return q},eq(){return q},limit(){return q},maybeSingle:async()=>({data:null}),insert:data=>{inserted=data;return q},single:async()=>({data:{id:'d'}})};return q;}};
 const ctx={pendingRecommendationFile:a,CRMUploadPDF:uploadPDF,window:{supabaseClient:client,CRMDocumentSync:{flatten:x=>({...x,warnings:[]}),valid:()=>true,sync:async()=>{}}},document:{getElementById:()=>null,querySelectorAll:()=>[]},FileReader:class{readAsDataURL(){this.result='data:application/pdf;base64,JVBERi0=';this.onload()}},structuredClone,console};
 vm.createContext(ctx);vm.runInContext(read('recommendation-upload-fix.js'),ctx);
 const older=ctx.window.aiExtractRecommendation('older');const rejected=assert.rejects(older,/замінено/);
 while(pending.length<1)await new Promise(resolve=>setImmediate(resolve));
 ctx.pendingRecommendationFile=b;const newer=ctx.window.aiExtractRecommendation('newer');
 while(pending.length<2)await new Promise(resolve=>setImmediate(resolve));
 pending[1]({data:{extracted:{full_name:'New result'},model:'synthetic'}});await newer;
 pending[0]({data:{extracted:{full_name:'Old result'},model:'synthetic'}});await rejected;
 assert.equal((await ctx.window.uploadRecommendation('c',{id:'u'})).ok,true);
 assert.equal(inserted.file_name,'newer.pdf');assert.equal(inserted.ai_extracted.full_name,'New result');
});

test('failed flattening cannot leave an AI receipt for recommendation upload',async()=>{
 let inserted;const file={name:'synthetic.pdf',size:100,type:'application/pdf'};
 const client={auth:{getSession:async()=>({data:{session:{access_token:'test'}}})},functions:{invoke:async()=>({data:{extracted:{full_name:'Тестова Олена'}}})},storage:{from:()=>({upload:async()=>({}),remove:async()=>({})})},from:table=>{
  const q={select(){return q},eq(){return q},limit(){return q},maybeSingle:async()=>({data:null}),insert:data=>{inserted=data;return q},single:async()=>({data:{id:'d'}})};return q;
 }};
 const ctx={pendingRecommendationFile:file,CRMUploadPDF:uploadPDF,window:{supabaseClient:client,CRMDocumentSync:{flatten(){throw Error('Bad extraction')},valid:()=>true}},document:{getElementById:()=>null,querySelectorAll:()=>[]},FileReader:class{readAsDataURL(){this.result='data:application/pdf;base64,JVBERi0=';this.onload()}},structuredClone,console};
 vm.createContext(ctx);vm.runInContext(read('recommendation-upload-fix.js'),ctx);
 await assert.rejects(ctx.window.aiExtractRecommendation('text'),/Bad extraction/);
 assert.equal((await ctx.window.uploadRecommendation('c',{id:'u'})).ok,true);
 assert.equal(inserted.processing_status,'Завантажено');assert.equal(Object.hasOwn(inserted,'ai_extracted'),false);
});

test('recommendation observer and timer never mount the relatives card editor in new RL form',async()=>{
 let mutation;const timers=[],form={id:'candidateForm',append(){throw Error('Unexpected relatives UI')},prepend(){throw Error('Unexpected relatives UI')}};
 const ctx={window:{},document:{body:{},getElementById:id=>id==='candidateForm'?form:null,createElement(){throw Error('Unexpected editor')}},MutationObserver:class{constructor(fn){mutation=fn}observe(){}},setInterval:fn=>{timers.push(fn);return 1},setTimeout(){},clearInterval(){},console:{info(){}}};
 vm.createContext(ctx);vm.runInContext(read('ai-recommendation-bridge.js'),ctx);
 await mutation();for(const callback of timers)await callback();
 assert.equal(form.__pskReadRelatives,undefined);assert.equal(form.onsubmit,undefined);
 assert(read('ai-recommendation-bridge.js').includes("document.getElementById('candidateCardV2')"),'Existing candidate-card relative editor remains available');
});

test('Contradictory flat/nested OCR and malformed relative entries become conflicts',()=>{
  const d=document({...personal(),military_specialty:'218121',service:service(),relatives:[null]});
  const p=sync.plan(d,candidate());assert.equal(p.rows.find(r=>r.key==='military_specialty').action,'conflict');assert(!p.selections.some(s=>s.key==='military_specialty'));assert(p.rows.some(r=>r.key==='relatives'&&r.action==='conflict'));
});
test('Retry and review use the same document-scoped planner; no legacy time-window writes',()=>{
  const s=fs.readFileSync(path.join(root,'documents.js'),'utf8');const retry=s.slice(s.indexOf('async function retryDocumentAI'),s.indexOf('async function openDocument'));
  assert(retry.includes('CRMDocumentSync.automate(supabaseClient,id)'));assert(s.includes('CRMDocumentSync.showPreview(supabaseClient,id)'));
  const legacy=fs.readFileSync(path.join(root,'document-upload-fix.js'),'utf8');assert(!legacy.includes('.gte('));assert(legacy.includes('report.document.candidate_id !== candidateId'));
});

test('Marriage act matches candidate among two participants and merges only spouse without duplicates',()=>{
 const c=candidate(); c.profile_data.relatives=[{relationship:'мати',full_name:'ТЕСТЕНКО Олена Іванівна'}];
 const d=document({full_name:null,relatives:[{relationship:'наречений',full_name:c.full_name,birth_date:c.birth_date},{relationship:'наречена',full_name:'ТЕСТЕНКО Марія Петрівна',birth_date:'1992-09-16'}]},'Актовий запис про шлюб');
 const a=sync.plan(d,c); const relatives=a.selections.find(x=>x.key==='relatives').incoming;
 assert.equal(relatives.length,2);assert.equal(relatives[1].relationship,'дружина');assert(!relatives.some(r=>r.full_name===c.full_name));
 c.profile_data.relatives=relatives;assert(!sync.plan(d,c).selections.some(x=>x.key==='relatives'));
 d.ai_extracted.relatives[0].birth_date='1980-01-01';assert.equal(sync.plan(d,c).selections.length,0);
});
test('Non-passport sources never retain passport fields; UBD cannot populate military ID',()=>{
 const policy=globalThis.CRMDocumentPolicy;
 const d=document({passport_data:'EXTRACT-1',passport_expiry_date:'2053-10-06',document_number:'123',military_document_number:'123'},'Військово-обліковий документ (паперовий)');d.requirement_type='Копія УБД';
 const a=policy.normalize(d);assert.equal(a.type,'Копія УБД');assert.equal(a.extracted.passport_data,null);assert.equal(a.extracted.military_document_number,null);assert.equal(d.ai_extracted.passport_data,'EXTRACT-1');
 const b=policy.normalize(document({passport_data:'DRIVER-1',passport_expiry_date:'2053-10-06',document_number:'DRIVER-1'},'Посвідчення водія'));
 assert.equal(b.extracted.driver_license_expiry_date,'2053-10-06');assert.equal(b.extracted.passport_expiry_date,null);
});
test('Malformed military rows remain review-only and structured service can render without legacy text',()=>{
 const policy=globalThis.CRMDocumentPolicy;
 const a=policy.normalize(document({military_service_records:[{unit:'n/n-2',military_specialty:'курса457',start_date:'2020-07-11'}]},'Військовий квиток'));
 assert.equal(a.extracted.military_service_records[0].requires_review,true);
 assert.equal(policy.serviceSummary([{kind:'military_service',start_date:'2022-08-23',end_date:'2025-03-15',employer:'А0536',position:'Інші посади'}]),'2022-08-23 · 2025-03-15 · А0536 · Інші посади');
});

test('Document transfer advances candidate and personal file versions to reject stale card saves',()=>{
 const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261013132000_document_sync_versions.sql'),'utf8');
 assert(sql.includes("if cp<>'{}' then cp:=cp||jsonb_build_object('updated_at',clock_timestamp());end if;"));
 assert(sql.includes("fp:=fp||jsonb_build_object('updated_at',clock_timestamp());"));
 assert(sql.includes('auth.uid()'));assert(sql.includes('expected_current'));assert(sql.includes('expected_ai'));
 assert(!/security definer|disable.*trigger|alter table/i.test(sql));
 const fileSql=fs.readFileSync(path.join(root,'supabase/migrations/20261013132800_document_file_sync_versions.sql'),'utf8');
 assert(fileSql.includes("if cp<>'{}' or fp<>'{}' then cp:=cp||jsonb_build_object('updated_at',clock_timestamp());end if;"));
});

test('Automatic pipeline fills safe blanks and persists recruiter escalation without overwriting mobilization',async()=>{
 const m=memory(candidate(),{...document({...personal(),...service()}),ai_confidence:0.98});const r=await sync.automate(m.client,'d1');assert(r.needsRecruiter);assert(r.autoFilled>0);assert.equal(m.state.c.military_specialty,'225256А');assert.equal(m.state.c.profile_data.service_type,'За мобілізацією');assert.equal(m.state.d.verification_status,'Потребує перевірки');assert(m.state.d.ai_warnings.some(w=>w.startsWith('[Рекрутер]')));
});
test('Low confidence and unreadable evidence do not silently enter a card',async()=>{
 const m=memory(candidate(),{...document({...personal(),military_specialty:'225256А'}),ai_confidence:0.4});const r=await sync.automate(m.client,'d1');assert(r.needsRecruiter);assert.equal(m.state.c.military_specialty,undefined);
 const p=sync.plan(document({...personal(),military_specialty:'225256А',field_evidence:{military_specialty:{legibility:'unreadable'}}}),candidate());assert(!p.selections.some(s=>s.key==='military_specialty'));
});
test('Unmapped service-record sources explicitly request recruiter review',async()=>{
 const m=memory(candidate(),document({...personal(),name_change:{previous_full_name:'Тестов Іван Петрович',new_full_name:'Тестенко Іван Петрович'}},'Свідоцтво про зміну імені / прізвища'));const r=await sync.automate(m.client,'d1');assert(r.needsRecruiter);assert.equal(m.state.rpcs,0);assert.equal(m.state.d.verification_status,'Потребує перевірки');
});
test('Clear source with no conflicting stored values does not trigger a recruiter exception',async()=>{
 const m=memory(candidate(),{...document({...personal(),military_specialty:'225256А'}),ai_confidence:0.99});const r=await sync.automate(m.client,'d1');assert.equal(r.needsRecruiter,false);assert.equal(m.state.c.military_specialty,'225256А');assert.notEqual(m.state.d.verification_status,'Підтверджено');
});


test('Reserve+ aliases normalize narrowly without turning military books or passports into registry extracts',()=>{
 const policy=globalThis.CRMDocumentPolicy,canonical='Військовий облік (витяг Резерв+ / приписне)';
 for(const type of ['Витяг з Резерв+','Витяг із Резерв+','Резерв+',canonical])assert.equal(policy.normalize(document({},type)).type,canonical);
 for(const type of ['Військовий квиток','Паспорт громадянина України','Приписне посвідчення','Інший документ'])assert.equal(policy.normalize(document({},type),canonical).type,type);
});
test('document review is not eleven scalar conflicts when values match; new and different values stay blocked',()=>{
 const c=candidate();c.military_rank='Солдат';c.profile_data.military_specialty='901074';
 const d={...document({...personal(),military_rank:'Солдат',military_specialty:'901074',tcc:'Новий ТЦК'},'Витяг з Резерв+'),notes:'AI REVIEW REQUIRED',ai_confidence:1};
 const p=sync.plan(d,c);
 assert.equal(p.rows.find(r=>r.key==='full_name').action,'leave');
 assert.equal(p.rows.find(r=>r.key==='military_rank').action,'leave');
 assert.equal(p.rows.find(r=>r.key==='military_specialty').action,'leave');
 assert.equal(p.rows.find(r=>r.key==='tcc').action,'conflict');assert.equal(p.selections.length,0);
 const unreadable=sync.plan({...d,ai_extracted:{...d.ai_extracted,field_evidence:{military_specialty:{legibility:'unreadable'}}}},c);
 assert.equal(unreadable.rows.find(r=>r.key==='military_specialty').action,'conflict');
});


test('Expected OCR revision mismatch returns superseded without writes or recruiter escalation',async()=>{
 const d={...document({...personal(),...service()}),ai_processed_at:'2026-10-26T10:00:00Z',ai_confidence:0.99},m=memory(candidate(),d),before=structuredClone(m.state);
 const result=await sync.automate(m.client,'d1',{expectedRevision:'2026-10-26T09:00:00Z'});
 assert.equal(result.superseded,true);assert.equal(result.autoFilled,0);assert.equal(result.needsRecruiter,false);
 assert.equal(m.state.rpcs,0);assert.equal(m.state.writes,0);assert.deepEqual(m.state.c,before.c);assert.deepEqual(m.state.d,before.d);
 assert.equal(m.state.c.profile_data.service_type,'За мобілізацією');
});
test('Expected OCR revision match retains safe blank filling and manual fields',async()=>{
 const c=candidate();c.military_specialty='manual-vos';const d={...document({...personal(),...service()}),ai_processed_at:'r1',ai_confidence:0.99},m=memory(c,d);
 const result=await sync.automate(m.client,'d1',{expectedRevision:'r1'});
 assert.notEqual(result.superseded,true);assert.equal(m.state.c.military_specialty,'manual-vos');assert.equal(m.state.c.profile_data.service_type,'За мобілізацією');
});


test('explicit draft-registration certificate names use registry planning without changing document types',()=>{
 const source={...personal(),military_rank:'Солдат',military_registry_number:'123456789'};
 for(const type of ['Посвідчення про приписку до призовної дільниці','Копія Посвідчення про приписку до призовної дільниці','  ПОСВІДЧЕННЯ ПРО ПРИПИСКУ ДО ПРИЗОВНОЇ ДІЛЬНИЦІ  ']){
  const d=document(source,type),c=candidate(),before=JSON.stringify({d,c}),p=sync.plan(d,c);
  assert.equal(p.supported,true,type);assert(p.selections.some(s=>s.key==='military_registry_number'),type);assert.equal(p.document.document_type,type);assert.equal(JSON.stringify({d,c}),before);
 }
 for(const type of ['Посвідчення водія','Копія УБД','Паспорт громадянина України','Посвідчення про нагороду','Довідка про приписку до роботи','Посвідчення про приписку до призовної дільниці іншої особи']){
  const p=sync.plan(document(source,type),candidate());
  assert(!p.selections.some(s=>s.key==='military_registry_number'),type);
 }
 const wrong=sync.plan({...document({...source,full_name:'Інший Петро Іванович',birth_date:'1980-01-01',rnokpp:'9999999999'},'Посвідчення про приписку до призовної дільниці'),verification_status:'Не перевірено',ai_confidence:0.2},candidate());
 assert.equal(wrong.selections.length,0);assert(wrong.rows.some(r=>r.action==='conflict'));
});

test('draft-registration preserves manual registry number',()=>{
 const c=candidate();c.profile_data.military_registry_number='manual-registry';
 const d=document({...personal(),military_registry_number:'987654321'},'Посвідчення про приписку до призовної дільниці'),before=JSON.stringify({c,d});
 const result=sync.plan(d,c);
 assert(!result.selections.some(selection=>selection.key==='military_registry_number'));
 assert.equal(result.rows.find(row=>row.key==='military_registry_number').action,'conflict');
 assert.equal(JSON.stringify({c,d}),before);
});

test('draft-registration rejects another card and unfinished OCR without proposing fields',()=>{
 for(const type of ['Посвідчення про приписку до призовної дільниці','Копія Посвідчення про приписку до призовної дільниці']){
  const source=document({...personal(),military_registry_number:'987654321'},type);
  for(const patch of [{candidate_id:'another-card'},{processing_status:'AI обробка'},{processing_status:'AI помилка'},{deleted_at:'2026-10-26T00:00:00Z'}]){
   const d={...source,...patch},c=candidate(),before=JSON.stringify({c,d}),result=sync.plan(d,c);
   assert.equal(result.selections.length,0,JSON.stringify(patch));
   assert.equal(JSON.stringify({c,d}),before);
  }
 }
});

test('OCR sex markers become canonical candidate values without changing source extraction',()=>{
 for(const [sex,expected] of [['Ч','male'],[' M ','male'],['М','male'],['чоловіча','male'],['Ж','female'],[' F ','female'],['жіноча','female'],['female','female']]){
  const c=candidate(),d=document({...personal(),sex},'Копія паспорта'),before=JSON.stringify({c,d}),r=sync.plan(d,c),row=r.rows.find(x=>x.key==='sex');
  assert.equal(row.action,'fill');assert.equal(row.incoming,expected);assert.equal(r.selections.find(x=>x.key==='sex').incoming,expected);assert.equal(JSON.stringify({c,d}),before);
 }
});
test('unknown OCR sex values conflict and manual values remain protected',()=>{
 for(const sex of ['невідомо','male female',1,true,['male'],{value:'male'}]){
  const r=sync.plan(document({...personal(),sex},'Копія паспорта'),candidate());assert.equal(r.rows.find(x=>x.key==='sex').action,'conflict');assert(!r.selections.some(x=>x.key==='sex'));
 }
 for(const [saved,incoming,action] of [['female','Ч','conflict'],['Ж','female','leave'],['Ч','male','leave']]){
  const c=candidate();c.sex=saved;const before=JSON.stringify(c),r=sync.plan(document({...personal(),sex:incoming},'Копія паспорта'),c);
  assert.equal(r.rows.find(x=>x.key==='sex').action,action);assert(!r.selections.some(x=>x.key==='sex'));assert.equal(JSON.stringify(c),before);
 }
});
test('equivalent flat and nested sex markers do not create a format conflict',()=>{
 const c=candidate(),d=document({...personal(),sex:'Ч',personal:{...personal(),sex:'male'}},'Копія паспорта'),before=JSON.stringify(d),r=sync.plan(d,c);
 assert.equal(r.rows.find(x=>x.key==='sex').action,'fill');assert.equal(r.selections.find(x=>x.key==='sex').incoming,'male');assert.equal(JSON.stringify(d),before);
});
