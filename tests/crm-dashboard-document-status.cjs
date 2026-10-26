const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../crm-dashboard.js'),'utf8');
const script=fs.readFileSync(require('node:path').join(__dirname,'../script.js'),'utf8');
const legacyUpdate=script.slice(script.indexOf('async function updateDashboard()'),script.indexOf('\nasync function getCandidates('));
const c=vm.createContext({CRMWorkspace:{}});c.window=c;vm.runInContext(source,c);
const status=extra=>c.CRMDashboard.documentStatus({errors:0,processing:0,review:0,unknown:0,total:5,verified:0,received:0,...extra});

test('modern dashboard skips legacy counters without triggering a duplicate render',async()=>{
 const context={CRMDashboard:{load:()=>{throw Error('Duplicate render')}},document:{querySelectorAll:()=>{throw Error('Legacy counters queried')}}};
 const update=vm.runInNewContext('('+legacyUpdate+')',context);await update();
});
test('legacy counter rendering still works when the modern dashboard is absent',async()=>{
 const cards=Array.from({length:3},()=>({isConnected:true,textContent:''})),tables=[];
 const update=vm.runInNewContext('('+legacyUpdate+')',{document:{querySelectorAll:()=>cards},getCount:async table=>{tables.push(table);return tables.length}});
 await update();assert.deepEqual(tables,['candidates','personal_files','documents']);assert.deepEqual(cards.map(c=>c.textContent),[1,2,3]);
});
test('dashboard describes document state rather than recruitment stage',()=>{
 assert.equal(status({}),'Очікуємо документи');
 assert.equal(status({received:2}),'Додати документи');
 assert.equal(status({verified:5}),'Комплект перевірено');
 assert.equal(status({total:0}),'Очікуємо документи');
});
test('processing and exceptions take precedence over complete counters',()=>{
 assert.equal(status({verified:5,errors:1,processing:1}),'Помилка AI');
 assert.equal(status({verified:5,processing:1,review:1}),'Розпізнавання');
 assert.equal(status({verified:5,review:1}),'Потрібна перевірка');
 assert.equal(status({verified:5,unknown:1}),'Уточнити відомості');
});
test('dashboard rendering and legacy overview do not show planning prompts',()=>{
 assert(!source.includes('<th>Етап</th>'));assert(source.includes('esc(documentStatus(s))'));
 const workspace=fs.readFileSync(require('node:path').join(__dirname,'../crm-workspace.js'),'utf8');
 assert(!workspace.includes('Потрібен контакт сьогодні'));assert(!workspace.includes('const contacts=candidates.filter'));
 assert(source.includes('window.CRMCaseTasks=')); // Historical consumers retain their API.
});

test('dashboard review counts follow current candidate requirements and keep excluded files separate',()=>{
 const ctx=vm.createContext({window:{}});for(const file of ['candidate-conditions.js','document-presence.js','document-state.js'])vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../'+file),'utf8'),ctx);
 const state=ctx.window.CRMDocumentState,person={served_before:true,worked_before:false,profile_data:{service_type:'За контрактом'}};
 const reqs=[{id:'w',document_type:'Документи про трудову діяльність',is_required:true},{id:'r',document_type:'Військовий облік (витяг Резерв+ / приписне)',is_required:true},{id:'p',document_type:'Копія паспорта',is_required:true}];
 const docs=[{id:'w',requirement_id:'w',document_type:reqs[0].document_type,storage_path:'w.pdf',verification_status:'Потребує перевірки',processing_status:'AI помилка'},{id:'r',requirement_id:'r',document_type:reqs[1].document_type,storage_path:'r.pdf',verification_status:'Не перевірено',processing_status:'AI оброблено'},{id:'p',requirement_id:'p',document_type:reqs[2].document_type,storage_path:'p.pdf',verification_status:'Підтверджено'}];
 const before=JSON.stringify([person,reqs,docs]),summary=state.summary(person,reqs,docs);
 assert.equal(summary.review,0);assert.equal(summary.errors,0);assert.equal(summary.processing,0);assert.equal(summary.excludedReview,2);assert.equal(summary.excludedErrors,1);assert.equal(summary.copies,1);assert.equal(summary.total,1);assert.equal(summary.verified,1);
 assert.equal(JSON.stringify([person,reqs,docs]),before);assert.equal(docs[0].verification_status,'Потребує перевірки');
 const unknown=state.summary({...person,worked_before:null},reqs,docs);assert.equal(unknown.review,1);assert.equal(unknown.errors,1);assert.equal(unknown.unknown,1);
 assert.equal(state.summary({...person,worked_before:true},reqs,docs).review,1);
 assert.equal(state.summary({...person,served_before:false},reqs,docs).review,1);
 assert.equal(state.summary(person,reqs,[...docs,{id:'u',document_type:'Інший документ',storage_path:'u.pdf'}]).review,1);
 assert.equal(state.summary(person,[],[{id:'optional',document_type:'Копія УБД',storage_path:'ubd.pdf'}]).review,1);
 const unclassified=state.summary({profile_data:{service_type:'За мобілізацією'}},[],[{id:'unknown',processing_status:'AI обробка'}]);assert.equal(unclassified.review,1);assert.equal(unclassified.processing,1);assert.equal(unclassified.excludedReview,0);
});
test('inactive and explicitly unmet requirements cannot create invisible dashboard review tasks',()=>{
 const ctx=vm.createContext({window:{}});for(const file of ['candidate-conditions.js','document-presence.js','document-state.js'])vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../'+file),'utf8'),ctx);
 const person={has_children:false,profile_data:{service_type:'За контрактом'}},requirements=[{id:'a',document_type:'Інший документ',is_required:true,active:false},{id:'b',document_type:'Окремий документ',is_required:true,condition_field:'has_children',condition_value:'true'}];
 const docs=requirements.map(r=>({id:r.id,requirement_id:r.id,document_type:r.document_type,storage_path:r.id+'.pdf',processing_status:'AI обробка'}));
 const summary=ctx.window.CRMDocumentState.summary(person,requirements,docs);assert.equal(summary.review,0);assert.equal(summary.processing,0);assert.equal(summary.excludedReview,2);assert.equal(summary.excludedProcessing,2);assert.equal(summary.total,0);
 assert.match(source,/Поза поточним комплектом/);assert.match(source,/документів на перевірку/);
 const scope=ctx.window.CRMDocumentState.scope(person,requirements,docs);assert.equal(scope.excluded.length,2);assert.equal(scope.current.length,0);
 const manager=fs.readFileSync(require('node:path').join(__dirname,'../documents.js'),'utf8');assert.match(manager,/CRMDocumentState.scope\(c,reqs,docs\)/);assert.match(manager,/documentScope.current.filter/);
});
