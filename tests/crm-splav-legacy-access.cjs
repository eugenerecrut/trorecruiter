const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{stripTypeScriptTypes}=require('node:module');
const source=fs.readFileSync(require('node:path').join(__dirname,'../supabase/functions/ai-extract-recommendation/index.ts'),'utf8');
function setup(role='recruiter',active=true){
 let handler;const calls=[];
 const c=vm.createContext({Response,Request,console:{error(){}},withSupabase:(_,fn)=>fn,Deno:{env:{get:key=>({SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'test-public',GEMINI_API_KEY:'test-not-a-key'})[key]}},
 fetch:async(url)=>{calls.push(url);if(url.includes('/rest/v1/crm_staff?'))return Response.json(active?[{role}]:[]);return Response.json({candidates:[{content:{parts:[{text:'{}'}]}}]});}});
 vm.runInContext(stripTypeScriptTypes(source.replace(/^import .*\r?\n/gm,'').replace('export default {','globalThis.endpoint = {')),c);handler=c.endpoint.fetch;
 return {calls,invoke:()=>handler(new Request('https://test',{method:'POST',headers:{Authorization:'Bearer test'},body:JSON.stringify({text:'Тест'})}),{userClaims:{sub:'u',email:'test@test.invalid'}})};
}
test('legacy text extractor denies processor and inactive caller before contacting provider',async()=>{
 for(const [role,active] of [['processor',true],['recruiter',false]]){
  const s=setup(role,active);assert.equal((await s.invoke()).status,403);assert.equal(s.calls.length,1);
 }
});
test('legacy text extractor preserves authenticated human processing',async()=>{const s=setup();assert.equal((await s.invoke()).status,200);assert.equal(s.calls.length,2);});
