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
 assert.match(source,/rpc\('crm_splav_zone_canary_enqueue'/);
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
