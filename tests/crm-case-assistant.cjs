const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const ctx={window:{},console,structuredClone};vm.createContext(ctx);
for(const f of ['candidate-conditions.js','document-presence.js','document-state.js','candidate-field-registry.js','service-record-readiness.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'),ctx);
const w=ctx.window;w.CRMResponsibility={latest:docs=>docs.filter(d=>!d.deleted_at)};w.CRMDocumentSync={plan:d=>({rows:d.rows||[]})};
vm.runInContext(fs.readFileSync(path.join(__dirname,'../crm-case-assistant.js'),'utf8'),ctx);
const build=w.CRMCaseAssistant.build;
const candidate=()=>({id:'c1',full_name:'Тестенко Іван',birth_date:'1990-01-01',birth_place:'Дніпро',phone:'+380000000000',worked_before:false,served_before:false,profile_data:{service_type:'За мобілізацією',education_level:'Середня',education_institution:'Школа'}});
test('explicitly inapplicable historical documents do not add report questions or processing blockers',()=>{const c=candidate(),docs=[{id:'old-work',document_type:'Документи про трудову діяльність',processing_status:'AI помилка',ai_extracted:{},rows:[{key:'full_name',action:'conflict',reason:'Старий файл'}]}];const before=JSON.stringify(docs),r=build(c,[],docs);assert.equal(r.issues.length,0);assert.equal(r.state.errors,0);assert.equal(JSON.stringify(docs),before);});
test('Read-only report preserves candidate and documents; false employment/service means no questions',()=>{const c=candidate(),docs=[],before=JSON.stringify({c,docs});const r=build(c,[],docs);assert.equal(JSON.stringify({c,docs}),before);assert.equal(r.questions.length,0);assert(!r.ready,'Missing package files still block readiness');});
test('Unknown differs from false; employment and education receive targeted questions',()=>{const c=candidate();delete c.served_before;c.worked_before=true;delete c.profile_data.education_institution;const r=build(c,[],[]);assert(r.questions.some(q=>q.key==='served_before'));assert(r.questions.some(q=>q.key==='work_history'));assert(r.questions.some(q=>q.key==='education_institution'));assert(!r.questions.some(q=>q.key==='military_service_history'));});
test('Conflicts preserve source, current and incoming values; fills do not count as confirmation',()=>{const c=candidate(),d={id:'d1',document_type:'Рекомендаційний лист',file_name:'rl.pdf',ai_extracted:{},verification_status:'Підтверджено',rows:[{key:'military_specialty',action:'conflict',current:'100',incoming:'200',reason:'Звірте ВОС'},{key:'shpk',action:'fill',incoming:'солдат'}]};const r=build(c,[],[d]);assert.equal(r.issues[0].document.id,'d1');assert.equal(r.issues[0].current,'100');assert.equal(r.fills.length,1);assert.equal(c.military_specialty,undefined);});
test('AI failure and processing are visible; deleted files are ignored',()=>{const r=build(candidate(),[],[{id:'bad',processing_status:'AI помилка'},{id:'pending',processing_status:'AI обробка'},{id:'deleted',deleted_at:'today',processing_status:'AI помилка'}]);assert.equal(r.issues.length,1);assert.equal(r.state.processing,1);assert(!r.ready);});
test('Missing obligatory document appears once and retains its requirement',()=>{const r=build(candidate(),[{id:'p',document_type:'Копія паспорта',is_required:true}],[]);assert.equal(r.missingDocuments.length,1);assert.equal(r.missingDocuments[0].r.id,'p');});


test('Service readiness is independent from PDF package and sees personal-file fallback',()=>{const c=candidate();c.rnokpp='1234567890';delete c.birth_place;const r=build(c,[],[],{birth_place:'Дніпро'});assert.equal(r.serviceRecord.ready,true);assert.equal(r.package.ready,false);assert.equal(r.ready,false);delete c.rnokpp;assert(build(c,[],[],{birth_place:'Дніпро'}).serviceRecord.issues.some(i=>i.fieldId==='identity.tax_number'));});

test('case report respects saved intake decisions and never offers stale pending OCR',()=>{
 const d={id:'decision',ai_extracted:{},rows:[{key:'phone',action:'conflict'}]},pending={id:'pending',ai_extracted:{},processing_status:'AI обробка',rows:[{key:'rnokpp',action:'fill'}]};
 w.CRMIntake={items:(_c,docs)=>docs.map(doc=>({doc,plan:doc.processing_status==='AI обробка'?null:{rows:doc.rows.map(r=>({...r,action:'leave'}))}}))};
 try{const r=build(candidate(),[],[d,pending]);assert.equal(r.issues.length,0);assert.equal(r.fills.length,0);}finally{delete w.CRMIntake;}
});

test('saved personal-file birthplace does not create a duplicate candidate question',()=>{
 for(const current of [undefined,null,'','   ']){
  const c=candidate();c.birth_place=current;const pf={birth_place:'Дніпро'},before=JSON.stringify({c,pf});
  const r=build(c,[],[],pf);
  assert(!r.questions.some(q=>q.key==='birth_place'));
  assert(!r.missingData.some(q=>q.key==='birth_place'));
  assert(!r.serviceRecord.issues.some(q=>q.fieldId==='identity.birth_place'));
  assert.equal(JSON.stringify({c,pf}),before);
 }
 const c=candidate();delete c.birth_place;
 for(const pf of [{},{birth_place:''},{birth_place:'   '}])assert(build(c,[],[],pf).questions.some(q=>q.key==='birth_place'));
});

test('work and service questions require a usable record of the corresponding kind',()=>{
 for(const kind of ['employment','military_service','police_service','unknown']){
  const c=candidate();c.worked_before=true;c.served_before=true;c.profile_data.work_records=[{kind}];
  const before=JSON.stringify(c),r=build(c,[],[]);
  assert.equal(r.questions.some(q=>q.key==='work_history'),kind!=='employment');
  assert.equal(r.questions.some(q=>q.key==='military_service_history'),!['military_service','police_service'].includes(kind));
  assert.equal(JSON.stringify(c),before);
 }
 for(const flags of [{requires_review:true},{crossed_out:true}]){
  const c=candidate();c.worked_before=true;c.served_before=true;c.profile_data.work_records=[{kind:'employment',...flags},{kind:'military_service',...flags}];
  const r=build(c,[],[]);assert(r.questions.some(q=>q.key==='work_history'));assert(r.questions.some(q=>q.key==='military_service_history'));
 }
 const c=candidate();c.worked_before=true;c.served_before=true;c.profile_data.work_records={kind:'employment'};
 assert(build(c,[],[]).questions.some(q=>q.key==='work_history'));
 c.profile_data.work_history='Збережена розповідь';c.profile_data.military_service_history='Збережена служба';
 const r=build(c,[],[]);assert(!r.questions.some(q=>q.key==='work_history'));assert(!r.questions.some(q=>q.key==='military_service_history'));
});
test('accepted biography work facts satisfy work questions without mutating the card',()=>{
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../biography-facts.js'),'utf8'),ctx);
 try{
  const c=candidate();c.worked_before=true;c.profile_data.bio_work_claims=[{source_document_id:'bio',start_date:'2020',employer:'Підприємство'}];
  const before=JSON.stringify(c),r=build(c,[],[]);assert(!r.questions.some(q=>q.key==='work_history'));assert.equal(JSON.stringify(c),before);
  c.profile_data.bio_work_claims[0].requires_review=true;assert(build(c,[],[]).questions.some(q=>q.key==='work_history'));
 }finally{delete w.CRMBiographyFacts;}
});

test('accepted biography education satisfies institution question without changing saved card',()=>{
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../biography-facts.js'),'utf8'),ctx);
 try{
  const c=candidate();delete c.profile_data.education_institution;
  c.profile_data.bio_education_claims=[{source_document_id:'bio',institution:'Ліцей',end_date:'2020'}];
  const before=JSON.stringify(c),r=build(c,[],[]);
  assert(!r.questions.some(q=>q.key==='education_institution'));
  assert.equal(JSON.stringify(c),before);
  for(const flag of ['requires_review','crossed_out']){
   c.profile_data.bio_education_claims[0][flag]=true;
   assert(build(c,[],[]).questions.some(q=>q.key==='education_institution'));
   delete c.profile_data.bio_education_claims[0][flag];
  }
 }finally{delete w.CRMBiographyFacts;}
});
test('unusable education records do not suppress institution questions',()=>{
 for(const records of [[null],[{institution:'Ліцей',requires_review:true}],[{institution:'Ліцей',crossed_out:true}],[{institution:'   '}],{institution:'Ліцей'}]){
  const c=candidate();delete c.profile_data.education_institution;c.profile_data.education_records=records;
  assert(build(c,[],[]).questions.some(q=>q.key==='education_institution'));
 }
 const c=candidate();delete c.profile_data.education_institution;c.profile_data.education_records=[{institution:'Ліцей'}];
 assert(!build(c,[],[]).questions.some(q=>q.key==='education_institution'));
});
