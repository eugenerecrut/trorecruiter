const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{stripTypeScriptTypes}=require('node:module');
const source=fs.readFileSync(require('node:path').join(__dirname,'../supabase/functions/ai-extract-recommendation/index.ts'),'utf8');
function setup(role='recruiter',active=true){
 let handler;const calls=[],bodies=[];
 const c=vm.createContext({Response,Request,AbortController,setTimeout,clearTimeout,console:{error(){},warn(){}},withSupabase:(_,fn)=>fn,Deno:{env:{get:key=>({SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'test-public',GEMINI_API_KEY:'test-not-a-key'})[key]}},
 fetch:async(url,options)=>{calls.push(url);if(options?.body)bodies.push(JSON.parse(options.body));if(url.includes('/rest/v1/crm_staff?'))return Response.json(active?[{role}]:[]);return Response.json({candidates:[{content:{parts:[{text:'{}'}]}}]});}});
 vm.runInContext(stripTypeScriptTypes(source.replace(/^import .*\r?\n/gm,'').replace(/export default\s*\{/,'globalThis.endpoint = {')),c);handler=c.endpoint.fetch;
 return {calls,bodies,invoke:(body={text:'Тест'})=>handler(new Request('https://test',{method:'POST',headers:{Authorization:'Bearer test'},body:JSON.stringify(body)}),{userClaims:{sub:'u',email:'test@test.invalid'}})};
}
test('legacy text extractor denies processor and inactive caller before contacting provider',async()=>{
 for(const [role,active] of [['processor',true],['recruiter',false]]){
  const s=setup(role,active);assert.equal((await s.invoke()).status,403);assert.equal(s.calls.length,1);
 }
});
test('legacy text extractor preserves authenticated human processing',async()=>{const s=setup();assert.equal((await s.invoke()).status,200);assert.equal(s.calls.length,2);});


test('recommendation reads the original PDF even without local OCR text',async()=>{
 const s=setup(),r=await s.invoke({text:'',file_base64:'JVBERi0=',mime_type:'application/pdf'});
 assert.equal(r.status,200);assert.equal(s.bodies[0].contents[0].parts[1].inlineData.data,'JVBERi0=');
 assert.equal(s.bodies[0].contents[0].parts[1].inlineData.mimeType,'application/pdf');
});
test('invalid recommendation file is rejected before provider',async()=>{
 for(const body of [{text:''},{file_base64:'bad!',mime_type:'application/pdf'},{file_base64:'JVBERi0=',mime_type:'text/html'}]){
  const s=setup();assert.equal((await s.invoke(body)).status,400);assert.equal(s.calls.length,1);
 }
});
