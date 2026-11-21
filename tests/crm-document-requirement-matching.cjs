const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
function setup(){const c=vm.createContext({window:{},Intl,Date});for(const f of ['candidate-conditions.js','document-presence.js','document-state.js'])vm.runInContext(read(f),c);return c.window.CRMDocumentState;}
const requirements=[
 {id:'own',document_type:'Свідоцтво про народження',is_required:true},
 {id:'children',document_type:'Копія свідоцтва про народження дітей',is_required:true,condition_field:'has_children',condition_value:'true'},
 {id:'residence',document_type:'Довідка про місце проживання / Витяг про місце проживання (ДІЯ)',is_required:true}
];
const candidate={has_children:true,children_count:1,profile_data:{service_type:'За контрактом'}};
test('own birth acts satisfy the candidate requirement, never a child requirement',()=>{
 const api=setup();
 for(const type of ['Свідоцтво про народження','Актовий запис про народження','Витяг про народження']){
  const d={id:'own-file',document_type:type};
  assert.equal(api.match(requirements[0],d),true,type);assert.equal(api.match(requirements[1],d),false,type);
  assert.equal(api.match(requirements[1],{...d,requirement_id:'children'}),false,'stale binding is not child evidence');
 }
});
test('explicit child hints prevent an own-birth match even when AI drops the child qualifier',()=>{
 const api=setup();
 for(const key of ['document_type','document_name','ai_document_type','requirement_type']){
  const d={id:'child-file',document_type:'Актовий запис про народження',ai_document_type:'Свідоцтво про народження',[key]:'Свідоцтво про народження дитини'};
  assert.equal(api.match(requirements[0],d),false,key);assert.equal(api.match(requirements[1],d),true,key);
 }
 assert.equal(api.match(requirements[1],{id:'untyped',requirement_id:'children',document_type:'Обробка AI'}),true);
});
test('two own copies do not falsely complete a child requirement or disappear for a childless candidate',()=>{
 const api=setup(),docs=['copy-a','copy-b'].map(id=>({id,document_type:'Актовий запис про народження',verification_status:'Підтверджено',storage_path:id+'.pdf'}));
 const before=JSON.stringify({candidate,requirements,docs});
 const model=api.summary(candidate,requirements,docs);
 assert.equal(model.rows.find(r=>r.r.id==='own').files.length,2);
 assert.equal(model.rows.find(r=>r.r.id==='children').received,false);
 assert.equal(api.scope({...candidate,has_children:false},requirements,docs).excluded.length,0);
 assert.equal(JSON.stringify({candidate,requirements,docs}),before);
});
test('display rows reuse semantic matches once and preserve separate file IDs with equal names',()=>{
 const api=setup(),docs=[
  {id:'a',file_name:'same.pdf',document_type:'Актовий запис про народження'},
  {id:'b',file_name:'same.pdf',document_type:'Актовий запис про народження'},
  {id:'r',document_type:'Витяг/довідка про зареєстроване місце проживання'},
  {id:'extra',document_type:'Інший документ',ai_extracted:{full_name:'Приклад Іван Петрович'}}
 ];
 const before=JSON.stringify(docs),model=api.displayRows(candidate,requirements,docs),ids=model.flatMap(r=>r.files.map(d=>d.id));
 assert.deepEqual(Array.from(ids).sort(),['a','b','extra','r']);
 assert.equal(model.filter(r=>r.files.some(d=>d.id==='r')).length,1);
 assert.equal(model.find(r=>r.files.some(d=>d.id==='extra')).r.ai_enabled,true);
 assert.equal(JSON.stringify(docs),before);
 assert.match(read('documents.js'),/const rows=CRMDocumentState\.displayRows\(c,reqs,docs\)/);
});
test('excluded and deleted sources are not reintroduced by display rows',()=>{
 const api=setup(),req=[{id:'children',document_type:'Копія свідоцтва про народження дітей',condition_field:'has_children'}];
 const docs=[{id:'child',document_type:'Свідоцтво про народження дитини'},{id:'deleted',document_type:'Інший документ',deleted_at:'2026-01-01'}];
 assert.equal(api.displayRows({...candidate,has_children:false},req,docs).flatMap(r=>r.files).length,0);
});
