const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const root = require('node:path').resolve(__dirname,'..');
const read = name => fs.readFileSync(require('node:path').join(root,name),'utf8');
const context = {window:{openCandidateCard(){}},localStorage:{getItem(){return null}}};
vm.createContext(context); vm.runInContext(read('candidate-card-v3.js'),context);
const v3 = context.window.CRMCandidateCardV3;
assert.equal(v3.tabs.length,3);
{
 const view={readiness:{serviceRecord:{ready:false,missing:[{label:'ПІБ <тест>',text:'Уточніть & збережіть'}]}}},before=JSON.stringify(view);
 const html=v3.readinessDetails(view);
 assert(html.includes('Дані послужного: уточнень 1'));
 assert(html.includes('ПІБ &lt;тест&gt;'));
 assert(html.includes('Уточніть &amp; збережіть'));
 assert(!html.includes('<тест>'));assert.equal(JSON.stringify(view),before);
 assert(v3.readinessDetails({readiness:{serviceRecord:{ready:true,missing:[]}}}).includes('основні дані заповнені'));
 for(const value of [{},{readiness:{serviceRecord:{ready:null,missing:[]}}},{readiness:{serviceRecord:{ready:true}}}])
  assert(v3.readinessDetails(value).includes('перевірка недоступна'));
 assert(!v3.readinessDetails({readiness:{serviceRecord:{ready:false,missing:[]}}}).includes('основні дані заповнені'));
 assert(read('candidate-card-v3.js').includes("</small>'+readinessDetails(view)"),'Actual compact card renders the tested readiness explanation');
}
const events = [
  {action:'candidates_update',source_document_id:null,changes:{profile_data:{before:{passport_number:'123',workflow:1},after:{passport_number:'123',workflow:2}}}},
  {action:'candidates_update',source_document_id:'passport',changes:{profile_data:{before:{passport_number:''},after:{passport_number:'123'}}}},
  {action:'candidates_update',source_document_id:'rl',changes:{phone:{before:'',after:'+380000000000'}}}
];
assert.equal(v3.provenance(events).get('passport_number').id,'passport','Unrelated manual profile edits retain document provenance');
events.unshift({action:'candidates_update',source_document_id:null,changes:{phone:{before:'+380000000000',after:'+380111111111'}}});
assert.equal(v3.provenance(events).get('phone').id,null,'Manual replacement must not inherit an AI badge');
events.unshift({action:'documents_update',source_document_id:'wrong',changes:{phone:{before:'',after:'fake'}}});
assert.equal(v3.provenance(events).get('phone').id,null,'Document metadata is not a candidate field transfer');
assert(v3.advanced.has('passport_data'));
assert(v3.advanced.has('work_order_number'));
const v2 = read('candidate-form-core.js');
assert(v2.includes("if (!unit && typeof form.__crmEducationRecords === 'function') oldProfile.education_records = form.__crmEducationRecords();"));
assert(v2.includes("candidateQuery.eq('updated_at',cardState.expectedUpdatedAt)"));
assert(!read('candidate-card-v3.js').includes('cc-version-switch'));
assert(read('index.html').indexOf('candidate-card-v3.js') > read('index.html').indexOf('ai-recommendation-bridge.js'));
assert(!read('candidate-card-v3.js').includes(".from('candidates').update"),'V3 must use the existing save, not a second candidate write');
assert(!read('candidate-card-v3.js').includes(".rpc("),'AI merge unchanged');
console.log('PASS: V3 tabs, fallback, provenance, manual changes, shared save and load order.');

const model=vm.createContext({window:{},Intl,Date,CRMWorkspace:{}});
for(const name of ['candidate-conditions.js','document-presence.js','document-state.js'])vm.runInContext(read(name),model);
const state=model.window.CRMDocumentState,conditions=model.window.CRMCandidateConditions;
const mobilized={served_before:false,worked_before:false,profile_data:{service_type:'За мобілізацією'}};
assert.equal(conditions.documentCondition('Свідоцтво про зміну імені / прізвища',mobilized),true,'Name history is independent of employment');
const alternatives=[{id:'book',document_type:'Копія військового квитка',is_required:true},{id:'reserve',document_type:'Військовий облік (витяг Резерв+ / приписне)',is_required:true}];
const military=[{id:'ticket',document_type:'Військовий квиток',storage_path:'example.pdf',verification_status:'Підтверджено'}];
const inputBefore=JSON.stringify([mobilized,alternatives,military]);
assert.equal(state.summary(mobilized,alternatives,military).total,1,'Alternative military files are one requirement');
assert.equal(state.summary(mobilized,alternatives,military).verified,1,'Nominative military-ticket type is recognized');
assert.equal(JSON.stringify([mobilized,alternatives,military]),inputBefore,'Read models do not mutate stored facts');
const paper={profile_data:{service_type:'За контрактом',document_presence:{anketa:{document_type:'Анкета на контракт',available:true,checked_by:'example',checked_at:'2026-10-13'}}}};
assert.equal(state.summary(paper,[{id:'anketa',document_type:'Анкета на контракт',is_required:true}],[]).verified,1);
assert.equal(state.summary(paper,[{id:'anketa',document_type:'Анкета на контракт',is_required:true}],[]).copies,0);
assert.equal(state.packageState(paper,[]).rows.find(r=>r.title==='Анкета').blocked,true,'Paper attestation is not a PDF page');
const childRequirements=[{id:'child',document_type:'Копія свідоцтва про народження дітей',is_required:true,condition_field:'has_children',condition_value:'true'}];
const children=state.summary({has_children:true,children_count:2,profile_data:{}},childRequirements,[{id:'one-child',requirement_id:'child',verification_status:'Підтверджено'}]);
assert.equal(children.total,2);assert.equal(children.verified,1,'Each child needs its own file');
assert.equal(state.summary({profile_data:{}},[{id:'work',document_type:'Документи про трудову діяльність',is_required:true,condition_field:'worked_before'}],[]).unknown,1,'Unknown is not false');
model.CRMWorkflow={profile:c=>c.profile_data||{},wf:c=>c.profile_data?.workflow||{},stage:()=> 'В роботі',isArchived:()=>false};
vm.runInContext(read('crm-dashboard.js'),model);
const tasks=model.window.CRMCaseTasks;
const followup={profile_data:{workflow:{next_contact_date:'2026-10-14',additional_exams:true,exams_date:'2026-10-12'}}};
assert.equal(tasks.due(followup),'2026-10-12');assert.equal(tasks.bucket(followup,'2026-10-13'),'overdue');
assert.equal(tasks.bucket({profile_data:{}},'2026-10-13'),'undated');
console.log('PASS: shared completeness, paper/PDF distinction, children, independent conditions and task priorities.');
