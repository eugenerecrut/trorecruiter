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
 const pfu={kind:'employment',employer:'ТОВАРИСТВО З ОБМЕЖЕНОЮ ВІДПОВІДАЛЬНІСТЮ "ВАЙН-ТАЙМ"',start_date:'2024-11-21',end_date:'2025-05-31',position:'Продавець-консультант'};
 const bio={employer:'«ВАЙН-ТАЙМ»',start_date:{value:'2024-04',precision:'month'},end_date:{value:'2025-05',precision:'month'},position:'продавець-консультант',source_document_id:'bio'};
 assert.deepEqual(facts.profile({work_records:[pfu],bio_work_claims:[bio]}).work_records,[pfu]);
 const pfuPrat={kind:'employment',employer:'ПРИВАТНЕ АКЦІОНЕРНЕ ТОВАРИСТВО "КИЇВСТАР"',start_date:'2024-12-02',end_date:'2025-06-27',position:'Молодший фахівець, Фахівець'};
 const bioPrat={employer:'ПрАТ «Київстар»',start_date:{value:'2024-11',precision:'month'},end_date:{value:'2025-06',precision:'month'},position:'менеджер',source_document_id:'bio'};
 assert.deepEqual(facts.profile({work_records:[pfuPrat],bio_work_claims:[bioPrat]}).work_records,[pfuPrat]);
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

test('crossed-out education is never ready or printed; null rows preserve the preview fallback',()=>{
 const c={URL,structuredClone};c.window=c;vm.createContext(c);for(const f of ['biography-facts.js','candidate-field-registry.js','service-record-readiness.js','crm-service-record.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'),c);
 const candidate={full_name:'Тестенко Іван Петрович',birth_date:'1990-01-01',rnokpp:'1234567890',birth_place:'Дніпро',worked_before:false,served_before:false,profile_data:{education_institution:'Збережений заклад',education_records:[{institution:'Закреслений заклад',crossed_out:true,source_document_id:'education'}]}};
 const before=JSON.stringify(candidate),r=c.CRMServiceReadiness.review(candidate,{},[{id:'education',file_name:'Освіта.pdf'}]);
 assert.equal(r.ready,false);assert(r.issues.some(i=>i.fieldId==='education.civil'&&i.documents.some(d=>d.id==='education')));
 const value=()=>c.CRMServiceRecord.model(candidate).fields.find(f=>f.key==='education_civil').value;
 assert.equal(value(),'Збережений заклад');assert.equal(JSON.stringify(candidate),before);
 for(const records of [[null],{institution:'Некоректний формат'}]){
  candidate.profile_data.education_records=records;
  assert.equal(value(),'Збережений заклад');assert.equal(c.CRMServiceReadiness.review(candidate).ready,false);
 }
 candidate.profile_data.education_records=[null,{institution:'Чинний заклад',graduation_year:'2020'}];
 assert.equal(value(),'Чинний заклад, 2020 р.');
 delete c.CRMBiographyFacts;
 for(const records of [[null],{institution:'Некоректний формат'},[{institution:'Закреслений заклад',crossed_out:true}]]){
  candidate.profile_data.education_records=records;assert.equal(value(),'Збережений заклад');assert.equal(c.CRMServiceReadiness.review(candidate).ready,false);
 }
});

test('service model excludes crossed-out work and service and tolerates null periods',()=>{
 const c={URL,structuredClone};c.window=c;vm.createContext(c);for(const f of ['biography-facts.js','candidate-field-registry.js','service-record-readiness.js','crm-service-record.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'),c);
 const person={full_name:'Тестенко Іван Петрович',birth_date:'1990-01-01',rnokpp:'1234567890',birth_place:'Дніпро',worked_before:true,served_before:true,profile_data:{education_institution:'Школа',work_records:[
 {kind:'employment',employer:'Неперевірена робота',requires_review:true},
 {kind:'military_service',unit:'Неперевірена частина',requires_review:true},
 {kind:'employment',employer:'Закреслена робота',crossed_out:true,source_document_id:'work'},
 {kind:'military_service',unit:'Закреслена частина',crossed_out:true,source_document_id:'service'},
 {kind:'employment',employer:'Чинна робота',position:'Фахівець',start_date:'2020-01-01'},
 {kind:'police_service',employer:'Поліція',position:'Поліцейський',start_date:'2021-01-01'}]}};
 const before=JSON.stringify(person),model=c.CRMServiceRecord.model(person),values=Object.fromEntries(model.fields.map(f=>[f.key,f.value]));
 assert.equal(values.work_0_2,'Чинна робота');assert.equal(values.service_0_3,'Поліція');assert(!JSON.stringify(values).includes('Закреслена'));assert(!JSON.stringify(values).includes('Неперевірена'));
 assert.equal(JSON.stringify(person),before);
 const report=c.CRMServiceReadiness.review(person,{},[{id:'work',file_name:'Робота.pdf'},{id:'service',file_name:'Служба.pdf'}]);
 assert.equal(report.ready,false);assert(report.issues.some(i=>i.documents.some(d=>d.id==='work')));assert(report.issues.some(i=>i.documents.some(d=>d.id==='service')));
 person.profile_data.work_records.unshift(null);
 assert.doesNotThrow(()=>c.CRMServiceRecord.model(person));
 person.profile_data.bio_work_claims=[{source_document_id:'bio',employer:'Інша робота',start_date:'2018'}];
 assert.doesNotThrow(()=>c.CRMServiceRecord.model(person));assert.doesNotThrow(()=>c.CRMServiceReadiness.review(person));
 delete c.CRMBiographyFacts;person.profile_data.work_records={kind:'employment'};
 assert.doesNotThrow(()=>c.CRMServiceRecord.model(person));assert.equal(c.CRMServiceReadiness.review(person).ready,false);
});

test('optional service sections exclude crossed-out records while retaining source-linked blockers',()=>{
 const c={URL,structuredClone};c.window=c;vm.createContext(c);for(const f of ['candidate-field-registry.js','service-record-readiness.js','crm-service-record.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'),c);
 const person={full_name:'Тестенко Іван Петрович',military_rank:'Солдат',birth_date:'1990-01-01',rnokpp:'1234567890',birth_place:'Дніпро',worked_before:false,served_before:false,profile_data:{education_institution:'Школа',
 combat_records:[{location:'Закреслений район',crossed_out:true,source_document_id:'combat'},{location:'Чинний район'}],
 awards:[{name:'Закреслена нагорода',crossed_out:true,source_document_id:'award'},{name:'Чинна нагорода'}],
 reserve_training_records:[{unit:'Закреслені збори',crossed_out:true,source_document_id:'training'},{unit:'Чинні збори'}],
 military_rank_records:[{rank:'Солдат',confirmed_by_user:true,crossed_out:true,order_number:'CROSSED',source_document_id:'rank'},{rank:'Солдат',confirmed_by_user:true,order_number:'VALID'}]}};
 const before=JSON.stringify(person),values=()=>Object.fromEntries(c.CRMServiceRecord.model(person).fields.map(f=>[f.key,f.value])),v=values();
 assert.equal(v.combat_0_0,'Чинний район');assert.equal(v.award_0_0,'Чинна нагорода');assert.equal(v.training_0_3,'Чинні збори');assert(v.rank_order.includes('VALID'));
 assert(!JSON.stringify(v).includes('Закреслен'));assert(!JSON.stringify(v).includes('CROSSED'));assert.equal(JSON.stringify(person),before);
 const report=c.CRMServiceReadiness.review(person,{},['combat','award','training','rank'].map(id=>({id,file_name:id+'.pdf'})));
 assert.equal(report.ready,false);for(const id of ['combat','award','training','rank'])assert(report.issues.some(i=>i.documents.some(d=>d.id===id)),id);
 for(const key of ['combat_records','awards','reserve_training_records','military_rank_records']){
  person.profile_data[key].unshift(null);assert.doesNotThrow(values);
  person.profile_data[key]={invalid:true};assert.doesNotThrow(values);assert.equal(c.CRMServiceReadiness.review(person).ready,false);
 }
 person.profile_data.military_rank_records=[{rank:'Солдат',order_number:'UNCONFIRMED'}];assert.equal(values().rank_order,'');
 person.profile_data.military_rank_records=[{rank:'Солдат',accepted_by_ai:true,requires_review:true,order_number:'HELD'}];assert.equal(values().rank_order,'');
});

test('held single source details never print or overwrite independent marital status',()=>{
 const c={URL,structuredClone};c.window=c;vm.createContext(c);for(const f of ['candidate-field-registry.js','service-record-readiness.js','crm-service-record.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'),c);
 for(const flag of ['requires_review','crossed_out'])for(const serialize of [r=>r,JSON.stringify]){
  const person={id:'synthetic',full_name:'Тестовий Іван Петрович',marital_status:'Одружений',rnokpp:'1234567890',birth_date:'1990-01-01',birth_place:'Дніпро',worked_before:false,served_before:true,profile_data:{education_institution:'Школа',work_records:[{kind:'military_service',start_date:'2020-01-01',unit:'А0000',position:'Солдат'}],
   military_oath:serialize({date:'2020-01-02',unit:'А0000',confirmed_by_user:true,[flag]:true,source_document_id:'oath'}),
   military_discharge:serialize({order_number:'TEST-D',order_date:'2021-01-01',unit:'А0000',[flag]:true,source_document_id:'discharge'}),
   marriage_record:serialize({certificate_number:'TEST-M',registration_date:'2019-01-01',[flag]:true,source_document_id:'marriage'})}};
  const before=JSON.stringify(person),values=Object.fromEntries(c.CRMServiceRecord.model(person).fields.map(f=>[f.key,f.value]));
  assert.equal(values.oath,'');assert.equal(values.discharge,'');assert.equal(values.family,'Одружений');assert.equal(JSON.stringify(person),before);
  const report=c.CRMServiceReadiness.review(person,{},['oath','discharge','marriage'].map(id=>({id,file_name:id+'.pdf'})));
  assert.equal(report.ready,false);for(const id of ['oath','discharge','marriage'])assert(report.issues.some(i=>i.documents.some(d=>d.id===id)),id);
  for(const key of ['military_oath','military_discharge','marriage_record']){const r=typeof person.profile_data[key]==='string'?JSON.parse(person.profile_data[key]):person.profile_data[key];delete r[flag];person.profile_data[key]=serialize(r);}
  const valid=Object.fromEntries(c.CRMServiceRecord.model(person).fields.map(f=>[f.key,f.value]));assert(valid.oath.includes('02.01.2020'));assert(valid.discharge.includes('TEST-D'));assert(valid.family.includes('TEST-M'));assert.equal(c.CRMServiceReadiness.review(person).ready,true);
 }
});

test('autobiography institution with Dniprovskyi spelling deduplicates against Dnipropetrovskyi diploma',()=>{
 const p={
  education_records:[{institution:'Дніпропетровський державний університет внутрішніх справ',specialty:'Право',qualification:'Бакалавр права',degree:'бакалавр',graduation_year:'2023',requires_review:false}],
  bio_education_claims:[{institution:'Дніпровський Державний університет внутрішніх справ',specialty:'Право',end_date:{value:'2023-06'},source_document_id:'bio',requires_review:false}]
 };
 const out=facts.profile(p);
 assert.equal(out.education_records.length,1);
 assert.equal(out.education_records[0].qualification,'Бакалавр права');
});
