const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const facts=require('../supabase/functions/_shared/military-facts.js');
const evidence={page:2,raw_text:'Присягу прийняв у військовій частині 52170',date:'1999-01-24'};
const doc={id:'d',document_type:'Військовий квиток',verification_status:'Підтверджено'};
test('historical five-digit unit retains its number and source; modern Latin A still canonicalizes',()=>{
 for(const [unit,expected] of [['52170','52170'],['A1735','А1735'],['А1735','А1735']]){
  const r=facts.review({military_oath:{...evidence,unit}}, {}, doc);
  assert.equal(r.conflicts.length,0);assert.equal(r.proposals[0].incoming.unit,expected);assert.deepEqual(r.proposals[0].incoming.source_pages,[2]);
 }
});
test('unit format never bypasses source evidence, legibility, date or manual-review checks',()=>{
 for(const patch of [{unit:'5217'},{unit:'521700'},{unit:'52 170'},{unit:'Начальник штабу'},{unit:'A52170'},{requires_review:true},{raw_text:''},{page:0},{date:'1999-01'}]){
  const r=facts.review({military_oath:{...evidence,unit:'52170',...patch}}, {}, doc);assert.equal(r.proposals.length,0);assert.equal(r.conflicts.length,1);
 }
});
test('historical service period is idempotent and review-marked periods remain held',()=>{
 const c={CRMNameHistory:{matches:()=>true},CRMWork:{date:s=>/^\d{4}-\d{2}-\d{2}$/.test(s)}};c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../military-document.js'),'utf8'),c);
 const e={full_name:'Тестовий Кандидат',military_service_records:[{unit:'52170',position:'курсант',start_date:'1998-12-25',end_date:'1999-05-27',page:3,raw_text:'52170, курсант, 25.12.1998–27.05.1999'}]};
 const r=c.CRMMilitary.review(e,{}, {}, 'd');assert.equal(r.accepted,1);assert.equal(r.records[0].employer,'52170');
 assert.equal(c.CRMMilitary.review(e,{}, {work_records:r.records}, 'd').accepted,0);
 e.military_service_records[0].requires_review=true;assert.equal(c.CRMMilitary.review(e,{}, {}, 'd').accepted,0);
});
test('row-level confirmation is explicit and the global hold still takes precedence',()=>{
 const src=fs.readFileSync(require('node:path').join(__dirname,'../document-review-editor.js'),'utf8'),start=src.indexOf("      for(const box of dialog.querySelectorAll('[data-review-service-row]'))"),end=src.indexOf('      const removed=',start);
 for(const held of [false,true]){const c={extracted:{military_service_records:[{requires_review:true},{requires_review:true}]},dialog:{querySelectorAll:()=>[{dataset:{reviewServiceRow:'0'},checked:false},{dataset:{reviewServiceRow:'1'},checked:true}],querySelector:()=>({checked:held})}};vm.createContext(c);vm.runInContext(src.slice(start,end),c);assert.equal(c.extracted.military_service_records[0].requires_review,held);assert.equal(c.extracted.military_service_records[1].requires_review,true);}
});
