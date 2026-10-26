const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
test('relative name casing handles Ukrainian names, initials, apostrophes, hyphens and maiden names',()=>{
 const c={URL,window:{}};vm.createContext(c);for(const f of ['candidate-name.js','crm-service-record.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'),c);
 const proper=c.window.CRMCandidateName.proper;
 assert.equal(proper(' ГРЕЧКО (КОВАЛЕНКО) СВІТЛАНА '),'Гречко (Коваленко) Світлана');
 assert.equal(proper('ЛУК’ЯНЕНКО АННА-МАРІЯ О.І.'),'Лук’яненко Анна-Марія О.І.');
 assert.equal(proper(null),'');assert.equal(proper(proper('ПАПАНОВ ЄВГЕН')),proper('ПАПАНОВ ЄВГЕН'));
 const state=c.window.CRMServiceRecord.model({full_name:'ТЕСТ Іван',profile_data:{relatives:[{relationship:'Батько',full_name:'ГРЕЧКО ОЛЕКСАНДР ІВАНОВИЧ',address:'м. Дніпро'}]}});
 assert.equal(state.fields.find(f=>f.key==='parents').value,'Батько: Гречко Олександр Іванович. м. Дніпро');
});

test('family model preserves maiden names and excludes held relatives without losing source review',()=>{
 const c={URL,structuredClone};c.window=c;vm.createContext(c);for(const f of ['candidate-name.js','candidate-field-registry.js','service-record-readiness.js','crm-service-record.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'),c);
 const person={id:'synthetic',full_name:'Тестовий Іван Петрович',rnokpp:'1234567890',birth_date:'1990-01-01',birth_place:'Дніпро',worked_before:false,served_before:false,has_children:true,profile_data:{education_institution:'Школа',relatives:[
 {relationship:'Мати',full_name:'ТЕСТОВА (ПРИКЛАДОВА) ОЛЕНА',address:'Збережена адреса'},
 {relationship:'Мати',full_name:'Неперевірена мати',requires_review:true,source_document_id:'mother'},
 {relationship:'Батько',full_name:'Закреслений батько',crossed_out:true,source_document_id:'father'},
 {relationship:'Дружина',full_name:'Неперевірена дружина',requires_review:true,source_document_id:'spouse'},
 {relationship:'Син',full_name:'Закреслена дитина',crossed_out:true,source_document_id:'child'},
 {relation:'Донька',full_name:'Чинна дитина'}]}};
 const before=JSON.stringify(person),values=()=>Object.fromEntries(c.CRMServiceRecord.model(person).fields.map(f=>[f.key,f.value])),v=values();
 assert.equal(v.parents,'Мати: Тестова (Прикладова) Олена. Збережена адреса');
 assert(v.family.includes('Чинна дитина'));assert(!v.family.includes('Неперевірена'));assert(!v.family.includes('Закреслена'));
 assert.equal(JSON.stringify(person),before);
 const r=c.CRMServiceReadiness.review(person,{},['mother','father','spouse','child'].map(id=>({id,file_name:id+'.pdf'})));
 assert.equal(r.ready,false);for(const id of ['mother','father','spouse','child'])assert(r.issues.some(i=>i.documents.some(d=>d.id===id)),id);
 assert(!r.issues.some(i=>i.text.includes('Кілька різних')));
 person.profile_data.relatives=[null,...person.profile_data.relatives];assert.doesNotThrow(values);assert.doesNotThrow(()=>c.CRMServiceReadiness.review(person));
 person.profile_data.relatives={invalid:true};assert.doesNotThrow(values);assert.equal(c.CRMServiceReadiness.review(person).ready,false);
 person.profile_data.relatives=[{relationship:'Мати',full_name:'Тестова (Прикладова) Олена'}];assert.equal(c.CRMServiceReadiness.review(person).ready,true);
 person.profile_data.relatives=[{relationship:'Мати',full_name:'Тестова Олена'},{relationship:'Мати',full_name:'Інша Олена'}];assert(c.CRMServiceReadiness.review(person).issues.some(i=>i.text.includes('Кілька різних')));
});
