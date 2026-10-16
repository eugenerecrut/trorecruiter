const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
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
  const source=fs.readFileSync(path.join(root,'documents.js'),'utf8');const code=source.slice(source.indexOf('async function processOneDocument('),source.indexOf('async function uploadSelectedDocuments('));
  const m=memory(candidate(),document({...personal(),...service()}));let invoked,ocr=0;const context={CRMUploadPDF:uploadPDF,supabaseClient:m.client,DOC_MAX_SIZE:20e6,DOC_BUCKET:'candidate-documents',getDocumentRequirements:async()=>[{id:'r1',document_type:'Рекомендаційний лист'}],extractPdfText:async()=>'',pdfToImages:async()=>['image'],runOcr:async()=>{ocr++;return 'text'},classifyStoredDocument:async(id)=>{invoked=id;return {document_type:'Рекомендаційний лист',confidence:0.99,extracted:{...personal(),...service()}}},findCandidateByName:()=>null,document:{getElementById:()=>null},CRMDocumentSync:sync,console};vm.createContext(context);vm.runInContext(code,context);
  await context.processOneDocument({name:'test.pdf',type:'application/pdf',size:100},'r1',{id:'u1'},[], 'c1');assert.equal(invoked,'d1');assert.equal(ocr,0);assert.equal(m.state.rpcs,1);assert.equal(m.state.c.military_specialty,'225256А');
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
