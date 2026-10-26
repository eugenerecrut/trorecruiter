const {test}=require('node:test'),assert=require('node:assert/strict');
require('../name-change-document.js');
const names=globalThis.CRMNameHistory;
const candidate=()=>({id:'c1',full_name:'Новий Іван Петрович',birth_date:'1990-01-02',rnokpp:'1234567890',profile_data:{name_history:[{previous_full_name:'Ручний Іван Петрович',new_full_name:'Новий Іван Петрович',verified:false}]}});
const document=()=>({id:'d1',candidate_id:'c1',verification_status:'Підтверджено'});
const extracted=()=>({birth_date:'1990-01-02',name_change:{previous_full_name:'Попередній Іван Петрович',new_full_name:'Новий Іван Петрович',change_date:'2020-02-29'}});
test('malformed and empty names cannot become verified name history',()=>{
 for(const key of ['previous_full_name','new_full_name'])for(const value of ['   ',{},[],123,'???']){
  const c=candidate(),d=document(),e=extracted();e.name_change[key]=value;const before=JSON.stringify({c,d,e}),review=names.review(e,c,d);
  assert.equal(review.blocked,true,key+': '+JSON.stringify(value));assert.deepEqual(review.history,c.profile_data.name_history);assert.equal(JSON.stringify({c,d,e}),before);
 }
});
test('provided change dates require real full calendar dates without rollover',()=>{
 for(const value of ['2025-02-29','2024-02-30','2020-13-01','2020-01-00','2020-02',20200229,{}]){
  const c=candidate(),e=extracted();e.name_change.change_date=value;const before=JSON.stringify({c,e}),review=names.review(e,c,document());
  assert.equal(review.blocked,true,JSON.stringify(value));assert.deepEqual(review.history,c.profile_data.name_history);assert.equal(JSON.stringify({c,e}),before);
 }
});
test('missing dates remain missing and valid records are source-bound and idempotent',()=>{
 for(const value of [undefined,null,'','2020-02-29']){
  const c=candidate(),e=extracted(),d=document();e.name_change.change_date=value;const before=JSON.stringify({c,e,d});
  const review=names.review(e,c,d);assert.equal(review.blocked,false);assert.equal(review.history.length,2);
  const added=review.history[1];assert.equal(added.change_date,value);assert.equal(added.source_document_id,'d1');assert.equal(added.verified,true);assert.equal(JSON.stringify({c,e,d}),before);
  c.profile_data.name_history=review.history;assert.equal(names.review(e,c,d).history.length,2);assert.equal(c.full_name,'Новий Іван Петрович');
 }
});
test('existing owner, document-confirmation and review requirements remain in force',()=>{
 for(const change of [(e,c,d)=>d.verification_status='Не перевірено',(e)=>e.rnokpp='9999999999',(e)=>e.birth_date='1991-01-02',(e)=>e.name_change.requires_review=true]){
  const c=candidate(),e=extracted(),d=document();change(e,c,d);const review=names.review(e,c,d);assert.equal(review.blocked,true);assert.deepEqual(review.history,c.profile_data.name_history);
 }
});

test('draft upgrade preserves an unrelated manual name record and remains idempotent',()=>{
 const c=candidate(),d=document(),e=extracted();
 const manual={previous_full_name:'Давній Іван Петрович',new_full_name:c.full_name,verified:true,confirmed_by_user:true,notes:'Зберегти вручну'};
 const draft={previous_full_name:e.name_change.previous_full_name,new_full_name:e.name_change.new_full_name,verified:false};
 c.profile_data.name_history=[manual,draft];
 const before=JSON.stringify({c,d,e,manual}),review=names.review(e,c,d);
 assert.equal(review.blocked,false);assert.equal(review.history.length,2);
 assert.deepEqual(review.history.find(r=>r.previous_full_name===manual.previous_full_name),manual);
 const upgraded=review.history.filter(r=>r.previous_full_name===e.name_change.previous_full_name);
 assert.equal(upgraded.length,1);assert.equal(upgraded[0].verified,true);assert.equal(upgraded[0].source_document_id,d.id);
 assert.equal(upgraded[0].new_full_name,e.name_change.new_full_name);assert.equal(upgraded[0].change_date,e.name_change.change_date);
 assert.equal(JSON.stringify({c,d,e,manual}),before);assert.equal(c.full_name,'Новий Іван Петрович');
 const clone=structuredClone(c);clone.profile_data.name_history=structuredClone(review.history);
 const reviewedBefore=JSON.stringify({clone,history:review.history});
 assert.deepEqual(names.review(e,clone,d).history,review.history);
 assert.equal(JSON.stringify({clone,history:review.history}),reviewedBefore);
});
