const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const ctx={window:{},console,URLSearchParams};vm.createContext(ctx);
for(const f of ['candidate-conditions.js','document-presence.js','document-state.js','candidate-field-registry.js','service-record-readiness.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'),ctx);
const w=ctx.window;w.CRMResponsibility={latest:docs=>docs.filter(d=>!d.deleted_at&&!d.replaced)};w.CRMDocumentSync={plan:d=>({rows:d.rows||[]})};
for(const f of ['crm-case-assistant.js','candidate-case-view.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'),ctx);
const c=()=>({id:'c',full_name:'Тестова Олена Іванівна',worked_before:false,served_before:false,profile_data:{service_type:'За мобілізацією',relatives:[{full_name:'Мати',field_confirmations:{full_name:true}}]}});
const build=(candidate,docs=[],req=[])=>w.CRMCandidateCaseView.build(candidate,{},docs,req);
test('changed projection is loaded with the current release cache key',()=>{
 const release=fs.readFileSync(path.join(__dirname,'../crm-release.js'),'utf8').match(/version:'([^']+)'/)[1];
 assert(fs.readFileSync(path.join(__dirname,'../index.html'),'utf8').includes('candidate-case-view.js?v='+release));
});
test('projection preserves all inputs and manual confirmations',()=>{const candidate=c(),docs=[{id:'one',ai_extracted:{},rows:[{key:'relatives',action:'conflict',current:'manual',incoming:'ai',reason:'Звірити'}]}];const before=JSON.stringify({candidate,docs});const view=build(candidate,docs);assert.equal(JSON.stringify({candidate,docs}),before);assert.equal(view.issues.length,1);assert.equal(view.issues[0].current,'manual');assert.equal(view.identity.serviceType,'За мобілізацією');assert.equal(view.nextAction.kind,'review');});
test('error and processing retain technical state despite previous confirmation/OCR',()=>{const docs=[{id:'one',verification_status:'Підтверджено',processing_status:'AI помилка',ai_extracted:{phone:'old'}},{id:'two',processing_status:'AI обробка',ai_extracted:{}}];const view=build(c(),docs);assert.equal(view.documents[0].aiState,'AI помилка');assert.equal(view.issues.length,1);assert.equal(view.nextAction.kind,'wait');});
test('false, unknown, paper availability and electronic copies remain separate',()=>{const candidate=c();candidate.profile_data.service_type='За контрактом';candidate.profile_data.document_presence={anketa:{document_type:'Анкета на контракт',available:true,checked_by:'test',checked_at:'2026-10-22'}};const view=build(candidate,[],[{id:'anketa',document_type:'Анкета на контракт',is_required:true}]);assert.equal(view.completeness.verified,1);assert.equal(view.readiness.questionnaire.ready,false);assert.equal(view.readiness.fullPackage.ready,null);assert.equal(view.readiness.information.ready,null);assert.equal(view.report.questions.some(q=>q.key==='worked_before'),false);delete candidate.worked_before;assert(build(candidate).report.questions.some(q=>q.key==='worked_before'));});
test('latest version scope and stable issue keys',()=>{const doc={id:'new',ai_extracted:{},rows:[{key:'phone',action:'conflict',reason:'Звірити',current:'a',incoming:'b'}]};const view=build(c(),[{id:'old',replaced:true,processing_status:'AI помилка'},doc]);assert.equal(view.documents.length,1);assert.equal(view.issues[0].id,build(c(),[doc]).issues[0].id);});
test('feature flag is off by default and explicit only',()=>{assert.equal(w.CRMCandidateCaseView.enabled(),false);w.CRMFeatureFlags={compactCaseView:true};assert.equal(w.CRMCandidateCaseView.enabled(),true);delete w.CRMFeatureFlags;});
test('UI-only canary opt-in is exact and explicit false overrides it',()=>{w.location={search:'?compactCaseView=1'};assert.equal(w.CRMCandidateCaseView.enabled(),true);w.CRMFeatureFlags={compactCaseView:false};assert.equal(w.CRMCandidateCaseView.enabled(),false);delete w.CRMFeatureFlags;w.location.search='?compactCaseView=true';assert.equal(w.CRMCandidateCaseView.enabled(),false);delete w.location;});
test('documents of another card cannot feed completeness or facts',()=>{const view=build(c(),[{id:'other',candidate_id:'another',storage_path:'other.pdf',ai_extracted:{},rows:[{key:'phone',action:'fill',incoming:'wrong'}]}]);assert.equal(view.documents.length,0);assert.equal(view.report.fills.length,0);assert.equal(view.issues.length,1);assert.match(view.nextAction.text,/належність/);});
test('unresolved verification remains a question even without an extracted conflicting field',()=>{const view=build(c(),[{id:'review',verification_status:'Потребує перевірки'}]);assert.equal(view.issues.length,1);assert.equal(view.nextAction.kind,'review');});

test('identity fallback rejects another candidate personal file and preserves manual service type',()=>{
 const candidate=c();delete candidate.profile_data.service_type;
 for(const pf of [{candidate_id:'other',service_type:'За контрактом'},null]){
  const before=JSON.stringify({candidate,pf});
  const view=w.CRMCandidateCaseView.build(candidate,pf,[],[]);
  assert.equal(view.identity.serviceType,'');assert.equal(JSON.stringify({candidate,pf}),before);
 }
 for(const pf of [{candidate_id:'c',service_type:'За контрактом'},{service_type:'За контрактом'}])
  assert.equal(w.CRMCandidateCaseView.build(candidate,pf,[],[]).identity.serviceType,'За контрактом');
 candidate.profile_data.service_type='За мобілізацією';
 assert.equal(w.CRMCandidateCaseView.build(candidate,{candidate_id:'other',service_type:'За контрактом'},[],[]).identity.serviceType,'За мобілізацією');
});

test('explicitly inapplicable files stay visible without adding verification questions',()=>{
 const candidate=c(),doc={id:'old-work',document_type:'Документи про трудову діяльність',verification_status:'Потребує перевірки'};
 const before=JSON.stringify({candidate,doc}),view=build(candidate,[doc]);
 assert.equal(view.documents.length,1);assert.equal(view.documents[0].condition,false);
 assert.equal(view.issues.length,0);assert.equal(JSON.stringify({candidate,doc}),before);
 delete candidate.worked_before;
 assert.equal(build(candidate,[doc]).issues.length,1,'Unknown conditions still require review');
});

test('optional template contracts add blockers without clearing existing service issues',()=>{
 const candidate=c(),contract={selected:'serviceRecord',serviceRecord:{missing:[]}},before=JSON.stringify({candidate,contract});
 const baseline=build(candidate),view=w.CRMCandidateCaseView.build(candidate,{},[],[],contract);
 assert(baseline.readiness.serviceRecord.missing.length>0);
 assert.equal(view.readiness.serviceRecord.ready,false);
 assert.deepEqual(view.readiness.serviceRecord.missing,baseline.readiness.serviceRecord.missing);
 contract.serviceRecord.missing.push({label:'Додаткова звірка'});
 const extended=w.CRMCandidateCaseView.build(candidate,{},[],[],contract);
 assert.equal(extended.readiness.serviceRecord.missing.length,baseline.readiness.serviceRecord.missing.length+1);
 contract.serviceRecord.missing.pop();assert.equal(JSON.stringify({candidate,contract}),before);
});

test('unavailable service validator cannot recommend forming a PDF',()=>{
 const candidate={id:'complete',full_name:'Тестовий Іван',birth_date:'1990-01-01',birth_place:'Дніпро',rnokpp:'1234567890',phone:'test',worked_before:false,served_before:false,profile_data:{service_type:'За мобілізацією',education_level:'Середня',education_institution:'Школа'}};
 const saved=w.CRMServiceReadiness;
 try{
  delete w.CRMServiceReadiness;
  const view=build(candidate);
  assert.equal(view.readiness.serviceRecord.ready,null);
  assert.equal(view.nextAction.kind,'review');
  assert.match(view.nextAction.text,/недоступна/);
 }finally{w.CRMServiceReadiness=saved;}
});
