const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{stripTypeScriptTypes}=require('node:module');
const source=fs.readFileSync(require('node:path').join(__dirname,'../supabase/functions/ai-classify-document/index.ts'),'utf8');
const id='00000000-0000-4000-8000-000000000001',owner='00000000-0000-4000-8000-000000000002',backend='https://test.supabase.co';
async function run(options={}){
 const calls=[];let handler,providerCalls=0;
 const fetch=async(url,init={})=>{calls.push({url,init});const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{'content-type':'application/json'}});
  if(url.endsWith('/auth/v1/user'))return json({id:'u'});
  if(url.includes('/crm_staff?'))return json(options.inactive?[]:[{user_id:'u',role:options.processor?'processor':'recruiter'}]);
  if(url.endsWith('/rpc/crm_splav_validate'))return json({document_id:id,stage:options.alreadyStarted?'provider_started':'waiting'});
  if(url.endsWith('/rpc/crm_splav_start_provider'))return options.receiptDenied?json({error:'already consumed'},409):json('00000000-0000-4000-8000-000000000003');
  if(url.includes('/documents?id='))return json(options.hidden?[]:[{id,candidate_id:owner,storage_path:options.badPath||owner+'/incoming/test.pdf',file_name:'test.pdf',mime_type:'application/pdf',version_group_id:id,version_number:1,deleted_at:options.deleted?'2026-01-01':null}]);
  if(url.includes('/documents?version_group_id='))return json(options.archived?[{id:'new'}]:[]);
  if(url.includes('/storage/v1/object/sign/'))return init.method==='POST'?json({signedURL:'/object/sign/candidate-documents/'+owner+'/incoming/test.pdf?token=test'}):new Response(options.large||options.bytes?new Uint8Array(options.bytes||18149553):'%PDF-test',{headers:{'content-type':'application/pdf'}});
  if(url==='https://openrouter.ai/api/v1/chat/completions'){providerCalls++;if(providerCalls===1)return json({error:{message:'response_format unsupported'}},400);return json({model:'openai/gpt-4.1-mini',choices:[{message:{content:JSON.stringify({document_type:'Рекомендаційний лист',confidence:1,extracted:{full_name:'Тестенко Іван'}})}}]});}
  if(url.includes('generativelanguage.googleapis.com')){providerCalls++;return json({candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'{"SECRET_THOUGHT":true}'},{text:JSON.stringify({document_type:'Рекомендаційний лист',confidence:1,extracted:{full_name:'Тестенко Іван'}})}]}}]});}
  if(url==='https://api.openai.com/v1/responses'){providerCalls++;if(options.failProvider||options.failSecondPart&&providerCalls>1)return json({error:{message:'temporary overload'}},503);return json({output:[{content:[{type:'output_text',text:JSON.stringify({document_type:'Рекомендаційний лист',candidate_name:'Тестенко Іван',confidence:0.99,extracted:{full_name:'Тестенко Іван'},warnings:[]})}]}]});}
  throw Error('Unexpected test fetch: '+url);
 };
 const c=vm.createContext({Response,Request,Headers,URL,AbortController,setTimeout,clearTimeout,Uint8Array,TextEncoder,btoa,console:{log(){},error(){}},fetch,Deno:{env:{get:k=>({SUPABASE_URL:backend,SUPABASE_ANON_KEY:'public-test-key',OPENAI_API_KEY:options.gemini||(options.router&&!options.allProviders)?'':'fake-test-key',GEMINI_API_KEY:options.gemini?'fake-gemini':'',OPENROUTER_API_KEY:options.router?'fake-router-key':''})[k]},serve:fn=>handler=fn}});
 c.CRMPDFAIParts={prepare:async()=>({pages:2,parts:[{bytes:new Uint8Array(10),start:1,end:1},{bytes:new Uint8Array(10),start:2,end:2}]}),merge:require('../supabase/functions/_shared/pdf-ai-parts.js').merge};c.PDFDocumentMock={};vm.runInContext(stripTypeScriptTypes(source.replace("await import('../_shared/pdf-ai-parts.js');",'').replace("await import('npm:pdf-lib@1.17.1')",'({PDFDocument:PDFDocumentMock})')),c);
 const response=await handler(new Request(backend,{method:'POST',headers:{Authorization:'Bearer fake-session','content-type':'application/json'},body:JSON.stringify({document_id:id,file_url:'https://untrusted.test/file',text:'Untrusted OCR',...options.body})}));
 return {response,data:await response.json(),calls};
}
test('document-ID route resolves file through caller RLS and signed Storage URL',async()=>{
 const r=await run();assert.equal(r.response.status,200);assert.equal(r.data.extracted.full_name,'Тестенко Іван');
 const metadata=r.calls.find(c=>c.url.includes('/documents?id='));assert.equal(metadata.init.headers.Authorization,'Bearer fake-session');
 assert(r.calls.some(c=>c.init.method==='POST'&&c.url.includes('/object/sign/')));assert(!r.calls.some(c=>c.url.includes('untrusted.test')));
 const request=JSON.parse(r.calls.find(c=>c.url.includes('api.openai.com')).init.body);assert(!JSON.stringify(request).includes('Untrusted OCR'));
});
test('inactive user, processor, hidden, deleted, old version and unsafe paths never reach AI',async()=>{
 for(const [options,status] of [[{inactive:true},403],[{processor:true},403],[{hidden:true},404],[{deleted:true},404],[{archived:true},409],[{badPath:owner+'/../other'},400],[{body:{document_id:'bad'}},400]]){
  const r=await run(options);assert.equal(r.response.status,status);assert(!r.calls.some(c=>c.url.includes('api.openai.com')));
 }
});

test('large PDF route processes every part and records original page coverage without DB writes',async()=>{const r=await run({large:true});assert.equal(r.response.status,200);assert.equal(r.data.pdf_processing.total_pages,2);assert.equal(r.data.pdf_processing.parts,2);assert.equal(r.data.pdf_parts[1].start,2);assert(!r.calls.some(c=>c.url.includes('/rest/v1/')&&c.init.method==='PATCH'));assert.equal(r.calls.filter(c=>c.url==='https://api.openai.com/v1/responses').length,2)});
test('12.9 MB PDF uses bounded parts before constructing provider payloads',async()=>{const r=await run({bytes:12924216});assert.equal(r.response.status,200);assert.equal(r.data.pdf_processing.original_bytes,12924216);assert.equal(r.data.pdf_processing.complete,true);const calls=r.calls.filter(c=>c.url==='https://api.openai.com/v1/responses');assert.equal(calls.length,2);assert(calls.every(c=>c.init.body.length<100000));});
test('temporary failure is retried once; unfinished parts never return partial success',async()=>{const r=await run({large:true,failSecondPart:true});assert.equal(r.response.status,502);assert.equal(r.data.extracted,undefined);assert.equal(r.calls.filter(c=>c.url==='https://api.openai.com/v1/responses').length,3)});

const queueBody={job_id:'00000000-0000-4000-8000-000000000010',lease_token:'00000000-0000-4000-8000-000000000011'};
test('leased classifier consumes exactly one receipt even when processing multiple PDF parts',async()=>{const r=await run({processor:true,large:true,body:queueBody});assert.equal(r.response.status,200);assert.equal(r.data.provider_receipt,'00000000-0000-4000-8000-000000000003');assert.equal(r.calls.filter(c=>c.url.endsWith('/rpc/crm_splav_start_provider')).length,1);assert.equal(r.calls.filter(c=>c.url==='https://api.openai.com/v1/responses').length,2);});
test('a lost dispatch race never reaches a model or returns a persistence receipt',async()=>{const r=await run({processor:true,receiptDenied:true,body:queueBody});assert.equal(r.response.status,409);assert.equal(r.data.code,'SPLAV_DISPATCH_UNCERTAIN');assert.equal(r.data.provider_receipt,undefined);assert(!r.calls.some(c=>c.url.includes('api.openai.com')));});
test('source validation fails before consuming a paid execution receipt',async()=>{for(const options of [{hidden:true},{alreadyStarted:true}]){const r=await run({processor:true,...options,body:queueBody});assert([403,404].includes(r.response.status));assert(!r.calls.some(c=>c.url.endsWith('/rpc/crm_splav_start_provider')));assert(!r.calls.some(c=>c.url.includes('api.openai.com')));}});


test('request-local metrics count actual HTTP compatibility retry separately from provider attempts',async()=>{
 const r=await run({router:true}),m=r.data.processing_metrics;assert.equal(r.response.status,200);assert.equal(m.version,1);assert.equal(m.provider_attempts,1);assert.equal(m.http_requests,2);assert.equal(m.parsed_results,1);assert.deepEqual(m.attempts.map(a=>a.http_status),[400,200]);assert.equal(m.attempts[1].response_parsed,true);assert.equal(m.billing_status,'not_collected');assert(!JSON.stringify(m).includes('fake-router-key'));assert(!JSON.stringify(m).includes('Тестенко'));assert(!JSON.stringify(m).includes('token=test'));
});
test('large PDFs aggregate metrics across all parts, errors retain metrics without partial OCR',async()=>{
 const good=await run({large:true}),m=good.data.processing_metrics;assert.equal(m.http_requests,2);assert.equal(m.provider_attempts,2);assert.equal(m.parsed_results,2);
 const failed=await run({large:true,failSecondPart:true});assert.equal(failed.response.status,502);assert.equal(failed.data.processing_metrics.http_requests,3);assert.equal(failed.data.processing_metrics.parsed_results,1);assert(!failed.data.extracted);
});
test('concurrent classifier executions keep counters and authorization isolated',async()=>{
 const [a,b]=await Promise.all([run({router:true}),run()]);assert.equal(a.data.processing_metrics.http_requests,2);assert.equal(b.data.processing_metrics.http_requests,1);assert.equal(a.data.processing_metrics.attempts[0].provider,'OpenRouter');assert.equal(b.data.processing_metrics.attempts[0].provider,'OpenAI');
});


test('root classifier selects configured OpenRouter before direct OpenAI',async()=>{
 const r=await run({router:true,allProviders:true});assert.equal(r.response.status,200);
 assert(!r.calls.some(c=>c.url.includes('api.openai.com')));assert(r.calls.some(c=>c.url.includes('openrouter.ai')));
});
test('root classifier reads only Gemini final text, excluding thought summaries',async()=>{
 const r=await run({gemini:true});assert.equal(r.response.status,200);assert.equal(r.data.extracted.full_name,'Тестенко Іван');
 assert(!JSON.stringify(r.data).includes('SECRET_THOUGHT'));
 assert.equal(r.calls.filter(c=>c.url.includes('generativelanguage')).length,1);
});
