const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=f=>fs.readFileSync(require('node:path').join(__dirname,'..',f),'utf8'),src=read('documents.js');
function state(){const c={window:{}};vm.createContext(c);vm.runInContext(read('document-state.js'),c);return c.window.CRMDocumentState;}

test('waiting document status is not proof of a durable server job',()=>{
 const api=state(),d={id:'doc',processing_status:'AI очікує'};
 assert.equal(api.fileState(d),'Розпізнавання ще не розпочато');
 assert.equal(api.fileState(d,true,null),'Не передано до черги СПЛАВ');
 assert.equal(api.fileState(d,true,{document_id:'other',state:'queued'}),api.fileState(d));
 assert.equal(api.fileState(d,true,{document_id:'doc',state:'queued'}),'У черзі СПЛАВ');
 assert.equal(api.fileState(d,true,{document_id:'doc',state:'running'}),'СПЛАВ опрацьовує');
 assert.equal(api.fileState({...d,verification_status:'Підтверджено'},true,null),'Перевірений');
 assert.equal(api.fileState(d,false,null),'Завантажено — перевірте документ');
});

function queue(reply){
 const labels=['one','two'].map(id=>({dataset:{splavWaitingDocument:id},textContent:'old',closest:()=>null}));
 const status={textContent:''},rows={dataset:{splavCandidate:'case'},querySelectorAll:()=>labels},tracked=[];
 const c=vm.createContext({activeDocumentsReadOnly:false,activeDocumentsCandidateId:'case',CRMDocumentState:state(),
  document:{getElementById:id=>id==='docBatchStatus'?status:rows},supabaseClient:{rpc:async()=>reply},trackSplavJob:(...a)=>tracked.push(a)});
 vm.runInContext(src.slice(src.indexOf('async function resumeSplavJobs('),src.indexOf('function acceptedServerReconciliation(')),c);
 return {c,labels,status,tracked};
}

test('empty acknowledged queue exposes saved but undelegated files without starting AI',async()=>{
 const q=queue({data:[]});await q.c.resumeSplavJobs('case');
 assert(q.labels.every(l=>l.textContent==='Не передано до черги СПЛАВ'));
 assert.match(q.status.textContent,/без серверного доручення: 2/);assert.equal(q.tracked.length,0);
});

test('real jobs are associated with the exact document, not the shared filename',async()=>{
 const q=queue({data:[{id:'job',document_id:'two',state:'queued',kind:'root'}]});await q.c.resumeSplavJobs('case');
 assert.equal(q.labels[0].textContent,'Не передано до черги СПЛАВ');assert.equal(q.labels[1].textContent,'У черзі СПЛАВ');
 assert.match(q.status.textContent,/без серверного доручення: 1/);assert.deepEqual(q.tracked,[['job','case']]);
});

test('unknown queue state never becomes a false empty-queue confirmation or changes another view',async()=>{
 for(const reply of [{error:{message:'offline'}},{data:null},{data:[{state:'queued'}]}]){
  const q=queue(reply);await q.c.resumeSplavJobs('case');assert(q.labels.every(l=>l.textContent==='Стан черги СПЛАВ недоступний'));
  assert.doesNotMatch(q.status.textContent,/без серверного доручення/);
 }
 const q=queue({data:[]});q.c.activeDocumentsCandidateId='other';await q.c.resumeSplavJobs('case');assert(q.labels.every(l=>l.textContent==='old'));
});

test('waiting files have a visible single queue action and escaped document references',()=>{
 const esc=s=>String(s).replaceAll('"','&quot;');
 const c=vm.createContext({docEscape:esc,formatDocSize:()=> '175 КБ',CRMDocumentState:state(),CRMResponsibility:{documentInfo:()=>'',canDelete:()=>false},versionHistory:()=>'',window:{}});
 vm.runInContext(src.slice(src.indexOf('function documentDisplayState('),src.indexOf('function manualZoneButtonHtml(')),c);
 const d={id:'doc"one',file_name:'fixture.pdf',processing_status:'AI очікує',verification_status:'Не перевірено'};
 const html=c.documentFileHtml(d,{ai_enabled:true},[d],esc,true);
 assert.match(html,/data-splav-waiting-document="doc&quot;one"/);assert.match(html,/Передати СПЛАВ/);
 assert.equal((html.match(/data-doc-retry=/g)||[]).length,1);assert.doesNotMatch(html,/Очікує опрацювання СПЛАВ/);
});

test('first processing of an unacknowledged waiting file delegates autopilot and cannot fall back on ambiguous errors',async()=>{
 for(const fail of [false,true]){
  let request,providerCalls=0;const alerts=[],doc={candidate_id:'case',processing_status:'AI очікує',ai_extracted:{},ai_processed_at:null};
  const q={select(){return q},eq(){return q},single:async()=>({data:doc})};
  const c=vm.createContext({supabaseClient:{from:()=>q,functions:{invoke:async()=>{providerCalls++;}}},getDocumentRequirements:async()=>[],
   activeDocumentsCandidateId:null,alert:m=>alerts.push(m),enqueueSplavDocument:async(id,caseId,options)=>{request={id,caseId,options};if(fail)throw Error('reply unknown');return {id:'job'};}});
  vm.runInContext(src.slice(src.indexOf('async function retryDocumentAI('),src.indexOf('async function openDocument(')),c);
  await c.retryDocumentAI('doc');assert.equal(request.options.autopilot,true);assert.equal(providerCalls,0);assert.equal(alerts.length,1);
 }
});
