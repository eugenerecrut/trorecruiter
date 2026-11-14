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
