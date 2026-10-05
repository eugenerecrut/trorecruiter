const fs=require('fs'),vm=require('vm'),assert=require('assert'),cp=require('child_process');
const root=require('path').resolve(__dirname,'..')+require('path').sep;
let checks=0;
for(const file of fs.readdirSync(root).filter(f=>f.endsWith('.js'))){cp.execFileSync(process.execPath,['--check',root+file]);checks++;}
const responsibility={window:{},document:{addEventListener(){}},supabaseClient:{auth:{onAuthStateChange(){}}}};
vm.createContext(responsibility);vm.runInContext(fs.readFileSync(root+'crm-responsibility.js','utf8'),responsibility);
const latest=responsibility.window.CRMResponsibility.latest;
assert.equal(latest([{id:'1',version_number:1},{id:'2',version_number:2}]).length,2);
assert.equal(latest([{id:'1',version_group_id:'a',version_number:1},{id:'2',version_group_id:'a',version_number:2}])[0].id,'2');
assert.equal(latest([{id:'1',version_group_id:'a',version_number:1},{id:'2',version_group_id:'a',version_number:2,deleted_at:'today'}]).length,0);
const conditions={window:{}};vm.createContext(conditions);vm.runInContext(fs.readFileSync(root+'candidate-conditions.js','utf8'),conditions);
const cond=conditions.window.CRMCandidateConditions;
assert(cond.isUnit({profile_data:{case_mode:'unit'}}));
assert(cond.unitDocument('Рекомендаційний лист'));
assert(!cond.unitDocument('Довідка ВЛК'));
assert.equal(cond.documentCondition('Копія свідоцтва про шлюб',{marital_status:'Не одружений'}),false);
assert.equal(cond.documentCondition('Документи про трудову діяльність',{worked_before:false}),false);
const src=fs.readFileSync(root+'crm-workflow.js','utf8');
const start=src.indexOf(" host.querySelector('[data-anketa]').onclick=");
const end=src.indexOf(" host.querySelector('[data-finish]')",start);
const handler=src.slice(start,end);
const factory=new Function('host','run','getCandidateDocuments','latest','esc','name','anketaFileName','c','modal','storePackage','mergedPDF','persist','download','refresh','CRMWorkspace',handler);
const base=['Анкета на контракт','Українська ID-картка','Копія ідентифікаційного коду','Довідка ВЛК','Додаток 13 (Картка обстеження та медичного огляду)','Довідка з МВС — повна (довідка про несудимість)'];
async function plan(types){let html='',button={addEventListener(){}},click={};const docs=types.map((type,i)=>typeof type==='object'?type:{id:String(i),document_type:type,file_name:type+'.pdf',verification_status:'Підтверджено'});
 factory({querySelector:()=>click},f=>f(),async()=>docs,latest,s=>String(s),'Тестовий кандидат','Анкета_Тестовий кандидат.pdf',{id:'test'},(t,h)=>{html=h;return{querySelector:()=>button}},()=>{throw Error('unexpected write')},()=>{},()=>{},()=>{},()=>{},{navigate(){}});
 await click.onclick();return html;}
(async()=>{
 for(const military of ['Копія військового квитка','Посвідчення про приписку до призовної дільниці','Копія приписного','Витяг з Резерв+','Військовий облік (витяг Резерв+ / приписне)']){const h=await plan([...base,military]);assert(!h.includes('data-build disabled'),military);checks++;}
 for(const missing of base){const h=await plan([...base.filter(t=>t!==missing),'Копія приписного']);assert(h.includes('data-build disabled'),missing);assert(h.includes('Не завантажено'));checks++;}
 let h=await plan([...base,'Копія приписного','Копія військового квитка']);assert(h.includes('Копія військового квитка.pdf'));assert(!h.includes('Копія приписного.pdf'));checks++;
 h=await plan([...base,'Копія приписного','Копія посвідчення водія / інші посвідчення','Копія УБД']);assert(h.includes('Копія посвідчення водія / інші посвідчення.pdf'));checks++;
 h=await plan([...base,{document_type:'Копія приписного',file_name:'test.pdf',verification_status:'Не перевірено'}]);assert(h.includes('Потрібно підтвердити'));assert(h.includes('data-build disabled'));checks++;
 h=await plan(base);assert(h.includes('Військово-обліковий документ'));assert(h.includes('data-build disabled'));checks++;
 const cardSource=fs.readFileSync(root+'candidate-card-v2.js','utf8');
 const saveStart=cardSource.indexOf('const saveCard=')+'const saveCard='.length;
 const saveEnd=cardSource.indexOf('    cardState.save=',saveStart);
 const saveFactory=new Function('context','with(context){return '+cardSource.slice(saveStart,saveEnd).trim().replace(/;$/,'')+'}');
 async function saveScenario(conflict){
  let queryVersion,pfWrites=0,patch;const values={name_nominative:'Тестовий кандидат',case_mode:'full',education_diploma_number:'123',education_start_date:'2020-09-01'};
  const c={id:'test',updated_at:'refreshed-by-workflow',profile_data:{}},pf={education:'Освіта, збережена раніше'},state={expectedUpdatedAt:'loaded-version'},status={};
  const form={reportValidity:()=>true,querySelectorAll:()=>[],querySelector:()=>({textContent:''})};
  const context={c,pf,profile:{},candidateId:'test',cardState:state,content:{querySelector:()=>status},document:{getElementById:()=>status},FormData:class{get(k){return values[k]??''}has(k){return Object.hasOwn(values,k)}},nameNominative:v=>v,CRMBiography:{partial:()=>null},CRMWork:{summary:()=>({days:0,incomplete:0})},window:{CRMPhone:{normalize:v=>v}},CRMWorkflow:{wf:()=>({}),mount:async()=>{}},supabaseClient:{from(table){return table==='candidates'?{update(p){patch=p;return{eq(k,v){if(k==='updated_at')queryVersion=v;return this},is(k,v){queryVersion=v;return this},select(){return this},async maybeSingle(){return{error:null,data:conflict?null:{...patch,updated_at:'saved-version'}}}}}}:{async upsert(p){pfWrites++;return{error:null}}}}}};
  const result=await saveFactory(context)({preventDefault(){},target:form});
  assert.equal(queryVersion,'loaded-version');
  if(conflict){assert.equal(result,false);assert.equal(pfWrites,0);assert(status.textContent.includes('інший працівник'));}
  else{assert.equal(result,true);assert.equal(pf.education,'Освіта, збережена раніше');assert.equal(c.profile_data.education_diploma_number,'123');assert.equal(c.profile_data.education_start_date,'2020-09-01');assert.equal(state.expectedUpdatedAt,'saved-version');assert.equal(pfWrites,1);}
 }
 await saveScenario(false);await saveScenario(true);checks+=2;
 assert.equal(cond.normalizeRequirement({document_type:'Копія УБД',is_required:true}).is_required,false);
 assert.equal(cond.normalizeRequirement({document_type:'Нагороди',is_required:true}).is_required,false);
 assert.equal(cond.normalizeRequirement({document_type:'Довідка ВЛК',is_required:true}).is_required,true);checks+=3;
 console.log('PASS: '+checks+' syntax and package scenario checks; no database writes.');
})().catch(e=>{console.error(e);process.exitCode=1});
