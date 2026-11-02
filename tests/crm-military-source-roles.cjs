const {test}=require('node:test'),assert=require('node:assert/strict');
require('../supabase/functions/_shared/document-data-policy.js');
const sync=require('../document-ai-sync.js');
const candidate=()=>({id:'c',full_name:'Тестенко Іван Петрович',birth_date:'1990-01-01',rnokpp:'1234567890',military_specialty:'999097',tcc:'Поточний ТЦК',profile_data:{service_type:'За мобілізацією'}});
const doc=(type,e)=>({id:'d',candidate_id:'c',document_type:type,verification_status:'Підтверджено',ai_extracted:{full_name:'Тестенко Іван Петрович',birth_date:'1990-01-01',rnokpp:'1234567890',...e}});
test('recommendation VOS and unit cannot fill current registry or historical unit',()=>{
 const c=candidate(),d=doc('Копія рекомендаційного листа',{military_specialty:'420182А',military_unit:'А5268',tcc:'Історичний ТЦК'}),before=JSON.stringify([c,d]);
 const p=sync.plan(d,c);
 assert(p.selections.some(s=>s.target==='profile'&&s.key==='recommendation_military_specialty'&&s.incoming==='420182А'));
 assert(p.selections.some(s=>s.key==='desired_unit'&&s.incoming==='А5268'));
 assert(!p.rows.some(s=>['military_specialty','military_unit','tcc'].includes(s.key)));
 assert.equal(JSON.stringify([c,d]),before);
});
test('confirmed destination VOS remains protected while registry VOS is independent',()=>{
 const c=candidate();c.profile_data.recommendation_military_specialty='111111';
 const p=sync.plan(doc('Рекомендаційний лист',{military_specialty:'420182А'}),c);
 assert(p.rows.some(s=>s.key==='recommendation_military_specialty'&&s.action==='conflict'));
 assert(!p.selections.some(s=>s.key==='recommendation_military_specialty'));
 assert.equal(c.military_specialty,'999097');
});
test('registry compares only current VOS, never destination VOS',()=>{
 const c=candidate();c.profile_data.recommendation_military_specialty='420182А';
 const p=sync.plan(doc('Військовий облік (витяг Резерв+ / приписне)',{military_specialty:'999097'}),c);
 assert(p.rows.some(s=>s.key==='military_specialty'&&s.action==='leave'));
 assert(!p.rows.some(s=>s.key==='recommendation_military_specialty'));
});
