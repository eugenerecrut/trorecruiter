// Cross-document evidence comparison. Read-only; never turns AI agreement into training truth.
(function(root){
'use strict';
const norm=v=>String(v??'').normalize('NFKC').replace(/[’ʼ`]/g,"'").trim().replace(/\s+/g,' ').toLocaleLowerCase('uk');
const obj=v=>{try{return typeof v==='string'?JSON.parse(v):v||{}}catch(_){return {}}};
const keys=['rnokpp','birth_date','birth_place'];
function birthplaceTokens(value){
 // Only explicit labels and adjective forms immediately preceding an administrative label.
 // No locality aliases, district renames, transliteration or inferred country.
 const labels={'обл':'область','області':'область','р-н':'район','району':'район','село':'с','місто':'м'};
 const tokens=norm(value).replace(/[,.;:]/gu,' ').split(/\s+/u).filter(Boolean).map(t=>labels[t]||t);
 for(let i=1;i<tokens.length;i++)if(['область','район'].includes(tokens[i])){
  tokens[i-1]=tokens[i-1].replace(/ської$/u,'ська').replace(/ського$/u,'ський');
 }
 return tokens.sort();
}
// Similar wording warrants review, never an automatic assertion of geographic identity.
function birthplaceReview(sources,current){
 const values=[...sources.map(s=>s.value),current].filter(v=>typeof v==='string'&&v.trim());
 if(new Set(values.map(norm)).size<2)return false;
 const lists=values.map(birthplaceTokens),fullest=lists.reduce((a,b)=>a.length>=b.length?a:b,[]);
 // A real source/card value must contain every explicit token; do not synthesize a merged address.
 return lists.every(tokens=>{const remaining=[...fullest];return tokens.length>=2&&tokens.every(t=>{const k=remaining.indexOf(t);if(k<0)return false;remaining.splice(k,1);return true;});});
}
function facts(d){const e=obj(d.ai_extracted),p=obj(e.personal);return Object.fromEntries(keys.map(k=>[k,e[k]??p[k]]));}
function eligibleDocuments(documents,candidate){
 const latest=new Map();
 for(const d of documents){if(d.deleted_at||d.candidate_id!==candidate.id||!d.storage_path)continue;
  const group=d.version_group_id||d.id,old=latest.get(group);
  if(!old||Number(d.version_number||1)>Number(old.version_number||1)||Number(d.version_number||1)===Number(old.version_number||1)&&String(d.created_at||'')>String(old.created_at||''))latest.set(group,d);
 }
 const eligible=[...latest.values()].filter(d=>{
  const e=obj(d.ai_extracted),p=obj(e.personal),name=e.full_name||p.full_name;
  if(/послужний список|анкета на контракт|перелік документів|реєстр кандидата|титульний/iu.test(d.document_type||''))return false;
  if(/дітей|шлюб|змін.{0,12}(імен|прізв)/iu.test(d.document_type||''))return false;
  if(['AI помилка','AI обробка'].includes(d.processing_status)||/AI REVIEW REQUIRED/.test(d.notes||''))return false;
  if(d.verification_status!=='Підтверджено'&&(d.ai_confidence==null||Number(d.ai_confidence)<.85||Number(d.ai_confidence)>1))return false;
  if(name&&norm(name)===norm(candidate.full_name))return true;
  return !!(name&&root.CRMNameHistory?.matches(name,candidate));
 });
 return eligible;
}
function compare(documents,candidate){
 const eligible=eligibleDocuments(documents,candidate);
 const scalar=keys.map(key=>{
  const sources=[],seen=new Set();
  for(const d of eligible){const raw=obj(d.ai_extracted),personal=obj(raw.personal);if(raw[key]!=null&&personal[key]!=null&&norm(raw[key])!==norm(personal[key]))continue;
   const value=facts(d)[key];if(typeof value!=='string'||!value.trim())continue;
   if(key==='rnokpp'&&!/^\d{10}$/.test(value))continue;
   if(key==='birth_date'&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||isNaN(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value))continue;
   // A reuploaded file is one source, even if assigned to another requirement.
   const fingerprint=d.file_hash||d.storage_path,signature=fingerprint+'|'+norm(value);if(seen.has(signature))continue;seen.add(signature);
   sources.push({document_id:d.id,document_type:d.document_type,file_name:d.file_name,value,fingerprint,verified:d.verification_status==='Підтверджено'});
  }
  const values=new Set(sources.map(s=>norm(s.value))),current=candidate[key];
  return {key,current:current??null,sources,status:values.size>1||current!=null&&String(current).trim()&&sources.some(s=>norm(s.value)!==norm(current))?'conflict':new Set(sources.map(s=>s.fingerprint)).size>1?'corroborated':sources.length?'single_source':'missing',learning_eligible:false};
 });
 for(const entry of scalar)if(entry.key==='birth_place'&&birthplaceReview(entry.sources,entry.current)){entry.status='needs_review';entry.reason='Записи відрізняються форматом або повнотою. Тотожність місця потрібно підтвердити; картка не змінена.';}
 return [...scalar,...structured(eligible,candidate),...periodLinks(eligible)];
}
function structured(documents,candidate){
 const groups=new Map(),current=candidate.profile_data||{};
 const role=v=>({mother:'мати',father:'батько',wife:'дружина',husband:'чоловік',son:'син',daughter:'донька'})[norm(v)]||norm(v);
 function add(key,subject,value,d,row){const id=key+'|'+subject;const entry=groups.get(id)||{key,subject,current:null,sources:[],learning_eligible:false};entry.sources.push({document_id:d.id,document_type:d.document_type,file_name:d.file_name,value,verified:d.verification_status==='Підтверджено',fingerprint:d.file_hash||d.storage_path,page:row.page||row.source_pages||null,raw_text:row.raw_text||null});groups.set(id,entry);}
 for(const d of documents){
  const e=obj(d.ai_extracted);
  for(const r of (Array.isArray(e.relatives)?e.relatives:Array.isArray(e.family?.relatives)?e.family.relatives:[])){const rel=role(r.relationship||r.relation),name=r.full_name||r.name;if(!['мати','батько'].includes(rel)||!name||r.requires_review)continue;add('relatives',rel,String(name),d,r);}
  for(const [source,key] of [['education_records','education_records'],['work_events','work_records'],['military_service_records','work_records']])for(const r of Array.isArray(e[source])?e[source]:[]){
   if(!r||r.requires_review||r.crossed_out)continue;
   // Only stable event anchors permit comparison; an employer alone is not an event.
   let anchor;if(source==='education_records'){if(!r.diploma_number||!r.institution)continue;anchor='education|'+norm(r.institution)+'|'+norm(r.diploma_series)+'|'+norm(r.diploma_number);}
   else{if(!r.start_date||!r.end_date||!(r.unit||r.employer)||!r.position)continue;anchor=source+'|'+norm(r.kind)+'|'+norm(r.unit||r.employer)+'|'+norm(r.position)+'|'+JSON.stringify([r.start_date,r.end_date]);}
   const value=source==='education_records'?JSON.stringify([norm(r.institution),norm(r.degree),norm(r.specialty),String(r.graduation_year||'')]):JSON.stringify([r.start_date,r.end_date,norm(r.position),norm(r.unit||r.employer),norm(r.order_number)]);add(key,anchor,value,d,r);
  }
 }
 return [...groups.values()].map(entry=>{const unique=new Map();for(const s of entry.sources)unique.set((s.fingerprint||s.document_id)+'|'+norm(s.value),s);entry.sources=[...unique.values()];if(entry.key==='relatives'){const stored=(current.relatives||[]).find(r=>role(r.relationship||r.relation)===entry.subject);entry.current=stored?.full_name||null;}const values=new Set(entry.sources.map(s=>norm(s.value)));entry.status=values.size>1||entry.current&&entry.sources.some(s=>norm(s.value)!==norm(entry.current))?'conflict':new Set(entry.sources.map(s=>s.fingerprint||s.document_id)).size>1?'corroborated':'single_source';return entry;});
}
// A partial date is an interval, never a guessed first day.
function dateRange(value){
 const v=typeof value==='object'&&value?value.value:value;
 if(typeof v!=='string'||!/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(v))return null;
 const [y,m=1,d=1]=v.split('-').map(Number),dt=new Date(Date.UTC(y,m-1,d));
 if(y<1800||dt.getUTCFullYear()!==y||dt.getUTCMonth()!==m-1||dt.getUTCDate()!==d)return null;
 const min=dt.toISOString().slice(0,10),max=v.length===4?String(y)+'-12-31':v.length===7?String(y)+'-'+String(m).padStart(2,'0')+'-'+new Date(Date.UTC(y,m,0)).getUTCDate():min;
 return {value:v,min,max};
}
function periodLinks(documents){
 const records=[],links=[];
 for(const d of documents){const e=obj(d.ai_extracted);
  for(const key of ['work_events','work_records','military_service_records'])for(const r of Array.isArray(e[key])?e[key]:[]){
   if(!r||r.requires_review||r.crossed_out)continue;
   const kind=key==='military_service_records'?'military_service':r.kind;
   if(!['employment','military_service','police_service'].includes(kind))continue;
   const start=dateRange(r.start_date),end=r.end_date?dateRange(r.end_date):null,unit=norm(r.unit||r.employer),position=norm(r.position);
   if(!start||r.end_date&&!end||end&&end.max<start.min||!unit||!position)continue;
   records.push({d,r,kind,start,end,unit,position});
  }
 }
 for(let i=0;i<records.length;i++)for(let j=i+1;j<records.length;j++){
  const a=records[i],b=records[j];
  if(a.d.id===b.d.id||a.kind!==b.kind||a.unit!==b.unit||a.position!==b.position||a.d.file_hash&&a.d.file_hash===b.d.file_hash)continue;
  // Separate non-overlapping appointments at the same employer remain separate.
  if((a.end?.max||'9999-12-31')<b.start.min||(b.end?.max||'9999-12-31')<a.start.min)continue;
  const same=a.start.value===b.start.value&&a.end?.value===b.end?.value;
  if(same)continue; // Existing exact-event comparison handles this case.
  const compatible=a.start.min<=b.start.max&&b.start.min<=a.start.max&&(!a.end||!b.end||a.end.min<=b.end.max&&b.end.min<=a.end.max);
  links.push({key:'work_records',subject:a.kind+' · '+(a.r.unit||a.r.employer)+' · '+a.r.position,status:'needs_review',reason:compatible?'Ймовірно один період із різною точністю дат. Не об’єднано автоматично.':'Періоди перекриваються, але дати різні. Можливе уточнення або окремі події.',learning_eligible:false,current:null,sources:[a,b].map(v=>({document_id:v.d.id,document_type:v.d.document_type,file_name:v.d.file_name,value:[v.start.value,v.end?.value||'завершення не визначено',v.r.position,v.r.unit||v.r.employer].join(' · '),page:v.r.page||v.r.source_pages||null,raw_text:v.r.raw_text||null}))});
 }
 return links;
}
function compareZones(documents,candidate,{reports=[],context,binding}={}){
 if(!context||typeof context.revision!=='string'||!context.revision||!/^[a-f0-9]{64}$/.test(context.file_sha256||'')||!Number.isInteger(context.pages)||context.pages<1||context.pages>200)return [];
 const document=eligibleDocuments(documents,candidate).find(d=>d.id===context.document_id);if(!document||document.ai_processed_at!==context.revision||document.file_hash&&document.file_hash!==context.file_sha256)return [];
 const base=compare(documents,candidate),groups=new Map(),seen=new Set();
 const validBox=b=>b&&['x','y','w','h'].every(k=>Number.isFinite(b[k])&&b[k]>=0&&b[k]<=1)&&b.w>0&&b.h>0&&b.x+b.w<=1.000001&&b.y+b.h<=1.000001;
 for(const report of Array.isArray(reports)?reports:[]){
  const s=report?.source;if(report?.review_only!==true||report.mode!=='zone'||s?.document_id!==document.id||!Number.isInteger(s.page)||s.page<1||s.page>context.pages||!validBox(s.box))continue;
  if(s.file_sha256!==undefined?s.file_sha256!==context.file_sha256:!binding||binding.document_id!==document.id||binding.file_sha256!==context.file_sha256||binding.revision!==context.revision)continue;
  const rows=Array.isArray(report.rows)?report.rows:[];
  // Generic birth fields in a family/mixed-person region must never become candidate identity facts.
  if(rows.some(row=>(Array.isArray(row?.fields)?row.fields:[]).some(f=>['relative_name','relationship'].includes(f?.key)||f?.key==='full_name'&&norm(f.value)!==norm(candidate.full_name)&&!root.CRMNameHistory?.matches(f.value,candidate))))continue;
  for(const row of rows)for(const field of Array.isArray(row?.fields)?row.fields:[]){
   if(!keys.includes(field?.key))continue;const value=field.value;
   const valid=typeof value==='string'&&!!value.trim()&&(field.key!=='rnokpp'||/^\d{10}$/.test(value))&&(field.key!=='birth_date'||/^\d{4}-\d{2}-\d{2}$/.test(value)&&!isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value);
   const uncertain=!valid||field.legibility!=='clear'||Array.isArray(field.alternatives)&&field.alternatives.length>0;
   const signature=JSON.stringify([field.key,s.page,s.box.x,s.box.y,s.box.w,s.box.h,value,uncertain]);if(seen.has(signature))continue;seen.add(signature);
   const group=groups.get(field.key)||{key:field.key,current:candidate[field.key]??null,sources:[],zone_crosscheck:true,learning_eligible:false,uncertain:false};
   group.uncertain ||= uncertain;
   group.sources.push({document_id:document.id,document_type:document.document_type,file_name:document.file_name,value:valid?value:'Не визначено',raw_text:field.raw_text||null,page:s.page,box:{...s.box},fingerprint:context.file_sha256,verified:false,kind:'zone_reading'});groups.set(field.key,group);
  }
 }
 return [...groups.values()].map(group=>{
  const others=base.find(e=>e.key===group.key)?.sources||[];
  for(const source of others)group.sources.push({...source,fingerprint:source.document_id===document.id||source.fingerprint===context.file_sha256?context.file_sha256:source.fingerprint});
  const values=new Set(group.sources.filter(s=>s.value!=='Не визначено').map(s=>norm(s.value))),current=group.current;
  const conflict=values.size>1||current!=null&&String(current).trim()&&group.sources.some(s=>s.value!=='Не визначено'&&norm(s.value)!==norm(current));
  group.status=group.uncertain?'needs_review':conflict?'conflict':new Set(group.sources.map(s=>s.fingerprint)).size>1?'corroborated':'single_source';
  group.reason=group.uncertain?'Зональне читання непевне або має альтернативи; підтвердження потрібне.':'Зіставлено збережене зональне читання. Збіг не є ручним підтвердженням; картка не змінюється.';
  if(!group.uncertain&&group.key==='birth_place'&&birthplaceReview(group.sources.filter(s=>s.value!=='Не визначено'),current)){group.status='needs_review';group.reason='Записи місця народження відрізняються форматом або повнотою; потрібне підтвердження, картка не змінена.';}
  delete group.uncertain;return group;
 });
}
async function load(client,candidate,options){const r=await client.from('documents').select('*').eq('candidate_id',candidate.id);if(r.error)throw r.error;if(!Array.isArray(r.data))throw Error('Не отримано пакет документів для звірки');return [...compare(r.data,candidate),...compareZones(r.data,candidate,options)];}
function guard(report,evidence){report.crosscheck=evidence;const conflicts=evidence.filter(e=>['conflict','needs_review'].includes(e.status));
 // Block proposed writes, retaining the original reason for existing conflicts.
 // An unchanged/absent value in an unrelated document is not another conflicting fact.
 for(const row of report.rows){if(row.action!=='fill'||!conflicts.some(e=>e.key===row.key)||!['candidate','profile'].includes(row.target))continue;row.action='conflict';row.reason='Розбіжність між документами кандидата';}
 report.selections=report.selections.filter(s=>!(['candidate','profile'].includes(s.target)&&conflicts.some(e=>e.key===s.key)));return report;
}
const api={compare,load,guard,dateRange,periodLinks,compareZones};root.CRMDocumentCrosscheck=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window==='undefined'?globalThis:window);
