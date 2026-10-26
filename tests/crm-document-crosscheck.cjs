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

test('uncertain birthplace reading keeps the quality warning ahead of formatting similarity',()=>{
 const context={document_id:'a',file_sha256:'a'.repeat(64),revision:'r1',pages:1},binding={...context};
 const doc=d('a',null,{ai_processed_at:'r1',ai_extracted:{full_name:c.full_name,birth_place:'Україна, Київ'}});
 const report={review_only:true,mode:'zone',source:{document_id:'a',page:1,box:{x:0,y:0,w:1,h:1}},rows:[{fields:[{key:'birth_place',value:'Київ, Україна',legibility:'uncertain'}]}]};
 const before=JSON.stringify([doc,report]),result=x.compareZones([doc],c,{context,binding,reports:[report]})[0];
 assert.equal(result.status,'needs_review');assert.match(result.reason,/непевне/);assert.equal(JSON.stringify([doc,report]),before);
});

test('explicit birthplace labels and administrative case endings allow review without inventing identity',()=>{
 const inputs=[
  'УКРАЇНА, ДНІПРОПЕТРОВСЬКА область, МИКОЛАЇВКА',
  'УКРАЇНА ДНІПРОПЕТРОВСЬКА ОБЛАСТЬ ПЕТРОПАВЛІВСЬКИЙ РАЙОН С. МИКОЛАЇВКА',
  'с. Миколаївка, Петропавлівського району, Дніпропетровської області',
  'Миколаївка, Петропавлівський район, Дніпропетровська область'
 ];
 const place=(id,value)=>d(id,null,{ai_extracted:{full_name:c.full_name,birth_place:value}});
 const candidate={...c,birth_place:'Україна, Дніпропетровська область, Петропавлівський район, село Миколаївка'};
 const docs=inputs.map((v,i)=>place(String(i),v)),before=JSON.stringify([docs,candidate]);
 const evidence=x.compare(docs,candidate),entry=evidence.find(e=>e.key==='birth_place');
 assert.equal(entry.status,'needs_review');assert.equal(entry.sources.length,4);assert.equal(entry.current,candidate.birth_place);
 assert.deepEqual(entry.sources.map(s=>s.value),inputs);assert.equal(JSON.stringify([docs,candidate]),before);
 const run=(a,b)=>x.compare([place('a',a),place('b',b)],c).find(e=>e.key==='birth_place').status;
 assert.equal(run('м. Київ, Україна','місто Київ, Україна'),'needs_review');
 for(const other of [
  'село Миколаївка, Київська область, Петропавлівський район',
  'село Миколаївка, Дніпропетровська область, Синельниківський район',
  'місто Миколаївка, Дніпропетровська область, Петропавлівський район',
  'село Михайлівка, Дніпропетровська область, Петропавлівський район'
 ])assert.equal(run(candidate.birth_place,other),'conflict');
 assert.equal(run('Україна, с. Миколаївська','Україна, с. Миколаївської'),'conflict');
 assert.equal(run('Україна, Дніпропетровська область, Миколаївка','Дніпропетровська область, Петропавлівський район, Миколаївка'),'conflict'); // No single complete source: do not construct a combined address.
 const guarded=x.guard({rows:[{target:'candidate',key:'birth_place',action:'fill'}],selections:[{target:'candidate',key:'birth_place'}]},evidence);
 assert.equal(guarded.selections.length,0);assert.equal(entry.learning_eligible,false);
 const context={document_id:'0',file_sha256:'a'.repeat(64),revision:'r1',pages:1},binding={...context};docs[0].ai_processed_at='r1';
 const report={review_only:true,mode:'zone',source:{document_id:'0',page:1,box:{x:0,y:0,w:1,h:1}},rows:[{fields:[{key:'birth_place',value:inputs[2],legibility:'clear'}]}]};
 const zonal=x.compareZones(docs,candidate,{context,binding,reports:[report]})[0];assert.equal(zonal.status,'needs_review');assert.equal(zonal.sources[0].page,1);
});

test('incomplete parent names suggest review without overwriting manual values or creating relatives',()=>{
 const mother={relationship:'Мати',full_name:'Тестенко (Коваленко) Світлана',birth_date:'1979-06-28',confirmed_by_user:true};
 const father={relationship:'Батько',full_name:'Тестенко Олександр Іванович'};
 const candidate={...c,profile_data:{relatives:[mother,father]}};
 const parent=(id,name,date='1979-06-28',extra={})=>d(id,null,{ai_extracted:{full_name:c.full_name,relatives:[{relationship:'mother',full_name:name,birth_date:date,...extra}]}});
 const docs=[parent('a','ТЕСТЕНКО (Коваленко) Світлана Олексіївна'),parent('b','Тестенко Світлана Олексіївна')],before=JSON.stringify([docs,candidate]);
 const evidence=x.compare(docs,candidate),entry=evidence.find(e=>e.key==='relatives');
 assert.equal(entry.status,'needs_review');assert.equal(entry.current,mother.full_name);assert.equal(entry.sources.length,2);assert.equal(entry.sources[0].birth_date,mother.birth_date);assert.equal(entry.learning_eligible,false);
 const guarded=x.guard({rows:[{target:'profile',key:'relatives',action:'fill'}],selections:[{target:'profile',key:'relatives'}]},evidence);
 assert.equal(guarded.selections.length,0);assert.equal(JSON.stringify([docs,candidate]),before);assert.equal(candidate.profile_data.relatives.length,2);
 for(const name of ['Тестенко Світлана Іванівна','Інша Світлана Олексіївна','Тестенко Олена Олексіївна','Тестенко С. Олексіївна','Тестенко (Іваненко) Світлана Олексіївна']){
  const full={...candidate,profile_data:{relatives:[{...mother,full_name:'Тестенко (Коваленко) Світлана Олексіївна'}]}};
  assert.equal(x.compare([parent('a',name)],full).find(e=>e.key==='relatives').status,'conflict');
 }
 assert.equal(x.compare([parent('a','Тестенко Світлана Олексіївна','1980-01-01')],candidate).find(e=>e.key==='relatives').status,'conflict');
 const ambiguous={...candidate,profile_data:{relatives:[mother,{...mother,full_name:'Тестенко Світлана Олексіївна'}]}};
 assert.match(x.compare(docs,ambiguous).find(e=>e.key==='relatives').reason,/кілька записів/);
 assert.equal(x.compare([parent('a','Тестенко (Коваленко) Світлана','1979-06-28'),parent('b','Тестенко (Коваленко) Світлана','1980-01-01')],c).find(e=>e.key==='relatives').status,'conflict');
 const sameFile=[parent('a','Тестенко Світлана Олексіївна'),parent('b','Тестенко Світлана Олексіївна')].map(v=>({...v,file_hash:'same'}));
 assert.equal(x.compare(sameFile,c).find(e=>e.key==='relatives').status,'single_source');
});

test('maiden surname presence is contextual information when the full maternal name agrees',()=>{
 const name='Тестенко (Коваленко) Світлана Олексіївна',plain='Тестенко Світлана Олексіївна';
 const doc=(id,full_name,date='1979-06-28')=>d(id,null,{ai_extracted:{full_name:c.full_name,relatives:[{relationship:'mother',full_name,birth_date:date}]}});
 const candidate={...c,profile_data:{relatives:[{relationship:'мати',full_name:name,birth_date:'1979-06-28',confirmed_by_user:true}]}};
 const docs=[doc('a',name),doc('b',plain)],before=JSON.stringify([docs,candidate]);
 const entry=x.compare(docs,candidate).find(e=>e.key==='relatives');
 assert.equal(entry.status,'corroborated');assert.match(entry.reason,/дівоче/);assert.equal(entry.learning_eligible,false);assert.equal(JSON.stringify([docs,candidate]),before);
 assert.equal(x.compare([doc('a',plain)],candidate).find(e=>e.key==='relatives').status,'single_source');
 assert.equal(x.compare(docs.map(v=>({...v,file_hash:'same'})),candidate).find(e=>e.key==='relatives').status,'single_source');
 assert.equal(x.compare([doc('a',plain,'1980-01-01')],candidate).find(e=>e.key==='relatives').status,'conflict');
 for(const other of ['Коваленко Світлана Олексіївна','Тестенко (Іваненко) Світлана Олексіївна','Тестенко Олена Олексіївна','Тестенко Світлана Іванівна'])assert.equal(x.maidenNameMatch([name,other]),false);
 assert.equal(x.maidenNameMatch([name,'Тестенко(Коваленко) Світлана Олексіївна']),true);
 assert.equal(x.maidenNameMatch([name,'Тестенко Світлана']),false);
});

test('education and service presentation preserves source spelling without changing comparison values',()=>{
 const education={institution:'Дніпровський Державний Університет',degree:'Бакалавр',specialty:'Право',graduation_year:2023,diploma_series:'КВ',diploma_number:'123',display_fields:{institution:'Підміна'}};
 const service={start_date:'2020',end_date:'2021-05',position:'Командир екіпажу',unit:'ВЧ А0998',order_number:'29-РС'};
 const docs=[d('a',null,{ai_extracted:{full_name:c.full_name,education_records:[education],military_service_records:[service]}})],before=JSON.stringify(docs);
 const evidence=x.compare(docs,c),edu=evidence.find(e=>e.key==='education_records'),work=evidence.find(e=>e.key==='work_records');
 assert.equal(edu.sources[0].display_fields.institution,education.institution);assert.equal(edu.sources[0].display_fields.diploma_number,'123');
 assert.equal(edu.sources[0].value,JSON.stringify(['дніпровський державний університет','бакалавр','право','2023']));
 assert.equal(edu.status,'single_source');assert.equal(work.status,'single_source');assert.equal(work.sources[0].display_fields.start_date,'2020');assert.equal(work.sources[0].display_fields.unit,'ВЧ А0998');
 assert.equal(JSON.stringify(docs),before);assert.equal(edu.learning_eligible,false);
});

test('empty surname parentheses ask for notation review, never establish identity or erase conflicts',()=>{
 const plain='Тестенко Олена Іванівна',blank='Тестенко ( ) Олена Іванівна';
 const parent=(id,name,birth='1979-06-28')=>d(id,null,{ai_extracted:{full_name:c.full_name,relatives:[{relationship:'мати',full_name:name,birth_date:birth}]}});
 const candidate={...c,profile_data:{relatives:[{relationship:'мати',full_name:plain,birth_date:'1979-06-28',confirmed_by_user:true}]}};
 const docs=[parent('a',blank)],before=JSON.stringify([docs,candidate]),entry=x.compare(docs,candidate).find(e=>e.key==='relatives');
 assert.equal(entry.status,'needs_review');assert.match(entry.reason,/порожні дужки/);assert.match(entry.reason,/Тотожність не підтверджена/);assert.equal(entry.learning_eligible,false);assert.equal(JSON.stringify([docs,candidate]),before);
 const dated=x.compare([parent('a',blank,'1980-01-01')],candidate).find(e=>e.key==='relatives');assert.equal(dated.status,'conflict');assert.match(dated.reason,/Дати народження/);
 const duplicate={...candidate,profile_data:{relatives:[candidate.profile_data.relatives[0],candidate.profile_data.relatives[0]]}};assert.equal(x.compare(docs,duplicate).find(e=>e.key==='relatives').status,'conflict');
 for(const name of ['Іваненко ( ) Олена Іванівна','Тестенко (Коваленко) Олена Петрівна','Тестенко (?) Олена Іванівна','Тестенко (нерозбірливо) Олена Іванівна','Тестенко ( ) Олена','Тестенко ( ) ( ) Олена Іванівна'])assert.equal(x.compare([parent('a',name)],candidate).find(e=>e.key==='relatives').status,'conflict',name);
 assert.equal(x.maidenNameMatch([blank,plain]),false);
});

test('zonal parents remain row-bound review evidence, with verified independent sources only',async()=>{
 const context={document_id:'a',file_sha256:'a'.repeat(64),revision:'r1',pages:1},binding={...context};
 const name='Тестенко Олена Іванівна';
 const source=d('a',null,{ai_processed_at:'r1',file_hash:context.file_sha256});
 const parent=(id,full_name=name,extra={})=>d(id,null,{verification_status:'Підтверджено',ai_extracted:{full_name:c.full_name,relatives:[{relationship:'мати',full_name,birth_date:'1970-01-01'}]},...extra});
 const field=(key,value,extra={})=>({key,value,raw_text:value,legibility:'clear',alternatives:[],...extra});
 const row={fields:[field('relative_name',name),field('relationship',null,{raw_text:'мати',legibility:'uncertain'}),field('birth_date','1970-01-01')]};
 const report={review_only:true,mode:'zone',source:{document_id:'a',page:1,box:{x:0,y:0,w:1,h:1}},rows:[row]};
 const run=(docs=[source,parent('b')],reports=[report],candidate=c,options={})=>x.compareZoneParents(docs,candidate,{context,binding,reports,...options});
 const before=JSON.stringify([source,report,c]);
 let e=run()[0];assert.equal(e.status,'needs_review');assert.equal(e.sources.length,2);assert.equal(e.learning_eligible,false);assert.equal(e.sources[0].verified,false);assert.equal(e.sources[0].birth_date,'1970-01-01');assert.equal(e.subject,'мати');
 assert.equal(JSON.stringify([source,report,c]),before);
 assert.equal(run([source,parent('b',name,{verification_status:null})])[0].sources.length,1);
 assert.equal(run([source,parent('b',name,{file_hash:context.file_sha256})])[0].sources.length,1);
 assert.equal(run([source,parent('b',name,{storage_path:source.storage_path})])[0].sources.length,1);
 assert.equal(run([source,parent('b')],[report,report])[0].sources.length,2);
 assert.equal(run([source,parent('b','Тестенко Інна Іванівна')])[0].status,'conflict');
 assert.equal(run([source],undefined,{...c,profile_data:{relatives:[{relationship:'мати',full_name:name,birth_date:'1971-01-01'}]}})[0].status,'conflict');
 assert.equal(run([source],undefined,{...c,profile_data:{relatives:[{relationship:'мати',full_name:name},{relationship:'мати',full_name:name}]}})[0].status,'conflict');
 for(const profile_data of [{merged_into:'other'},{workflow:{archived_at:'now'}}])assert.deepEqual(run(undefined,undefined,{...c,profile_data}),[]);
 for(const patch of [{candidate_id:'other'},{deleted_at:'now'},{ai_processed_at:'old'},{file_hash:'b'.repeat(64)}])assert.deepEqual(run([{...source,...patch}]),[]);
 assert.deepEqual(run([source,{...source,id:'new',version_group_id:'a',version_number:2}]),[]);
 for(const patch of [{page:2},{document_id:'other'},{file_sha256:'b'.repeat(64)},{box:{x:0,y:0,w:2,h:1}}])assert.deepEqual(run(undefined,[{...report,source:{...report.source,...patch}}]),[]);
 assert.deepEqual(run(undefined,undefined,undefined,{binding:null}),[]);
 for(const bad of [
  [field('relative_name','Тестенко Олена'),row.fields[1]],
  [row.fields[0],field('relationship','батько',{raw_text:'мати'})],
  [row.fields[0],field('relationship','мати',{raw_text:'мати дружини'})],
  [row.fields[0],field('relationship','constructor',{raw_text:'constructor'})],
  [row.fields[0],{...row.fields[1],alternatives:['батько']}],
  [row.fields[0],row.fields[1],field('full_name',c.full_name)],
  [row.fields[0],row.fields[0],row.fields[1]],
  [{...row.fields[0],alternatives:['Тестенко Інна Іванівна']},row.fields[1]]
 ])assert.deepEqual(run(undefined,[{...report,rows:[{fields:bad}]}]),[]);
 assert.deepEqual(run(undefined,[{...report,rows:[{fields:[row.fields[0]]},{fields:[row.fields[1]]}]}]),[]);
 assert.deepEqual(x.compareZones([source],c,{reports:[report],context,binding}),[]);
 const client={from:()=>({select:()=>({eq:async()=>({data:[source,parent('b')],error:null})})})};
 assert.equal((await x.load(client,c,{reports:[report],context,binding})).filter(e=>e.zone_crosscheck&&e.key==='relatives').length,1);
});
