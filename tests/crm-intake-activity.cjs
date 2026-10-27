const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function context(files){const c=vm.createContext({console,structuredClone});c.window=c;for(const f of files)vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'),c);return c;}
const files=['supabase/functions/_shared/document-data-policy.js','work-document.js','document-ai-sync.js'];
function plan(flags={},events,old=[]){
 const c=context(files),candidate={id:'c',full_name:'ТЕСТЕНКО Іван Петрович',birth_date:'1990-01-01',profile_data:{...flags,work_records:old}};
 const doc={id:'d',document_type:'Трудова книжка',ai_confidence:0.99,ai_extracted:{full_name:candidate.full_name,birth_date:candidate.birth_date,work_events:events||[{kind:'hire',employer:'Підприємство',event_date:'2020-01-01',position:'Водій'}]}};
 return c.CRMDocumentSync.plan(doc,candidate);
}
test('manual no-work blocks new employment periods and source events',()=>{
 const p=plan({worked_before:false});assert(!p.selections.some(s=>['work_records','work_events'].includes(s.key)));assert(p.rows.some(r=>r.action==='conflict'&&r.reason.includes('Не працював')));
});
test('unknown and positive employment answers allow reliable new work',()=>{
 for(const flags of [{},{worked_before:true}]){const p=plan(flags);assert(p.selections.some(s=>s.key==='work_records'));assert(p.selections.some(s=>s.key==='work_events'));}
});
test('no-service blocks service while independent employment remains available',()=>{
 const p=plan({served_before:'false'},[{kind:'service_start',employer:'А0000',event_date:'2020-01-01'},{kind:'hire',employer:'Підприємство',event_date:'2021-01-01'}]);
 assert(p.rows.some(r=>r.action==='conflict'&&r.reason.includes('Не служив')));
 for(const s of p.selections.filter(s=>['work_records','work_events'].includes(s.key)))assert(s.incoming.every(r=>!['military_service','service_start'].includes(r.kind)));
 assert(p.selections.some(s=>s.key==='work_records'&&s.incoming.some(r=>r.kind==='employment')));
});
test('pending and failed AI never offer stale extraction for transfer',()=>{
 const c=context([]);c.CRMResponsibility={latest:docs=>docs};let calls=0;c.CRMDocumentSync={plan:()=>{calls++;return {supported:true,selections:[{}],rows:[{action:'fill'}]}}};
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../crm-intake.js'),'utf8'),c);
 const rows=c.CRMIntake.items({},['AI обробка','AI помилка','Завершено'].map(processing_status=>({processing_status,ai_extracted:{full_name:'Тест'},verification_status:'Потребує перевірки'})));
 assert.equal(calls,1);assert.equal(rows[0].fills.length,0);assert.equal(rows[0].review,false);assert.equal(rows[1].fills.length,0);assert.equal(rows[1].failed,true);assert.equal(rows[2].fills.length,1);
});

test('keep-card decision closes only the exact saved question and reopens on changed evidence',()=>{
 const c=context([]);c.CRMResponsibility={latest:docs=>docs};const conflict={target:'candidate',key:'phone',action:'conflict',current:'111',incoming:'222',reason:'Збережене значення має пріоритет'};c.CRMDocumentSync={plan:()=>({supported:true,selections:[],rows:[{...conflict}]})};vm.runInContext(fs.readFileSync(path.join(__dirname,'../crm-intake.js'),'utf8'),c);
 const doc={ai_extracted:{_crm_review_decisions:[{...conflict,action:'keep_card',reviewed_by:'user',reviewed_at:'now'}]}};assert.equal(c.CRMIntake.items({},[doc])[0].conflicts.length,0);conflict.incoming='333';assert.equal(c.CRMIntake.items({},[doc])[0].conflicts.length,1);
});

test('one relative field uses the real aggregate planner without transferring other proposed facts',()=>{
 const c=context(files);c.CRMResponsibility={latest:docs=>docs};vm.runInContext(fs.readFileSync(path.join(__dirname,'../crm-intake.js'),'utf8'),c);
 const candidate={id:'c',full_name:'Тестенко Іван Петрович',profile_data:{relatives:[{relationship:'мати',full_name:'Тестова Олена Іванівна',phone:'saved',field_sources:{full_name:'old'}}]}},doc={id:'d',candidate_id:'c',document_type:'Свідоцтво про народження',verification_status:'Підтверджено',ai_extracted:{full_name:candidate.full_name,relatives:[{relationship:'мати',full_name:'Тестова Олена Іванівна',birth_date:'1970',deceased:false,address:'New address'}]}};
 const plan=c.CRMDocumentSync.plan(doc,candidate),row=plan.rows.find(r=>r.key==='relatives.0.birth_date');assert.equal(row?.action,'fill');assert.equal(c.CRMIntake.canFillField(plan,row),true);
 const before=JSON.stringify({candidate,doc,plan}),chosen=c.CRMIntake.reviewedFill({doc,plan},plan,candidate,row);
 assert.equal(chosen.selections.length,1);assert.equal(chosen.selections[0].key,'relatives');const relative=chosen.selections[0].incoming[0];
 assert.equal(relative.birth_date,'1970');assert.equal(relative.deceased,undefined);assert.equal(relative.address,undefined);assert.equal(relative.phone,'saved');
 assert.equal(relative.field_sources.full_name,'old');assert.equal(relative.field_sources.birth_date,'d');assert.equal(chosen.rows.length,1);
 assert.equal(JSON.stringify({candidate,doc,plan}),before);
 const falseRow=plan.rows.find(r=>r.key==='relatives.0.deceased'),falsePlan=c.CRMIntake.reviewedFill({doc,plan},plan,candidate,falseRow);assert.equal(falsePlan.selections[0].incoming[0].deceased,false);assert.equal(falsePlan.selections[0].incoming[0].birth_date,undefined);
 const stale=structuredClone(plan);stale.document.ai_extracted.full_name='Changed';assert.throws(()=>c.CRMIntake.reviewedFill({doc,plan},stale,candidate,row),/Джерело/);
 const reordered=structuredClone(plan);reordered.selections.find(s=>s.key==='relatives').expected_current[0].full_name='Other person';assert.throws(()=>c.CRMIntake.reviewedFill({doc,plan},reordered,candidate,row),/перевірку документа/);
 assert.equal(c.CRMIntake.canFillField(plan,{action:'fill',target:'profile',key:'relatives.1.birth_date'}),false);
 assert.equal(c.CRMIntake.canFillField(plan,{action:'fill',target:'profile',key:'relatives.1'}),false);
});

test('relative phones in local and international notation agree without changing saved values',()=>{
 const c=context([]);c.document={addEventListener(){}};vm.runInContext(fs.readFileSync(path.join(__dirname,'../candidate-phone.js'),'utf8'),c);vm.runInContext(fs.readFileSync(path.join(__dirname,'../document-ai-sync.js'),'utf8'),c);
 const stored=[{relationship:'Мати',full_name:'Тестенко Олена Іванівна',phone:'+380501234567'}],rows=[];
 const merged=c.CRMDocumentSync.mergeRelatives(stored,[{relationship:'Мати',full_name:stored[0].full_name,phone:'050 123-45-67'}],(...args)=>rows.push(args),'d');
 assert.equal(rows[0][3],'leave');assert.equal(merged[0].phone,stored[0].phone);
 const different=[];c.CRMDocumentSync.mergeRelatives(stored,[{relationship:'Мати',full_name:stored[0].full_name,phone:'0501234568'}],(...args)=>different.push(args),'d');assert.equal(different[0][3],'conflict');
});

test('reordered certificate object keys do not create a conflict; changed facts still do',()=>{
 const c=context(files),candidate={id:'c',full_name:'Тестенко Іван Петрович',profile_data:{ubd_certificate:{number:'123',source_document_id:'d',issue_date:'2024-01-01',series:'УБД'}}};
 const doc={id:'d',candidate_id:'c',document_type:'Копія УБД',verification_status:'Підтверджено',ai_extracted:{full_name:candidate.full_name,document_date:'2024-01-01',document_series:'УБД',document_number:'123'}};
 const p=c.CRMDocumentSync.plan(doc,candidate);assert.equal(p.rows.find(r=>r.key==='ubd_certificate')?.action,'leave');assert.equal(p.selections.length,0);
 doc.ai_extracted.document_number='124';assert.equal(c.CRMDocumentSync.plan(doc,candidate).rows.find(r=>r.key==='ubd_certificate')?.action,'conflict');
});
