const {test}=require('node:test'),assert=require('node:assert/strict');
const x=require('../document-crosscheck.js');
const c={id:'c',full_name:'Тестенко Іван',birth_date:null};
const d=(id,value,extra={})=>({id,candidate_id:'c',document_type:id,storage_path:id,ai_confidence:.95,ai_extracted:{full_name:c.full_name,birth_date:value},...extra});
test('birthplace formatting is reviewable without changing sources or inferring geography',()=>{
 const place=(id,value)=>d(id,null,{ai_extracted:{full_name:c.full_name,birth_place:value}});
 const run=(a,b)=>x.compare([place('a',a),place('b',b)],c).find(e=>e.key==='birth_place');
 const a='Україна, Дніпропетровська обл., Миколаївка',b='Миколаївка; Дніпропетровська область; Україна';
 assert.equal(run(a,b).status,'needs_review');
 assert.equal(run(a,'Україна Дніпропетровська область Петропавлівський район с. Миколаївка').status,'needs_review');
 assert.equal(run(a,'Україна Київська область Миколаївка').status,'conflict');
 assert.equal(run('Україна, Київ','Польща, Київ').status,'conflict');
 assert.equal(run('Петропавлівський район Миколаївка','Синельниківський район Миколаївка').status,'conflict');
 assert.equal(run(a,a).status,'corroborated');
 const docs=[place('a',a)],candidate={...c,birth_place:b},before=JSON.stringify([docs,candidate]),evidence=x.compare(docs,candidate);
 const guarded=x.guard({rows:[{target:'candidate',key:'birth_place',action:'fill'}],selections:[{target:'candidate',key:'birth_place'}]},evidence);
 assert.equal(guarded.selections.length,0);assert.equal(JSON.stringify([docs,candidate]),before);
});
test('saved zone identity facts retain page and provenance without becoming independent self-corroboration',()=>{
 const context={document_id:'a',file_sha256:'a'.repeat(64),revision:'r1',pages:2},binding={...context};
 const doc=d('a','2000-01-01',{ai_processed_at:'r1'}),report={review_only:true,mode:'zone',source:{document_id:'a',page:2,box:{x:.1,y:.2,w:.3,h:.2}},rows:[{fields:[{key:'birth_date',value:'2000-01-01',legibility:'clear',raw_text:'1.1.2000'}]}]};
 const run=(documents=[doc],reports=[report],options={})=>x.compareZones(documents,c,{context,binding,reports,...options});
 const before=JSON.stringify([doc,c,report]);const single=run()[0];assert.equal(single.status,'single_source');assert.equal(single.learning_eligible,false);assert.equal(single.sources[0].page,2);assert.equal(single.sources[0].verified,false);assert.equal(single.sources[0].kind,'zone_reading');assert.equal(JSON.stringify([doc,c,report]),before);
 assert.equal(run([doc,d('b','2000-01-01')])[0].status,'corroborated');
 assert.equal(run([doc,d('b','2000-01-01',{file_hash:context.file_sha256})])[0].status,'single_source');
 assert.equal(run([doc,d('b','2001-01-01')])[0].status,'conflict');
 assert.equal(x.compareZones([doc],{...c,birth_date:'2001-01-01'},{context,binding,reports:[report]})[0].status,'conflict');
 const uncertain=structuredClone(report);uncertain.rows[0].fields[0].alternatives=['2001-01-01'];assert.equal(run([doc],[uncertain])[0].status,'needs_review');
 assert.equal(run([doc],[report,structuredClone(report)])[0].sources.filter(s=>s.kind==='zone_reading').length,1);
 for(const change of [{document_id:'foreign'},{file_sha256:'b'.repeat(64)},{revision:'old'}])assert.equal(run([doc],[report],{binding:{...binding,...change}}).length,0);
 for(const change of [{document_id:'foreign'},{page:0},{page:3},{box:{x:0,y:0,w:2,h:1}},{file_sha256:'b'.repeat(64)}])assert.equal(run([doc],[{...report,source:{...report.source,...change}}]).length,0);
 assert.equal(run([doc],[report],{binding:null}).length,0);assert.equal(run([{...doc,deleted_at:'now'}]).length,0);assert.equal(run([{...doc,candidate_id:'foreign'}]).length,0);
 const newer={...doc,id:'new',version_group_id:'v',version_number:2};assert.equal(run([{...doc,version_group_id:'v',version_number:1},newer]).length,0);
 const family=structuredClone(report);family.rows.push({fields:[{key:'relative_name',value:'Мати',legibility:'clear'}]});assert.equal(run([doc],[family]).length,0);
 const stranger=structuredClone(report);stranger.rows.push({fields:[{key:'full_name',value:'Інша Особа',legibility:'clear'}]});assert.equal(run([doc],[stranger]).length,0);
});
test('agreement records two sources but never promotes AI to learning',()=>{const r=x.compare([d('a','2000-01-01'),d('b','2000-01-01')],c).find(r=>r.key==='birth_date');assert.equal(r.status,'corroborated');assert.equal(r.learning_eligible,false)});
test('conflict blocks candidate fill and keeps sources',()=>{const e=x.compare([d('a','2000-01-01'),d('b','2001-01-01')],c);const p=x.guard({rows:[{target:'candidate',key:'birth_date',action:'fill'}],selections:[{target:'candidate',key:'birth_date'}]},e);assert.equal(p.selections.length,0);assert.equal(p.rows[0].action,'conflict')});

test('cross-document guard does not invent conflicts for absent or matching facts or hide ownership errors',()=>{
 const evidence=[{key:'birth_date',status:'conflict',sources:[{document_id:'other'}]}];
 const rows=[{target:'candidate',key:'birth_date',action:'leave',incoming:null},{target:'candidate',key:'birth_date',action:'leave',current:'2000-01-01',incoming:'2000-01-01'},{target:'candidate',key:'birth_date',action:'conflict',reason:'ПІБ не збігається: звірте власника документа'}];
 const p=x.guard({rows,selections:[]},evidence);assert.equal(p.rows[0].action,'leave');assert.equal(p.rows[1].action,'leave');assert.match(p.rows[2].reason,/власника/);assert.equal(p.crosscheck,evidence);
});
test('same file, old versions, children, wrong owner and invalid dates do not corroborate',()=>{for(const extra of [{storage_path:'a'},{deleted_at:'now'},{document_type:'Свідоцтво про народження дітей'},{ai_extracted:{full_name:'Інша Особа',birth_date:'2000-01-01'}},{ai_extracted:{full_name:c.full_name,birth_date:'2000-02-31'}}]){const r=x.compare([d('a','2000-01-01'),d('b','2000-01-01',extra)],c).find(r=>r.key==='birth_date');assert.equal(r.status,'single_source')}});
test('latest version only and existing manual fact preserved',()=>{const e=x.compare([d('a','2000-01-01',{version_group_id:'r',version_number:1}),d('b','2001-01-01',{version_group_id:'r',version_number:2})],{...c,birth_date:'2000-01-01'}).find(r=>r.key==='birth_date');assert.equal(e.sources.length,1);assert.equal(e.status,'conflict')});

test('separate diplomas survive; repeated hash is not independent evidence',()=>{const base={full_name:c.full_name,birth_date:'2000-01-01'};const r=x.compare([d('a','2000-01-01',{document_type:'Документи про освіту',file_hash:'same'}),d('b','2000-01-01',{document_type:'Документи про освіту',file_hash:'same'})],c).find(r=>r.key==='birth_date');assert.equal(r.sources.length,1);const distinct=x.compare([d('a','2000-01-01',{document_type:'Документи про освіту'}),d('b','2000-01-01',{document_type:'Документи про освіту'})],c).find(r=>r.key==='birth_date');assert.equal(distinct.sources.length,2)});
test('parent roles and different names block structured transfer',()=>{const doc=(id,name)=>d(id,'2000-01-01',{ai_extracted:{full_name:c.full_name,relatives:[{relation:'mother',full_name:name}]}});const e=x.compare([doc('a','Олена Тестенко'),doc('b','Олена Інша')],c);const r=e.find(r=>r.key==='relatives');assert.equal(r.subject,'мати');assert.equal(r.status,'conflict');assert.equal(x.guard({rows:[{target:'profile',key:'relatives',action:'fill'}],selections:[{target:'profile',key:'relatives'}]},e).selections.length,0)});
test('diploma event compared by document number not institution alone',()=>{const doc=(id,specialty,number)=>d(id,'2000-01-01',{ai_extracted:{full_name:c.full_name,education_records:[{institution:'Університет',diploma_number:number,specialty,graduation_year:2020}]}});const e=x.compare([doc('a','Право','1'),doc('b','Медицина','1'),doc('c','Право','2')],c).filter(r=>r.key==='education_records');assert.equal(e.length,2);assert.equal(e.filter(r=>r.status==='conflict').length,1)});
