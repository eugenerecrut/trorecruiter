const {test}=require('node:test');
const assert=require('node:assert/strict');
const {appendRecords}=require('../document-ai-sync.js');
test('education appends independent diploma and preserves manual record',()=>{
 const old={diploma_series:'К',diploma_number:'1',institution:'Заклад',confirmed_by_user:true};
 const next={diploma_series:'К',diploma_number:'2',institution:'Інший заклад',source_document_id:'doc'};
 const result=appendRecords('education_records',[old],[next],'doc');
 assert.deepEqual(result.value,[old,next]);assert.deepEqual(result.conflicts,[]);assert.equal(old.source_document_id,undefined);
 assert.deepEqual(appendRecords('education_records',result.value,[next],'doc').value,result.value);
});
test('same diploma changes require review without duplication',()=>{
 const old={diploma_number:'1',institution:'Заклад'};
 const result=appendRecords('education_records',[old],[{...old,institution:'Змінений',source_document_id:'doc'}],'doc');
 assert.deepEqual(result.value,[old]);assert.equal(result.conflicts.length,1);
});
test('closing existing work period requires review rather than duplicate',()=>{
 const old={kind:'employment',employer:'Підприємство',start_date:'2020-01-01'};
 const result=appendRecords('work_records',[old],[{...old,end_date:'2021-01-01',source_document_id:'doc'}],'doc');
 assert.deepEqual(result.value,[old]);assert.equal(result.conflicts.length,1);
});
test('new work period rejects another document and fake manual approval',()=>{
 for(const extra of [{source_document_id:'other'},{source_document_id:'doc',confirmed_by_user:true},{source_document_id:'doc',requires_review:true}]){
  const result=appendRecords('work_records',[],[{kind:'employment',employer:'Підприємство',start_date:'2020-01-01',...extra}],'doc');
  assert.deepEqual(result.value,[]);assert.equal(result.conflicts.length,1);
 }
});
test('malformed saved lists are preserved for review',()=>{
 assert(appendRecords('education_records','legacy',[],'doc').error);
});
test('PFU employer code does not duplicate manually confirmed service period',()=>{
 const old={kind:'military_service',unit:'А1363',employer:'Військова частина А1363',start_date:'2022-07-11',end_date:'2022-08-23',position:'Курсант',confirmed_by_user:true};
 const incoming={kind:'military_service',employer:'ВІЙСЬКОВА ЧАСТИНА А1363',employer_code:'08190603',start_date:'2022-07-11',end_date:'2022-08-23',position:'солдат',source_document_id:'pfu'};
 const result=appendRecords('work_records',[old],[incoming],'pfu');assert.deepEqual(result.value,[old]);assert.equal(result.conflicts.length,1);
});
