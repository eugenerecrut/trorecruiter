const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{stripTypeScriptTypes}=require('node:module');
const contract=require('../supabase/functions/_shared/military-zone.js');
test('document profiles cover handwriting and preserve explicit exclusions and ID-card distinction',()=>{
 for(const type of ['Автобіографія рукописна','Документи про трудову діяльність','Свідоцтво про народження','Копія свідоцтва про розірвання шлюбу','Копія диплома та атестата з додатками','Довідка ВЛК','Копія рекомендаційного листа','Копія посвідчення водія / інші посвідчення','Копія УБД'])assert(contract.family(type),type);
 for(const type of ['Додаток 13 (Картка обстеження та медичного огляду)','Довідка гінеколога','Сертифікат психологічного тестування','Фото 9×12'])assert.equal(contract.family(type),null,type);
 assert.equal(contract.family('Копія паспорта/ID Картки','ID-картка'),null);assert.equal(contract.family('Копія паспорта/ID Картки','Паспорт-книжечка'),'passport');
 assert.match(contract.prompt('zone','Автобіографія рукописна'),/родичів/);assert.doesNotMatch(contract.prompt('zone','Свідоцтво про народження'),/командир екіпажу/);
});
test('zones reject invalid coordinates, clamp floating point edges, preserve glossary without VOS invention',()=>{
 for(const b of [{x:-1,y:0,w:1,h:1},{x:0,y:0,w:0,h:1},{x:0,y:0,w:2,h:1},{x:0,y:NaN,w:1,h:1}])assert.equal(contract.box(b),null);
 assert.equal(contract.box({x:.1,y:0,w:.9005,h:1}).w,.9);assert.match(contract.prompt('zone'),/ВОС не визначай/);assert.match(contract.prompt('overview'),/цілі рядки/);
});
test('review output strips candidate merge fields and never accepts uncertain values as facts',()=>{
 const out=contract.result('zone',{full_name:'DO NOT MERGE',extracted:{military_specialty:'123456А'},raw_text:'Наказ 18?',rows:[{fields:[{key:'order_number',raw_text:'18?',value:'182',legibility:'uncertain',alternatives:['182','192']},{key:'position',raw_text:'оператор',value:'оператор',legibility:'clear'},{key:'military_specialty',value:'123456А',legibility:'clear'},{key:'full_name',value:'DO NOT MERGE'}]}]}, {page:3});
 assert.equal(contract.fieldValid('military_specialty','4900347 А'),false);assert.equal(contract.fieldValid('start_date','11.07.16'),false);assert.equal(contract.fieldValid('start_date','2024-02-30'),false);assert.equal(contract.fieldValid('military_specialty','216182А'),true);
 assert.equal(out.review_only,true);assert.equal(out.requires_review,true);assert.equal(out.full_name,undefined);assert.equal(out.extracted,undefined);assert.equal(out.rows[0].fields.length,4);assert.equal(out.rows[0].fields[0].value,null);assert.equal(out.rows[0].fields[1].value,'оператор');assert.equal(out.rows[0].fields[2].value,null);assert(out.rows[0].fields.every(f=>f.requires_review));
});
function server({auth=true,staff=true,processor=false,doc=true,enabled=true,type='Копія військового квитка',newer=false,provider=true,fallback=false,ledger='accepted',finish='completed'}={}){
 let handler;const calls=[];let savedReceipt=null;
 const context={globalThis:null,Response,Request,AbortController,setTimeout,clearTimeout,atob,btoa,console,crypto:require('node:crypto').webcrypto,CRMMilitaryZoneContract:contract,Deno:{env:{get:k=>({SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'publishable-test',OPENAI_API_KEY:'unit-test-not-a-real-key',...(fallback?{GEMINI_API_KEY:'test-gemini',OPENROUTER_API_KEY:'test-router'}:{})}[k])},serve:fn=>handler=fn},fetch:async(url,init={})=>{
  calls.push({url,method:init.method||'GET'});
  if(url.endsWith('/auth/v1/user'))return Response.json({id:'user'},{status:auth?200:401});
  if(url.includes('crm_staff?'))return Response.json(staff?[{user_id:'user',role:processor?'processor':'recruiter'}]:[]);
  if(url.includes('version_number=gt.'))return Response.json(newer?[{id:'new'}]:[]);
  if(url.includes('/document_requirements?'))return Response.json([{ai_enabled:enabled}]);
  if(url.includes('/rpc/crm_military_zone_examples'))return Response.json([]);
  if(url.includes('/rpc/crm_zone_begin')||url.includes('/rpc/crm_zone_coordinator_begin')){
   if(ledger==='durable'){
    if(savedReceipt)return Response.json(savedReceipt);
    savedReceipt={state:'dispatched'};
    return Response.json({state:'accepted',id:'receipt-id',receipt:'secret-receipt'});
   }
   if(ledger==='error')return Response.json({error:'unavailable'},{status:503});
   if(ledger==='completed')return Response.json({state:'completed',result:{review_only:true,mode:'zone',rows:[],source:{page:1}}});
   if(ledger==='failed')return Response.json({state:'failed',result:{error:'Unknown result',code:'ZONE_RESULT_UNCERTAIN',automatic_retry:false}});
   return Response.json({state:ledger,...(ledger==='accepted'?{id:'receipt-id',receipt:'secret-receipt'}:{})});
  }
  if(url.includes('/rpc/crm_zone_finish')){
   if(ledger==='durable'){const payload=JSON.parse(init.body);savedReceipt={state:payload.p_result.error?'failed':'completed',result:payload.p_result};return Response.json({state:savedReceipt.state});}
   return finish==='error'?Response.json({error:'unavailable'},{status:503}):Response.json({state:finish});
  }
  if(url.includes('/documents?'))return Response.json(doc?[{id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',candidate_id:'c',storage_path:'c/original.pdf',document_type:type,version_group_id:'g',version_number:1}]:[]);
  if(url.includes('api.openai.com')){
   if(provider==='transport')throw Error('synthetic network failure');
   if(provider==='malformed')return Response.json({output:[]});
   if(provider==='body-lost')return new Response('{truncated');
   if(provider==='5xx')return Response.json({error:'synthetic'}, {status:503});
   return provider?Response.json({output:[{content:[{text:JSON.stringify({raw_text:'оператор',rows:[]})}]}]}):Response.json({error:'not available'},{status:429});
  }
  if(url.includes('generativelanguage.googleapis.com'))return Response.json({candidates:[{content:{parts:[{text:'{"rows":[]}' }]}}]});
  throw Error('Unexpected request '+url);
 }};context.globalThis=context;vm.createContext(context);
 let source=fs.readFileSync(path.join(__dirname,'../supabase/functions/ai-military-zone/index.ts'),'utf8').replace("import '../_shared/military-zone.js';",'');source=stripTypeScriptTypes(source);vm.runInContext(source,context);
 const body={document_id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',mode:'zone',page:1,box:{x:0,y:0,w:1,h:1},image_data:'data:image/jpeg;base64,/9g='};
 return {calls,invoke:extra=>handler(new Request('https://test/zone',{method:'POST',headers:{Authorization:'Bearer test'},body:JSON.stringify({...body,...extra})}))};
}
test('edge requires authentication, active staff, accessible military document and latest version',async()=>{
 for(const [opts,status] of [[{auth:false},401],[{staff:false},403],[{processor:true},403],[{doc:false},404],[{type:'Додаток 13'},400],[{enabled:false},403],[{newer:true},409]]){const s=server(opts),r=await s.invoke();assert.equal(r.status,status);assert(!s.calls.some(x=>x.url.includes('api.openai.com')));}
});
test('edge rejects malformed page, image and box without AI calls',async()=>{
 for(const extra of [{page:0},{mode:'merge'},{box:{x:0,y:0,w:0,h:1}},{image_data:'data:image/jpeg;base64,YWJj'},{image_data:'https://external.invalid/doc'}]){const s=server(),r=await s.invoke(extra);assert.equal(r.status,400);assert(!s.calls.some(x=>x.url.includes('api.openai.com')));}
});
test('edge returns read-only result, writes only to the receipt RPCs, and reports failures safely',async()=>{
 const s=server(),r=await s.invoke(),out=await r.json();assert.equal(r.status,200);assert.equal(out.review_only,true);assert.equal(out.source.page,1);assert.equal(out.source.document_id,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');assert(s.calls.filter(x=>x.url.includes('/rest/')&&x.method!=='GET').every(x=>/\/rpc\/crm_zone_(begin|finish)$/.test(x.url)));
 const fail=await server({provider:false}).invoke();assert.equal(fail.status,502);assert(!JSON.stringify(await fail.json()).includes('unit-test-not-a-real-key'));
});

test('ambiguous transport, server and accepted-but-unreadable responses stop before fallback',async()=>{
 for(const provider of ['transport','malformed','body-lost','5xx']){
  const s=server({provider,fallback:true}),r=await s.invoke(),out=await r.json();
  assert.equal(r.status,502);assert.equal(out.code,'ZONE_RESULT_UNCERTAIN');assert.equal(out.automatic_retry,false);
  assert.equal(s.calls.filter(x=>x.url.includes('api.openai.com')).length,1);
  assert.equal(s.calls.filter(x=>x.url.includes('generativelanguage')||x.url.includes('openrouter')).length,0);
  assert(!JSON.stringify(out).includes('unit-test-not-a-real-key'));
 }
});
test('explicit provider rejection permits the existing bounded fallback',async()=>{
 const s=server({provider:false,fallback:true}),r=await s.invoke();
 assert.equal(r.status,200);assert.equal((await r.json()).source.provider,'Gemini');
 assert.equal(s.calls.filter(x=>x.url.includes('api.openai.com')).length,1);
 assert.equal(s.calls.filter(x=>x.url.includes('generativelanguage')).length,1);
});

test('cached, dispatched, failed and unavailable receipts prevent all model calls',async()=>{
 for(const [ledger,status] of [['completed',200],['dispatched',409],['failed',502],['error',409]]){
  const s=server({ledger}),response=await s.invoke();assert.equal(response.status,status);
  assert.equal(s.calls.filter(x=>x.url.includes('api.openai.com')).length,0);
  if(ledger==='completed')assert.equal((await response.json()).request_replayed,true);
 }
});
test('source changes and lost persistence do not return an apparently successful result',async()=>{
 for(const finish of ['superseded','error']){
  const s=server({finish}),response=await s.invoke(),out=await response.json();
  assert.equal(response.status,finish==='superseded'?409:502);
  assert.equal(out.review_only,undefined);
  assert.equal(out.code,finish==='superseded'?'ZONE_SOURCE_CHANGED':'ZONE_RESULT_UNCERTAIN');
  assert.equal(s.calls.filter(x=>x.url.includes('api.openai.com')).length,1);
 }
});
test('image digest mismatch is rejected before receipt allocation and AI',async()=>{
 const s=server(),r=await s.invoke({render_sha256:'a'.repeat(64)});assert.equal(r.status,400);
 assert.equal(s.calls.filter(x=>x.url.includes('crm_zone_begin')||x.url.includes('api.openai.com')).length,0);
});
test('reopening the same step replays the durable result without another paid call',async()=>{
 const s=server({ledger:'durable'});
 const first=await s.invoke();assert.equal(first.status,200);
 const second=await s.invoke();assert.equal(second.status,200);assert.equal((await second.json()).request_replayed,true);
 assert.equal(s.calls.filter(x=>x.url.includes('api.openai.com')).length,1);
 assert.equal(s.calls.filter(x=>x.url.includes('crm_zone_finish')).length,1);
});
test('a durable uncertain result is replayed without another paid call',async()=>{
 const s=server({ledger:'durable',provider:'transport'});
 assert.equal((await s.invoke()).status,502);assert.equal((await s.invoke()).status,502);
 assert.equal(s.calls.filter(x=>x.url.includes('api.openai.com')).length,1);
});
test('coordinator dispatch uses its guarded RPC and malformed versions make no AI request',async()=>{
 const s=server({ledger:'completed'}),r=await s.invoke({coordinator_id:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',coordinator_version:1});
 assert.equal(r.status,200);assert(s.calls.some(c=>c.url.endsWith('/rpc/crm_zone_coordinator_begin')));
 assert(!s.calls.some(c=>c.url.endsWith('/rpc/crm_zone_begin')));
 for(const extra of [{coordinator_id:'invalid',coordinator_version:1},{coordinator_id:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',coordinator_version:-1},{coordinator_version:1}]){
  const bad=server();assert.equal((await bad.invoke(extra)).status,400);assert(!bad.calls.some(c=>c.url.includes('api.openai.com')));
 }
});
