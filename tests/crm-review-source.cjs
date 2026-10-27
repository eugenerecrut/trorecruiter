const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function fixture(){const c={structuredClone,CRMResponsibility:{latest:x=>x}};c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(__dirname,'../crm-intake.js'),'utf8'),c);const row={target:'candidate',key:'phone',current:'111',incoming:'222',reason:'different',action:'conflict'};c.CRMDocumentSync={plan:()=>({supported:true,rows:[{...row}],selections:[]})};const doc={id:'d',candidate_id:'c',document_type:'ID',version_group_id:'g',version_number:1,storage_path:'c/a.pdf',file_hash:'abc',processing_status:'AI готово',ai_extracted:{phone:'222',relatives:[{full_name:'Тестова Олена'}]}};const candidate={id:'c'};doc.ai_extracted._crm_review_context={version:1,id:'context',source:structuredClone(c.CRMReviewDecision.source(doc))};doc.ai_extracted._crm_review_decisions=[{...row,action:'keep_card',reviewed_by:'u',reviewed_at:'now',source_binding:{version:1,context_id:'context'}}];return {c,doc,row,candidate};}
const conflicts=f=>f.c.CRMIntake.items(f.candidate,[f.doc])[0].conflicts.length;
test('bound decision closes current exact evidence; shared metadata does not invalidate itself',()=>{const f=fixture();assert.equal(conflicts(f),0);f.doc.ai_extracted._crm_review_decisions.push({...f.doc.ai_extracted._crm_review_decisions[0],key:'other'});assert.equal(conflicts(f),0);assert.equal(f.c.CRMReviewDecision.binding(f.doc,f.doc.ai_extracted._crm_review_decisions[0],f.candidate),'source-snapshot');});
for(const key of ['id','candidate_id','document_type','version_group_id','version_number','storage_path','file_hash'])test('bound decision invalidates on changed source '+key,()=>{const f=fixture();f.doc[key]=key==='version_number'?2:'changed';assert.equal(f.c.CRMReviewDecision.binding(f.doc,f.doc.ai_extracted._crm_review_decisions[0],f.candidate),'stale-source');if(key==='candidate_id')assert.equal(f.c.CRMIntake.items(f.candidate,[f.doc]).length,0);else assert.equal(conflicts(f),1);});
test('unrelated nested OCR change invalidates a decision even when proposed phone is unchanged',()=>{const f=fixture();f.doc.ai_extracted.relatives[0].full_name+=' Петрівна';assert.equal(conflicts(f),1);});
test('JSON object key order is irrelevant but array order and values are exact',()=>{const f=fixture(),ctx=f.doc.ai_extracted._crm_review_context;ctx.source=Object.fromEntries(Object.entries(ctx.source).reverse());assert.equal(conflicts(f),0);ctx.source.extraction.relatives.push({full_name:'Інша'});assert.equal(conflicts(f),1);});
test('missing, malformed or unsupported binding never falls back to legacy approval',()=>{for(const value of [null,{},'x',{version:2,context_id:'context'},{version:1,context_id:'other'}]){const f=fixture();f.doc.ai_extracted._crm_review_decisions[0].source_binding=value;assert.equal(conflicts(f),1);}});
test('missing helper context and mismatched candidate fail closed for bound decisions',()=>{const f=fixture();delete f.doc.ai_extracted._crm_review_context;assert.equal(conflicts(f),1);const other=fixture();other.candidate.id='other';assert.equal(other.c.CRMReviewDecision.binding(other.doc,other.doc.ai_extracted._crm_review_decisions[0],other.candidate),'stale-source');assert.equal(other.c.CRMIntake.items(other.candidate,[other.doc]).length,0);});
test('legacy decisions retain their prior exact-value semantics without fabricated binding',()=>{const f=fixture();delete f.doc.ai_extracted._crm_review_decisions[0].source_binding;assert.equal(conflicts(f),0);assert.equal(f.c.CRMReviewDecision.binding(f.doc,f.doc.ai_extracted._crm_review_decisions[0],f.candidate),'container-only');f.row.current='changed';assert.equal(conflicts(f),1);});
test('all binding checks are pure and make no writes or mutations',()=>{const f=fixture(),before=JSON.stringify(f.doc);conflicts(f);assert.equal(JSON.stringify(f.doc),before);});

test('explicit OCR identity review is restricted to populated identity fields',()=>{
 const {c}=fixture(),kind=c.CRMReviewDecision.keepKind;
 for(const key of ['full_name','birth_date','rnokpp'])assert.equal(kind({action:'conflict',target:'candidate',key,current:'saved',reason:'Дата народження іншої особи'}),'identity-field');
 for(const key of ['phone','passport_data','military_rank','work_records'])assert.equal(kind({action:'conflict',target:'candidate',key,current:'saved',reason:'ПІБ не збігається'}),null);
 for(const current of [null,'','   ',{},[],false,123])assert.equal(kind({action:'conflict',target:'candidate',key:'birth_date',current,reason:'Дата народження іншої особи'}),null);
 assert.equal(kind({action:'conflict',target:'profile',key:'work_records',current:[{employer:'Test'}],reason:'Збережене значення має пріоритет'}),'ordinary');
 assert.equal(kind({action:'fill',target:'candidate',key:'birth_date',current:'saved',reason:'Дата народження іншої особи'}),null);
 assert.equal(kind({action:'conflict',target:'profile',key:'birth_date',current:'saved',reason:'Дата народження іншої особи'}),null);
});

test('identity keep closes one exact question, without clearing other owner conflicts or authorizing transfer',()=>{
 const f=fixture();f.row.key='birth_date';f.row.reason='Дата народження іншої особи';
 const saved=f.doc.ai_extracted._crm_review_decisions[0];Object.assign(saved,{key:f.row.key,reason:f.row.reason});
 f.c.CRMDocumentSync.plan=()=>({supported:true,rows:[{...f.row},{...f.row,key:'full_name'}],selections:[]});
 const before=JSON.stringify({doc:f.doc,candidate:f.candidate}),item=f.c.CRMIntake.items(f.candidate,[f.doc])[0];
 assert.equal(item.conflicts.length,1);assert.equal(item.conflicts[0].key,'full_name');assert.equal(item.plan.selections.length,0);
 assert.equal(JSON.stringify({doc:f.doc,candidate:f.candidate}),before);
 f.row.incoming='changed';assert.equal(f.c.CRMIntake.items(f.candidate,[f.doc])[0].conflicts.length,2);
});

test('identity review requires explicit confirmation before the existing guarded RPC',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../crm-intake.js'),'utf8');
 assert(source.includes("keepKind(row)==='identity-field'&&!window.confirm("));
 assert(source.indexOf("keepKind(row)==='identity-field'&&!window.confirm(")<source.indexOf("rpc('crm_keep_document_value'"));
});

test('human explanation distinguishes OCR disagreement from proven foreign ownership without changing evidence',()=>{
 const f=fixture();
 for(const reason of ['Дата народження іншої особи','РНОКПП іншої особи','Некоректне OCR-значення; РНОКПП іншої особи','ПІБ не збігається']){
  const row={...f.row,reason},before=JSON.stringify(row),text=f.c.CRMIntake.reasonText(row);
  assert(text.includes('може бути помилка AI'));assert(text.includes('документ іншої людини'));assert(text.includes('Порівняйте оригінал'));assert(text.includes('заблоковане'));assert.equal(JSON.stringify(row),before);
 }
 assert(f.c.CRMIntake.reasonText({reason:'Некоректне OCR-значення'}).includes('не зміг'));
 assert(f.c.CRMIntake.reasonText({reason:'Збережене значення має пріоритет'}).includes('звірки з оригіналом'));
 assert.equal(f.c.CRMIntake.reasonText({reason:'custom'}),'custom');
 assert(f.c.CRMIntake.reasonText(null).includes('Потрібно порівняти'));
});

test('intake script cache key follows the current published release',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),release=fs.readFileSync(path.join(__dirname,'../crm-release.js'),'utf8').match(/version:\s*['"]([^'"]+)['"]/)[1];
 assert(html.includes('crm-intake.js?v='+release+'"'));
});

test('intake scopes ownership before real latest selection and never plans foreign files',()=>{
 const f=fixture();
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../crm-responsibility.js'),'utf8'),f.c);
 const own={...f.doc,id:'owned',version_number:1},foreign={...f.doc,id:'foreign',candidate_id:'other',version_number:2},calls=[];
 f.c.CRMDocumentSync.plan=doc=>{calls.push(doc.id);return {supported:true,rows:[],selections:[]}};
 const input=[own,foreign],before=JSON.stringify(input),rows=f.c.CRMIntake.items(f.candidate,input);
 assert.deepEqual(Array.from(rows,r=>r.doc.id),['owned']);assert.deepEqual(calls,['owned']);assert.equal(JSON.stringify(input),before);
 assert.equal(f.c.CRMIntake.items(f.candidate,[foreign]).length,0);
});

test('intake preserves unscoped legacy documents but handles absent and null inputs',()=>{
 const f=fixture(),legacy={...f.doc};delete legacy.candidate_id;
 assert.equal(f.c.CRMIntake.items(f.candidate,[legacy]).length,1);
 assert.equal(f.c.CRMIntake.items(f.candidate,null).length,0);
 assert.equal(f.c.CRMIntake.items(f.candidate,[null,undefined]).length,0);
});

test('blocked plans explain their actual reason without recommending another OCR run',()=>{
 const f=fixture(),reason='Це свідоцтво дитини: особисті дані кандидата з нього не переносяться.';
 const item={plan:{supported:false,blockedReason:reason},conflicts:[],fills:[]},before=JSON.stringify(item);
 assert.equal(f.c.CRMIntake.unavailableText(item),reason);
 assert.equal(f.c.CRMIntake.questionTitle(item),'Перенесення даних недоступне');
 assert.equal(JSON.stringify(item),before);
 const unknown={plan:{supported:false},conflicts:[],fills:[]};
 assert(f.c.CRMIntake.unavailableText(unknown).includes('не підтримується'));
 assert(!f.c.CRMIntake.unavailableText(unknown).includes('повторіть'));
 assert.equal(f.c.CRMIntake.questionTitle({...item,failed:true}),'Не вдалося прочитати документ');
 assert.equal(f.c.CRMIntake.questionTitle({...item,error:'error'}),'Не вдалося перевірити дані');
});

test('unsupported-plan UI escapes its reason, offers original and does not expose retry',async()=>{
 const f=fixture();f.c.CRMWorkspace={escape:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')};
 f.c.CRMDocumentSync.plan=()=>({supported:false,blockedReason:'Blocked <script>unsafe</script>',rows:[],selections:[]});
 const controls=new Map(),host={innerHTML:'',querySelector(key){if(!controls.has(key))controls.set(key,{});return controls.get(key);},querySelectorAll(){return []}};
 const before=JSON.stringify(f.doc);await f.c.CRMIntake.review(host,f.candidate,[f.doc]);
 assert(host.innerHTML.includes('Перенесення даних недоступне'));
 assert(host.innerHTML.includes('Blocked &lt;script&gt;unsafe&lt;/script&gt;'));assert(!host.innerHTML.includes('<script>unsafe'));
 assert(host.innerHTML.includes('data-intake-open="d"'));assert(!host.innerHTML.includes('data-intake-retry='));
 assert(!host.innerHTML.includes('повторіть розпізнавання'));assert.equal(JSON.stringify(f.doc),before);
});

test('confirmation snapshot rejects changed evidence, in-flight OCR and wrong ownership',()=>{
 const f=fixture(),fresh=structuredClone(f.doc);assert.equal(f.c.CRMIntake.confirmationMatches(f.doc,fresh,f.candidate),true);
 for(const change of [d=>d.ai_extracted.phone='333',d=>d.ai_processed_at='new',d=>d.storage_path='c/new.pdf',d=>d.file_hash='changed',d=>d.version_number=2,d=>d.candidate_id='other',d=>d.deleted_at='now',d=>d.processing_status='AI обробка',d=>d.processing_status='AI помилка']){
  const changed=structuredClone(f.doc);change(changed);assert.equal(f.c.CRMIntake.confirmationMatches(f.doc,changed,f.candidate),false);
 }
 assert.equal(f.c.CRMIntake.confirmationMatches(f.doc,null,f.candidate),false);
 assert.equal(f.c.CRMIntake.confirmationMatches(f.doc,fresh,{id:'other'}),false);
});

test('confirmation handler uses snapshot guards and never applies after stale evidence or a lost update',async()=>{
 for(const mode of ['stale','lost-update','changed-after-confirm','success']){
  const f=fixture();Object.assign(f.doc,{verification_status:'Не перевірено',verified_at:null,ai_processed_at:'2026-01-01T00:00:00Z'});
  const fresh=structuredClone(f.doc);if(mode==='stale')fresh.ai_extracted.phone='changed';
  const controls=new Map(),host={innerHTML:'',querySelector(key){if(!controls.has(key))controls.set(key,{});return controls.get(key);},querySelectorAll(){return []}};
  const calls={updates:0,applies:0,previews:0,filters:[]};
  f.c.CRMWorkspace={escape:v=>String(v??''),guard:async()=>true};f.c.getCandidateDocuments=async()=>[fresh];f.c.getCurrentUser=async()=>({id:'worker'});f.c.openCandidateCard=async()=>{};
  f.c.CRMDocumentSync={plan:()=>({supported:true,rows:[{target:'candidate',key:'phone',current:'',incoming:'222',action:'fill'}],selections:[]}),preview:async()=>{calls.previews++;const document={...structuredClone(fresh),verification_status:'Підтверджено'};if(mode==='changed-after-confirm')document.ai_extracted.phone='new';return {supported:true,document}},apply:async()=>{calls.applies++}};
  const query={eq(key,value){calls.filters.push([key,value]);return this;},is(key,value){calls.filters.push([key,value]);return this;},select:async()=>({data:mode==='lost-update'?[]:[{id:'d'}]})};
  f.c.supabaseClient={from:table=>table==='documents'?{update(){calls.updates++;return query;}}:{select:()=>({eq:()=>({single:async()=>({data:f.candidate})})})}};
  await f.c.CRMIntake.review(host,f.candidate,[f.doc]);assert(host.innerHTML.includes('Підтвердити файл і заповнити порожні поля'));
  await host.onclick({target:{closest:()=>({dataset:{intakeConfirm:'d'}})}});
  if(mode==='stale'){assert.equal(calls.updates,0);assert.equal(calls.applies,0);assert(controls.get('[data-intake-status]').textContent.includes('змінився'));}
  else{assert(calls.filters.some(([k,v])=>k==='ai_processed_at'&&v===f.doc.ai_processed_at));assert(calls.filters.some(([k,v])=>k==='processing_status'&&v===f.doc.processing_status));assert(calls.filters.some(([k,v])=>k==='verified_at'&&v===null));assert.equal(calls.applies,mode==='success'?1:0);assert.equal(calls.previews,mode==='lost-update'?0:1);}
 }
});

test('relative question UI renders escaped names and boolean words without changing source values',async()=>{
 const f=fixture();vm.runInContext(fs.readFileSync(path.join(__dirname,'../crm-case-assistant.js'),'utf8'),f.c);
 f.candidate.profile_data={relatives:[{full_name:'Тестова <Олена>'}]};
 f.c.CRMWorkspace={escape:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')};
 f.c.CRMDocumentSync.plan=()=>({supported:true,rows:[{target:'profile',key:'relatives.0.deceased',current:null,incoming:false,action:'fill'},{target:'profile',key:'relatives.0.birth_date',current:null,incoming:'1981',action:'fill'}],selections:[]});
 const controls=new Map(),host={innerHTML:'',querySelector(key){if(!controls.has(key))controls.set(key,{});return controls.get(key);},querySelectorAll(){return []}};
 const before=JSON.stringify({doc:f.doc,candidate:f.candidate});await f.c.CRMIntake.review(host,f.candidate,[f.doc]);
 assert(host.innerHTML.includes('Тестова &lt;Олена&gt; · Позначка про смерть'));assert(!host.innerHTML.includes('<Олена>'));
 assert(host.innerHTML.includes('Розпізнано з документа<br>Ні'));assert(host.innerHTML.includes('Розпізнано з документа<br>1981'));assert(!host.innerHTML.includes('1981-01-01'));
 assert(!host.innerHTML.includes('Інші відомості (relatives.'));assert.equal(JSON.stringify({doc:f.doc,candidate:f.candidate}),before);
});

test('bulk fill preflights all sources, avoids unseen OCR and reports partial completion',async()=>{
 for(const mode of ['preflight-stale','later-stale','success']){
  const f=fixture(),second={...structuredClone(f.doc),id:'e',version_group_id:'g2'},docs=[f.doc,second],calls=[];
  const report=d=>{const key=d.id==='d'?'phone':'email',row={target:'candidate',key,current:null,incoming:d.id==='d'?'222':'test@example.invalid',action:'fill'};return {document:d,supported:true,rows:[row],selections:[{target:'candidate',key,incoming:row.incoming,expected_current:null}]};};
  const controls=new Map(),host={innerHTML:'',querySelector(key){if(!controls.has(key))controls.set(key,{});return controls.get(key);},querySelectorAll(){return []}};
  f.c.CRMWorkspace={escape:v=>String(v??''),guard:async()=>true};f.c.openCandidateCard=async()=>{};
  f.c.supabaseClient={from:()=>({select:()=>({eq:()=>({single:async()=>({data:f.candidate})})})})};
  f.c.CRMDocumentSync={plan:report,preview:async(_,id)=>{calls.push('preview:'+id);const d=structuredClone(docs.find(d=>d.id===id));if(id==='e'&&(mode==='preflight-stale'||mode==='later-stale'&&calls.includes('apply:d')))d.ai_extracted.phone='unseen';return report(d);},apply:async(_,r)=>{calls.push('apply:'+r.document.id);},sync:async()=>{throw Error('unguarded sync must not run');}};
  await f.c.CRMIntake.review(host,f.candidate,docs);await controls.get('[data-intake-fill]').onclick();
  const applied=calls.filter(c=>c.startsWith('apply:'));
  assert.equal(applied.length,mode==='success'?2:mode==='later-stale'?1:0);
  if(mode==='later-stale')assert(controls.get('[data-intake-status]').textContent.includes('Перенесено документів: 1'));
  if(applied.length)assert(calls.indexOf('preview:e')<calls.indexOf('apply:d'));
 }
});

test('single-field click transfers only the displayed field and rejects changed OCR',async()=>{
 for(const stale of [false,true]){
  const f=fixture(),controls=new Map(),applied=[];
  const plan=doc=>({document:doc,supported:true,rows:['phone','email'].map(key=>({target:'candidate',key,action:'fill',current:null,incoming:key==='phone'?'222':'test@example.invalid'})),selections:['phone','email'].map(key=>({target:'candidate',key,incoming:key==='phone'?'222':'test@example.invalid',expected_current:null}))});
  const host={innerHTML:'',querySelector(key){if(!controls.has(key))controls.set(key,{});return controls.get(key);},querySelectorAll(){return []}};
  f.c.CRMWorkspace={escape:v=>String(v??''),guard:async()=>true};f.c.openCandidateCard=async()=>{};f.c.supabaseClient={from:()=>({select:()=>({eq:()=>({single:async()=>({data:f.candidate})})})})};
  f.c.CRMDocumentSync={plan,preview:async()=>{const doc=structuredClone(f.doc);if(stale)doc.ai_extracted.phone='unseen';return plan(doc);},apply:async(_,report)=>applied.push(report)};
  await f.c.CRMIntake.review(host,f.candidate,[f.doc]);await host.onclick({target:{closest:()=>({dataset:{intakeField:'d',row:'0'}})}});
  assert.equal(applied.length,stale?0:1);if(!stale){assert.deepEqual(Array.from(applied[0].selections,s=>s.key),['phone']);assert.deepEqual(Array.from(applied[0].rows,r=>r.key),['phone']);}
 }
});

test('held fill explains source review and conflict headings receive candidate context',async()=>{
 const f=fixture();vm.runInContext(fs.readFileSync(path.join(__dirname,'../crm-case-assistant.js'),'utf8'),f.c);
 const held={action:'fill',target:'profile',key:'relatives.0.birth_date',current:null,incoming:'1981'},plan={supported:true,rows:[held],selections:[]};
 assert.equal(f.c.CRMIntake.questionTitle({plan,conflicts:[],fills:[held]}),'Знайдені дані потребують звірки');
 assert(f.c.CRMIntake.fieldHint(plan,held).includes('Потрібна звірка джерел'));assert(!f.c.CRMIntake.canFillField(plan,held));
 const conflict={...held,action:'conflict',reason:'Збережене значення має пріоритет'};f.candidate.profile_data={relatives:[{full_name:'Тестова Олена'}]};
 assert.equal(f.c.CRMIntake.questionTitle({plan,conflicts:[{...conflict,key:'tcc'}],fills:[]}),'Потрібно уточнити: ТЦК та СП');
 f.c.CRMWorkspace={escape:v=>String(v??'')};f.c.CRMDocumentSync.plan=()=>({supported:true,rows:[conflict],selections:[]});
 const controls=new Map(),host={innerHTML:'',querySelector(key){if(!controls.has(key))controls.set(key,{});return controls.get(key);},querySelectorAll(){return []}};
 await f.c.CRMIntake.review(host,f.candidate,[f.doc]);assert(host.innerHTML.includes('Потрібно уточнити: Тестова Олена · Дата народження'));
});
