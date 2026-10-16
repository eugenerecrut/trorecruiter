const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const ctx={window:{},console};vm.createContext(ctx);
for(const f of ['candidate-conditions.js','document-presence.js','document-state.js','candidate-field-registry.js','service-record-readiness.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'),ctx);
const w=ctx.window;w.CRMResponsibility={latest:docs=>docs.filter(d=>!d.deleted_at)};w.CRMDocumentSync={plan:d=>({rows:d.rows||[]})};
vm.runInContext(fs.readFileSync(path.join(__dirname,'../crm-case-assistant.js'),'utf8'),ctx);
const build=w.CRMCaseAssistant.build;
const candidate=()=>({id:'c1',full_name:'Тестенко Іван',birth_date:'1990-01-01',birth_place:'Дніпро',phone:'+380000000000',worked_before:false,served_before:false,profile_data:{service_type:'За мобілізацією',education_level:'Середня',education_institution:'Школа'}});
test('Read-only report preserves candidate and documents; false employment/service means no questions',()=>{const c=candidate(),docs=[],before=JSON.stringify({c,docs});const r=build(c,[],docs);assert.equal(JSON.stringify({c,docs}),before);assert.equal(r.questions.length,0);assert(!r.ready,'Missing package files still block readiness');});
test('Unknown differs from false; employment and education receive targeted questions',()=>{const c=candidate();delete c.served_before;c.worked_before=true;delete c.profile_data.education_institution;const r=build(c,[],[]);assert(r.questions.some(q=>q.key==='served_before'));assert(r.questions.some(q=>q.key==='work_history'));assert(r.questions.some(q=>q.key==='education_institution'));assert(!r.questions.some(q=>q.key==='military_service_history'));});
test('Conflicts preserve source, current and incoming values; fills do not count as confirmation',()=>{const c=candidate(),d={id:'d1',document_type:'Рекомендаційний лист',file_name:'rl.pdf',ai_extracted:{},verification_status:'Підтверджено',rows:[{key:'military_specialty',action:'conflict',current:'100',incoming:'200',reason:'Звірте ВОС'},{key:'shpk',action:'fill',incoming:'солдат'}]};const r=build(c,[],[d]);assert.equal(r.issues[0].document.id,'d1');assert.equal(r.issues[0].current,'100');assert.equal(r.fills.length,1);assert.equal(c.military_specialty,undefined);});
test('AI failure and processing are visible; deleted files are ignored',()=>{const r=build(candidate(),[],[{id:'bad',processing_status:'AI помилка'},{id:'pending',processing_status:'AI обробка'},{id:'deleted',deleted_at:'today',processing_status:'AI помилка'}]);assert.equal(r.issues.length,1);assert.equal(r.state.processing,1);assert(!r.ready);});
test('Missing obligatory document appears once and retains its requirement',()=>{const r=build(candidate(),[{id:'p',document_type:'Копія паспорта',is_required:true}],[]);assert.equal(r.missingDocuments.length,1);assert.equal(r.missingDocuments[0].r.id,'p');});


test('Service readiness is independent from PDF package and sees personal-file fallback',()=>{const c=candidate();c.rnokpp='1234567890';delete c.birth_place;const r=build(c,[],[],{birth_place:'Дніпро'});assert.equal(r.serviceRecord.ready,true);assert.equal(r.package.ready,false);assert.equal(r.ready,false);delete c.rnokpp;assert(build(c,[],[],{birth_place:'Дніпро'}).serviceRecord.issues.some(i=>i.fieldId==='identity.tax_number'));});
