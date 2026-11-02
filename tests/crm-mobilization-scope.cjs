const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const ctx={window:{},console,structuredClone};vm.createContext(ctx);const w=ctx.window;
for(const f of ['candidate-conditions.js','document-presence.js','document-state.js','candidate-field-registry.js','service-record-readiness.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'),ctx);
w.CRMResponsibility={latest:docs=>docs.filter(d=>!d.deleted_at)};w.CRMDocumentSync={plan:()=>({rows:[]})};
for(const f of ['crm-case-assistant.js','candidate-case-view.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'),ctx);
const c=()=>({id:'c',full_name:'Тестенко Іван Петрович',birth_date:'1975-10-05',phone:'+380000000000',rnokpp:'1234567890',profile_data:{service_type:'За мобілізацією',work_records:[{kind:'employment',employer:'Збережено'}]}});
test('all mobilization candidates have no labor requirement, independent of employment answer',()=>{
 for(const worked of [true,false,null]){const candidate=c();candidate.worked_before=worked;const before=JSON.stringify(candidate);
 assert.equal(w.CRMCandidateConditions.formsPersonalFile(candidate),false);
 assert.equal(w.CRMCandidateConditions.requirement({document_type:'Документи про трудову діяльність'},candidate),false);
 assert.equal(w.CRMCandidateConditions.documentCondition('Трудова книжка',candidate),false);
 assert.equal(w.CRMCandidateConditions.documentCondition('Копія паспорта/ID Картки',candidate),true);
 assert.equal(JSON.stringify(candidate),before);}
});
test('mobilization has explicit not-applicable service readiness and no fabricated ready form',()=>{
 const candidate=c(),pf={candidate_id:'c',education:'Історичні дані'},before=JSON.stringify([candidate,pf]);
 const r=w.CRMServiceReadiness.review(candidate,pf);assert.equal(r.applicable,false);assert.equal(r.ready,false);assert.equal(r.issues.length,0);
 const view=w.CRMCandidateCaseView.build(candidate,pf,[],[]);assert.equal(view.readiness.serviceRecord.applicable,false);assert.equal(view.readiness.serviceRecord.missing.length,0);
 assert.equal(JSON.stringify([candidate,pf]),before);
});
test('mobilization assistant does not request personal-file-only information but retains document errors',()=>{
 const candidate=c();candidate.worked_before=true;candidate.profile_data.education_level='Вища';
 const doc={id:'d',candidate_id:'c',document_type:'Копія паспорта/ID Картки',processing_status:'AI помилка'};
 const r=w.CRMCaseAssistant.build(candidate,[],[doc]);
 assert(!r.questions.some(q=>['birth_place','worked_before','served_before','education_level','education_institution','work_history','military_service_history'].includes(q.key)));
 assert(r.issues.some(i=>i.kind==='error'));assert.equal(r.package.applicable,false);
});
test('contract requirements and missing personal-file information remain active',()=>{
 const candidate=c();candidate.profile_data.service_type='За контрактом';candidate.worked_before=true;candidate.profile_data.work_records=[];
 assert.equal(w.CRMCandidateConditions.formsPersonalFile(candidate),true);
 assert.equal(w.CRMCandidateConditions.documentCondition('Трудова книжка',candidate),true);
 assert(w.CRMServiceReadiness.review(candidate).issues.length>0);
 assert(w.CRMCaseAssistant.build(candidate,[],[]).questions.some(q=>q.key==='work_history'));
});
test('service generator rejects mobilization before creating a form or PDF',async()=>{
 const generator={window:w,URL};vm.createContext(generator);vm.runInContext(fs.readFileSync(path.join(__dirname,'../crm-service-record.js'),'utf8'),generator);
 await assert.rejects(()=>w.CRMServiceRecord.open(c(),{},{save(){throw Error('must not save')}}),/не формується/);
});
