const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{stripTypeScriptTypes}=require('node:module');
const contract=require('../supabase/functions/_shared/military-zone.js');
test('zones reject invalid coordinates, clamp floating point edges, preserve glossary without VOS invention',()=>{
 for(const b of [{x:-1,y:0,w:1,h:1},{x:0,y:0,w:0,h:1},{x:0,y:0,w:2,h:1},{x:0,y:NaN,w:1,h:1}])assert.equal(contract.box(b),null);
 assert.equal(contract.box({x:.1,y:0,w:.9005,h:1}).w,.9);assert.match(contract.prompt('zone'),/ВОС не визначай/);assert.match(contract.prompt('overview'),/цілі рядки/);
});
test('review output strips candidate merge fields and never accepts uncertain values as facts',()=>{
 const out=contract.result('zone',{full_name:'DO NOT MERGE',extracted:{military_specialty:'123456А'},raw_text:'Наказ 18?',rows:[{fields:[{key:'order_number',raw_text:'18?',value:'182',legibility:'uncertain',alternatives:['182','192']},{key:'position',raw_text:'оператор',value:'оператор',legibility:'clear'},{key:'military_specialty',value:'123456А',legibility:'clear'},{key:'full_name',value:'DO NOT MERGE'}]}]}, {page:3});
 assert.equal(contract.fieldValid('military_specialty','4900347 А'),false);assert.equal(contract.fieldValid('start_date','11.07.16'),false);assert.equal(contract.fieldValid('start_date','2024-02-30'),false);assert.equal(contract.fieldValid('military_specialty','216182А'),true);
 assert.equal(out.review_only,true);assert.equal(out.requires_review,true);assert.equal(out.full_name,undefined);assert.equal(out.extracted,undefined);assert.equal(out.rows[0].fields.length,3);assert.equal(out.rows[0].fields[0].value,null);assert.equal(out.rows[0].fields[1].value,'оператор');assert.equal(out.rows[0].fields[2].value,null);assert(out.rows[0].fields.every(f=>f.requires_review));
});
function server({auth=true,staff=true,doc=true,type='Копія військового квитка',newer=false,provider=true}={}){
 let handler;const calls=[];
 const context={globalThis:null,Response,Request,AbortController,setTimeout,clearTimeout,atob,btoa,console,CRMMilitaryZoneContract:contract,Deno:{env:{get:k=>({SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'publishable-test',OPENAI_API_KEY:'unit-test-not-a-real-key'}[k])},serve:fn=>handler=fn},fetch:async(url,init={})=>{
  calls.push({url,method:init.method||'GET'});
  if(url.endsWith('/auth/v1/user'))return Response.json({id:'user'},{status:auth?200:401});
  if(url.includes('crm_staff?'))return Response.json(staff?[{user_id:'user'}]:[]);
  if(url.includes('version_number=gt.'))return Response.json(newer?[{id:'new'}]:[]);
  if(url.includes('/rpc/crm_military_zone_examples'))return Response.json([]);
  if(url.includes('/documents?'))return Response.json(doc?[{id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',candidate_id:'c',storage_path:'c/original.pdf',document_type:type,version_group_id:'g',version_number:1}]:[]);
  if(url.includes('api.openai.com'))return provider?Response.json({output:[{content:[{text:JSON.stringify({raw_text:'оператор',rows:[]})}]}]}):Response.json({error:'not available'},{status:429});
  throw Error('Unexpected request '+url);
 }};context.globalThis=context;vm.createContext(context);
 let source=fs.readFileSync(path.join(__dirname,'../supabase/functions/ai-military-zone/index.ts'),'utf8').replace("import '../_shared/military-zone.js';",'');source=stripTypeScriptTypes(source);vm.runInContext(source,context);
 const body={document_id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',mode:'zone',page:1,box:{x:0,y:0,w:1,h:1},image_data:'data:image/jpeg;base64,/9g='};
 return {calls,invoke:extra=>handler(new Request('https://test/zone',{method:'POST',headers:{Authorization:'Bearer test'},body:JSON.stringify({...body,...extra})}))};
}
test('edge requires authentication, active staff, accessible military document and latest version',async()=>{
 for(const [opts,status] of [[{auth:false},401],[{staff:false},403],[{doc:false},404],[{type:'Копія паспорта'},400],[{newer:true},409]]){const s=server(opts),r=await s.invoke();assert.equal(r.status,status);assert(!s.calls.some(x=>x.url.includes('api.openai.com')));}
});
test('edge rejects malformed page, image and box without AI calls',async()=>{
 for(const extra of [{page:0},{mode:'merge'},{box:{x:0,y:0,w:0,h:1}},{image_data:'data:image/jpeg;base64,YWJj'},{image_data:'https://external.invalid/doc'}]){const s=server(),r=await s.invoke(extra);assert.equal(r.status,400);assert(!s.calls.some(x=>x.url.includes('api.openai.com')));}
});
test('edge returns read-only result, uses only GET against database, and reports provider failures safely',async()=>{
 const s=server(),r=await s.invoke(),out=await r.json();assert.equal(r.status,200);assert.equal(out.review_only,true);assert.equal(out.source.page,1);assert.equal(out.source.document_id,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');assert(s.calls.filter(x=>x.url.includes('/rest/')).every(x=>x.method==='GET'));
 const fail=await server({provider:false}).invoke();assert.equal(fail.status,502);assert(!JSON.stringify(await fail.json()).includes('unit-test-not-a-real-key'));
});
