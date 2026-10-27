const {test}=require('node:test'),assert=require('node:assert/strict');require('../candidate-field-registry.js');const {review}=require('../service-record-readiness.js');
const base=()=>({id:'c1',full_name:'ТЕСТЕНКО Іван Петрович',rnokpp:'1234567890',birth_date:'1990-02-10',birth_place:'Дніпро',worked_before:false,served_before:false,profile_data:{education_institution:'Школа'}});
test('Explicit absence and optional empty fields do not create artificial blockers',()=>{const c=base(),before=JSON.stringify(c),r=review(c);assert(r.ready);assert.equal(r.checkedGroups,29);assert.equal(r.worked,false);assert.equal(JSON.stringify(c),before);});
test('Unknown differs from no; print overrides cannot replace missing facts',()=>{const c=base();delete c.worked_before;delete c.rnokpp;c.profile_data.service_record_print={personal_number:'1234567890'};const r=review(c);assert(!r.ready);assert(r.issues.some(i=>i.fieldId==='employment.absence'));assert(r.issues.some(i=>i.fieldId==='identity.tax_number'));assert.equal(r.notes.length,1);});
test('Employment and service periods are separate; stale rows do not override explicit no',()=>{const c=base();c.worked_before=true;c.profile_data.work_records=[{kind:'military_service',start_date:'2022-01-01',unit:'А0000',position:'Солдат'}];assert(review(c).issues.some(i=>i.fieldId==='employment.records'));c.worked_before=false;assert(review(c).ready);});
test('Invalid dates, source links and held records are visible to recruiter',()=>{const c=base();c.worked_before=true;c.profile_data.work_records=[{kind:'employment',start_date:'2022-02-30',employer:'Тест',position:'Водій',source_document_id:'d1'}];let r=review(c,{},[{id:'d1',file_name:'Трудова.pdf'}]);assert(r.issues.some(i=>i.documents.some(d=>d.id==='d1')));c.profile_data.work_records[0].requires_review=true;r=review(c);assert(r.issues.some(i=>i.text.includes('потребує звірки')));});
test('Education cannot pass with only unreadable rows; legacy verified data retains fallback',()=>{const c=base();delete c.profile_data.education_institution;c.profile_data.education_records=[{institution:'Нечітко',requires_review:true}];assert(review(c).issues.some(i=>i.fieldId==='education.civil'));c.profile_data.education_records=[{institution:'Заклад',graduation_year:2023}];assert(review(c).ready);});
test('29 service periods fit, 30 are reported without dropping records',()=>{const c=base();c.served_before=true;c.profile_data.work_records=Array.from({length:29},()=>({kind:'military_service',start_date:'2022-01-01',unit:'А0000',position:'Солдат'}));assert(review(c).ready);c.profile_data.work_records.push({...c.profile_data.work_records[0]});assert(review(c).issues.some(i=>i.text.includes('29')));assert.equal(c.profile_data.work_records.length,30);});
test('Ambiguous rank orders and unconfirmed family address need explicit review',()=>{const c=base();c.military_rank='солдат';c.profile_data.military_rank_records=[{rank:'Солдат',confirmed_by_user:true,order_number:'1'},{rank:'солдат',confirmed_by_user:true,order_number:'2'}];c.profile_data.family_residence_address='Дніпро';const r=review(c);assert(r.issues.some(i=>i.fieldId==='military.rank_order'));assert(r.issues.some(i=>i.fieldId==='family.address'));});
test('Birth-place fallback is retained; malformed date never treated as valid',()=>{const c=base();delete c.birth_place;assert(review(c,{birth_place:'Дніпро'}).ready);c.birth_date='1990-02-30';assert(review(c,{birth_place:'Дніпро'}).issues.some(i=>i.fieldId==='identity.birth_date'));});

test('ambiguous parent review identifies saved alternatives and all owned current sources',()=>{
 const c=base();c.profile_data.relatives=[
  {relationship:'Мати',full_name:'Прикладова Олена Петрівна',source_document_id:'birth'},
  {relationship:'Мати',full_name:'Тестова (Прикладова) Олена Петрівна',source_document_id:'bio'},
  {relationship:'Мати',full_name:'Не використовується',requires_review:true,source_document_id:'held'}];
 const docs=[{id:'birth',candidate_id:'c1',file_name:'Свідоцтво.pdf'},{id:'bio',candidate_id:'c1',file_name:'Автобіографія.pdf'},{id:'held',candidate_id:'c1',file_name:'held.pdf'}];
 const before=JSON.stringify({c,docs}),r=review(c,{},docs),issue=r.issues.find(i=>i.text.includes('Кілька різних'));
 assert(issue);assert(issue.text.includes('Прикладова Олена Петрівна'));assert(issue.text.includes('Тестова (Прикладова) Олена Петрівна'));
 assert.deepEqual(issue.documents.map(d=>d.id),['birth','bio']);
 assert.equal(JSON.stringify({c,docs}),before);assert.equal(r.ready,false,'Surname notation alone does not resolve identity');
 const foreign=docs.map(d=>d.id==='bio'?{...d,candidate_id:'other'}:d);
 assert.deepEqual(review(c,{},foreign).issues.find(i=>i.text.includes('Кілька різних')).documents.map(d=>d.id),['birth']);
});

test('parent name review follows field provenance and respects manual source markers',()=>{
 const c=base();c.profile_data.relatives=[
  {relationship:'Мати',full_name:'Тестова Олена Петрівна',source_document_id:'old',field_sources:{full_name:'name',address:'address'}},
  {relationship:'Мати',full_name:'Прикладова Олена Петрівна',source_document_id:'legacy'}];
 const docs=['old','name','address','legacy'].map(id=>({id,candidate_id:'c1',file_name:id+'.pdf'}));
 const before=JSON.stringify({c,docs}),issue=()=>review(c,{},docs).issues.find(i=>i.text.includes('Кілька різних'));
 assert.deepEqual(issue().documents.map(d=>d.id),['name','legacy']);
 assert.equal(JSON.stringify({c,docs}),before);
 c.profile_data.relatives[0].field_sources.full_name=null;
 assert.deepEqual(issue().documents.map(d=>d.id),['legacy'],'Manual name must not inherit an unrelated original');
});
