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
