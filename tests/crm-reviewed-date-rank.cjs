const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
require('../supabase/functions/_shared/document-data-policy.js');
const sync=require('../document-ai-sync.js');
test('literal Recruit rank is valid for current rank, never a staffing rank',()=>{
 assert.equal(sync.valid('military_rank','Рекрут'),true);
 assert.equal(sync.valid('shpk','Рекрут'),false);
 const c={id:'c',full_name:'Тестенко Іван Петрович',birth_date:'1975-10-05',rnokpp:'1234567890',profile_data:{}};
 const d={id:'d',candidate_id:'c',document_type:'Витяг Резерв+',verification_status:'Підтверджено',ai_extracted:{full_name:c.full_name,birth_date:c.birth_date,rnokpp:c.rnokpp,military_rank:'Рекрут'}};
 assert(sync.plan(d,c).selections.some(s=>s.key==='military_rank'&&s.incoming==='Рекрут'));
 c.military_rank='солдат';assert(!sync.plan(d,c).selections.some(s=>s.key==='military_rank'));
});
const source=fs.readFileSync(require('node:path').join(__dirname,'../document-review-editor.js'),'utf8');
const start=source.indexOf('      const extracted=structuredClone(e);'),end=source.indexOf('      if(!documentType)',start);
assert(start>=0&&end>start);
function review(e,values){const ctx={e,structuredClone,d:{document_type:'Копія ідентифікаційного коду'},dialog:{querySelectorAll:()=>Object.entries(values).map(([key,value])=>({dataset:{reviewKey:key},value}))}};vm.createContext(ctx);return vm.runInContext('(function(){'+source.slice(start,end)+'return extracted;})()',ctx);}
test('clearing wrongly classified DOB clears derived year, keeps document date and original extraction',()=>{
 const e={birth_date:'1998-05-29',birth_year:1998,document_date:'1998-05-29',personal:{birth_date:'1998-05-29',birth_year:1998}},before=JSON.stringify(e);
 const r=review(e,{birth_date:'',document_date:'1998-05-29'});
 assert.equal(r.birth_date,null);assert.equal(r.birth_year,null);assert.equal(r.personal.birth_year,null);assert.equal(r.personal.birth_date,null);assert.equal(r.document_date,'1998-05-29');assert.equal(JSON.stringify(e),before);
});
test('correcting DOB updates derived year; unrelated review does not rewrite it',()=>{
 const e={birth_date:'1998-05-29',birth_year:1998};
 assert.equal(review(e,{birth_date:'1975-10-05'}).birth_year,1975);
 assert.equal(review(e,{birth_date:'1998-05-29'}).birth_year,1998);
});
