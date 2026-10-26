// Read-only checks for the data used by the fixed service-record form.
(function(root){
'use strict';
const object=v=>{if(typeof v==='string'){try{return JSON.parse(v)||{}}catch{return {}}}return v&&typeof v==='object'?v:{}};
const list=v=>Array.isArray(v)?v:[];
const blank=v=>v==null||typeof v==='string'&&!v.trim();
const bool=v=>v===true||v==='true'?true:v===false||v==='false'?false:null;
const norm=v=>String(v||'').trim().replace(/\s+/g,' ').toLocaleLowerCase('uk-UA');
function date(v){if(!/^\d{4}-\d{2}-\d{2}$/.test(String(v||'')))return false;const d=new Date(v+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v;}
function review(c,pf={},documents=[]){
 const raw=object(c.profile_data),p=root.CRMBiographyFacts?root.CRMBiographyFacts.profile(raw):raw,issues=[],notes=[];
 const docs=(root.CRMResponsibility?.latest(documents)||documents.filter(d=>!d.deleted_at)).filter(d=>!d.candidate_id||d.candidate_id===c.id);
 function add(fieldId,text,record){const field=root.CRMFieldRegistry.fields.find(f=>f.id===fieldId);const ids=record?.source_document_id?[record.source_document_id]:[];issues.push({fieldId,label:field?.label||fieldId,text,sources:field?.sources||[],documents:docs.filter(d=>ids.includes(d.id)).map(d=>({id:d.id,name:d.file_name||d.document_type}))});}
 for(const [key,id] of [['education_records','education.civil'],['work_records','service.records'],['military_rank_records','military.rank_order'],['relatives','family.members'],['awards','combat.awards'],['combat_records','combat.periods'],['reserve_training_records','service.reserve_training']])if(raw[key]!=null&&!Array.isArray(raw[key]))add(id,'Некоректний формат збережених записів: потрібна звірка.');
 if(blank(c.name_nominative||c.full_name)||String(c.name_nominative||c.full_name).trim().split(/\s+/).length<2)add('identity.name','Уточніть чинне ПІБ.');
 if(!/^\d{10}$/.test(String(c.rnokpp||'')))add('identity.tax_number','Потрібен РНОКПП із 10 цифр або ручна звірка підстави його відсутності.');
 if(!date(c.birth_date)||c.birth_date>new Date().toISOString().slice(0,10))add('identity.birth_date','Уточніть повну дату народження.');
 if(blank(c.birth_place)&&blank(pf.birth_place))add('identity.birth_place','Укажіть місце народження з документа.');
 const worked=bool(c.worked_before??p.worked_before),served=bool(c.served_before??p.served_before);
 if(worked===null)add('employment.absence','Уточніть, чи працював кандидат.');
 if(served===null)add('service.absence','Уточніть, чи проходив кандидат військову службу.');
 const education=list(p.education_records),acceptedEducation=education.filter(r=>r&&!r.requires_review&&!r.crossed_out);
 if(!acceptedEducation.length&&blank(p.education_institution))add('education.civil','Немає закладу освіти для послужного.');
 for(const r of education){if(!r||r.requires_review||r.crossed_out){add('education.civil','Запис освіти потребує звірки або закреслений і не використовується у друці.',r);continue;}if(blank(r.institution))add('education.civil','У записі освіти бракує назви закладу.',r);if(r.graduation_year&&!/^\d{4}$/.test(String(r.graduation_year)))add('education.civil','Перевірте рік завершення навчання.',r);}
 function periods(kind,enabled,id){
  if(enabled!==true)return;
  const records=list(p.work_records).filter(r=>(r?.kind===kind||kind==='military_service'&&r?.kind==='police_service'));
  if(!records.length){add(id,'Немає структурованих періодів '+(kind==='employment'?'роботи.':'служби.'));return;}
  for(const [i,r] of records.entries()){
   const prefix='Запис '+(i+1)+': ';
   if(r.requires_review||r.crossed_out){add(id,prefix+'запис потребує звірки або закреслений у джерелі.',r);continue;}
   const start=r.source_type==='autobiography'?root.CRMBiographyFacts?.partial(r.start_date):date(r.start_date)?{min:r.start_date,max:r.start_date}:null;
   const end=r.source_type==='autobiography'?root.CRMBiographyFacts?.partial(r.end_date):date(r.end_date)?{min:r.end_date,max:r.end_date}:null;
   if(!start)add(id,prefix+'уточніть дату початку.',r);
   if(r.end_date&&(!end||start&&end.max<start.min))add(id,prefix+'перевірте дату завершення.',r);
   if(blank(kind==='employment'?r.employer:r.unit||r.employer))add(id,prefix+(kind==='employment'?'немає підприємства.':'немає військової частини.'),r);
   if(blank(r.position)&&blank(r.disposition))add(id,prefix+'немає посади.',r);
  }
  if(kind==='military_service'&&records.filter(r=>!r.requires_review&&!r.crossed_out).length>29)add(id,'У фіксованому бланку передбачено не більше 29 періодів служби.');
 }
 periods('employment',worked,'employment.records');periods('military_service',served,'service.records');
 if(served===true){for(const [key,id] of [['military_oath','service.oath'],['military_discharge','service.discharge']]){const r=p[key];if(r?.requires_review)add(id,'Відомості потребують перевірки.',r);for(const dateKey of ['date','order_date'])if(r?.[dateKey]&&!date(r[dateKey]))add(id,'Некоректна дата в документі.',r);}}
 for(const r of list(p.military_rank_records))if(!r||((r.confirmed_by_user===true||r.accepted_by_ai===true)&&norm(r.rank)===norm(c.military_rank)&&norm(c.military_rank)&&(r.requires_review||r.crossed_out)))add('military.rank_order','Наказ про звання потребує звірки й не використовується у друці.',r);
 const rankOrders=list(p.military_rank_records).filter(r=>(r?.confirmed_by_user===true||r?.accepted_by_ai===true)&&!r.requires_review&&!r.crossed_out&&norm(r.rank)===norm(c.military_rank)&&norm(c.military_rank));
 if(new Set(rankOrders.map(r=>JSON.stringify([r.order_issuer||'',r.order_number||'',r.order_date||'']))).size>1)add('military.rank_order','До чинного звання є кілька різних наказів: виберіть підтверджений.');
 for(const [key,id] of [['combat_records','combat.periods'],['awards','combat.awards'],['reserve_training_records','service.reserve_training']])for(const r of list(p[key])){
  if(!r||r.requires_review||r.crossed_out){add(id,'Є запис, що потребує звірки перед формуванням.',r);continue;}
  for(const k of ['start_date','end_date','order_date'])if(r[k]&&!date(r[k]))add(id,'Уточніть дату в записі.',r);
  if(date(r.start_date)&&date(r.end_date)&&r.end_date<r.start_date)add(id,'Завершення періоду раніше за початок.',r);
 }
 const relation=r=>norm(r.relationship||r.relation);
 for(const role of ['мати','батько','дружина','чоловік']){const people=list(p.relatives).filter(r=>relation(r)===role);if(new Set(people.map(r=>norm(r.full_name))).size>1)add(role==='мати'||role==='батько'?'family.parents':'family.members','Кілька різних записів: '+role+'. Звірте їх актуальність.');}
 if(!blank(p.family_residence_address)&&!p.family_residence_confirmed)add('family.address','Адреса родини є, але її не підтверджено для друку.');
 const overrides=Object.keys(object(p.service_record_print));if(overrides.length)notes.push('Є окремі правки для друку: '+overrides.length+'. Вони не замінюють перевірку первинних даних.');
 return {form:'service_record',ready:issues.length===0,issues,notes,checkedGroups:root.CRMFieldRegistry.fields.length,worked,served};
}
const api={review};root.CRMServiceReadiness=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window==='undefined'?globalThis:window);
