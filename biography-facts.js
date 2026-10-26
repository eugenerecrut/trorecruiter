// Shared, read-only projection of accepted autobiography facts into output forms.
(function(root){
'use strict';
const list=v=>Array.isArray(v)?v:[],norm=v=>String(v||'').normalize('NFKC').toLocaleLowerCase('uk-UA').replace(/[«»"']/g,'').replace(/\s+/g,' ').trim();
function partial(v){
 const value=typeof v==='object'&&v?v.value:v;if(typeof value!=='string')return null;
 if(/^\d{4}$/.test(value))return {value,min:value+'-01-01',max:value+'-12-31'};
 if(/^\d{4}-(0[1-9]|1[0-2])$/.test(value)){const [year,month]=value.split('-').map(Number);return {value,min:value+'-01',max:value+'-'+new Date(Date.UTC(year,month,0)).getUTCDate()};}
 if(/^\d{4}-\d{2}-\d{2}$/.test(value)){const d=new Date(value+'T00:00:00Z');if(Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value)return {value,min:value,max:value};}
 return null;
}
function profile(input={}){
 const p=structuredClone(input),work=list(p.work_records),education=list(p.education_records);
 const usable=r=>r&&!r.requires_review&&!r.crossed_out&&r.source_document_id;
 for(const r of list(p.bio_work_claims)){
  const start=partial(r?.start_date),end=partial(r?.end_date);if(!usable(r)||!r.employer||!start||(r.end_date&&!end)||(end&&end.max<start.min))continue;
  const existing=work.some(old=>old&&old.kind==='employment'&&norm(old.employer)===norm(r.employer)&&partial(old.start_date)?.min<=(end?.max||'9999')&&(!partial(old.end_date)||partial(old.end_date).max>=start.min));
  if(existing)continue;
  work.push({...r,kind:'employment',start_date:start.value,end_date:end?.value||null,source_type:'autobiography',date_precision:{start:start.value.length===4?'year':start.value.length===7?'month':'day',end:!end?null:end.value.length===4?'year':end.value.length===7?'month':'day'}});
 }
 // A diploma remains authoritative; fallback does not invent additional degrees.
 for(const r of list(p.bio_education_claims)){
  if(!usable(r)||!r.institution)continue;
  const accepted=education.filter(e=>e&&!e.requires_review),year=partial(r.end_date)?.value.slice(0,4);
  if(accepted.some(e=>norm(e.institution)===norm(r.institution)&&(!e.graduation_year||!year||String(e.graduation_year)===year)))continue;
  // An incomplete existing diploma cannot safely be distinguished from the biography claim.
  if(accepted.some(e=>!e.degree&&!e.graduation_year))continue;
  const end=partial(r.end_date);education.push({...r,study_start_date:partial(r.start_date)?.value||null,study_end_date:end?.value||null,graduation_year:end?.value.slice(0,4)||null,source_type:'autobiography'});
 }
 p.work_records=work;p.education_records=education;return p;
}
const api={profile,partial};root.CRMBiographyFacts=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
