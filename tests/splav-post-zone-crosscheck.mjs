import test from 'node:test';import assert from 'node:assert/strict';
import {crosscheckZoneContinuation} from '../supabase/functions/_shared/zone-crosscheck.mjs';
const context={document:{id:'d'},source:{document_id:'d',file_sha256:'a'.repeat(64),revision:'r'},snapshot:{pages:1},reports:[],crosscheck_binding:{document_id:'d',candidate_id:'c',candidate_revision:'fingerprint'}};
const candidate={id:'c',full_name:'Тестенко Іван Петрович',birth_date:'1990-01-01',profile_data:{}};
const doc=(id,place)=>({id,candidate_id:'c',storage_path:'c/'+id+'.pdf',version_group_id:id,version_number:1,document_type:'Свідоцтво про народження',processing_status:'AI оброблено',verification_status:'Підтверджено',ai_processed_at:'r',ai_extracted:{full_name:candidate.full_name,birth_date:candidate.birth_date,birth_place:place}});
function client(documents){return{from:table=>{const q={select:()=>q,eq:(key,value)=>{assert.equal(value,'c');return q},single:async()=>({data:candidate}),then:(a,b)=>Promise.resolve({data:documents}).then(a,b)};return q}}}
test('existing real comparator detects cross-document contradiction without writes or AI',async()=>{const r=await crosscheckZoneContinuation({client:client([doc('d','Тестове А'),doc('e','Тестове Б')]),context});assert.equal(r.status,'needs_review');assert(r.issues.some(x=>x.key==='birth_place'));assert(!JSON.stringify(r).includes('Тестове А'));assert.deepEqual(r.binding,context.crosscheck_binding);});
test('matching sources produce matched; no evidence remains review-only',async()=>{const r=await crosscheckZoneContinuation({client:client([doc('d','Тестове А'),doc('e','Тестове А')]),context});assert.equal(r.status,'matched');const empty=await crosscheckZoneContinuation({client:client([]),context});assert.equal(empty.status,'needs_review');assert.equal(empty.issues[0].key,'document');});
test('missing binding and truncated results never report success',async()=>{for(const changed of [{crosscheck_binding:null},{reports_truncated:true},{reports:null}])await assert.rejects(crosscheckZoneContinuation({client:client([]),context:{...context,...changed}}),/unavailable/);});
test('failed package read leaves finalization to retry rather than inventing agreement',async()=>{await assert.rejects(crosscheckZoneContinuation({client:client([]),context,comparator:{load:async()=>{throw Error('database unavailable')}}}),/database unavailable/);});

const field=(key,value)=>({key,value,raw_text:value,legibility:'clear',alternatives:[]});
const subjectReport=fields=>({review_only:true,mode:'zone',source:{document_id:'d',page:1,box:{x:0,y:.9,w:1,h:.1}},rows:[{fields}]});
const sourceContext=reports=>({...context,reports,source:{...context.source}});
test('foreign identity in a footer cannot disappear behind otherwise matching facts',async()=>{
 const documents=[doc('d','Тестове А')],reports=[subjectReport([field('full_name','Іншенко Олег Іванович'),field('birth_date','1985-03-15'),field('employer','Приклад'),field('signatory','Керівник Андрій Тестович')])];
 const before=JSON.stringify({candidate,documents,reports});
 const result=await crosscheckZoneContinuation({client:client(documents),context:sourceContext(reports)});
 assert.equal(result.status,'needs_review');assert(result.issues.some(i=>i.key==='zone_subject'&&i.source_ids[0]==='d'));
 assert(!JSON.stringify(result).includes('Іншенко'));assert.equal(JSON.stringify({candidate,documents,reports}),before);
});
test('explicit other-person roles and verified previous names remain separate from candidate identity',async()=>{
 for(const fields of [
  [field('full_name','Іншенко Олег Іванович'),field('signatory','полковник Іншенко Олег Іванович')],
  [field('full_name','Іншенко Олег Іванович'),field('recruiter_name','Іншенко Олег Іванович')],
  [field('full_name','Іншенко Олег Іванович'),field('relationship','батько')],
  [field('full_name',candidate.full_name)]
 ]){
  const r=await crosscheckZoneContinuation({client:client([doc('d','Тестове А')]),context:sourceContext([subjectReport(fields)])});
  assert(!r.issues.some(i=>i.key==='zone_subject'));
 }
 const profile_data=candidate.profile_data;try{
  candidate.profile_data={name_history:[{previous_full_name:'Минуленко Іван Петрович',new_full_name:candidate.full_name,verified:true}]};
  const r=await crosscheckZoneContinuation({client:client([doc('d','Тестове А')]),context:sourceContext([subjectReport([field('full_name','Минуленко Іван Петрович')])])});
  assert(!r.issues.some(i=>i.key==='zone_subject'));
  candidate.profile_data.name_history[0].verified=false;
  const draft=await crosscheckZoneContinuation({client:client([doc('d','Тестове А')]),context:sourceContext([subjectReport([field('full_name','Минуленко Іван Петрович')])])});
  assert(draft.issues.some(i=>i.key==='zone_subject'));
 }finally{candidate.profile_data=profile_data;}
});
test('subject diagnostics honor source binding, deduplication and current case boundaries',()=>{
 const compare=globalThis.CRMDocumentCrosscheck.compareZoneSubjects,document=doc('d','Тестове А'),report=subjectReport([field('full_name','Іншенко Олег Іванович')]);
 const options={reports:[report,structuredClone(report)],context:{document_id:'d',file_sha256:'a'.repeat(64),pages:1,revision:'r'},binding:context.source};
 assert.equal(compare([document],candidate,options).length,1);
 for(const change of [{document_id:'other'},{revision:'old'},{file_sha256:'b'.repeat(64)}])assert.deepEqual(compare([document],candidate,{...options,binding:{...context.source,...change}}),[]);
 for(const change of [{candidate_id:'other'},{deleted_at:'now'},{ai_processed_at:'old'}])assert.deepEqual(compare([{...document,...change}],candidate,options),[]);
 assert.deepEqual(compare([document],{...candidate,profile_data:{workflow:{archived_at:'now'}}},options),[]);
 const uncertain=subjectReport([{...field('full_name','Іншенко Олег Іванович'),value:null,legibility:'uncertain'}]);
 assert.equal(compare([document],candidate,{...options,reports:[uncertain]}).length,1);
 const alternative=subjectReport([{...field('full_name',candidate.full_name),alternatives:['Інше прочитання']}]);
 assert.equal(compare([document],candidate,{...options,reports:[alternative]}).length,1);
 const prefix=subjectReport([field('full_name','Іншенко Олег'),field('signatory','Іншенко Олегій')]);
 assert.equal(compare([document],candidate,{...options,reports:[prefix]}).length,1);
});
