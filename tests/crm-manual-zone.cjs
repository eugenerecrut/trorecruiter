const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(){
 const calls=[],review={open:async(doc,options)=>calls.push({doc,options})};
 const context={document:{readyState:'loading',addEventListener(){}},window:{CRMMilitaryZoneReview:review,CRMMilitaryZoneContract:{family:type=>type==='Автобіографія'}},
  CRMMilitaryZoneReview:review,CRMWorkspace:{busy:false}};
 vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../documents.js'),'utf8'),context);
 return {context,calls};
}
test('manual entry is limited to an available AI-enabled supported source and escapes the ID',()=>{
 const {context:c}=setup(),doc={id:'x"<',document_type:'Автобіографія',storage_path:'file.pdf'};
 assert.match(c.manualZoneButtonHtml(doc),/data-doc-zone-manual="x&quot;&lt;"/);
 assert.equal(c.manualZoneButtonHtml(doc,{ai_enabled:false}),'');
 assert.equal(c.manualZoneButtonHtml({...doc,deleted_at:'now'}),'');
 assert.equal(c.manualZoneButtonHtml({...doc,storage_path:null}),'');
 assert.equal(c.manualZoneButtonHtml({...doc,document_type:'Додаток 13'}),'');
});
test('manual entry saves workspace first and never enables autostart',async()=>{
 const {context:c,calls}=setup(),doc={id:'d'};let saved=0;
 await c.openManualZoneDocument('d',[doc],async()=>{saved++;return true;});
 assert.equal(saved,1);assert.equal(calls.length,1);assert.equal(calls[0].options.autostart,false);
 await c.openManualZoneDocument('d',[doc],async()=>false);assert.equal(calls.length,1);
 c.CRMWorkspace.busy=true;await c.openManualZoneDocument('d',[doc],async()=>{throw Error('should not save');});assert.equal(calls.length,1);
});
test('the real reader gates primary OCR on autostart and provides the original with a verified hash',()=>{
 const source=fs.readFileSync(require.resolve('../military-zone-review.js'),'utf8');
 assert.match(source,/if\(autostart&&!canary&&\(!doc.ai_extracted\|\|doc.processing_status==='AI помилка'\)\)/);
 assert.match(source,/crypto.subtle.digest\('SHA-256',originalBytes\)/);
 assert.match(source,/originalLink.download=doc.file_name/);
 assert.match(source,/URL.revokeObjectURL\(originalURL\)/);
});
test('one-step canary is owner-only, sends a durable budget of one and never falls into browser AI',()=>{
 const source=fs.readFileSync(require.resolve('../military-zone-review.js'),'utf8');
 assert.match(source,/get\('zoneBudget'\)\s*===\s*'1'/);
 assert.match(source,/supabaseClient.auth.getUser\(\)/);
 assert.match(source,/rpc\(nativeCanary\?'crm_splav_zone_native_canary_enqueue':'crm_splav_zone_canary_enqueue'/);
 assert.match(source,/p_budget:canary\?1:2600/);
 assert.match(source,/if\(canary&&\(ready.error\|\|ready.data!==true\)\)throw/);
 assert(source.indexOf("if(canary)throw Error('Немає придатного")<source.indexOf('await autopilot.run'));
 assert.match(source,/async function read\(mode\)\{if\(canary\)/);
 assert.match(source,/else if\(autostart&&!canary&&sourceReady\)/);
});


test('background status explains the saved failure without model calls, raw errors or false completion',()=>{
 const context={window:{}};vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../military-zone-review.js'),'utf8'),context);
 const describe=context.window.CRMMilitaryZoneReview.backgroundSummary;
 const result=describe({state:'needs_review',zone_summary:{attempts:1,budget:1,pages:2,pending_steps:1,code:'ZONE_RESULT_UNCERTAIN',providers:[{provider:'OpenAI',http_status:429},{provider:'Gemini',error:'SECRET'}]}});
 const text=JSON.stringify(result);assert.match(text,/Автоматичний повтор заблоковано/);assert.match(text,/квота або частота/);assert.doesNotMatch(text,/SECRET|Опрацювання завершено/);
 assert.match(JSON.stringify(describe({state:'needs_review',zone_summary:{attempts:1,budget:1,pending_steps:2}})),/погодженого ліміту/);
 assert.match(JSON.stringify(describe({state:'completed'})),/Опрацювання завершено/);
 assert.match(JSON.stringify(describe({state:'needs_review',zone_summary:{source_changed:true}})),/чинну версію/);
});


test('opening the reader shows an existing server job without dispatching a new step',()=>{
 const source=fs.readFileSync(require.resolve('../military-zone-review.js'),'utf8');
 assert.match(source,/if\(backgroundJob\)showBackground\(backgroundJob\);else if\(saved/);
 assert.match(source,/rpc\('crm_splav_job_status'/);
 assert.match(source,/line.textContent=note/);
});


test('terminal background UI hides dead controls, clears the stale reading hint and gives the next action',()=>{
 const source=fs.readFileSync(require.resolve('../military-zone-review.js'),'utf8');
 assert.match(source,/\$\('\[data-stop\]'\).hidden=true/);assert.match(source,/hidden=!reports.length;status\(''\)/);
 const context={window:{}};vm.createContext(context);vm.runInContext(source,context);
 const result=context.window.CRMMilitaryZoneReview.backgroundSummary({state:'uncertain'});
 assert.match(JSON.stringify(result),/Наступна дія: адміністратору/);assert.match(JSON.stringify(result),/без окремого рішення/);
});
test('only the saved report matching this completed job can be displayed without another AI call',()=>{
 const context={window:{}};vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../military-zone-review.js'),'utf8'),context);
 const read=context.window.CRMMilitaryZoneReview.backgroundReports;
 const report={review_only:true,source:{document_id:'d'},rows:[]};
 const saved={status:'complete',saved_at:'2026-10-23',reports:[report,{...report,source:{document_id:'other'}}]};
 const job={_detailed:true,zone_summary:{},document_id:'d',state:'completed',result:{status:'complete',saved_at:saved.saved_at}};
 assert.equal(read(job,saved).length,1);
 for(const changed of [{state:'running'},{_detailed:false},{zone_summary:{source_changed:true}},{result:{status:'complete',saved_at:'older'}},{document_id:'other-doc'}])assert.equal(read({...job,...changed},saved).length,0);
 assert.equal(read(job,{...saved,status:'complete_with_gaps'}).length,0);
});


test('saved manual receipts reopen in the reader without a new AI call and pass the current semantic guard',()=>{
 const source=fs.readFileSync(require.resolve('../military-zone-review.js'),'utf8');
 assert.match(source,/Array.isArray\(job.zone_reports\)/);assert.match(source,/CRMMilitaryZoneContract.projectField\(f\)/);
 assert.match(source,/Відновлено збережені читання/);assert.match(source,/f.partial_value/);
});

test('manual reading snapshots visible inputs before dispatch and never falls back to stale full-page bounds',()=>{
 const source=fs.readFileSync(require.resolve('../military-zone-review.js'),'utf8');
 const context={window:{},CRMMilitaryZoneContract:require('../supabase/functions/_shared/military-zone.js')};vm.createContext(context);vm.runInContext(source,context);
 const read=context.window.CRMMilitaryZoneReview.selectedBox;
 const inputs=v=>Object.entries(v).map(([key,value])=>({dataset:{box:key},value}));
 assert.deepEqual(JSON.parse(JSON.stringify(read(inputs({x:'5',y:'20',w:'90',h:'5'})))),{x:.05,y:.2,w:.9,h:.05});
 for(const v of [{x:'',y:0,w:90,h:5},{x:5,y:20,w:100,h:5},{x:0,y:0,w:0,h:5},{x:'bad',y:0,w:90,h:5},{x:0,y:0,w:90}])assert.equal(read(inputs(v)),null);
 assert(source.indexOf("selectedBox(dialog.querySelectorAll('[data-box]'))")<source.indexOf("supabaseClient.functions.invoke('ai-military-zone'"));
 assert.match(source,/if\(!selected\|\|!sourceReady\)/);assert.match(source,/el.oninput=el.onchange=/);
 assert.doesNotMatch(source,/setBox\(box\)/);
});

test('PDF text geometry gives source-bound paragraphs without guessed semantic labels or provider calls',()=>{
 const source=fs.readFileSync(require.resolve('../military-zone-review.js'),'utf8'),context={window:{}};vm.createContext(context);vm.runInContext(source,context);
 const zones=context.window.CRMMilitaryZoneReview.textLayerZones;
 const viewport={width:600,height:800,transform:[1,0,0,-1,0,800]};
 const item=(str,x,y,width=100)=>({str,width,transform:[12,0,0,12,x,y]});
 const result=zones([item('Батько:',50,740),item('Приклад',160,740),item('Другий рядок із додатковим текстом прикладу',50,726),item('Інший абзац із додатковим текстом прикладу',50,680),item('жовтня 2026',50,540)],viewport);
 assert.equal(result.length,3);assert.match(result[0].preview,/Батько: Приклад\nДругий рядок/);assert.equal(result[0].box.y,.06);
 assert(result.every(z=>/^Текстовий блок \d+$/.test(z.label)&&z.box.x>=0&&z.box.y>=0&&z.box.x+z.box.w<=1&&z.box.y+z.box.h<=1));
 assert(result[2].box.y<.4);assert.doesNotMatch(JSON.stringify(result),/судимість|дата і підпис/);
 assert.equal(zones([],viewport).length,0);assert.equal(zones([item(' ',0,0)],viewport).length,0);
 assert.equal(zones([item('Заголовок скану',50,740)],viewport).length,0);
 assert.equal(zones([{str:'bad',width:10,transform:[0,12,-12,0,50,700]}],viewport).length,0);
 assert.equal(zones([item('x',0,0)],{width:0,height:0}).length,0);
 assert.match(source,/await p.getTextContent\(\)/);assert.match(source,/nativeZones.length\?showNativeZones\(\):read\('overview'\)/);
 assert.match(source,/рукописні дописи й зображення можуть бути відсутні/);
});

test('native-only background control never claims content recognition or suggests a paid continuation',()=>{
 const context={window:{}};vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../military-zone-review.js'),'utf8'),context);
 const describe=context.window.CRMMilitaryZoneReview.backgroundSummary;
 const job={state:'needs_review',result:{native_only:true},zone_reports:[]};
 assert.equal(describe(job).title,'Контроль зупинено без AI');
 const saved=describe({...job,zone_reports:[{mode:'overview',ai_requests:0,source:{origin:'server_text_layer'}}]});assert.equal(saved.title,'Локальний огляд збережено');assert.match(JSON.stringify(saved),/зміст документа цим контролем не підтверджується/);
 const visual=describe({...job,zone_summary:{code:'NATIVE_VISUAL_REVIEW_REQUIRED'}});assert.match(JSON.stringify(visual),/Сторінку підготовлено/);assert.match(JSON.stringify(visual),/AI не запускався/);
 const legacy=describe({...job,zone_summary:{code:'ZONE_PREP_FAILED'}});assert.match(JSON.stringify(legacy),/причина не деталізована/);assert.doesNotMatch(JSON.stringify(legacy),/Сторінку підготовлено/);
});
test('empty and unresolved zone readings explain gaps instead of claiming a successful read',()=>{
 const context={window:{}};vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../military-zone-review.js'),'utf8'),context);
 const describe=context.window.CRMMilitaryZoneReview.backgroundSummary;
 assert.match(JSON.stringify(describe({state:'needs_review',zone_summary:{code:'ZONE_NO_READABLE_FIELDS'}})),/не вважається успішним читанням/);
 assert.match(JSON.stringify(describe({state:'needs_review',zone_summary:{code:'ZONE_FIELDS_UNCERTAIN'}})),/додатковий автоматичний повтор не запускається/);
});
test('partial completion and saved response counts never imply complete or verified fields',()=>{
 const context={window:{}};vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../military-zone-review.js'),'utf8'),context);
 const {backgroundSummary:describe,readingSummary:reading}=context.window.CRMMilitaryZoneReview;
 const job={state:'completed',result:{status:'complete_with_gaps'},zone_reports:[{mode:'overview'},{mode:'zone',rows:[]}]};
 const summary=describe(job);assert.equal(summary.title,'Звіт збережено з прогалинами');assert.match(JSON.stringify(summary),/не кількість підтверджених полів/);assert.doesNotMatch(JSON.stringify(summary),/успішних читань/);
 assert.equal(describe({state:'completed',zone_summary:{error_count:1}}).title,'Звіт збережено з прогалинами');
 assert.equal(describe({state:'completed',result:{status:'complete'}}).title,'Опрацювання завершено');
 for(const rows of [undefined,[],[{fields:[]}],[null]]){const r=reading({rows});assert.equal(r.count,0);assert.match(r.label,/Структурованих полів немає/);}
 const r=reading({rows:[{fields:[{value:' ',legibility:'clear'},{value:'x',legibility:'clear',alternatives:['y']},{value:0,legibility:'clear'},{value:false,legibility:'clear'}]}]});
 assert.equal(r.count,4);assert.equal(r.uncertain,2);assert.match(r.label,/2 потребують перевірки/);
 const source=fs.readFileSync(require.resolve('../military-zone-review.js'),'utf8');assert.match(source,/esc\(summary.label\)/);assert.match(source,/esc\(summary.notice\)/);assert.match(source,/Збережено відповідь через/);
});
test('source navigation requires the current document, page, bounds and verified original hash',()=>{
 const contract=require('../supabase/functions/_shared/military-zone.js'),context={window:{},CRMMilitaryZoneContract:contract};vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../military-zone-review.js'),'utf8'),context);
 const target=context.window.CRMMilitaryZoneReview.sourceTarget,current={document_id:'doc',file_sha256:'a'.repeat(64),pages:2,revision:'r1'},binding={...current};
 const report={mode:'zone',source:{document_id:'doc',page:2,box:{x:.1,y:.2,w:.3,h:.4}}};
 assert.equal(target(report,current,binding).page,2);
 assert.equal(target({...report,source:{...report.source,file_sha256:current.file_sha256}},current,null).page,2);
 for(const changed of [{document_id:'foreign'},{file_sha256:'b'.repeat(64)},{revision:'old'},null])assert.equal(target(report,current,changed?{...binding,...changed}:null),null);
 for(const changed of [{document_id:'foreign'},{page:0},{page:3},{page:1.5},{box:{x:0,y:0,w:2,h:1}},{file_sha256:'b'.repeat(64)}])assert.equal(target({...report,source:{...report.source,...changed}},current,binding),null);
 assert.equal(target({...report,mode:'overview'},current,binding),null);
 const code=fs.readFileSync(require.resolve('../military-zone-review.js'),'utf8');const handler=code.slice(code.indexOf('original.onclick=async'),code.indexOf('report.append(original)'));
 assert.match(handler,/sourceTarget\(data,currentSource\(\),binding\(\)\)/);assert.match(handler,/await render\(\)/);assert.match(handler,/setBox\(target.box\)/);assert.doesNotMatch(handler,/functions.invoke|read\('zone'\)|rpc\(/);
});
test('saved zonal crosscheck is read-only, source filtered and rendered without duplicate panels',()=>{
 const source=fs.readFileSync(require.resolve('../military-zone-review.js'),'utf8');
 const start=source.indexOf('async function crosscheck()'),end=source.indexOf('async function saveFinal()',start),body=source.slice(start,end);
 assert.match(body,/reports.filter\(r=>sourceTarget\(r,context,binding\)\)/);assert.match(body,/CRMDocumentCrosscheck.load/);
 assert.match(body,/section.dataset.crosscheck/);assert(body.includes("querySelector('[data-crosscheck]')?.remove()"));
 assert.match(body,/if\(closed\|\|version!==crosscheckVersion\)return/);assert.doesNotMatch(body,/functions.invoke|\.update\(|\.insert\(|\.upsert\(/);
 assert.match(source,/crosscheck\(\).catch/);assert.match(body,/зональне читання, сторінка/);
 assert(source.includes("if(job.zone_summary?.source_changed||job.state==='superseded'){crosscheckVersion++"));
});

test('crosscheck displays the stored card value safely without fabricating unloaded structures',()=>{
 const context={window:{}};vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../military-zone-review.js'),'utf8'),context);
 const render=context.window.CRMMilitaryZoneReview.cardValueHTML;
 assert.match(render({key:'birth_place',current:'Україна, Київ'}),/У картці зараз:.*Україна, Київ/);
 assert.match(render({key:'birth_date',current:null}),/Не заповнено/);
 assert.match(render({key:'relatives',current:'<img src=x onerror=alert(1)>'}),/&lt;img/);
 assert.doesNotMatch(render({key:'relatives',current:'<script>'}),/<script>/);
 assert.equal(render({key:'education_records',current:null}),'');
 const code=fs.readFileSync(require.resolve('../military-zone-review.js'),'utf8');assert.match(code,/cardValueHTML\(e\)/);
});

test('parent dates are shown beside the card name with HTML escaping',()=>{
 const context={window:{}};vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../military-zone-review.js'),'utf8'),context);
 const render=context.window.CRMMilitaryZoneReview.cardValueHTML;
 assert.match(render({key:'relatives',current:'Тестенко Олена Іванівна',current_birth_date:'1979-06-28'}),/дата народження: 1979-06-28/);
 assert.match(render({key:'relatives',current:'Тестенко Олена',current_birth_date:'<script>'}),/&lt;script&gt;/);
 assert.doesNotMatch(render({key:'birth_place',current:'Київ',current_birth_date:'1979-06-28'}),/дата народження/);
});

test('education and service evidence uses labelled escaped fields rather than technical arrays',()=>{
 const context={window:{}};vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../military-zone-review.js'),'utf8'),context);
 const render=context.window.CRMMilitaryZoneReview.evidenceValueHTML;
 const result=render({key:'education_records'},{value:'[technical]',display_fields:{institution:'Університет',degree:'Бакалавр',specialty:'<script>',graduation_year:2023,diploma_number:'001',unknown:'hidden'}});
 assert.match(result,/Заклад:.*Університет/);assert.match(result,/Рік закінчення:.*2023/);assert.match(result,/Номер диплома:.*001/);assert.match(result,/&lt;script&gt;/);assert.doesNotMatch(result,/<script>|technical|hidden/);
 const service=render({key:'work_records'},{value:'[technical]',display_fields:{start_date:'2020',end_date:'2021-05',position:'Водій',unit:'ВЧ А0998'}});
 assert.match(service,/Початок:.*2020<br>/);assert.match(service,/Завершення:.*2021-05/);assert.doesNotMatch(service,/2020-01-01/);
 assert.equal(render({key:'birth_place'},{value:'<Київ>',display_fields:{institution:'ignored'}}),'&lt;Київ&gt;');
 assert.equal(render({key:'education_records'},{value:'original <value>'}),'original &lt;value&gt;');
 assert.equal(render({key:'education_records'},{value:'original',display_fields:{institution:{value:'not scalar'}}}),'original');
 const code=fs.readFileSync(require.resolve('../military-zone-review.js'),'utf8');assert.match(code,/evidenceValueHTML\(e,v\)/);
});


test('saved reports distinguish gaps and discard foreign or malformed reading sources without mutating evidence',()=>{
 const context={window:{}};vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../military-zone-review.js'),'utf8'),context);
 const view=(saved,id)=>context.window.CRMMilitaryZoneReview.savedReportView(saved,id,{context:{document_id:id,file_sha256:"a".repeat(64),pages:2,revision:"r1"},binding:{document_id:id,file_sha256:"a".repeat(64),revision:"r1"}});
 const own={review_only:true,mode:'zone',source:{document_id:'own',page:1},rows:[{fields:[{value:'Example',legibility:'clear'}]}]};
 const foreign={...own,source:{document_id:'other',page:1}},invalid={...own,source:{document_id:'own',page:0}};
 const saved={status:'complete',reports:[own,foreign,invalid,null],errors:[]},before=JSON.stringify(saved);
 const result=view(saved,'own');assert.equal(result.reports.length,1);assert.equal(result.omitted,3);assert.equal(result.errors,0);
 assert.match(result.title,/потрібна перевірка/);assert.match(result.notes.join(' '),/не беруть участі у зіставленні/);assert.equal(JSON.stringify(saved),before);
 assert.equal(view({status:'complete',reports:[own],errors:[]},'own').title,'Звіт збережено');
 for(const changed of [
  {status:'complete_with_gaps'}, {errors:[{code:'ZONE_STEP_FAILED'}]}, {reports:[]},
  {reports:[{...own,rows:[]}]}, {reports:[{...own,quality_issues:['blur']}]},
  {reports:[{...own,rows:[{fields:[{value:'Example',legibility:'clear',alternatives:['Other']}]}]}]}
 ])assert.match(view({...saved,reports:[own],...changed},'own').title,/потрібна перевірка/);
 for(const documentId of [null,undefined,''])assert.equal(view(saved,documentId).reports.length,0);
 for(const page of [-1,0,201,1.5,'1'])assert.equal(view({status:'complete',reports:[{...own,source:{document_id:'own',page}}]},'own').reports.length,0);
 assert.match(result.notes.join(' '),/Перегляд не запускає AI/);
});

test('saved fallback displays only filtered evidence and never automatically reprocesses an incomplete report',()=>{
 const source=fs.readFileSync(require.resolve('../military-zone-review.js'),'utf8');
 assert(source.includes('const view=savedReportView(saved,doc.id,{context:{document_id:doc.id,file_sha256:originalDigest,pages:total,revision:doc.ai_processed_at'));
 assert(source.includes('binding:reportBinding||coordinatorSession?.source}'));
 assert(source.includes('reports.push(...view.reports)'));
 assert(source.includes('for(const report of view.reports)'));
 assert(source.includes('if(view.reports.length)try{await crosscheck()}'));
 assert(!source.includes('reports.push(...saved.reports)'));
 assert(source.includes('else if(saved){'));
 assert(!source.includes("else if(saved&&Array.isArray(saved.reports)"));
});

test('unknown or malformed saved reports remain review-only instead of triggering automatic AI',()=>{
 const context={window:{}};vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../military-zone-review.js'),'utf8'),context);
 for(const saved of [{status:'unknown',reports:[]},{status:'complete',reports:null},{status:'complete'},'legacy']){const view=context.window.CRMMilitaryZoneReview.savedReportView(saved,'own');assert.match(view.title,/потрібна перевірка/);assert.equal(view.reports.length,0);}
});


test('saved readings are checked against actual original pages and digest; unbound legacy readings remain history',()=>{
 const sandbox={window:{}};vm.createContext(sandbox);vm.runInContext(fs.readFileSync(require.resolve('../military-zone-review.js'),'utf8'),sandbox);
 const view=sandbox.window.CRMMilitaryZoneReview.savedReportView;
 const context={document_id:'own',file_sha256:'a'.repeat(64),pages:1,revision:'r1'},binding={document_id:'own',file_sha256:'a'.repeat(64),revision:'r1'};
 const own={review_only:true,mode:'zone',source:{document_id:'own',page:1,file_sha256:context.file_sha256},rows:[{fields:[{value:'Example',legibility:'clear'}]}]};
 const saved=reports=>({status:'complete',reports,errors:[]});
 const valid=view(saved([own]),'own',{context});assert.equal(valid.reports.length,1);assert.equal(valid.unverified,0);assert.equal(valid.title,'Звіт збережено');
 for(const changed of [{page:2},{file_sha256:'b'.repeat(64)},{file_sha256:''},{file_sha256:null}]){const original=saved([{...own,source:{...own.source,...changed}}]),before=JSON.stringify(original),result=view(original,'own',{context,binding});assert.equal(result.reports.length,0);assert.equal(result.omitted,1);assert.equal(JSON.stringify(original),before);}
 const legacy={...own,source:{document_id:'own',page:1}};
 assert.equal(view(saved([legacy]),'own',{context,binding}).unverified,0);
 for(const options of [{},{context},{context,binding:{...binding,revision:'old'}},{context,binding:{...binding,document_id:'other'}},{context,binding:{...binding,file_sha256:'b'.repeat(64)}}]){const result=view(saved([legacy]),'own',options);assert.equal(result.reports.length,1);assert.equal(result.unverified,1);assert.match(result.title,/потрібна перевірка/);assert.match(result.notes.join(' '),/Історичних читань/);}
 for(const changed of [{pages:0},{pages:201},{pages:1.5},{file_sha256:'bad'},{document_id:'other'}])assert.equal(view(saved([own]),'own',{context:{...context,...changed}}).reports.length,0);
 const overview={...own,mode:'overview',zones:[]};assert.equal(view(saved([overview]),'own',{context}).unverified,0);
});

test('mixed empty rows and uncertain alternatives use the same summary in final browser saving',()=>{
 const context={window:{}};vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../military-zone-review.js'),'utf8'),context);
 const reading=context.window.CRMMilitaryZoneReview.readingSummary;
 const result=reading({rows:[{fields:[{value:0,legibility:'clear'},{value:false,legibility:'clear'}]},{fields:[]}]});
 assert.equal(result.count,2);assert.equal(result.uncertain,0);assert.equal(result.empty_rows,1);assert.match(result.label,/непрочитаних рядків: 1/);assert.match(result.notice,/непрочитані рядки/);
 const source=fs.readFileSync(require.resolve('../military-zone-review.js'),'utf8');assert(source.includes('sum+readingSummary(r).uncertain'));assert(source.includes('readingSummary(r).empty_rows>0'));
});
