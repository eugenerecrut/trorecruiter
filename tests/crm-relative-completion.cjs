const {test}=require('node:test'),assert=require('node:assert/strict');
const sync=require('../document-ai-sync.js');
const source='795332a9-3e7a-409a-8db5-893749225c9a';
const old={relationship:'Мати',full_name:'Гречко (Коваленко) Світлана',birth_date:'1979-06-28',source_document_id:source};
const incoming={relationship:'мати',full_name:'Гречко (Коваленко) Світлана Олексіївна',birth_date:'1979-06-28'};
function review(existing=old){const rows=[];const result=sync.mergeRelatives([existing],[incoming],(...args)=>rows.push(args),source);return {rows,result}}

test('complex biography keeps spouse family separate and repeated parents share one record',()=>{
 // Synthetic people only: this case mirrors the relationship structure, not a real candidate.
 const family=[
  {relationship:'дружина',full_name:'Тестова (Зразкова) Олена Петрівна',birth_date:'1990-11-22'},
  {relationship:'донька',full_name:'Тестова Марія Іванівна',birth_date:'2020-12-25'},
  {relationship:'мати',full_name:'Тестова Наталія Василівна',birth_date:'1959-09-13',notes:'За кордоном; адреса невідома'},
  {relationship:'сестра',full_name:'Тестова Ольга Петрівна',birth_date:'1982-05-13'},
  {relationship:'батько',full_name:'Тестов Петро Іванович',birth_date:'1958-05-12',death_date:'2020-03-11'},
  {relationship:'батько дружини',full_name:'Приклад Сергій Миколайович',birth_date:'1965-09-05'},
  {relationship:'донька дружини',full_name:'Зразкова Анна Олександрівна',birth_date:'2010-05-16'},
 ];
 const input=[...family,family[2],family[3]],before=JSON.stringify(input),rows=[];
 const first=sync.mergeRelatives([],input,(...args)=>rows.push(args),source);
 assert.equal(first.length,7);assert.equal(JSON.stringify(input),before);
 assert.equal(first.filter(r=>r.relationship==='батько').length,1);
 assert.equal(first.filter(r=>r.relationship==='донька').length,1);
 assert.equal(first.find(r=>r.relationship==='батько дружини').full_name,family[5].full_name);
 assert.equal(first.find(r=>r.relationship==='донька дружини').full_name,family[6].full_name);
 assert.equal(first.find(r=>r.relationship==='мати').address,undefined);
 assert.equal(first.find(r=>r.relationship==='мати').citizenship,undefined);
 assert.equal(rows.filter(r=>r[3]==='fill'&&/^relatives\.\d+$/.test(r[1])).length,7);
 assert.deepEqual(sync.mergeRelatives(first,input,()=>{},source),first);
 assert(!rows.some(r=>r[3]==='conflict'));
});
test('fuller maternal name is proposed once without duplicate or automatic overwrite',()=>{const r=review();assert.equal(r.result.length,1);assert.equal(r.result[0].full_name,old.full_name);assert(r.rows.some(x=>x[1]==='relatives.0.full_name'&&x[2]===incoming.full_name));assert.deepEqual(review().result,r.result)});
test('manual confirmation and conflicting dates block completion',()=>{for(const extra of [{confirmed_by_user:true},{field_confirmations:{full_name:true}},{field_sources:{full_name:null}},{birth_date:'1980-01-01'}]){const r=review({...old,...extra});assert(!r.rows.some(x=>/повніше/.test(x[4])));assert.equal(r.result[0].full_name,old.full_name)}});
test('active same-candidate autobiography reaches completion path; merged and unrelated cards cannot',()=>{const c={id:'c',full_name:'Гречко Каріна Олександрівна',profile_data:{relatives:[old]}},d={id:source,candidate_id:'c',document_type:'Автобіографія друкована',verification_status:'Підтверджено',ai_extracted:{full_name:c.full_name,relatives:[incoming]}};assert(sync.plan(d,c).rows.some(r=>r.key==='relatives.0.full_name'));assert.equal(sync.plan({...d,candidate_id:'other'},c).supported,false);assert.equal(sync.plan(d,{...c,profile_data:{...c.profile_data,merged_into:'other'}}).supported,false)});

test('maiden surname context preserves an existing relative without a false conflict or duplicate',()=>{
 const stored={...old,full_name:'Гречко (Коваленко) Світлана Олексіївна',confirmed_by_user:true};
 const plain={...incoming,full_name:'Гречко Світлана Олексіївна'};
 for(const [existing,next] of [[stored,plain],[{...stored,full_name:plain.full_name},incoming]]){
  const before=JSON.stringify([existing,next]),rows=[];
  const result=sync.mergeRelatives([existing],[next,next],(...args)=>rows.push(args),source);
  assert.equal(result.length,1);assert.equal(result[0].full_name,existing.full_name);assert.equal(JSON.stringify([existing,next]),before);
  assert(!rows.some(r=>r[3]==='conflict'||r[3]==='fill'));assert(rows.some(r=>r[3]==='leave'&&/Дівоче/.test(r[4])));
 }
 for(const extra of [{birth_date:'1980-01-01'},{full_name:'Коваленко Світлана Олексіївна'},{full_name:'Гречко (Іваненко) Світлана Олексіївна'}]){
  const rows=[];const result=sync.mergeRelatives([stored],[{...plain,...extra}],(...args)=>rows.push(args),source);assert.equal(result.length,1);assert(rows.some(r=>r[3]==='conflict'));
 }
 const rows=[];sync.mergeRelatives([stored,{...stored}],[plain],(...args)=>rows.push(args),source);assert(rows.some(r=>r[3]==='conflict'));
});

test('the shared maiden-name rule is loaded before both live browser and server planners',()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 const html=fs.readFileSync(require.resolve('../index.html'),'utf8'),runtime=fs.readFileSync(require.resolve('../supabase/functions/_shared/sync-runtime.js'),'utf8');
 assert(html.indexOf('parent-names.js')<html.indexOf('document-crosscheck.js'));assert(html.indexOf('parent-names.js')<html.indexOf('document-ai-sync.js'));
 assert(runtime.indexOf('parent-names.js')<runtime.indexOf('document-crosscheck.js'));
 const ctx={window:{}};vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../parent-names.js'),'utf8'),ctx);
 assert.equal(ctx.window.CRMParentNames.maidenNameMatch(['Тестенко (Коваленко) Олена Іванівна','Тестенко Олена Іванівна']),true);
 assert.equal(ctx.window.CRMParentNames.maidenNameMatch(['Тестенко (Коваленко) Олена Іванівна','Коваленко Олена Іванівна']),false);
});

test('OCR placeholder words in surname parentheses never create an automatic maiden-name match',()=>{
 const names=require('../parent-names.js'),plain='Гречко Світлана Олексіївна';
 for(const placeholder of ['нерозбірливо','нерозбірливе','нечитабельно','нечитабельне','невідомо','невідоме','не зазначено','не вказано','відсутнє']){
  const name='Гречко ('+placeholder+') Світлана Олексіївна';assert.equal(names.parts(name),null);assert.equal(names.maidenNameMatch([name,plain]),false);
  const stored={...old,full_name:plain,confirmed_by_user:true},next={...incoming,full_name:name},before=JSON.stringify([stored,next]),rows=[];const result=sync.mergeRelatives([stored],[next],(...args)=>rows.push(args),source);assert.equal(result.length,1);assert.equal(result[0].full_name,plain);assert(rows.some(r=>r[3]==='conflict'));assert(!rows.some(r=>r[3]==='fill'));assert.equal(JSON.stringify([stored,next]),before);
 }
 assert.equal(names.maidenNameMatch(['Гречко (Коваленко) Світлана Олексіївна',plain]),true);
});
