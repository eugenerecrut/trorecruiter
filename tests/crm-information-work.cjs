const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','crm-workspace.js'),'utf8');
const start=source.indexOf('  employmentInformation(c,p,pf) {');
const end=source.indexOf('  async showInformation(id)',start);
const ctx=vm.createContext({window:{},CRMCandidateConditions:{bool:v=>v===true||v==='true'?true:v===false||v==='false'?false:null},CRMWork:{historyText:rows=>(rows||[]).filter(r=>r.kind==='employment').map(r=>r.employer).join('\n')}});
ctx.window.CRMWork=ctx.CRMWork;
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','case-information.js'),'utf8'),ctx);ctx.CRMCaseInformation=ctx.window.CRMCaseInformation;
vm.runInContext('var workspace={'+source.slice(start,end)+'};',ctx);
const summary=(c,p={},pf={})=>ctx.workspace.employmentInformation(c,p,pf);
test('Explicit no-work in the card overrides old OCR and personal-file work text',()=>{
 const p={worked_before:'true',work_records:[{kind:'employment',employer:'Old employer'}],work_history:'Old text'};
 const before=JSON.stringify(p);
 assert.equal(summary({worked_before:false,sex:'male'},p,{work_history:'Old AI text'}),'Не працював');
 assert.equal(JSON.stringify(p),before);
});
test('Gender and boolean string/profile fallback are respected',()=>{
 assert.equal(summary({worked_before:'false',sex:'female'}),'Не працювала');
 assert.equal(summary({sex:'male'},{worked_before:'false'}),'Не працював');
 assert.equal(summary({worked_before:false}),'Не працював / не працювала');
});
test('Work history remains available when worked before; military service is separate',()=>{
 assert.equal(summary({worked_before:true},{work_records:[{kind:'employment',employer:'Employer'},{kind:'military_service',employer:'Military unit'}]}),'Employer');
 assert.equal(summary({worked_before:true},{},{civilian_experience:'Existing work'}),'Existing work');
 assert.equal(summary({},{}),'');
 assert(source.includes("['Трудовий стаж',work]"));
 assert(fs.readFileSync(path.join(__dirname,'..','case-information.js'),'utf8').includes("serviceSummary(p.work_records)"));
});
