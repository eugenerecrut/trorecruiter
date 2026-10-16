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
