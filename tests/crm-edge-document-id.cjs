const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{stripTypeScriptTypes}=require('node:module');
const source=fs.readFileSync(require('node:path').join(__dirname,'../supabase/functions/ai-classify-document/index.ts'),'utf8');
const id='00000000-0000-4000-8000-000000000001',owner='00000000-0000-4000-8000-000000000002',backend='https://test.supabase.co';
async function run(options={}){
 const calls=[];let handler;
 const fetch=async(url,init={})=>{calls.push({url,init});const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{'content-type':'application/json'}});
  if(url.endsWith('/auth/v1/user'))return json({id:'u'});
  if(url.includes('/crm_staff?'))return json(options.inactive?[]:[{user_id:'u'}]);
  if(url.includes('/documents?id='))return json(options.hidden?[]:[{id,candidate_id:owner,storage_path:options.badPath||owner+'/incoming/test.pdf',file_name:'test.pdf',mime_type:'application/pdf',version_group_id:id,version_number:1,deleted_at:options.deleted?'2026-01-01':null}]);
  if(url.includes('/documents?version_group_id='))return json(options.archived?[{id:'new'}]:[]);
  if(url.includes('/storage/v1/object/sign/'))return init.method==='POST'?json({signedURL:'/object/sign/candidate-documents/'+owner+'/incoming/test.pdf?token=test'}):new Response('%PDF-test',{headers:{'content-type':'application/pdf'}});
  if(url==='https://api.openai.com/v1/responses')return json({output:[{content:[{type:'output_text',text:JSON.stringify({document_type:'Рекомендаційний лист',candidate_name:'Тестенко Іван',confidence:0.99,extracted:{full_name:'Тестенко Іван'},warnings:[]})}]}]});
  throw Error('Unexpected test fetch: '+url);
 };
 const c=vm.createContext({Response,Request,Headers,URL,AbortController,setTimeout,clearTimeout,Uint8Array,TextEncoder,btoa,console:{log(){},error(){}},fetch,Deno:{env:{get:k=>({SUPABASE_URL:backend,SUPABASE_ANON_KEY:'public-test-key',OPENAI_API_KEY:'fake-test-key'})[k]},serve:fn=>handler=fn}});
 vm.runInContext(stripTypeScriptTypes(source),c);
 const response=await handler(new Request(backend,{method:'POST',headers:{Authorization:'Bearer fake-session','content-type':'application/json'},body:JSON.stringify({document_id:id,file_url:'https://untrusted.test/file',text:'Untrusted OCR',...options.body})}));
 return {response,data:await response.json(),calls};
}
test('document-ID route resolves file through caller RLS and signed Storage URL',async()=>{
 const r=await run();assert.equal(r.response.status,200);assert.equal(r.data.extracted.full_name,'Тестенко Іван');
 const metadata=r.calls.find(c=>c.url.includes('/documents?id='));assert.equal(metadata.init.headers.Authorization,'Bearer fake-session');
 assert(r.calls.some(c=>c.init.method==='POST'&&c.url.includes('/object/sign/')));assert(!r.calls.some(c=>c.url.includes('untrusted.test')));
 const request=JSON.parse(r.calls.find(c=>c.url.includes('api.openai.com')).init.body);assert(!JSON.stringify(request).includes('Untrusted OCR'));
});
test('inactive user, hidden, deleted, old version and unsafe paths never reach AI',async()=>{
 for(const [options,status] of [[{inactive:true},403],[{hidden:true},404],[{deleted:true},404],[{archived:true},409],[{badPath:owner+'/../other'},400],[{body:{document_id:'bad'}},400]]){
  const r=await run(options);assert.equal(r.response.status,status);assert(!r.calls.some(c=>c.url.includes('api.openai.com')));
 }
});
