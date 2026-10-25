const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../military-zone-review.js'),'utf8');
const start=source.indexOf('function showBackground(job){'),end=source.indexOf(" $('[data-auto]').onclick",start),body=source.slice(start,end);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function setup(){
 const node=()=>({children:[],hidden:false,disabled:false,textContent:'',append(...items){this.children.push(...items)},replaceChildren(...items){this.children=items},querySelector(){return {remove(){}}}});
 const nodes=new Map(),get=key=>{if(!nodes.has(key))nodes.set(key,node());return nodes.get(key)},requests=[],timers=[],statuses=[];let checks=0;
 const client={from:()=>{const chain={select(){return chain},eq(){return chain},single(){const d=deferred();requests.push({kind:'document',...d});return d.promise}};return chain},rpc:()=>{const d=deferred();requests.push({kind:'status',...d});return d.promise}};
 const context={reports:[],doc:{id:'d'},closed:false,backgroundViewVersion:0,backgroundReportsKey:null,backgroundReportLoaded:false,backgroundSeen:false,backgroundPoll:null,reportBinding:null,crosscheckVersion:0,
  $:get,document:{createElement:node,createTextNode:text=>({textContent:text})},dialog:{querySelector:get,querySelectorAll:()=>[node(),node()]},
  backgroundSummary:job=>({title:job.state,notes:[]}),showReport:report=>get('[data-result]').append(report),crosscheck:()=>{checks++;return Promise.resolve()},backgroundReports:(_job,saved)=>saved?.reports||[],status:text=>statuses.push(text),supabaseClient:client,
  clearInterval(){},setInterval:fn=>{timers.push(fn);return timers.length}};
 vm.createContext(context);vm.runInContext(body,context);return {context,get,requests,timers,statuses,checks:()=>checks};
}
const overview={review_only:true,mode:'overview',source:{document_id:'d',page:1}},zone={review_only:true,mode:'zone',source:{document_id:'d',page:1},rows:[]};
const job=extra=>({id:'j',_detailed:true,state:'running',zone_summary:{},...extra});
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
 const f=setup();f.context.showBackground(job({_detailed:false}));assert.equal(f.requests.length,1);f.context.showBackground(job({state:'superseded'}));f.requests[0].resolve({data:job({zone_reports:[overview,zone]})});await flush();assert.equal(f.context.reports.length,0);assert.equal(f.get('[data-auto-progress]').children[0].textContent,'superseded');
 const g=setup();g.context.showBackground(job({state:'completed',result:{saved_at:'now'}}));g.context.showBackground(job({state:'superseded'}));const count=g.statuses.length;g.requests[0].reject(Error('late'));await flush();assert.equal(g.statuses.length,count);
});
test('polling transport failures are contained and do not dispatch AI',async()=>{
 const f=setup();f.context.showBackground(job());const pending=f.timers[0]();assert.equal(f.requests.length,1);f.requests[0].reject(Error('offline'));await pending;assert.match(f.statuses.at(-1),/Не вдалося оновити стан/);
});

test('an old polling response cannot replace a newer terminal view and closed dialogs ignore pending loads',async()=>{
 const f=setup();f.context.showBackground(job());const pending=f.timers[0]();f.context.showBackground(job({state:'superseded'}));f.requests[0].resolve({data:job({zone_reports:[overview,zone]})});await pending;assert.equal(f.context.reports.length,0);assert.equal(f.get('[data-auto-progress]').children[0].textContent,'superseded');
 const g=setup();g.context.showBackground(job({state:'completed',result:{saved_at:'now'}}));g.context.closed=true;g.requests[0].resolve({data:{ai_extracted:{_military_zone_report:{reports:[zone]}}}});await flush();assert.equal(g.context.reports.length,0);
});
