const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../military-zone-review.js'),'utf8');
const start=source.indexOf('function paintBackgroundSummary(job,detailState){'),end=source.indexOf(" $('[data-auto]').onclick",start),body=source.slice(start,end);
const apiContext={window:{}};vm.createContext(apiContext);vm.runInContext(source,apiContext);const api=apiContext.window.CRMMilitaryZoneReview;
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function setup(){
 const node=()=>({children:[],style:{},hidden:false,disabled:false,textContent:'',append(...items){this.children.push(...items)},replaceChildren(...items){this.children=items},querySelector(){return {remove(){}}}});
 const nodes=new Map(),get=key=>{if(!nodes.has(key))nodes.set(key,node());return nodes.get(key)},requests=[],timers=[],statuses=[];let checks=0;
 const client={auth:{getUser:()=>{const d=deferred();requests.push({kind:'auth',...d});return d.promise}},from:()=>{const chain={select(){return chain},eq(){return chain},single(){const d=deferred();requests.push({kind:'document',...d});return d.promise}};return chain},rpc:(name,args)=>{const d=deferred();requests.push({kind:'status',name,args,...d});return d.promise}};
 const context={reports:[],doc:{id:'d'},closed:false,backgroundViewVersion:0,backgroundReportsKey:null,backgroundReportLoaded:false,backgroundSeen:false,backgroundPoll:null,reportBinding:null,crosscheckVersion:0,
  $:get,document:{createElement:node,createTextNode:text=>({textContent:text})},dialog:{querySelector:get,querySelectorAll:()=>[node(),node()]},
  backgroundSummary:api.backgroundSummary,readBackgroundStatus:api.readBackgroundStatus,showReport:report=>get('[data-result]').append(report),crosscheck:()=>{checks++;return Promise.resolve()},backgroundReports:(_job,saved)=>saved?.reports||[],status:text=>statuses.push(text),supabaseClient:client,
  rerunButton:node(),rerunIntents:new Map(),pageCanary:false,pageRerunEligible:()=>true,total:1,originalDigest:'hash',busy:false,autoActive:false,confirmed:true,
  window:{confirm:()=>context.confirmed},crypto:{randomUUID:()=>{context.uuidCalls++;return 'intent-'+context.uuidCalls}},uuidCalls:0,lock:value=>{context.busy=value},
  clearInterval(){},setInterval:fn=>{timers.push(fn);return timers.length}};
 vm.createContext(context);vm.runInContext(body,context);return {context,get,requests,timers,statuses,checks:()=>checks};
}
const overview={review_only:true,mode:'overview',source:{document_id:'d',page:1}},zone={review_only:true,mode:'zone',source:{document_id:'d',page:1},rows:[]};
const job=extra=>({id:'j',document_id:'d',kind:'zone',_detailed:true,state:'running',zone_summary:{},...extra});
test('new saved readings replace the first overview; identical polling responses do not redraw',()=>{
 const f=setup();f.context.showBackground(job({zone_reports:[overview]}));assert.equal(f.context.reports.length,1);assert.equal(f.checks(),1);
 f.context.showBackground(job({state:'completed',zone_reports:[overview,zone]}));assert.equal(f.context.reports.length,2);assert.equal(f.checks(),2);assert.equal(f.get('[data-result]').children.length,1);
 f.context.showBackground(job({state:'completed',zone_reports:[overview,zone]}));assert.equal(f.checks(),2);
});
test('a changed or superseded source clears visible readings and disables export',()=>{
 for(const changed of [{zone_summary:{source_changed:true}},{state:'superseded'}]){const f=setup();f.context.showBackground(job({zone_reports:[overview,zone],zone_binding:{document_id:'d'}}));f.context.showBackground(job({...changed,zone_reports:[overview,zone]}));assert.equal(f.context.reports.length,0);assert.equal(f.get('[data-result]').children.length,0);assert.equal(f.context.reportBinding,null);assert.equal(f.get('[data-export]').hidden,true);assert.equal(f.get('[data-export]').disabled,true);}
});
test('late final-report loads cannot repopulate a superseded or newer view',async()=>{
 for(const next of [job({state:'superseded'}),job({zone_reports:[overview,zone]})]){const f=setup();f.context.showBackground(job({state:'completed',result:{saved_at:'now'}}));assert.equal(f.requests.length,1);f.context.showBackground(next);const before=JSON.stringify(f.context.reports);f.requests[0].resolve({data:{ai_extracted:{_military_zone_report:{reports:[zone]}}}});await flush();assert.equal(JSON.stringify(f.context.reports),before);}
});
test('late job-status responses and stale load failures cannot overwrite the latest view',async()=>{
 const f=setup();f.context.showBackground(job({_detailed:false}));assert.equal(f.requests.length,1);f.context.showBackground(job({state:'superseded'}));f.requests[0].resolve({data:job({zone_reports:[overview,zone]})});await flush();assert.equal(f.context.reports.length,0);assert.equal(f.get('[data-auto-progress]').children[0].textContent,'Джерело документа змінилося');
 const g=setup();g.context.showBackground(job({state:'completed',result:{saved_at:'now'}}));g.context.showBackground(job({state:'superseded'}));const count=g.statuses.length;g.requests[0].reject(Error('late'));await flush();assert.equal(g.statuses.length,count);
});
test('polling transport failures are contained and do not dispatch AI',async()=>{
 const f=setup();f.context.showBackground(job());const pending=f.timers[0]();assert.equal(f.requests.length,1);f.requests[0].reject(Error('offline'));await pending;assert.equal(f.get('[data-auto-progress]').children[0].textContent,'Не вдалося отримати стан результату');assert.equal(f.requests[0].name,'crm_splav_job_status');
});

test('an old polling response cannot replace a newer terminal view and closed dialogs ignore pending loads',async()=>{
 const f=setup();f.context.showBackground(job());const pending=f.timers[0]();f.context.showBackground(job({state:'superseded'}));f.requests[0].resolve({data:job({zone_reports:[overview,zone]})});await pending;assert.equal(f.context.reports.length,0);assert.equal(f.get('[data-auto-progress]').children[0].textContent,'Джерело документа змінилося');
 const g=setup();g.context.showBackground(job({state:'completed',result:{saved_at:'now'}}));g.context.closed=true;g.requests[0].resolve({data:{ai_extracted:{_military_zone_report:{reports:[zone]}}}});await flush();assert.equal(g.context.reports.length,0);
});

test('opening an eligible old run only checks owner visibility; cancellation never enqueues',async()=>{
 const f=setup();f.context.pageCanary=true;f.context.showBackground(job({state:'completed',zone_binding:{file_sha256:'hash'},zone_reports:[overview,zone]}));
 assert.equal(f.requests.length,1);assert.equal(f.requests[0].kind,'auth');
 f.requests[0].resolve({data:{user:{id:'7c74b122-3940-40a8-a32f-fe2b6776c173'}}});await flush();assert.equal(f.context.rerunButton.hidden,false);
 f.context.confirmed=false;await f.context.rerunButton.onclick();assert.equal(f.requests.length,1);assert.equal(f.context.uuidCalls,0);
});

test('uncertain enqueue response reuses the same run intent and success clears the old display',async()=>{
 const f=setup();f.context.pageCanary=true;f.context.showBackground(job({state:'completed',zone_binding:{file_sha256:'hash'},zone_reports:[overview,zone]}));
 f.requests[0].resolve({data:{user:{id:'7c74b122-3940-40a8-a32f-fe2b6776c173'}}});await flush();
 const first=f.context.rerunButton.onclick(),request=f.requests[1];assert.equal(request.name,'crm_splav_zone_page_rerun_enqueue');
 request.reject(Error('network response lost'));await first;assert.equal(f.context.busy,false);assert.equal(f.context.reports.length,2);
 const second=f.context.rerunButton.onclick(),retry=f.requests[2];assert.equal(retry.args.p_run_id,request.args.p_run_id);assert.equal(retry.args.p_previous_job,'j');assert.equal(f.context.uuidCalls,1);
 retry.resolve({data:{id:'new-job',state:'queued',kind:'zone'}});await second;assert.equal(f.context.reports.length,0);assert.equal(f.context.rerunButton.hidden,true);assert.equal(f.context.reportBinding,null);
 assert.equal(f.requests[3].args.job_id,'new-job');
});

test('late owner check cannot reveal the rerun action after the source changes',async()=>{
 const f=setup();f.context.pageCanary=true;f.context.showBackground(job({state:'completed',zone_binding:{file_sha256:'hash'},zone_reports:[overview,zone]}));
 f.context.showBackground(job({state:'superseded',zone_binding:null}));
 f.requests[0].resolve({data:{user:{id:'7c74b122-3940-40a8-a32f-fe2b6776c173'}}});await flush();assert.equal(f.context.rerunButton.hidden,true);
});

test('a short needs-review entry stays loading until its bound saved-with-gaps details arrive',async()=>{
 const f=setup();f.context.showBackground(job({_detailed:false,state:'needs_review',zone_summary:null}));
 assert.equal(f.get('[data-auto-progress]').children[0].textContent,'Завантажуємо збережений результат');
 assert.equal(f.get('h2').textContent,'Документ · завантаження результату');
 assert.equal(f.requests.length,1);assert.equal(f.requests[0].name,'crm_splav_job_status');
 f.requests[0].resolve({data:job({state:'needs_review',result:{status:'complete_with_gaps'},zone_summary:{pending_steps:0}})});await flush();
 assert.equal(f.get('[data-auto-progress]').children[0].textContent,'Звіт збережено з прогалинами');assert.equal(f.get('h2').textContent,'Документ · результат СПЛАВ');assert.equal(f.requests.length,1);
});
test('initial detail failures stop loading without mislabelling document processing or dispatching another request',async()=>{
 for(const failure of ['network','rpc','empty','foreign']){
  const f=setup();f.context.showBackground(job({_detailed:false,state:'needs_review'}));
  if(failure==='network')f.requests[0].reject(Error('offline'));
  else f.requests[0].resolve(failure==='rpc'?{error:{message:'denied'}}:failure==='empty'?{data:null}:{data:job({document_id:'other'})});
  await flush();assert.equal(f.get('h2').textContent,'Документ · стан недоступний');assert.equal(f.get('[data-auto-progress]').children[0].textContent,'Не вдалося отримати стан результату');assert.equal(f.requests.length,1);assert.equal(f.context.reports.length,0);
 }
 const f=setup();f.context.showBackground(job({_detailed:false,state:'needs_review'}));f.context.closed=true;const title=f.get('h2').textContent;f.requests[0].reject(Error('late'));await flush();assert.equal(f.get('h2').textContent,title);
});
