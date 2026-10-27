const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function fixture(){const c={structuredClone,CRMResponsibility:{latest:x=>x}};c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(__dirname,'../crm-intake.js'),'utf8'),c);const row={target:'candidate',key:'phone',current:'111',incoming:'222',reason:'different',action:'conflict'};c.CRMDocumentSync={plan:()=>({supported:true,rows:[{...row}],selections:[]})};const doc={id:'d',candidate_id:'c',document_type:'ID',version_group_id:'g',version_number:1,storage_path:'c/a.pdf',file_hash:'abc',processing_status:'AI готово',ai_extracted:{phone:'222',relatives:[{full_name:'Тестова Олена'}]}};const candidate={id:'c'};doc.ai_extracted._crm_review_context={version:1,id:'context',source:structuredClone(c.CRMReviewDecision.source(doc))};doc.ai_extracted._crm_review_decisions=[{...row,action:'keep_card',reviewed_by:'u',reviewed_at:'now',source_binding:{version:1,context_id:'context'}}];return {c,doc,row,candidate};}
const conflicts=f=>f.c.CRMIntake.items(f.candidate,[f.doc])[0].conflicts.length;
test('bound decision closes current exact evidence; shared metadata does not invalidate itself',()=>{const f=fixture();assert.equal(conflicts(f),0);f.doc.ai_extracted._crm_review_decisions.push({...f.doc.ai_extracted._crm_review_decisions[0],key:'other'});assert.equal(conflicts(f),0);assert.equal(f.c.CRMReviewDecision.binding(f.doc,f.doc.ai_extracted._crm_review_decisions[0],f.candidate),'source-snapshot');});
for(const key of ['id','candidate_id','document_type','version_group_id','version_number','storage_path','file_hash'])test('bound decision reopens on changed source '+key,()=>{const f=fixture();f.doc[key]=key==='version_number'?2:'changed';assert.equal(conflicts(f),1);});
test('unrelated nested OCR change invalidates a decision even when proposed phone is unchanged',()=>{const f=fixture();f.doc.ai_extracted.relatives[0].full_name+=' Петрівна';assert.equal(conflicts(f),1);});
test('JSON object key order is irrelevant but array order and values are exact',()=>{const f=fixture(),ctx=f.doc.ai_extracted._crm_review_context;ctx.source=Object.fromEntries(Object.entries(ctx.source).reverse());assert.equal(conflicts(f),0);ctx.source.extraction.relatives.push({full_name:'Інша'});assert.equal(conflicts(f),1);});
test('missing, malformed or unsupported binding never falls back to legacy approval',()=>{for(const value of [null,{},'x',{version:2,context_id:'context'},{version:1,context_id:'other'}]){const f=fixture();f.doc.ai_extracted._crm_review_decisions[0].source_binding=value;assert.equal(conflicts(f),1);}});
test('missing helper context and mismatched candidate fail closed for bound decisions',()=>{for(const change of [f=>delete f.doc.ai_extracted._crm_review_context,f=>f.candidate.id='other']){const f=fixture();change(f);assert.equal(conflicts(f),1);}});
test('legacy decisions retain their prior exact-value semantics without fabricated binding',()=>{const f=fixture();delete f.doc.ai_extracted._crm_review_decisions[0].source_binding;assert.equal(conflicts(f),0);assert.equal(f.c.CRMReviewDecision.binding(f.doc,f.doc.ai_extracted._crm_review_decisions[0],f.candidate),'container-only');f.row.current='changed';assert.equal(conflicts(f),1);});
test('all binding checks are pure and make no writes or mutations',()=>{const f=fixture(),before=JSON.stringify(f.doc);conflicts(f);assert.equal(JSON.stringify(f.doc),before);});

test('explicit OCR identity review is restricted to populated identity fields',()=>{
 const {c}=fixture(),kind=c.CRMReviewDecision.keepKind;
 for(const key of ['full_name','birth_date','rnokpp'])assert.equal(kind({action:'conflict',target:'candidate',key,current:'saved',reason:'Дата народження іншої особи'}),'identity-field');
 for(const key of ['phone','passport_data','military_rank','work_records'])assert.equal(kind({action:'conflict',target:'candidate',key,current:'saved',reason:'ПІБ не збігається'}),null);
 for(const current of [null,'','   ',{},[],false,123])assert.equal(kind({action:'conflict',target:'candidate',key:'birth_date',current,reason:'Дата народження іншої особи'}),null);
 assert.equal(kind({action:'conflict',target:'profile',key:'work_records',current:[{employer:'Test'}],reason:'Збережене значення має пріоритет'}),'ordinary');
 assert.equal(kind({action:'fill',target:'candidate',key:'birth_date',current:'saved',reason:'Дата народження іншої особи'}),null);
 assert.equal(kind({action:'conflict',target:'profile',key:'birth_date',current:'saved',reason:'Дата народження іншої особи'}),null);
});

test('identity keep closes one exact question, without clearing other owner conflicts or authorizing transfer',()=>{
 const f=fixture();f.row.key='birth_date';f.row.reason='Дата народження іншої особи';
 const saved=f.doc.ai_extracted._crm_review_decisions[0];Object.assign(saved,{key:f.row.key,reason:f.row.reason});
 f.c.CRMDocumentSync.plan=()=>({supported:true,rows:[{...f.row},{...f.row,key:'full_name'}],selections:[]});
 const before=JSON.stringify({doc:f.doc,candidate:f.candidate}),item=f.c.CRMIntake.items(f.candidate,[f.doc])[0];
 assert.equal(item.conflicts.length,1);assert.equal(item.conflicts[0].key,'full_name');assert.equal(item.plan.selections.length,0);
 assert.equal(JSON.stringify({doc:f.doc,candidate:f.candidate}),before);
 f.row.incoming='changed';assert.equal(f.c.CRMIntake.items(f.candidate,[f.doc])[0].conflicts.length,2);
});

test('identity review requires explicit confirmation before the existing guarded RPC',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../crm-intake.js'),'utf8');
 assert(source.includes("keepKind(row)==='identity-field'&&!window.confirm("));
 assert(source.indexOf("keepKind(row)==='identity-field'&&!window.confirm(")<source.indexOf("rpc('crm_keep_document_value'"));
});
