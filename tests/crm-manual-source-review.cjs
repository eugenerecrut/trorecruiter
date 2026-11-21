const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8'),c=vm.createContext({window:{},structuredClone,Date});
vm.runInContext(read('supabase/functions/_shared/id-validation.js').replace(/^export /gm,''),c);
vm.runInContext(read('supabase/functions/_shared/document-data-policy.js'),c);
const person={id:'candidate',full_name:'Приклад Іван Петрович',birth_date:'1990-02-12',rnokpp:'1234567890'},extracted={full_name:person.full_name,birth_date:person.birth_date,rnokpp:person.rnokpp,document_number:'123456789',document_issuer:'1234',document_date:'2020-02-12',passport_expiry_date:'2030-02-12',unzr:'19900212-12345'},result=()=>({document_type:'ID',confidence:0,extracted:{...extracted}}),source=()=>({id:'document',candidate_id:person.id,verification_status:'Підтверджено',processing_status:'AI оброблено',verified_by:'00000000-0000-4000-8000-000000000001',verified_at:'2026-11-21T09:00:00Z',ai_processed_at:'2026-11-21T08:00:00Z',ai_confidence:0,ai_extracted:{...extracted}});
test('a human-verified exact ID source can retain original zero AI confidence',()=>{
 const r=result(),s=source(),before=JSON.stringify([r,s]);assert.equal(c.reviewID(r,person,s).blocked,false);assert.equal(r.confidence,0);assert.equal(JSON.stringify([r,s]),before);
 assert.equal(c.reviewID(r,person).blocked,true,'a new provider result cannot inherit old human verification');
});
test('missing, foreign, stale and unverified source metadata cannot waive confidence',()=>{
 for(const patch of [{candidate_id:'other'},{verified_by:null},{verified_by:'not-a-user'},{verified_at:null},{ai_processed_at:null},{ai_processed_at:'2026-11-21T10:00:00Z'},{verification_status:'Не перевірено'},{processing_status:'AI обробка'},{deleted_at:'2026-11-21'},{ai_confidence:1},{ai_extracted:{...extracted,document_number:'999999999'}}]){
  assert(c.reviewID(result(),person,{...source(),...patch}).issues.some(i=>i.includes('впевненості')),JSON.stringify(patch));
 }
});
test('manual verification never overrides owner, date or identifier checks',()=>{
 for(const patch of [{rnokpp:'9999999999'},{full_name:'Інший Петро Петрович'},{document_number:'123'},{document_issuer:'12'},{passport_expiry_date:'2019-01-01'},{birth_date:'2000-02-12'},{unzr:'wrong'}]){
  const r=result();r.extracted={...r.extracted,...patch};const s=source();s.ai_extracted={...r.extracted};assert.equal(c.reviewID(r,person,s).blocked,true,JSON.stringify(patch));
 }
 const r=result();r.review_required=true;assert.equal(c.reviewID(r,person,source()).blocked,true);
});
test('the complete sync planner uses the verified ID source for candidate and profile fields',()=>{
 const runtimeFile=path.join(__dirname,'..','supabase/functions/_shared/sync-runtime.js'),runtime=fs.readFileSync(runtimeFile,'utf8');
 const context={structuredClone,Date};context.window=context;vm.createContext(context);
 for(const match of runtime.matchAll(/^import (?:.*? from )?'([^']+)';$/gm)){
  const file=path.resolve(path.dirname(runtimeFile),match[1]);vm.runInContext(fs.readFileSync(file,'utf8').replace(/^export /gm,''),context,{filename:file});
 }
 context.CRMIDValidation={review:context.reviewID};
 const candidate={...person,rnokpp:null,profile_data:{}},document={...source(),document_type:'Копія паспорта/ID Картки',ai_document_type:'Українська ID-картка',ai_extracted:{...extracted,citizenship:'Україна'}};
 const before=JSON.stringify([candidate,document]),plan=context.CRMDocumentSync.plan(document,candidate);
 for(const [target,key] of [['candidate','rnokpp'],['profile','unzr'],['profile','citizenship']])assert(plan.selections.some(s=>s.target===target&&s.key===key),target+'.'+key);
 assert.equal(JSON.stringify([candidate,document]),before);
 for(const patch of [{verification_status:'Не перевірено'},{ai_processed_at:'2026-11-21T10:00:00Z'}]){
  const blocked=context.CRMDocumentSync.plan({...document,...patch},candidate);assert.equal(blocked.selections.length,0);
 }
});
test('exact residence aliases normalize without changing extracted values or a different type',()=>{
 const policy=c.CRMDocumentPolicy,canonical='Довідка про місце проживання / Витяг про місце проживання (ДІЯ)';
 for(const type of [canonical,'Витяг/довідка про зареєстроване місце проживання','Витяг з реєстру територіальної громади','Витяг про місце проживання']){
  const d={ai_document_type:type,ai_extracted:{document_number:'REC-1',passport_data:'not-a-passport',registered_address:'Адреса з джерела'}},before=JSON.stringify(d),n=policy.normalize(d);
  assert.equal(n.type,canonical);assert.equal(n.extracted.registered_address,'Адреса з джерела');assert.equal(n.extracted.passport_data,null);assert.equal(JSON.stringify(d),before);
 }
 for(const type of ['Витяг про несудимість','Актовий запис про народження','Довідка іншої особи','Витяг про місце проживання іншої особи'])assert.equal(policy.normalize({ai_document_type:type,ai_extracted:{}},canonical).type,type);
});
