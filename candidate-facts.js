/* Stage 2 shadow reader. No network, OCR, writes, or replacement of the existing guards. */
(function(root){
 'use strict';
 const own=(o,k)=>o!=null&&Object.prototype.hasOwnProperty.call(o,k);
 const object=v=>{try{v=typeof v==='string'?JSON.parse(v):v;}catch{return {};}return v&&typeof v==='object'&&!Array.isArray(v)?v:{};};
 const copy=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
 const stable=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
 const equal=(a,b)=>stable(a)===stable(b);
 const empty=v=>v==null||typeof v==='string'&&!v.trim()||Array.isArray(v)&&!v.length;
 const norm=v=>typeof v==='string'?v.normalize('NFKC').replace(/[’ʼ`]/g,"'").trim().replace(/\s+/g,' ').toLocaleLowerCase('uk'):copy(v);
 // Opaque display references only. Exact values, not these hashes, validate decisions.
 function ref(parts){let h=2166136261;for(const c of stable(parts)||'')h=Math.imul(h^c.charCodeAt(0),16777619);return (h>>>0).toString(16);}
 function at(o,path){const keys=path.split('.');if(keys.some(k=>['__proto__','prototype','constructor'].includes(k)))return undefined;for(const k of keys){if(!own(o,k))return undefined;o=o[k];}return o;}
 const definitions=[
  ['identity.name',['candidate.name_nominative','candidate.full_name']],
  ['identity.birth_date',['candidate.birth_date']],['identity.birth_place',['candidate.birth_place','personal_file.birth_place']],
  ['identity.tax_number',['candidate.rnokpp']],['contact.phone',['candidate.phone']],
  ['identity.sex',['candidate.sex','profile.sex']],
  ['identity.citizenship',['candidate.citizenship','profile.citizenship']],
  ['identity.unzr',['profile.unzr']],['identity.birth_certificate',['profile.birth_certificate']],
  ['identity.document_type',['profile.identity_document_type']],
  ['identity.passport_series',['profile.passport_series']],['identity.passport_number',['profile.passport_number']],
  ['identity.passport_issuer',['profile.passport_issuer']],['identity.passport_issue_date',['profile.passport_issue_date']],
  ['identity.passport_expiry_date',['profile.passport_expiry_date']],
  ['identity.passport_data',['candidate.passport_data','personal_file.passport_data']],
  ['contact.phone_secondary',['profile.phone_secondary']],['contact.email',['candidate.email']],['contact.messenger',['profile.messenger']],
  ['address.registered',['profile.registered_address','personal_file.registered_address']],['address.actual',['personal_file.address']],
  ['family.children_count',['candidate.children_count']],['family.children_info',['personal_file.children_info','profile.children_info']],
  ['military.rank',['candidate.military_rank']],['military.specialty',['candidate.military_specialty','profile.military_specialty']],
  ['recruitment.service_type',['profile.service_type','personal_file.service_type']],
  ['recruitment.desired_position',['candidate.desired_position']],['recruitment.shpk',['profile.shpk']],['recruitment.tariff_grade',['profile.tariff_grade']],
  ['employment.absence',['candidate.worked_before','profile.worked_before']],['service.absence',['candidate.served_before','profile.served_before']],
  ['family.marital_status',['candidate.marital_status','profile.marital_status']],['family.has_children',['candidate.has_children','profile.has_children']],
  ['family.address',['profile.family_residence_address']],['family.address_confirmed',['profile.family_residence_confirmed']]
 ];
 const collectionIds={relatives:'family.relative',education_records:'education.record',work_records:'period.record',work_events:'period.event',military_rank_records:'military.rank_record',combat_records:'combat.record',awards:'award.record',reserve_training_records:'service.reserve_training'};
 const collections=new Set(Object.keys(collectionIds));
 const recordFields={
  relatives:new Set('relationship full_name birth_date birth_place citizenship address phone workplace position notes deceased death_date death_date_precision'.split(' ')),
  education_records:new Set('degree institution specialty qualification graduation_year study_start_date study_end_date diploma_series diploma_number diploma_issue_date specialty_code supplement_number supplement_issue_date'.split(' ')),
  work_records:new Set('kind employer employer_code position unit military_specialty location locality disposition start_date end_date order_number order_date end_order_number end_order_date termination_reason position_changes'.split(' ')),
  military_rank_records:new Set('rank order_issuer order_number order_date'.split(' ')),
  combat_records:new Set('location start_date end_date'.split(' ')),
  awards:new Set('name reason order_issuer order_number order_date'.split(' ')),
  reserve_training_records:new Set('start_date end_date position military_specialty unit order_issuer order_number order_date'.split(' ')),
  work_events:new Set('kind employer employer_code position event_date date_precision order_number order_date termination_reason'.split(' '))
 };
 const objectFields={military_oath:{id:'service.oath',keys:['date','unit']},military_discharge:{id:'service.discharge',keys:['basis','unit','order_number','order_date']},marriage_record:{id:'family.marriage',keys:['certificate_number','registration_date','registration_authority']}};
 const metadataKeys=new Set('field_sources field_confirmations source_document_id source_pages source_record_index confirmed_by_user manually_confirmed accepted_by_ai raw_text requires_review crossed_out degree_raw'.split(' '));
 const generated=d=>/послужний список|анкета на контракт|перелік документів|реєстр кандидата|титульний/iu.test(d.document_type||'')||d.generated===true||d.is_generated===true;
 function enabled(){return root.CRMFeatureFlags?.factsShadow===true||!own(root.CRMFeatureFlags,'factsShadow')&&!!root.location&&new URLSearchParams(root.location.search).get('factsShadow')==='1';}
 function build(input){
  const candidate=copy(input.candidate||{}),personal=copy(input.personalFile||{}),documents=copy(input.documents||[]);
  const profile=object(candidate.profile_data),context={candidate,profile,personal_file:personal};
  // Cover all supplied evidence, including primary fields and technical states.
  // These display references still do not replace database CAS or exact comparisons.
  const snapshotId='snapshot:'+ref([candidate,personal,documents,copy(input.activity||[])]);
  const facts=[],claims=[],issues=[],decisions=[],diagnostics=[],recordUnmapped=[],covered=new Set(),byLocation=new Map();
  const blocked=!!profile.merged_into||!!profile.workflow?.archived_at;
  const currentDocs=root.CRMResponsibility?.latest(documents)||documents.filter(d=>!d.deleted_at&&!documents.some(n=>d.version_group_id&&n.version_group_id===d.version_group_id&&Number(n.version_number)>Number(d.version_number)));
  const excluded=[];
  const eligible=currentDocs.filter(d=>{
   const reason=blocked?'inactive-candidate':d.deleted_at?'deleted':!candidate.id||d.candidate_id!==candidate.id?'candidate-mismatch':generated(d)?'generated':!d.storage_path?'no-original':null;
   if(reason)excluded.push({documentId:d.id,reason});return !reason;
  });
  const docById=new Map(eligible.map(d=>[d.id,d]));
  function source(doc,row={}){
   const evidence=object(doc.ai_extracted).field_evidence?.[row.key]||{};
   const pages=row.source_pages||evidence.source_pages;
   return {kind:'document',documentId:doc.id,versionGroupId:doc.version_group_id||doc.id,versionNumber:doc.version_number??null,
    evidenceKeys:[doc.version_group_id?'version-group:'+doc.version_group_id:null,doc.file_hash?'hash:'+doc.file_hash:null,doc.storage_path?'path:'+doc.storage_path:null].filter(Boolean),
    sourcePages:Array.isArray(pages)?pages.filter(n=>Number.isInteger(n)&&n>0):[],sourceRecordIndex:row.source_record_index??null,
    evidenceLocator:copy(evidence.zone||null),runRef:doc.ai_run_id||null};
  }
  function addFact(id,paths,metadata={},entityRef='candidate:'+candidate.id){
   const locations=paths.filter(path=>at(context,path)!==undefined),populated=locations.filter(path=>!empty(at(context,path)));
   const location=populated[0]||locations[0],value=location?copy(at(context,location)):null;
   const key=location?.split('.').at(-1),manual=metadata.confirmed_by_user===true||metadata.manually_confirmed===true||metadata.field_confirmations?.[key]===true;
   const fact={id:'fact:'+ref([candidate.id,entityRef,id]),candidateId:candidate.id,entityRef,fieldId:id,value,
    valueState:empty(value)?'unknown':value===false?'explicit_absence':'present',legacyLocations:locations,
    provenanceState:manual?'human_confirmed':'legacy_unknown',claimRefs:[],decisionRefs:[],protected:!empty(value),
    protectionReason:manual?'explicit-human-marker':!empty(value)?'existing-value':'',sourceRefs:[],held:metadata.requires_review===true||metadata.crossed_out===true};
   const sources=object(metadata.field_sources),sourceId=own(sources,key)?sources[key]:metadata.source_document_id;
   const doc=docById.get(sourceId);
   if(sourceId===null&&own(sources,key)&&!empty(value))fact.protectionReason='manual-source-cleared';
   if(doc&&doc.verification_status==='Підтверджено'&&!['AI помилка','AI обробка'].includes(doc.processing_status)){
    fact.sourceRefs.push(source(doc,metadata));if(!manual)fact.provenanceState='documented';
   }else if(sourceId)diagnostics.push({code:'unavailable-provenance',factId:fact.id,documentId:sourceId});
   for(const path of paths){byLocation.set(path,fact);covered.add(path);}
   if(populated.some(path=>!equal(at(context,path),value)))diagnostics.push({code:'legacy-path-divergence',factId:fact.id,locations:populated});
   facts.push(fact);return fact;
  }
  for(const [id,paths] of definitions)addFact(id,paths,{field_sources:profile.field_sources,field_confirmations:profile.field_confirmations});
  // Detect current form/print fallback drift without redefining either reader.
  for(const [fieldId,cardPaths] of [
   ['identity.birth_place',['candidate.birth_place','personal_file.birth_place','profile.birth_place']],
   ['family.marital_status',['candidate.marital_status','personal_file.family_status','profile.marital_status']]
  ]){const fact=facts.find(f=>f.fieldId===fieldId),path=cardPaths.find(path=>!!at(context,path));
   const cardValue=path?at(context,path):null;
   if(!equal(cardValue,fact.value)&&!(empty(cardValue)&&empty(fact.value)))diagnostics.push({code:'reader-route-divergence',factId:fact.id,fieldId,cardLocation:path||null,canonicalLocations:fact.legacyLocations});
  }
  // Extend coverage from the current print contract without guessing that a composite
  // group (education, family, periods) is one scalar with interchangeable paths.
  for(const group of root.CRMFieldRegistry?.fields||[])for(const path of group.paths){
   if(covered.has(path)||collections.has(path.split('.')[1])||own(objectFields,path.split('.')[1]))continue;
   addFact(group.id+'.legacy.'+path.split('.').at(-1),[path]);
  }
  for(const [key,definition] of Object.entries(objectFields)){
   const location='profile.'+key,raw=profile[key];covered.add(location);
   if(raw===undefined||raw===null)continue;
   let record=raw;try{if(typeof raw==='string')record=JSON.parse(raw);}catch{record=null;}
   if(!record||typeof record!=='object'||Array.isArray(record)){diagnostics.push({code:'invalid-structured-object',location});recordUnmapped.push(location);continue;}
   profile[key]=record;
   for(const field of Object.keys(record)){
    if(metadataKeys.has(field))continue;
    if(!definition.keys.includes(field)){recordUnmapped.push(location+'.'+field);continue;}
    addFact(definition.id+'.'+field,[location+'.'+field],record,snapshotId+':'+key);
   }
  }
  for(const collection of collections){
   const records=profile[collection];if(records!==undefined&&!Array.isArray(records)){diagnostics.push({code:'invalid-collection',location:'profile.'+collection});continue;}
   covered.add('profile.'+collection);
   for(const [index,record] of (records||[]).entries()){
    if(!record||typeof record!=='object'||Array.isArray(record)){recordUnmapped.push('profile.'+collection+'.'+index);diagnostics.push({code:'invalid-record',location:'profile.'+collection+'.'+index});continue;}
    const entity=snapshotId+':'+collection+':'+index;
    if(record.requires_review===true||record.crossed_out===true)diagnostics.push({code:'held-record',entityRef:entity});
    if(collection==='relatives'&&(own(record,'relationship')||own(record,'relation')))addFact('family.relative.relationship',['profile.relatives.'+index+'.relationship','profile.relatives.'+index+'.relation'],record,entity);
    for(const key of Object.keys(record)){
     if(collection==='relatives'&&['relationship','relation'].includes(key))continue;
     if(metadataKeys.has(key))continue;
     if(!recordFields[collection].has(key)){recordUnmapped.push('profile.'+collection+'.'+index+'.'+key);continue;}
     addFact(collectionIds[collection]+'.'+key,['profile.'+collection+'.'+index+'.'+key],record,entity);
    }
   }
  }
  // Only explicit activity receipts with an exact current value and an eligible
  // document can recover scalar provenance. Missing history is never "manual".
  const events=copy(input.activity||[]).sort((a,b)=>String(b.occurred_at||'').localeCompare(String(a.occurred_at||'')));
  for(const fact of facts.filter(f=>f.entityRef==='candidate:'+candidate.id&&f.provenanceState==='legacy_unknown')){
   for(const event of events){
    if(event.candidate_id!==candidate.id||!['candidates_update','personal_files_update'].includes(event.action))continue;
    const changes=object(event.changes),table=event.action==='personal_files_update'?'personal_file':'candidate';let found=false;
    for(const path of fact.legacyLocations){const parts=path.split('.');let receipt;
     if(parts[0]===table&&parts.length===2&&own(changes,parts[1]))receipt=changes[parts[1]];
     if(parts[0]==='profile'&&own(changes,'profile_data')){const before=object(changes.profile_data.before),after=object(changes.profile_data.after);if(!equal(at(before,parts.slice(1).join('.')),at(after,parts.slice(1).join('.'))))receipt={after:at(after,parts.slice(1).join('.'))};}
     if(!receipt)continue;found=true;const doc=docById.get(event.source_document_id);
     if(equal(receipt.after,fact.value)&&doc&&doc.verification_status==='Підтверджено'&&!['AI помилка','AI обробка'].includes(doc.processing_status)){
      fact.provenanceState='documented';fact.sourceRefs.push({...source(doc),activityId:event.id||null});
     }break;
    }if(found)break;
   }
  }
  let items=[];
  try{
   if(root.CRMIntake?.items)items=root.CRMIntake.items(copy(candidate),copy(eligible));
   else if(root.CRMDocumentSync?.plan){diagnostics.push({code:'partial-planner-without-intake'});items=eligible.map(doc=>({doc,plan:['AI помилка','AI обробка'].includes(doc.processing_status)?null:root.CRMDocumentSync.plan(copy(doc),copy(candidate))}));}
   else diagnostics.push({code:'planner-unavailable'});
  }catch{diagnostics.push({code:'planner-failed'});}
  for(const item of items){
   const doc=docById.get(item.doc.id);if(!doc)continue;
   if(item.error){diagnostics.push({code:'document-plan-failed',documentId:doc.id});continue;}
   if(['AI помилка','AI обробка'].includes(doc.processing_status)){issues.push({kind:'technical-state',documentId:doc.id,state:doc.processing_status});continue;}
   for(const [index,row] of (item.plan?.rows||[]).entries()){
    if(!['candidate','profile'].includes(row.target)||!row.key)continue;
    const path=row.target+'.'+row.key;let fact=byLocation.get(path);
    if(!fact)fact=addFact('legacy.'+row.target+'.'+row.key,[path]);
    if(!empty(row.current)&&!equal(row.current,fact.value)){
     diagnostics.push({code:'planner-current-divergence',factId:fact.id,documentId:doc.id,location:path});
     fact.protected=true;fact.protectionReason=fact.protectionReason||'legacy-planner-value';
    }
    const claim={id:'claim:'+ref([snapshotId,doc.id,doc.version_number,row.target,row.key,index]),candidateId:candidate.id,entityRef:fact.entityRef,fieldId:fact.fieldId,
     rawValue:copy(row.incoming),rawValueOrigin:'existing-planner-proposal',normalizedComparisonValue:norm(row.incoming),source:source(doc,row),
     reviewState:'unreviewed',extractionStatus:doc.processing_status||'unknown',proposalAction:row.action,
     target:row.target,key:row.key,reason:row.reason||'',plannerCurrent:copy(row.current)};
    claims.push(claim);fact.claimRefs.push(claim.id);
    const saved=object(doc.ai_extracted)._crm_review_decisions;
    for(const [di,d] of (Array.isArray(saved)?saved:[]).entries()){
     if(d.target!==row.target||d.key!==row.key)continue;
     const current=d.action==='keep_card'&&!!d.reviewed_by&&!!d.reviewed_at&&equal(d.current,row.current)&&equal(d.incoming,row.incoming)&&d.reason===row.reason;
     const decision={id:'decision:'+ref([doc.id,di]),candidateId:candidate.id,entityRef:fact.entityRef,fieldId:fact.fieldId,action:d.action,
      state:current?'current-container-match':'stale-or-unverified',sourceBinding:'container-only',actorId:d.reviewed_by||null,reviewedAt:d.reviewed_at||null,documentId:doc.id};
     const previous=decisions.find(x=>x.id===decision.id);
     if(!previous)decisions.push(decision);else if(current)Object.assign(previous,decision);
     if(current){fact.decisionRefs.push(decision.id);fact.protected=true;fact.protectionReason='keep-card-decision';}
    }
    if(row.action==='conflict')issues.push({kind:'proposal-conflict',factId:fact.id,claimId:claim.id,reason:row.reason||'',documentId:doc.id});
   }
  }
  for(const doc of eligible){
   const saved=object(doc.ai_extracted)._crm_review_decisions;
   for(const [index,d] of (Array.isArray(saved)?saved:[]).entries()){
    const id='decision:'+ref([doc.id,index]);if(decisions.some(x=>x.id===id))continue;
    decisions.push({id,candidateId:candidate.id,entityRef:'candidate:'+candidate.id,fieldId:'legacy.'+d.target+'.'+d.key,action:d.action,
     state:'not-in-current-plan',sourceBinding:'container-only',actorId:d.reviewed_by||null,reviewedAt:d.reviewed_at||null,documentId:doc.id});
   }
  }
  if(decisions.length)diagnostics.push({code:'legacy-decision-source-snapshot-unavailable',count:decisions.length});
  const ownershipBlocked=new Set(items.filter(item=>(item.plan?.rows||[]).some(row=>/власник|інш.*особ|ПІБ не збігається/iu.test(row.reason||''))).map(item=>item.doc.id));
  for(const fact of facts){
   const rejected=fact.sourceRefs.filter(s=>ownershipBlocked.has(s.documentId));
   if(rejected.length){fact.sourceRefs=fact.sourceRefs.filter(s=>!ownershipBlocked.has(s.documentId));
    if(fact.provenanceState==='documented'&&!fact.sourceRefs.length)fact.provenanceState='legacy_unknown';
    diagnostics.push({code:'provenance-owner-blocked',factId:fact.id,documentIds:rejected.map(s=>s.documentId)});
   }
  }
  // A record marked accepted_by_ai is deliberately not a human confirmation.
  const unmapped=[...recordUnmapped];
  for(const [prefix,record] of [['candidate',candidate],['profile',profile],['personal_file',personal]])for(const key of Object.keys(record)){
   if(prefix==='candidate'&&key==='profile_data')continue;
   const path=prefix+'.'+key;if(!covered.has(path))unmapped.push(path);
  }
  // Print edits are presentation values, never evidence or canonical candidate facts.
  const printOverrides=Object.entries(object(profile.service_record_print)).map(([key,value])=>({
   key,value:copy(value),location:'profile.service_record_print.'+key,
   fieldGroupId:root.CRMFieldRegistry?.forPrintKey?.(key)?.id||null,
   state:typeof value==='string'?'stored-print-override':'invalid-print-override',
   provenanceState:'legacy_unknown',protected:true
  }));
  if(own(profile,'service_record_print')){covered.add('profile.service_record_print');
   const index=unmapped.indexOf('profile.service_record_print');if(index>=0)unmapped.splice(index,1);
  }
  for(const override of printOverrides)if(override.state==='invalid-print-override'||!override.fieldGroupId)diagnostics.push({code:override.state==='invalid-print-override'?'invalid-print-override':'unmapped-print-override',location:override.location});
  const citizenship=facts.find(f=>f.fieldId==='identity.citizenship');
  const displayDefaults=citizenship?.valueState==='unknown'?[{fieldId:'identity.citizenship',value:'Україна',origin:'form-default',persisted:false}]:[];
  const conflicts=issues.filter(i=>i.kind==='proposal-conflict').length;
  const baseline=Number.isInteger(input.comparison?.conflictCount)?input.comparison.conflictCount:null;
  return {version:1,mode:'shadow',snapshotId,candidateId:candidate.id,facts,claims,issues,decisions,diagnostics,printOverrides,displayDefaults,
   coverage:{mappedLocations:[...covered],unmappedLocations:unmapped,excludedDocuments:excluded,documentScope:'supplied-snapshot'},
   shadow:{conflictCount:conflicts,baselineConflictCount:baseline,conflictDelta:baseline===null?null:conflicts-baseline,automaticWrites:0}};
 }
 function render(host,model){
  const summary=document.createElement('summary');summary.textContent='Діагностика джерел (без запису)';
  const details=document.createElement('details');details.className='cc-facts-shadow';details.append(summary);
  const intro=document.createElement('p');intro.textContent='Діагностичний режим: факти '+model.facts.length+', пропозиції '+model.claims.length+', непокриті шляхи '+model.coverage.unmappedLocations.length+'. Друковані правки '+model.printOverrides.length+'. Не змінює картку або правила друку.';details.append(intro);
  for(const value of model.displayDefaults){const row=document.createElement('p');row.textContent='Громадянство: '+value.value+' — значення за замовчуванням, можна змінити в картці. Джерело-документ не встановлено.';details.append(row);}
  if(model.shadow.conflictDelta!==null){const compare=document.createElement('p');compare.textContent='Конфлікти: чинний звіт '+model.shadow.baselineConflictCount+', адаптер '+model.shadow.conflictCount+'. Різниця '+model.shadow.conflictDelta+' (без застосування змін).';details.append(compare);}
  const unmapped=[...new Set(model.coverage.unmappedLocations)].sort();
  if(unmapped.length){const section=document.createElement('details'),title=document.createElement('summary');title.textContent='Що ще не охоплено діагностикою: '+unmapped.length;section.append(title);
   const note=document.createElement('p');note.textContent='Ці збережені поля ще не мають повного відображення в адаптері. Це не означає, що дані відсутні або їх треба видалити. Значення тут не виводяться.';section.append(note);
   for(const path of unmapped){const item=document.createElement('p');item.textContent=path;section.append(item);}details.append(section);
  }
  const diagnosticLabels={'reader-route-divergence':'Картка й послужний читають різні резервні значення','unavailable-provenance':'Посилання на джерело недоступне','legacy-path-divergence':'У збережених полях є різні значення','invalid-collection':'Неправильний формат списку','invalid-record':'Неправильний формат запису','held-record':'Запис очікує перевірки','invalid-structured-object':'Не вдалося прочитати реквізити','planner-unavailable':'Чинний механізм зіставлення недоступний','planner-failed':'Не вдалося побудувати зіставлення','document-plan-failed':'Не вдалося зіставити документ','partial-planner-without-intake':'Доступна лише частина чинних перевірок','planner-current-divergence':'Адаптер і чинне зіставлення читають різні значення','legacy-decision-source-snapshot-unavailable':'Для старого рішення немає повного знімка джерела','provenance-owner-blocked':'Джерело має розбіжність щодо власника','invalid-print-override':'Неправильний формат друкованої правки','unmapped-print-override':'Друкована правка не відповідає відомому полю'};
  if(model.diagnostics.length){const section=document.createElement('details'),title=document.createElement('summary');title.textContent='Пояснення діагностики: '+model.diagnostics.length;section.append(title);
   for(const diagnostic of model.diagnostics){const item=document.createElement('p');item.textContent=(diagnosticLabels[diagnostic.code]||'Інша діагностична подія')+' · '+diagnostic.code+(diagnostic.location?' · '+diagnostic.location:'');section.append(item);}details.append(section);
  }
  for(const fact of model.facts.filter(f=>!empty(f.value))){const row=document.createElement('p');
   row.textContent=fact.fieldId+' · '+({documented:'є явне джерело',human_confirmed:'є ручна позначка підтвердження',legacy_unknown:'джерело не встановлено'})[fact.provenanceState]+(fact.protected?' · захищено':'')+(fact.held?' · запис потребує перевірки':'');
   for(const source of fact.sourceRefs){const button=document.createElement('button');button.type='button';button.textContent='Відкрити джерело';
    button.onclick=async()=>{button.disabled=true;try{if(typeof root.openDocument!=='function')throw Error('Перегляд документа недоступний');await root.openDocument(source.documentId);}catch{button.textContent='Не вдалося відкрити джерело';}finally{button.disabled=false;}};row.append(button);}
   details.append(row);}
  host.replaceChildren(details);
 }
 root.CRMCandidateFacts={build,enabled,render};
})(typeof window==='undefined'?globalThis:window);
