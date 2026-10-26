const {test}=require('node:test');
const assert=require('node:assert/strict');
require('../work-document.js');
require('../supabase/functions/_shared/document-data-policy.js');
const sync=require('../document-ai-sync.js');
const title='Витяг з Реєстру застрахованих осіб Державного реєстру загальнообовя’зкового державного соціального страхування (ПФУ)';
const candidate=()=>({id:'c1',full_name:'Тестенко Іван Петрович',rnokpp:'1234567890',profile_data:{service_type:'За мобілізацією'}});
const source=()=>({id:'pfu1',candidate_id:'c1',document_type:title,ai_confidence:0.99,processing_status:'AI оброблено',ai_extracted:{full_name:'Тестенко Іван Петрович',rnokpp:'1234567890',work_events:[{kind:'hire',event_date:'2020-01-01',employer:'Тестове підприємство',position:'Водій',page:1},{kind:'dismissal',event_date:'2021-01-01',employer:'Тестове підприємство',page:2}]}});

test('full PFU extract titles reach the existing work validator',()=>{
 for(const name of [title,'Копія '+title,title.replace('загальнообовя’зкового',"загальнообов'язкового"),title.replace('Витяг з','ВИТЯГ ІЗ').replaceAll(' ','  '),'Трудова книжка','Відомості з реєстру застрахованих осіб'])assert(globalThis.CRMWork.isDocument(name),name);
 for(const name of ['Довідка банку з IBAN','Довідка ПФУ','Довідка про місце проживання','Рекомендаційний лист із посиланням на '+title,title+' іншої особи'])assert(!globalThis.CRMWork.isDocument(name),name);
});

test('PFU routing preserves pages and source, without input mutation or duplicate periods',()=>{
 const c=candidate(),d=source(),before=JSON.stringify({c,d}),p=sync.plan(d,c);
 assert.equal(p.supported,true);
 const records=p.selections.find(s=>s.key==='work_records').incoming;
 assert.equal(records.length,1);assert.equal(records[0].source_document_id,'pfu1');assert.deepEqual(records[0].source_pages,[1,2]);
 assert.equal(JSON.stringify({c,d}),before);
 c.profile_data.work_records=records;c.profile_data.work_events=p.selections.find(s=>s.key==='work_events').incoming;
 const repeated=sync.plan(d,c);assert(!repeated.selections.some(s=>['work_records','work_events'].includes(s.key)));
 assert.equal(c.profile_data.service_type,'За мобілізацією');
});

test('PFU title does not bypass owner, manual values, or no-employment guards',()=>{
 for(const patch of [{candidate_id:'another-card'},{processing_status:'AI помилка'},{ai_confidence:0.2},{ai_extracted:{...source().ai_extracted,full_name:'Інший Петро Іванович',rnokpp:'9999999999'}}])assert.equal(sync.plan({...source(),...patch},candidate()).selections.length,0);
 const c=candidate();c.worked_before=false;
 assert(!sync.plan(source(),c).selections.some(s=>['work_records','work_events'].includes(s.key)));
 const manual=candidate();manual.profile_data.form_data={work_records:'Ручний запис',work_events:'Ручний запис'};
 const before=JSON.stringify(manual),p=sync.plan(source(),manual);
 assert(!p.selections.some(s=>['work_records','work_events'].includes(s.key)));assert.equal(JSON.stringify(manual),before);
});
