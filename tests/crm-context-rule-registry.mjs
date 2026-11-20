import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createCRMRuleRegistry} from '../crm-context-rule-registry.mjs';
import {previewEducationRules} from '../education-rule-preview.mjs';

function setup(){
 const root={console,structuredClone,URLSearchParams,Intl,document:{addEventListener(){}},fetch(){throw Error('network forbidden');},supabaseClient:{from(){throw Error('queries forbidden');},rpc(){throw Error('writes forbidden');}}};root.window=root;
 vm.createContext(root);
 for(const name of ['candidate-name.js','name-change-document.js','education-document.js','candidate-phone.js','autobiography-document.js','work-document.js','candidate-conditions.js','supabase/functions/_shared/document-data-policy.js','document-ai-sync.js'])
  vm.runInContext(readFileSync(new URL('../'+name,import.meta.url),'utf8'),root);
 return {root,education:root.CRMEducation,planner:root.CRMDocumentSync,policy:root.CRMDocumentPolicy};
}
const candidate=()=>({id:'fixture-case',full_name:'Прикладенко Тест Тестович',birth_date:'1990-05-04',rnokpp:'1234567890',profile_data:{}});
const record=()=>({owner_full_name:'Прикладенко Тест Тестович',owner_birth_date:'1990-05-04',degree:'кваліфікований робітник',
 diploma_present:true,diploma_number:'TEST-1',institution:'Тестовий заклад',graduation_year:2010,source_pages:[2]});
const document=()=>({id:'fixture-doc',candidate_id:'fixture-case',document_type:'Копія диплома та атестата з додатками',file_name:'synthetic-diploma.pdf',
 storage_path:'fixture/diploma.pdf',verification_status:'Підтверджено',processing_status:'AI готово',ai_processed_at:'revision',version_group_id:'fixture-group',version_number:1,
 ai_extracted:{full_name:'Прикладенко Тест Тестович',birth_date:'1990-05-04',rnokpp:'1234567890',education_records:[record()]}});

test('registry obtains all aliases from the published education normalizer, without a second vocabulary',()=>{
 const deps=setup(),policy=deps.education.degreePolicy,registry=createCRMRuleRegistry(deps.education);
 assert.equal(registry.accepted_count,policy.aliases.length);assert.equal(registry.rejectedRules.length,0);
 assert(Object.isFrozen(policy));assert(Object.isFrozen(policy.aliases));
 for(const {alias,canonical} of policy.aliases){
  const result=registry.match({category:'education',raw_value:alias,document_type:'education',field_path:'education.degree',language:'uk',
   context:{},source_current:true,owner_match:true,manual_confirmed:false,held:false,evidence_location:{document_id:'fixture',page:1}});
  assert.equal(result.proposed_value,canonical);assert.equal(deps.education.normalizeDegree(alias),canonical);
  assert.match(result.matches[0].source_reference,/6f4a6fc5f2509386d741b09626855224d1a7714a/);
 }
 assert.throws(()=>createCRMRuleRegistry({...deps.education,normalizeDegree:()=> 'unknown'}),/mismatch/);
 assert.throws(()=>createCRMRuleRegistry({...deps.education,degreePolicy:{version:'future',aliases:[]}}),/unavailable/);
 assert.equal(createCRMRuleRegistry(null,{enabled:false}).accepted_count,0);
});

test('real owner and education planners feed a read-only proposal with page and rule provenance',()=>{
 const deps=setup(),input={candidate:candidate(),documents:[document()]},before=JSON.stringify(input);
 const preview=previewEducationRules(input,deps);
 assert.deepEqual(preview.diagnostics,[]);assert.equal(preview.rows.length,1);
 const row=preview.rows[0];assert.equal(row.proposed_value,'професійна');assert.equal(row.raw_value,'кваліфікований робітник');
 assert.equal(row.evidence_location.page,2);assert.equal(row.matches[0].rule_version,'education-degree-1');
 assert.equal(JSON.stringify(input),before);assert.deepEqual(preview,previewEducationRules(input,deps));
});

test('current planner blocks another owner or role and unverified/error sources',()=>{
 const deps=setup();
 for(const changed of [{candidate_id:'other'},{verification_status:'Не перевірено'},{processing_status:'AI помилка'},
  {ai_document_type:'Паспорт'}, {ai_extracted:{...document().ai_extracted,rnokpp:'9876543210'}},
  {ai_extracted:{...document().ai_extracted,birth_date:'1990-05-05'}},
  {ai_extracted:{...document().ai_extracted,education_records:[{...record(),owner_full_name:'Інша Тестова Особа'}]}}])
  assert.equal(previewEducationRules({candidate:candidate(),documents:[{...document(),...changed}]},deps).rows.length,0);
});

test('latest version and archive guards are shared with identity evidence',()=>{
 const deps=setup(),old=document(),next={...old,id:'new',version_number:2};
 for(const docs of [[old,{...next,deleted_at:'now'}],[old,next,{...next,id:'twin'}],[old,{...next,version_number:'invalid'}]])
  assert.equal(previewEducationRules({candidate:candidate(),documents:docs},deps).rows.length,0);
 for(const profile_data of [{workflow:{archived_at:'now'}},JSON.stringify({merged_into:'other'}),'{bad-json'])
  assert.equal(previewEducationRules({candidate:{...candidate(),profile_data},documents:[old]},deps).rows.length,0);
});

test('existing degrees, manual confirmations and low-legibility fields never receive replacements',()=>{
 const deps=setup();
 for(const profile_data of [{education_level:'ручне значення'},{education_level:'бакалавр',field_confirmations:{education_level:true}},
  {education_records:[{source_document_id:'fixture-doc',source_record_index:0,degree:'магістр',confirmed_by_user:true}]},
  JSON.stringify({education_level:'ручне значення'})]){
  const preview=previewEducationRules({candidate:{...candidate(),profile_data},documents:[document()]},deps);
  assert.equal(preview.rows[0].proposed_value,null);assert.equal(preview.rows[0].reason,'protected_manual_value');
 }
 const d=document();d.ai_extracted.education_records[0].field_evidence={degree:{legibility:'low'}};
 assert.equal(previewEducationRules({candidate:candidate(),documents:[d]},deps).rows[0].proposed_value,null);
});

test('a page is never invented and missing dependencies/rollback fail closed',()=>{
 const deps=setup(),d=document();delete d.ai_extracted.education_records[0].source_pages;
 const input={candidate:candidate(),documents:[d]};
 const result=previewEducationRules(input,deps).rows[0];assert.equal(result.proposed_value,null);assert.equal(result.reason,'missing_evidence_location');
 assert.equal(previewEducationRules(input,{}).rows.length,0);
 assert.deepEqual(previewEducationRules(input,{...deps,enabled:false}).rows,[]);
 assert.equal(previewEducationRules(input,{...deps,education:{...deps.education,degreePolicy:null}}).diagnostics[0],'registry_unavailable');
});
