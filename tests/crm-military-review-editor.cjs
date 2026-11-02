const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../document-review-editor.js'),'utf8');
test('manual military correction keeps page numeric and does not change original or unrelated evidence',()=>{
 const start=source.indexOf('      const extracted=structuredClone(e);'),end=source.indexOf('      if(!documentType)',start);
 const e={military_rank:null,military_oath:{page:null,unit:null},military_service_records:[{unit:'52170',page:null,requires_review:true}],_crm_review_decisions:[{key:'tcc'}]},before=JSON.stringify(e);
 const inputs=[['military_rank','Сержант'],['military_oath.page','2','number'],['military_oath.unit','52170'],['military_service_records.0.page','3','number']].map(([key,value,type])=>({dataset:{reviewKey:key},value,type}));
 const c={e,d:{document_type:'Військовий квиток'},structuredClone,dialog:{querySelectorAll:()=>inputs}};vm.createContext(c);
 const r=vm.runInContext('(function(){'+source.slice(start,end)+'return extracted;})()',c);
 assert.equal(r.military_rank,'Сержант');assert.equal(r.military_oath.page,2);assert.equal(r.military_service_records[0].page,3);assert.equal(r.military_service_records[0].requires_review,true);assert.deepEqual(r._crm_review_decisions,e._crm_review_decisions);assert.equal(JSON.stringify(e),before);
});
test('only explicitly removed OCR fragments disappear and surviving records retain review flags',()=>{
 const start=source.indexOf('      const removed=new Set('),end=source.indexOf('      for(const box of dialog.querySelectorAll',start);
 const e={military_service_records:[{unit:'52170',requires_review:true},{unit:'Начальник штабу'},{unit:'А1735',requires_review:true}]},extracted=structuredClone(e);
 const c={extracted,dialog:{querySelectorAll:()=>[{dataset:{reviewRemoveService:'1'}}]}};vm.createContext(c);vm.runInContext(source.slice(start,end),c);
 assert.deepEqual(Array.from(extracted.military_service_records,r=>r.unit),['52170','А1735']);assert(extracted.military_service_records.every(r=>r.requires_review));assert.equal(e.military_service_records.length,3);
});
