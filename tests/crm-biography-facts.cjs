const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const facts=require('../biography-facts.js');
const claim=(extra={})=>({employer:'Національна поліція України у м. Дніпрі',position:'поліцейський',start_date:{value:'2024-03-05',precision:'day'},end_date:{value:'2025-11-04',precision:'day'},source_document_id:'bio',requires_review:false,...extra});

test('complex biography preserves parallel education and work and never invents foreign employers or exact days',()=>{
 const p={bio_education_claims:[
  {institution:'Тестова школа',start_date:'1993-09',end_date:'2003-05',source_document_id:'bio'},
  {institution:'Тестовий технікум',start_date:'2003-09',end_date:'2006-05',source_document_id:'bio'},
  {institution:'Тестовий університет',degree:'бакалавр',start_date:'2010-09',end_date:'2015-05',source_document_id:'bio'},
 ],bio_work_claims:[
  claim({employer:'Тестовий ресторан',start_date:'2003-09-15',end_date:'2006-01-15'}),
  claim({employer:'Тестовий завод',start_date:'2010',end_date:'2012'}),
  claim({employer:null,position:null,start_date:'2008',end_date:'2010',notes:'Працював за кордоном'}),
  claim({employer:null,position:null,start_date:'2006',end_date:'2008',notes:'Безробітний'}),
 ]},before=JSON.stringify(p),out=facts.profile(p);
 assert.equal(JSON.stringify(p),before);assert.equal(out.education_records.length,3);
 assert.equal(out.work_records.length,2);assert.equal(out.work_records[1].start_date,'2010');
 assert.equal(out.work_records[1].date_precision.start,'year');
 assert.equal(out.education_records[2].study_start_date,'2010-09');
 assert.equal(out.education_records[1].degree,undefined);
 assert.deepEqual(facts.profile(out),out);
});
test('explicit police period prints in service only with exact institution, no military unit prefix',()=>{
 const c={URL,structuredClone};c.window=c;vm.createContext(c);for(const f of ['biography-facts.js','candidate-field-registry.js','service-record-readiness.js','crm-service-record.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'),c);
 const r={...claim(),kind:'police_service',start_date:'2024-03-05',end_date:'2025-11-04',order_number:null};
 const candidate={full_name:'ТЕСТЕНКО Марія Іванівна',sex:'female',birth_date:'1990-01-01',rnokpp:'1234567890',birth_place:'Дніпро',worked_before:false,served_before:true,profile_data:{education_institution:'Школа',work_records:[r]}};
 const fields=c.CRMServiceRecord.model(candidate).fields,value=k=>fields.find(f=>f.key===k)?.value;
 assert.equal(value('work_0_0'),undefined);assert.equal(value('not_worked'),'Не працювала');
 assert.equal(value('service_0_3'),r.employer);assert.equal(value('service_0_2'),'поліцейський');assert.equal(value('service_0_4'),'');
 assert(c.CRMServiceReadiness.review(candidate).ready);
});
test('autobiography work enters shared output facts without mutation or military duplication',()=>{
 const p={work_records:[],bio_work_claims:[claim()],bio_service_claims:[{unit:'Національна поліція України',...claim()}]},old=JSON.stringify(p),out=facts.profile(p);
 assert.equal(JSON.stringify(p),old);assert.equal(out.work_records.length,1);assert.equal(out.work_records[0].kind,'employment');assert.equal(out.work_records[0].source_document_id,'bio');assert.equal(out.work_records[0].start_date,'2024-03-05');
});
test('month and year remain partial; invalid, held and unsourced claims do not print',()=>{
 const out=facts.profile({bio_work_claims:[claim({start_date:{value:'2021-10'},end_date:{value:'2022-05'}}),claim({start_date:{value:'2020-02-30'}}),claim({requires_review:true}),claim({source_document_id:null})]});assert.equal(out.work_records.length,1);assert.equal(out.work_records[0].start_date,'2021-10');assert.equal(out.work_records[0].end_date,'2022-05');assert.equal(facts.partial('2020').value,'2020');assert.equal(facts.partial('2020-13'),null);
});
test('overlapping confirmed employer record wins and repeated projection is idempotent',()=>{
 const manual={kind:'employment',employer:claim().employer,start_date:'2024-03-05',end_date:'2025-11-04',position:'Погоджена посада',confirmed_by_user:true},out=facts.profile({work_records:[manual],bio_work_claims:[claim()]});assert.deepEqual(out.work_records,[manual]);assert.deepEqual(facts.profile(out),out);
});
test('diploma is retained; autobiography education fills absence only',()=>{
 const bio={institution:'Школа',degree:'середня',end_date:{value:'2019-05'},source_document_id:'bio'};
 assert.equal(facts.profile({bio_education_claims:[bio]}).education_records[0].graduation_year,'2019');
 assert.deepEqual(facts.profile({education_records:[{institution:'Університет'}],bio_education_claims:[bio]}).education_records,[{institution:'Університет'}]);
});
test('service record and readiness use the same autobiography periods and partial dates',()=>{
 const c={URL,structuredClone};c.window=c;vm.createContext(c);for(const f of ['biography-facts.js','candidate-field-registry.js','service-record-readiness.js','crm-service-record.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'),c);
 const candidate={full_name:'ТЕСТЕНКО Іван Петрович',birth_date:'1990-01-01',rnokpp:'1234567890',birth_place:'Дніпро',worked_before:true,served_before:false,profile_data:{education_institution:'Школа',bio_work_claims:[claim({start_date:{value:'2021-10'},end_date:{value:'2022-05'}})]}};
 const model=c.CRMServiceRecord.model(candidate,{}),value=k=>model.fields.find(f=>f.key===k)?.value;assert.equal(value('work_0_0'),'10.\n2021');assert.equal(value('work_0_2'),claim().employer);assert(c.CRMServiceReadiness.review(candidate).ready);
});

test('distinct biography education survives a different complete diploma without duplicates',()=>{const p={education_records:[{institution:'Університет',degree:'бакалавр',graduation_year:'2023'}],bio_education_claims:[{institution:'Школа',degree:'середня',end_date:'2019',source_document_id:'bio'}]};const out=facts.profile(p);assert.equal(out.education_records.length,2);assert.deepEqual(facts.profile(out),out)});
