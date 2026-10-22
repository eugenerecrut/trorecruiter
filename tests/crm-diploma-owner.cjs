const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const context={window:{},structuredClone,console,Date};context.window=context;
vm.createContext(context);
for(const file of ['supabase/functions/_shared/document-data-policy.js','education-document.js','document-ai-sync.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context);
const c=()=>({id:'c',full_name:'ТЕСТЕНКО Іван Петрович',birth_date:'1990-06-13',profile_data:{education_records:[]}});
const row=()=>({degree:'бакалавр',owner_full_name:'Тестенко Іван',owner_birth_date:'1990-06-13',institution:'Тестовий університет',diploma_series:'В24',diploma_number:'123456',diploma_present:true,graduation_year:2024,source_document_id:'d'});
const doc=r=>({id:'d',candidate_id:'c',document_type:'Документи про освіту',verification_status:'Підтверджено',ai_confidence:0,ai_extracted:{full_name:r.owner_full_name,birth_date:r.owner_birth_date,education_records:[r]}});
test('Confirmed diploma with surname and given name plus matching DOB preserves full candidate name',()=>{
 const p=context.CRMDocumentSync.plan(doc(row()),c());
 assert(!p.rows.some(r=>r.key==='full_name'&&r.action==='conflict'));
 assert(!p.selections.some(r=>r.key==='full_name'));
 assert(p.selections.some(r=>r.key==='education_records'));
});
test('Given-name-first diploma without DOB links only to an identified existing supplement',()=>{
 const candidate=c(),r=row();candidate.profile_data.education_records=[{...r,owner_full_name:candidate.full_name,source_document_id:'supplement'}];
 r.owner_full_name='Іван Тестенко';r.owner_birth_date=null;
 assert.equal(context.CRMEducation.ownerMatches(r,candidate,candidate.profile_data.education_records,true),true);
 const p=context.CRMDocumentSync.plan(doc(r),candidate);
 assert(!p.rows.some(r=>r.reason==='ПІБ не збігається: звірте власника документа'));
 assert.equal(context.CRMEducation.ownerMatches(r,candidate,[],true),false);
 assert.equal(context.CRMEducation.ownerMatches(r,candidate,candidate.profile_data.education_records,false),false);
 for(const key of ['diploma_series','diploma_number','institution'])assert.equal(context.CRMEducation.ownerMatches({...r,[key]:'інше'},candidate,candidate.profile_data.education_records,true),false);
});
test('Surname-only, wrong given name, wrong patronymic and different DOB remain blocked',()=>{
 for(const owner_full_name of ['Тестенко','Тестенко Петро','Тестенко Іван Миколайович','Іван Петрович'])assert.equal(context.CRMEducation.ownerMatches({...row(),owner_full_name},c()),false);
 const r={...row(),owner_birth_date:'1991-06-13'};
 assert.equal(context.CRMEducation.ownerMatches(r,c()),false);
 assert.equal(context.CRMDocumentSync.plan(doc(r),c()).selections.length,0);
});
test('Unconfirmed OCR and non-education documents do not get the diploma exception',()=>{
 const d=doc(row());d.verification_status='Потребує перевірки';
 assert.equal(context.CRMDocumentSync.plan(d,c()).selections.length,0);
 d.verification_status='Підтверджено';d.document_type='Свідоцтво про народження';
 assert.equal(context.CRMDocumentSync.plan(d,c()).selections.length,0);
});
