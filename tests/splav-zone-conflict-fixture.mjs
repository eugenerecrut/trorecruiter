import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../supabase/functions/_shared/sync-runtime.js';
import {crosscheckZoneContinuation} from '../supabase/functions/_shared/zone-crosscheck.mjs';
import {groupReviewIssues} from '../supabase/functions/_shared/case-review-shadow.mjs';

const name='ПРИКЛАДЕНКО Тест Тестович';
const parent='Прикладенко Умовна Зразківна';
const date='1991-04-15';
const candidate={id:'fixture-case',full_name:name,birth_date:date,birth_place:'місто Чернігів',
 profile_data:{relatives:[{relationship:'мати',full_name:parent,birth_date:'1966-05-21',confirmed_by_user:true}]}};
const document={id:'fixture-pdf',candidate_id:candidate.id,storage_path:'synthetic/zone.pdf',
 document_type:'Автобіографія друкована',ai_confidence:.97,ai_processed_at:'2026-11-14T10:00:00Z',
 ai_extracted:{relatives:[],autobiography:{owner_full_name:name,owner_birth_date:date,multiple_owners:false,
  personal:{birth_place:'місто Полтава'},relatives:[{relationship:'мати',full_name:parent,birth_date:'1966-05-20'}]}}};
const binding={document_id:document.id,file_sha256:'a'.repeat(64),revision:document.ai_processed_at};
const field=(key,value)=>({key,value,raw_text:value,legibility:'clear'});
function report(y,fields){
 return {mode:'zone',review_only:true,source:{...binding,page:1,box:{x:.1,y,w:.8,h:.16}},rows:[{fields}]};
}

test('same-owner biography can hand off to zones and group the duplicated birthplace conflict',async()=>{
 const before=structuredClone({candidate,document});
 const plan=globalThis.CRMDocumentSync.plan(document,candidate);
 assert.equal(plan.supported,true);
 assert.equal(plan.ownerBlocked,false);
 assert.ok(plan.rows.some(row=>row.key==='relatives.0.birth_date'&&row.action==='conflict'));
 assert.ok(plan.rows.some(row=>row.key==='birth_place'&&row.action==='conflict'));
 assert.deepEqual(plan.selections,[]);

 const client={from:table=>({select:()=>({eq:()=>table==='candidates'
  ?{single:async()=>({data:candidate})}:Promise.resolve({data:[document]})})})};
 const result=await crosscheckZoneContinuation({client,context:{document,source:binding,
  crosscheck_binding:{document_id:document.id,candidate_id:candidate.id},snapshot:{pages:1},
  reports:[report(.18,[field('full_name',name),field('birth_place','місто Полтава')]),
   report(.57,[field('relationship','мати'),field('relative_name',parent),field('birth_date','1966-05-20')])]}});
 const items=result.issues;
 const same=items.flatMap((x,i)=>x.key==='birth_place'?[i]:[]);
 const separate=items.flatMap((x,i)=>x.key==='birth_place'?[]:[i]);
 assert.equal(result.status,'needs_review');
 assert.equal(same.length,2);
 assert.ok(separate.some(i=>items[i].key==='relatives'));
 const original=structuredClone(result);
 const grouped=await groupReviewIssues(items,async input=>{
  assert.deepEqual(Object.keys(input[0]).sort(),['field','i','kind']);
  return [{items:same,action:'compare_sources'},...separate.map(i=>({items:[i],action:'review_document'}))];
 });
 assert.equal(grouped?.group_count,items.length-1);
 assert.deepEqual(result,original);
 assert.deepEqual({candidate,document},before);
});

test('nested biography with a different author cannot become candidate evidence',()=>{
 const wrong=structuredClone(document);
 wrong.ai_extracted.full_name=name;
 wrong.ai_extracted.autobiography.owner_full_name='Інша Тестова Особа';
 const plan=globalThis.CRMDocumentSync.plan(wrong,candidate);
 assert.equal(plan.ownerBlocked,true);
 assert.deepEqual(plan.selections,[]);
 assert.equal(globalThis.CRMDocumentCrosscheck.compare([wrong],candidate).find(r=>r.key==='birth_place').sources.length,0);
});
