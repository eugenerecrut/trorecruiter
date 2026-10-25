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
function server({auth=true,staff=true,processor=false,zoneLease=false,nativeOnly=false,doc=true,enabled=true,type='Копія військового квитка',newer=false,provider=true,fallback=false,geminiFailure=false,geminiThoughts=false,router=false,cachedResult=null,ledger='accepted',finish='completed'}={}){
 let handler;const calls=[];let savedReceipt=null;
 const context={globalThis:null,TextDecoder,Response,Request,AbortController,setTimeout,clearTimeout,atob,btoa,console,crypto:require('node:crypto').webcrypto,CRMMilitaryZoneContract:contract,Deno:{env:{get:k=>({SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'publishable-test',OPENAI_API_KEY:'unit-test-not-a-real-key',...(fallback?{GEMINI_API_KEY:'test-gemini'}:{}),...(router?{OPENROUTER_API_KEY:'test-router'}:{})}[k])},serve:fn=>handler=fn},fetch:async(url,init={})=>{
  calls.push({url,method:init.method||'GET'});
  if(url.endsWith('/auth/v1/user'))return Response.json({id:'user'},{status:auth?200:401});
  if(url.includes('crm_staff?'))return Response.json(staff?[{user_id:'user',role:processor?'processor':'recruiter'}]:[]);
  if(url.includes('version_number=gt.'))return Response.json(newer?[{id:'new'}]:[]);
  if(url.includes('/document_requirements?'))return Response.json([{ai_enabled:enabled}]);
  if(url.includes('/rpc/crm_military_zone_examples'))return Response.json([]);
  if(url.includes('/rpc/crm_splav_zone_step')){
   if(!zoneLease)return Response.json({error:'lease denied'},{status:403});
   const payload=JSON.parse(init.body);
   if(payload.p_operation==='validate'&&nativeOnly)return Response.json({error:'AI disabled for native canary'},{status:403});
   if(payload.p_operation==='validate')return Response.json({document_id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',coordinator_id:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',version:7});
   if(payload.p_operation==='begin')return Response.json({state:'accepted',id:'receipt-id',receipt:'secret-receipt'});
   if(payload.p_operation==='finish')return Response.json({state:'completed'});
   throw Error('Unexpected zonal operation');
  }
  if(url.includes('/rpc/crm_zone_begin')||url.includes('/rpc/crm_zone_coordinator_begin')){
   if(ledger==='durable'){
    if(savedReceipt)return Response.json(savedReceipt);
    savedReceipt={state:'dispatched'};
    return Response.json({state:'accepted',id:'receipt-id',receipt:'secret-receipt'});
   }
   if(ledger==='error')return Response.json({error:'unavailable'},{status:503});
   if(ledger==='completed')return Response.json({state:'completed',result:cachedResult||{review_only:true,mode:'zone',rows:[],source:{page:1}}});
   if(ledger==='failed')return Response.json({state:'failed',result:{error:'Unknown result',code:'ZONE_RESULT_UNCERTAIN',automatic_retry:false}});
   return Response.json({state:ledger,...(ledger==='accepted'?{id:'receipt-id',receipt:'secret-receipt'}:{})});
  }
  if(url.includes('/rpc/crm_zone_finish')){
   if(ledger==='durable'){const payload=JSON.parse(init.body);savedReceipt={state:payload.p_result.error?'failed':'completed',result:payload.p_result};return Response.json({state:savedReceipt.state});}
   return finish==='error'?Response.json({error:'unavailable'},{status:503}):Response.json({state:finish});
  }
  if(url.includes('/documents?'))return Response.json(doc?[{id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',candidate_id:'c',storage_path:'c/original.pdf',document_type:type,version_group_id:'g',version_number:1}]:[]);
  if(url.includes('openrouter.ai'))return router==='malformed'?Response.json({choices:[]}):Response.json({choices:[{message:{content:'{"rows":[]}'}}]});
  if(url.includes('api.openai.com')){
   if(provider==='quota')return Response.json({error:{code:'insufficient_quota',message:'SECRET PASSPORT DATA'}},{status:429,headers:{'retry-after':'30'}});
   if(provider==='unknown-code')return Response.json({error:{code:'SECRET PASSPORT DATA',message:'SECRET'}},{status:429});
   if(provider==='oversize')return new Response('x'.repeat(20000),{status:429});
   if(provider==='transport')throw Error('synthetic network failure');
   if(provider==='malformed')return Response.json({output:[]});
   if(provider==='body-lost')return new Response('{truncated');
   if(provider==='5xx')return Response.json({error:'synthetic'}, {status:503});
   return provider?Response.json({output:[{content:[{text:JSON.stringify({raw_text:'оператор',rows:[]})}]}]}):Response.json({error:'not available'},{status:429});
  }
  if(url.includes('generativelanguage.googleapis.com')&&geminiThoughts)return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'{"SECRET_THOUGHT":1}'},{text:'{"rows":[]}' }]}}]});
  if(url.includes('generativelanguage.googleapis.com')&&geminiFailure)return Response.json({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:geminiFailure==='valid-json'?'{"rows":[]}':'truncated SECRET'}]}}]});
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
test('processor model access requires a live exact zonal lease and uses only scoped RPCs',async()=>{
 const extra={job_id:'cccccccc-cccc-cccc-cccc-cccccccccccc',lease_token:'dddddddd-dddd-dddd-dddd-dddddddddddd',coordinator_id:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',coordinator_version:7};
 for(const opts of [{processor:true},{processor:true,zoneLease:true}]){
  const s=server(opts),r=await s.invoke({...extra,...(opts.zoneLease?{coordinator_version:6}:{})});assert.ok([403,409].includes(r.status));assert(!s.calls.some(x=>x.url.includes('api.openai.com')));
 }
 const s=server({processor:true,zoneLease:true}),r=await s.invoke(extra);assert.equal(r.status,200);assert.equal((await r.json()).source.origin,'server_render');
 assert(s.calls.some(x=>x.url.includes('/rpc/crm_splav_zone_step')));assert(!s.calls.some(x=>/\/rpc\/crm_zone_(begin|finish|coordinator_begin)$/.test(x.url)));
 const human=server();assert.equal((await human.invoke(extra)).status,403);
});


test('provider diagnoses distinguish quota without persisting provider messages or unknown codes',async()=>{
 for(const [provider,expected] of [['quota','insufficient_quota'],['unknown-code','QUOTA_OR_RATE_LIMIT'],['oversize','QUOTA_OR_RATE_LIMIT']]){
  const s=server({provider});const result=await (await s.invoke()).json();
  assert.equal(result.provider_errors[0].diagnosis,expected);assert.equal(result.provider_errors[0].http_status,429);
  assert.equal(result.automatic_retry,false);assert(!JSON.stringify(result).includes('SECRET'));
  if(provider==='quota')assert.equal(result.provider_errors[0].retry_after_seconds,30);
 }
});
test('Gemini truncated output retains safe reason and prevents further provider dispatch',async()=>{
 const s=server({provider:false,fallback:true,geminiFailure:true});const result=await (await s.invoke()).json();
 assert.equal(result.code,'ZONE_RESULT_UNCERTAIN');assert.equal(result.provider_errors[1].diagnosis,'MAX_TOKENS');
 assert(!JSON.stringify(result).includes('SECRET'));assert(!s.calls.some(c=>c.url.includes('openrouter.ai')));
});


test('funded OpenRouter has priority when configured and an uncertain response never falls through',async()=>{
 for(const router of [true,'malformed']){
  const s=server({router,fallback:true});const response=await s.invoke();const result=await response.json();
  assert.equal(s.calls.filter(c=>c.url.includes('openrouter.ai')).length,1);
  assert(!s.calls.some(c=>c.url.includes('api.openai.com')||c.url.includes('generativelanguage')));
  assert.equal(router===true?result.source.provider:result.code,router===true?'OpenRouter':'ZONE_RESULT_UNCERTAIN');
 }
});
test('Gemini JSON excludes thought parts and is read without a second paid request',async()=>{
 const s=server({provider:false,fallback:true,geminiThoughts:true});const result=await (await s.invoke()).json();
 assert.equal(result.source.provider,'Gemini');assert(!JSON.stringify(result).includes('SECRET_THOUGHT'));
 assert.equal(s.calls.filter(c=>c.url.includes('generativelanguage')).length,1);
});


test('Gemini MAX_TOKENS is rejected even when its partial output happens to be valid JSON',async()=>{
 const s=server({provider:false,fallback:true,geminiFailure:'valid-json'});const response=await s.invoke(),result=await response.json();
 assert.equal(response.status,502);assert.equal(result.code,'ZONE_RESULT_UNCERTAIN');assert.equal(result.provider_errors[1].diagnosis,'MAX_TOKENS');
 assert(!s.calls.some(c=>c.url.includes('openrouter.ai')));
});


test('rank is never accepted as a VLK conclusion while real medical conclusions remain readable',()=>{
 for(const rank of ['сержант поліції','спеціальне звання сержант поліції','капітан','старший лейтенант']){
  assert.equal(contract.fieldValid('vlk_conclusion',rank),false);
  const old={key:'vlk_conclusion',raw_text:rank,value:rank,legibility:'clear'};const original=JSON.stringify(old),field=contract.projectField(old);
  assert.equal(field.value,null);assert.match(field.reason,/Звання не є/);assert.equal(JSON.stringify(old),original);
 }
 assert.equal(contract.fieldValid('vlk_conclusion','Придатний до військової служби'),true);
 assert.equal(contract.fieldValid('vlk_conclusion','сержант поліції, придатний до служби'),true);
 assert.match(contract.prompt('zone','Автобіографія друкована'),/special_rank/);
 assert.match(contract.prompt('zone','Автобіографія друкована'),/service_statement/);
});
test('partial source dates retain month/year without inventing a day, including old cached rows',()=>{
 for(const [raw,value,precision] of [['вересня 2019','2019-09','month'],['травень 2019','2019-05','month'],['2019','2019','year'],['2019-09','2019-09','month']]){
  const result=contract.projectField({key:'start_date',raw_text:raw,value:'2019-09-01',legibility:'clear'});
  assert.equal(result.value,null);assert.equal(result.partial_value,value);assert.equal(result.date_precision,precision);assert.equal(result.requires_review,true);
 }
 for(const raw of ['01 вересня 2019','2019-2023','травень','2019-13','2019-09-01'])assert.equal(contract.partialDate(raw),null,raw);
 const full=contract.projectField({key:'start_date',raw_text:'01.09.2019',value:'2019-09-01',legibility:'clear'});assert.equal(full.value,'2019-09-01');assert.equal(full.partial_value,undefined);
 const unclear=contract.projectField({key:'start_date',raw_text:'вересня 2019',value:'2019-09',legibility:'uncertain'});assert.equal(unclear.partial_value,undefined);
});

test('criminal responsibility is never accepted as marital status, including cached source text',()=>{
 const raw='Я та мої родичі до кримінальної відповідальності не притягувалися.';
 for(const value of [raw,'неодружена']){const f={key:'marital_status',raw_text:raw,value,legibility:'clear'},original=JSON.stringify(f),p=contract.projectField(f);assert.equal(p.value,null);assert.match(p.reason,/не є сімейним станом/);assert.equal(JSON.stringify(f),original);}
 assert.equal(contract.projectField({key:'marital_status',raw_text:'Незаміжня',value:'Незаміжня',legibility:'clear'}).value,'Незаміжня');
 const result=contract.result('zone',{rows:[{fields:[{key:'criminal_record_statement',raw_text:raw,value:raw,legibility:'clear'}]}]},{});assert.equal(result.rows[0].fields[0].value,raw);
 assert.match(contract.prompt('zone','Автобіографія друкована'),/military_registration_statement/);
});


test('replayed legacy receipts get semantic review without changing stored facts or calling a provider',async()=>{
 const cached={contract:'military-zones-1',review_only:true,mode:'zone',source:{page:1},rows:[{fields:[{key:'vlk_conclusion',raw_text:'сержант поліції',value:'сержант поліції',legibility:'clear'},{key:'start_date',raw_text:'вересня 2019',value:null,legibility:'clear'}]}]};
 const original=JSON.stringify(cached),s=server({ledger:'completed',cachedResult:cached}),result=await (await s.invoke()).json();
 assert.equal(result.request_replayed,true);assert.equal(result.rows[0].fields[0].value,null);assert.equal(result.rows[0].fields[1].partial_value,'2019-09');
 assert.equal(JSON.stringify(cached),original);assert(!s.calls.some(c=>c.url.includes('api.openai.com')||c.url.includes('openrouter.ai')));
});

test('native-only delegated lease is rejected by AI validation before any provider or receipt',async()=>{
 const s=server({processor:true,zoneLease:true,nativeOnly:true}),r=await s.invoke({job_id:'11111111-1111-1111-1111-111111111111',lease_token:'22222222-2222-2222-2222-222222222222',coordinator_id:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',coordinator_version:7});
 assert.equal(r.status,403);assert(!s.calls.some(c=>/api.openai.com|generativelanguage|openrouter.ai|crm_zone_begin/.test(c.url)));
});

test('graduation years preserve exact clear source years without inventing dates or choosing alternatives',()=>{
 for(const raw of ['2017','2017 року','у 2017 році','2017 р.'])for(const value of [null,'2017',2017]){const f={key:'graduation_year',raw_text:raw,value,legibility:'clear'},before=JSON.stringify(f),out=contract.projectField(f);assert.equal(out.value,'2017');assert.equal(out.requires_review,true);assert.equal(out.partial_value,undefined);assert.equal(out.raw_text,raw);assert.equal(JSON.stringify(f),before);assert.equal(contract.projectField(out).value,'2017');}
 for(const raw of ['2017-2021','вересня 2017','2017 або 2018','закінчив у 2017 році','2017<script>','17','2200'])assert.equal(contract.projectField({key:'graduation_year',raw_text:raw,value:'2017',legibility:'clear'}).value,null,raw);
 for(const legibility of ['uncertain','unreadable',undefined])assert.equal(contract.projectField({key:'graduation_year',raw_text:'2017',value:null,legibility}).value,null);
 const conflict=contract.projectField({key:'graduation_year',raw_text:'2017',value:'2018',legibility:'clear'});assert.equal(conflict.value,null);assert.match(conflict.reason,/відрізняється/);assert.equal(contract.projectField(conflict).value,null);assert(contract.projectField(conflict).alternatives.includes('2018'));
 const alternative=contract.projectField({key:'graduation_year',raw_text:'2017',value:null,legibility:'clear',alternatives:['2018']});assert.equal(alternative.value,null);assert.match(alternative.reason,/альтернативні/);
 for(const value of [{toString:'not callable'},false,[]]){const out=contract.projectField({key:'graduation_year',raw_text:'2017',value,legibility:'clear'});assert.equal(out.value,null);assert.equal(contract.projectField(out).value,null);}
 for(const alternatives of [[2018],[{}],[false]]){const out=contract.projectField({key:'graduation_year',raw_text:'2017',value:null,legibility:'clear',alternatives});assert.equal(out.value,null);assert.equal(contract.projectField(out).value,null);assert(out.alternatives.length);}
 assert.equal(contract.fieldValid('graduation_year','2017-01-01'),false);assert.equal(contract.fieldValid('graduation_year','2017'),true);
});
test('source precision accepts Ukrainian year suffixes but never extracts years from prose or ranges',()=>{
 for(const raw of ['2017 році','у 2017 році','в 2017 р.','2017 рік'])assert.equal(contract.partialDate(raw).partial_value,'2017');
 for(const raw of ['2017-2021 роки','з 2017 по 2021','У 2017 році закінчив школу','2017 2018'])assert.equal(contract.partialDate(raw),null);
 const out=contract.projectField({key:'start_date',raw_text:'у 2017 році',value:'2017-01-01',legibility:'clear'});assert.equal(out.value,null);assert.equal(out.partial_value,'2017');assert.equal(out.date_precision,'year');
});
test('legacy year projection is read only and does not call AI on cached receipt replay',async()=>{
 const cached={contract:'military-zones-2',review_only:true,mode:'zone',source:{page:1},rows:[{fields:[{key:'graduation_year',raw_text:'2017',value:null,legibility:'clear'}]}]};const before=JSON.stringify(cached),s=server({ledger:'completed',cachedResult:cached});const result=await (await s.invoke()).json();assert.equal(result.request_replayed,true);assert.equal(result.rows[0].fields[0].value,'2017');assert.equal(result.rows[0].fields[0].requires_review,true);assert.equal(JSON.stringify(cached),before);assert(!s.calls.some(c=>/api.openai.com|openrouter.ai|generativelanguage/.test(c.url)));
});
