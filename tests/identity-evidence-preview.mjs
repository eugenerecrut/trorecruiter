import test from 'node:test';
import assert from 'node:assert/strict';
import {previewFromSnapshot} from '../identity-evidence-preview.mjs';

const candidate={id:'synthetic-case',full_name:'Прикладенко Тест Тестович',birth_date:'1991-04-15'};
const doc={id:'synthetic-pdf',candidate_id:candidate.id,document_type:'Паспорт',verification_status:'Підтверджено',
 ai_processed_at:'revision',storage_path:'synthetic.pdf',ai_extracted:{full_name:candidate.full_name,birth_date:candidate.birth_date,birth_place:'Тестове місто'}};
const field=(rows,key)=>rows.find(x=>x.field===key);
test('preview needs a verified current same-owner original and performs no writes',()=>{
 const before=structuredClone(doc);
 const result=previewFromSnapshot(candidate,[doc,{...doc,id:'copy',file_hash:null}]);
 assert.equal(field(result,'birth_place').proposal.value,'Тестове місто');
 assert.equal(field(result,'birth_place').evidence.length,1);
 assert.deepEqual(doc,before);
 for(const changed of [{candidate_id:'foreign'},{verification_status:'Не перевірено'},{deleted_at:'now'},
  {document_type:'Свідоцтво про народження дітей'},{ai_extracted:{...doc.ai_extracted,full_name:'Інша Тестова Особа'}}])
  assert.equal(field(previewFromSnapshot(candidate,[{...doc,...changed}]),'birth_place').proposal,null);
});
test('a differing birth date flags review but cannot fill another field',()=>{
 const rows=previewFromSnapshot(candidate,[{...doc,ai_extracted:{...doc.ai_extracted,birth_date:'1991-04-16'}}]);
 assert.equal(field(rows,'birth_date').decision,'needs_review');
 assert.equal(field(rows,'birth_place').proposal,null);
});
test('older readings are not reused after a newer version is deleted or ambiguous',()=>{
 const older={...doc,version_group_id:'original',version_number:1};
 const newer={...older,id:'new',version_number:2};
 for(const latest of [[{...newer,deleted_at:'now'}],[newer,{...newer,id:'twin'}]])
  assert.equal(field(previewFromSnapshot(candidate,[older,...latest]),'birth_place').proposal,null);
});

test('a matching name cannot override contradictory owner identifiers',()=>{
 const owner={...candidate,rnokpp:'1234567890'};
 for(const extracted of [
  {...doc.ai_extracted,rnokpp:'9876543210'},
  {...doc.ai_extracted,personal:{rnokpp:'9876543210'}},
  {...doc.ai_extracted,personal:{birth_date:'1991-04-16'}}
 ]) {
  const rows=previewFromSnapshot(owner,[{...doc,ai_extracted:extracted}]);
  assert.equal(field(rows,'birth_place').proposal,null);
 }
 // Even without a card date, two different dates cannot establish one owner.
 const rows=previewFromSnapshot({...candidate,birth_date:null},[{...doc,ai_extracted:{...doc.ai_extracted,personal:{birth_date:'1991-04-16'}}}]);
 assert.equal(field(rows,'birth_place').proposal,null);
 assert.equal(field(rows,'birth_date').decision,'needs_review');
});

test('invalid version metadata cannot select a source based on input ordering',()=>{
 const valid={...doc,version_group_id:'same-original',version_number:2};
 for(const version of ['not-a-version',0,-1,1.5,'Infinity']) {
  const malformed={...valid,id:'malformed',version_number:version};
  for(const documents of [[valid,malformed],[malformed,valid]])
   assert.equal(field(previewFromSnapshot(candidate,documents),'birth_place').proposal,null);
 }
});

test('conflicting source roles cannot promote a child birth certificate to an identity source',()=>{
 for(const changed of [
  {ai_document_type:'Свідоцтво про народження дітей'},
  {requirement_type:'Копія свідоцтва про народження дітей'},
  {ai_extracted:{...doc.ai_extracted,meta:{warnings:['different person']}}}
 ]) assert.equal(field(previewFromSnapshot(candidate,[{...doc,...changed}]),'birth_place').proposal,null);
});

test('malformed snapshots fail closed instead of breaking the card',()=>{
 assert.deepEqual(previewFromSnapshot(null,null),[]);
 assert.doesNotThrow(()=>previewFromSnapshot(candidate,{}));
 for(const changed of [{ai_extracted:[]},{ai_extracted:'{}'},{storage_path:{}},{ai_warnings:['another person']}])
  assert.equal(field(previewFromSnapshot(candidate,[{...doc,...changed}]),'birth_place').proposal,null);
});
