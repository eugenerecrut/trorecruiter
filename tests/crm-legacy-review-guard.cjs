const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const text=fs.readFileSync(require('node:path').join(__dirname,'../documents.js'),'utf8');
const source=text.slice(text.indexOf('async function reviewDocumentData(id){'),text.indexOf('\nfunction versionHistory('));
function harness(doc,{error=null,supported=false}={}){
 const calls={tables:[],plan:0,preview:0};
 const client={from(table){calls.tables.push(table);if(table!=='documents')throw Error('Unexpected candidate read');const q={select(){return q},eq(){return q},single:async()=>({data:doc,error})};return q;}};
 const context={supabaseClient:client,CRMDocumentSync:{plan(){calls.plan++;return {supported}},async showPreview(_client,id){calls.preview++;return {id}}}};
 return {calls,run:vm.runInNewContext('('+source+')',context)};
}
test('failed and unfinished OCR cannot reach legacy review or candidate reads',async()=>{
 for(const processing_status of ['AI обробка','AI помилка'])for(const document_type of ['Свідоцтво про зміну імені / прізвища','Копія свідоцтва про розірвання шлюбу','Паспорт громадянина України']){
  const d={id:'d1',candidate_id:'c1',processing_status,document_type,verification_status:'Підтверджено',ai_extracted:{full_name:'Старе ПІБ'}},before=JSON.stringify(d),h=harness(d);
  await assert.rejects(h.run('d1'),/Розпізнавання не завершено/);
  assert.deepEqual(h.calls.tables,['documents']);assert.equal(h.calls.plan,0);assert.equal(h.calls.preview,0);assert.equal(JSON.stringify(d),before);
 }
});
test('successful source still uses the shared preview and read errors propagate',async()=>{
 const h=harness({id:'d1',processing_status:'AI оброблено'},{supported:true});
 assert.equal((await h.run('d1')).id,'d1');assert.equal(h.calls.preview,1);assert.deepEqual(h.calls.tables,['documents']);
 const error=Error('Read failed'),failed=harness(null,{error});await assert.rejects(failed.run('d1'),error);assert.equal(failed.calls.plan,0);
});
