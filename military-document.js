(function(){
'use strict';
const norm=v=>String(v??'').normalize('NFKC').replace(/[’ʼ]/g,"'").replace(/\s+/g,' ').trim().toLocaleLowerCase('uk-UA');
const isDocument=t=>/військов(?:ий|ого) квиток|військового квитка|посвідчення офіцера/iu.test(String(t||''));
const present=v=>v!==null&&v!==undefined&&v!=='';
function review(e,c,p={},documentId){
 const issues=[],fields={},records=(Array.isArray(p.work_records)?p.work_records:[]).map(r=>({...r}));
 const owner=e.full_name||e.name_nominative;
 if(!owner||norm(owner)!==norm(c.name_nominative||c.full_name)||(e.birth_date&&c.birth_date&&e.birth_date!==c.birth_date)||(e.rnokpp&&c.rnokpp&&e.rnokpp!==c.rnokpp))return {blocked:true,issues:['Власника військового документа не звірено.'],fields,records,accepted:0};
 const evidence=e.field_evidence||e.meta?.field_evidence||{};
 const safe=k=>!evidence[k]?.requires_review&&!['low','unreadable'].includes(evidence[k]?.legibility);
 for(const k of ['military_document_number','military_document_type','military_registration_date','military_registration_category','military_registration_status','military_training_status'])if(present(e[k])&&safe(k))fields[k]=e[k];
 if(!fields.military_document_number&&safe('document_number')&&present(e.document_number))fields.military_document_number=[e.document_series,e.document_number].filter(present).join(' ');
 const training=(Array.isArray(e.military_training_records)?e.military_training_records:[]).filter(r=>r&&!r.requires_review).map(r=>[r.training_type,r.date,r.unit,r.military_specialty&&'ВОС '+r.military_specialty,r.order_number&&'наказ '+r.order_number].filter(present).join(' · '));
 if(training.length&&!fields.military_training_status)fields.military_training_status=training.join('\n');
 const extra=[e.document_date&&'Дата видачі: '+e.document_date,e.document_issuer&&'Ким виданий: '+e.document_issuer,...(Array.isArray(e.military_rank_records)?e.military_rank_records:[]).filter(r=>r&&!r.requires_review).map(r=>['Звання: '+r.rank,r.date,r.unit,r.order_number&&'наказ '+r.order_number].filter(present).join(' · ')),e.military_oath&&!e.military_oath.requires_review&&e.military_oath.date&&'Присяга: '+e.military_oath.date+' · '+(e.military_oath.unit||'')].filter(Boolean);
 let accepted=0;
 for(const r of Array.isArray(e.military_service_records)?e.military_service_records:[]){
  if(!r||r.requires_review||!CRMWork.date(r.start_date)||!r.unit||(r.end_date&&(!CRMWork.date(r.end_date)||r.end_date<r.start_date))){issues.push('Нечіткий період залишено в контейнері документа.');continue;}
  const item={kind:'military_service',employer:r.unit,position:r.position||r.disposition||null,start_date:r.start_date,end_date:r.end_date||null,military_specialty:r.military_specialty||null,order_number:r.order_number||null,end_order_number:r.end_order_number||null,source_document_id:documentId,source_pages:[r.page].filter(present),raw_text:r.raw_text||null,crossed_out:!!r.crossed_out,requires_review:false};
  const same=records.find(x=>x.kind==='military_service'&&norm(x.employer)===norm(item.employer)&&x.start_date===item.start_date&&norm(x.order_number)===norm(item.order_number));
  if(!same){records.push(item);accepted++;}else if(['position','military_specialty','end_date'].some(k=>present(same[k])&&present(item[k])&&norm(same[k])!==norm(item[k])))issues.push('Конфлікт періоду '+item.start_date+': чинний запис збережено.');
 }
 return {blocked:false,issues,fields,records,accepted,history:records.filter(r=>r.kind==='military_service').map(r=>[r.start_date,r.end_date||'завершення не зазначене',r.employer,r.military_specialty&&'ВОС '+r.military_specialty,r.position,r.order_number&&'наказ '+r.order_number].filter(Boolean).join(' · ')).concat(extra).join('\n')};
}
window.CRMMilitary={isDocument,review};
})();
