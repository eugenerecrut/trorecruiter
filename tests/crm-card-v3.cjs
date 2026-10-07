const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const root = require('node:path').resolve(__dirname,'..');
const read = name => fs.readFileSync(require('node:path').join(root,name),'utf8');
const context = {window:{openCandidateCard(){}},localStorage:{getItem(){return null}}};
vm.createContext(context); vm.runInContext(read('candidate-card-v3.js'),context);
const v3 = context.window.CRMCandidateCardV3;
assert.equal(v3.tabs.length,6);
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
const v2 = read('candidate-card-v2.js');
assert(v2.includes("if (!unit && typeof form.__crmEducationRecords === 'function') oldProfile.education_records = form.__crmEducationRecords();"));
assert(v2.includes("candidateQuery.eq('updated_at',cardState.expectedUpdatedAt)"));
assert(read('candidate-card-v3.js').includes("let version = 'v2'"));
assert(read('index.html').indexOf('candidate-card-v3.js') > read('index.html').indexOf('ai-recommendation-bridge.js'));
assert(!read('candidate-card-v3.js').includes(".from('candidates').update"),'V3 must use the existing save, not a second candidate write');
assert(!read('candidate-card-v3.js').includes(".rpc("),'AI merge unchanged');
console.log('PASS: V3 tabs, fallback, provenance, manual changes, shared save and load order.');
