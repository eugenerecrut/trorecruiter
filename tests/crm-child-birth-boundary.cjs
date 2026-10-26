const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
require('../supabase/functions/_shared/document-data-policy.js');
const sync=require('../document-ai-sync.js'),policy=globalThis.CRMDocumentPolicy;
const crosscheck=require('../document-crosscheck.js');
const childTypes=['Копія свідоцтва про народження дітей','Свідоцтво про народження дитини','Копія Свідоцтва про народження (дитини)'];
const candidate=()=>({id:'c1',full_name:'Тестенко Іван Петрович',rnokpp:'1234567890',profile_data:{}});
const doc=type=>({id:'d1',candidate_id:'c1',document_type:type,ai_confidence:0.99,ai_extracted:{full_name:'Тестенко Іван Петрович',rnokpp:'1234567890',birth_place:'Місце народження дитини',document_number:'child-number'}});
test('child birth titles are recognized in each source hint without rewriting inputs',()=>{
 for(const type of childTypes)for(const key of ['document_type','ai_document_type','requirement_type']){
  const d={document_type:'Свідоцтво про народження',[key]:type},before=JSON.stringify(d);
  assert.equal(policy.isChildBirth(d),true);assert.equal(JSON.stringify(d),before);
 }
 for(const document_type of ['Свідоцтво про народження','Копія паспорта','Документи про освіту дитини','Посвідчення водія'])assert.equal(policy.isChildBirth({document_type}),false);
});
test('child source cannot populate candidate identity even with matching parent identifiers',()=>{
 for(const type of childTypes)for(const variant of [{document_type:type},{document_type:type,ai_document_type:'Свідоцтво про народження'},{document_type:'Свідоцтво про народження',requirement_type:type}]){
  const d={...doc(type),...variant},c=candidate(),before=JSON.stringify({d,c}),p=sync.plan(d,c);
  assert.equal(p.supported,false);assert.equal(p.selections.length,0);assert.equal(JSON.stringify({d,c}),before);
 }
 const c=candidate(),own=sync.plan(doc('Свідоцтво про народження'),c);assert.equal(own.supported,true);assert(own.selections.some(s=>s.key==='birth_place'));
});
function legacyFixture(d){
 const c=candidate(),nodes=new Map(),dialog={innerHTML:'',prepend(){},addEventListener(){},showModal(){},querySelectorAll(){return []},querySelector(key){if(key==='[data-apply]'&&!this.innerHTML.includes('data-apply'))return null;if(key==='[data-select-empty]'&&!this.innerHTML.includes('data-select-empty'))return null;if(!nodes.has(key))nodes.set(key,{});return nodes.get(key);}};
 const context={structuredClone,docEscape:String,CRMPhone:{normalize:v=>v},identityDocumentTypeValue:()=> 'birth',CRMDocumentSync:{plan:()=>({supported:false})},CRMResponsibility:{ready:async()=>{},documentInfo:()=>'',bindHistory(){}},CRMWorkflow:{readOnly:()=>false},document:{createElement:()=>dialog,body:{append(){}}}};
 for(const name of ['CRMBiography','CRMVLK','CRMWork','CRMEducation','CRMResidence','CRMMilitary','CRMNameHistory'])context[name]={isDocument:()=>false};
 context.supabaseClient={from(table){const q={select(){return q},eq(){return q},gt(){return q},single:async()=>({data:table==='documents'?d:c}),maybeSingle:async()=>({data:{}}),limit:async()=>({data:[]})};return q;}};
 context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../supabase/functions/_shared/document-data-policy.js'),'utf8'),context);
 const source=fs.readFileSync(path.join(__dirname,'../documents.js'),'utf8');const run=vm.runInContext('('+source.slice(source.indexOf('async function reviewDocumentData(id){'),source.indexOf('\nfunction versionHistory('))+')',context);
 return {run,dialog};
}
test('legacy fallback displays the child container without offering transfer fields',async()=>{
 for(const type of childTypes){const f=legacyFixture({...doc(type),version_group_id:'g',version_number:1});await f.run('d1');assert(!f.dialog.innerHTML.includes('data-change='));assert(f.dialog.innerHTML.includes('Контейнер документа'));}
});
test('child certificates cannot corroborate candidate facts, including without the optional policy module',()=>{
 const c=candidate(),own={...doc('Свідоцтво про народження'),id:'own',storage_path:'own.pdf'},child={...doc('Свідоцтво про народження дитини'),storage_path:'child.pdf',ai_document_type:'Свідоцтво про народження'};
 const before=JSON.stringify({c,own,child});
 for(const withoutPolicy of [false,true]){
  if(withoutPolicy)delete globalThis.CRMDocumentPolicy;
  try{const field=crosscheck.compare([own,child],c).find(f=>f.key==='birth_place');assert.equal(field.sources.length,1);assert.equal(field.sources[0].document_id,'own');assert.equal(sync.plan(child,c).selections.length,0);}
  finally{globalThis.CRMDocumentPolicy=policy;}
 }
 assert.equal(JSON.stringify({c,own,child}),before);
});
test('birth-source links after name changes exclude child certificates in singular and plural',async()=>{
 const documents=[{...doc('Свідоцтво про народження'),file_name:'own.pdf'},...childTypes.map((type,i)=>({...doc(type),id:'child'+i,file_name:'child'+i+'.pdf'}))];
 const dialog={innerHTML:'',showModal(){},querySelector(){return {}},querySelectorAll(){return []}};
 const context={structuredClone,CRMResponsibility:{latest:x=>x},CRMWorkspace:{escape:String},getCandidateDocuments:async()=>documents,document:{createElement:()=>dialog,body:{append(){}}}};
 context.window=context;vm.createContext(context);
 for(const file of ['supabase/functions/_shared/document-data-policy.js','name-change-document.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context);
 await context.CRMNameHistory.birthLinks('c1');assert(dialog.innerHTML.includes('own.pdf'));assert(!dialog.innerHTML.includes('child0.pdf'));assert(!dialog.innerHTML.includes('child1.pdf'));assert(!dialog.innerHTML.includes('child2.pdf'));
});
