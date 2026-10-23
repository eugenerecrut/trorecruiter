const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(){
 const calls=[],review={open:async(doc,options)=>calls.push({doc,options})};
 const context={document:{readyState:'loading',addEventListener(){}},window:{CRMMilitaryZoneReview:review,CRMMilitaryZoneContract:{family:type=>type==='Автобіографія'}},
  CRMMilitaryZoneReview:review,CRMWorkspace:{busy:false}};
 vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../documents.js'),'utf8'),context);
 return {context,calls};
}
test('manual entry is limited to an available AI-enabled supported source and escapes the ID',()=>{
 const {context:c}=setup(),doc={id:'x"<',document_type:'Автобіографія',storage_path:'file.pdf'};
 assert.match(c.manualZoneButtonHtml(doc),/data-doc-zone-manual="x&quot;&lt;"/);
 assert.equal(c.manualZoneButtonHtml(doc,{ai_enabled:false}),'');
 assert.equal(c.manualZoneButtonHtml({...doc,deleted_at:'now'}),'');
 assert.equal(c.manualZoneButtonHtml({...doc,storage_path:null}),'');
 assert.equal(c.manualZoneButtonHtml({...doc,document_type:'Додаток 13'}),'');
});
test('manual entry saves workspace first and never enables autostart',async()=>{
 const {context:c,calls}=setup(),doc={id:'d'};let saved=0;
 await c.openManualZoneDocument('d',[doc],async()=>{saved++;return true;});
 assert.equal(saved,1);assert.equal(calls.length,1);assert.equal(calls[0].options.autostart,false);
 await c.openManualZoneDocument('d',[doc],async()=>false);assert.equal(calls.length,1);
 c.CRMWorkspace.busy=true;await c.openManualZoneDocument('d',[doc],async()=>{throw Error('should not save');});assert.equal(calls.length,1);
});
test('the real reader gates primary OCR on autostart and provides the original with a verified hash',()=>{
 const source=fs.readFileSync(require.resolve('../military-zone-review.js'),'utf8');
 assert.match(source,/if\(autostart&&\(!doc.ai_extracted\|\|doc.processing_status==='AI помилка'\)\)/);
 assert.match(source,/crypto.subtle.digest\('SHA-256',originalBytes\)/);
 assert.match(source,/originalLink.download=doc.file_name/);
 assert.match(source,/URL.revokeObjectURL\(originalURL\)/);
});
