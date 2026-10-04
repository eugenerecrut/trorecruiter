(function(){
'use strict';
const norm=v=>String(v??'').normalize('NFKC').replace(/[’ʼ]/g,"'").replace(/\s+/g,' ').trim().toLocaleLowerCase('uk-UA');
const isDocument=t=>/автобіограф/iu.test(String(t||''));
function partial(v){
 if(!v)return null;const value=typeof v==='string'?v:v.value;
 if(/^\d{4}$/.test(value||''))return {value,precision:'year'};
 if(/^\d{4}-(0[1-9]|1[0-2])$/.test(value||''))return {value,precision:'month'};
 if(/^\d{4}-\d{2}-\d{2}$/.test(value||'')){const d=new Date(value+'T00:00:00Z');if(Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value)return {value,precision:'day'};}
 return null;
}
const list=v=>Array.isArray(v)?v:[];
const personKey=r=>norm(r.relationship)+'|'+norm(r.full_name);
const claimKey=r=>JSON.stringify([norm(r.institution||r.employer||r.unit),norm(r.degree||r.position),partial(r.start_date)?.value,partial(r.end_date)?.value]);
function mergeClaims(old,incoming,source){const result=list(old).map(r=>({...r}));for(const r of list(incoming)){if(!r||r.requires_review)continue;const entry={...r,start_date:partial(r.start_date),end_date:partial(r.end_date),source_document_id:source,source_type:'autobiography',confirmed_by_document:false};if(!result.some(x=>claimKey(x)===claimKey(entry)))result.push(entry);}return result;}
function review(e,c,p={},pf={},source){
 const a=e.autobiography||{},issues=[],conflicts=[],proposals=[];
 const owner=norm(a.owner_full_name||e.full_name||e.name_nominative),candidate=norm(c.name_nominative||c.full_name);
 if(!owner||owner!==candidate)issues.push('ПІБ автора не збігається з кандидатом або не визначено.');
 const dob=partial(a.owner_birth_date||e.birth_date);
 if(dob&&c.birth_date&&!String(c.birth_date).startsWith(dob.value))issues.push('Дата народження автора не збігається з карткою.');
 if(a.multiple_owners===true)issues.push('У файлі є відомості кількох авторів.');
 if(issues.length)return {issues,conflicts,proposals};
 const add=(target,key,incoming,label,current)=>{if(incoming===null||incoming===undefined||incoming===''||JSON.stringify(incoming)===JSON.stringify(current))return;proposals.push({target,key,incoming,label,current});if(current!==null&&current!==undefined&&current!==''&&norm(current)!==norm(incoming)&&!Array.isArray(incoming))conflicts.push(label+': значення відрізняється від картки.');};
 const personal=a.personal||{};
 for(const key of ['birth_place','sex','marital_status','has_children','worked_before','served_before','phone','email']){
  let v=personal[key];if(v===undefined)continue;
  if(['sex','marital_status','has_children','worked_before','served_before'].includes(key)&&personal.explicit_fields?.includes(key)!==true)continue;
  if(key==='phone')v=window.CRMPhone?.normalize(v)||v;
  add('candidate',key,v,({birth_place:'Місце народження',sex:'Стать',marital_status:'Сімейний стан',has_children:'Є діти',worked_before:'Працював / Працювала',served_before:'Служив / Служила',phone:'Телефон',email:'Email'})[key],c[key]);
 }
 if(personal.actual_address)add('file','address',personal.actual_address,'Фактичне місце проживання',pf.address);
 if(personal.tcc)add('candidate','tcc',personal.tcc,'ТЦК та СП за автобіографією',c.tcc);
 for(const [key,items,label] of [['bio_education_claims',a.education_claims,'Освіта зі слів кандидата'],['bio_work_claims',a.work_claims,'Робота зі слів кандидата'],['bio_service_claims',a.service_claims,'Служба зі слів кандидата']]){
  const incoming=mergeClaims(p[key],items,source);if(incoming.length)add('profile',key,incoming,label,p[key]);
 }
 const org=v=>norm(v).replace(/приватне акціонерне товариство|^пр[аa]т\s*/giu,'').replace(/["«»]/g,'').trim();
 for(const r of list(a.work_claims)){
  const start=partial(r.start_date),end=partial(r.end_date);
  const match=list(p.work_records).find(x=>x.kind==='employment'&&org(x.employer)===org(r.employer)&&(!start||String(x.start_date||'').slice(0,4)===start.value.slice(0,4)));
  if(!match)continue;
  if(start&&match.start_date&&!match.start_date.startsWith(start.value))conflicts.push('Початок роботи '+r.employer+': автобіографія '+start.value+', документ '+match.start_date+'.');
  if(end&&match.end_date&&!match.end_date.startsWith(end.value))conflicts.push('Завершення роботи '+r.employer+': автобіографія '+end.value+', документ '+match.end_date+'.');
  if(r.position&&match.position&&norm(r.position)!==norm(match.position))conflicts.push('Посада '+r.employer+': опис з автобіографії відрізняється від офіційного запису.');
 }
 for(const r of list(a.relatives)){
  if(!r?.full_name||!r.relationship||r.requires_review){issues.push('Неповні або нечіткі відомості родича залишено в контейнері.');continue;}
  const old=list(p.relatives).find(x=>personKey(x)===personKey(r));
  const birth=partial(r.birth_date),death=partial(r.death_date);
  const incoming={...old,relationship:r.relationship,full_name:r.full_name,source_document_id:source,source_type:'autobiography'};
  for(const k of ['address','phone','workplace','position','notes'])if(r[k])incoming[k]=k==='phone'?(window.CRMPhone?.normalize(r[k])||r[k]):r[k];
  if(birth?.precision==='day')incoming.birth_date=birth.value;else if(birth)incoming.birth_date_partial=birth;
  if(typeof r.deceased==='boolean'&&r.deceased_explicit===true)incoming.deceased=r.deceased;
  if(death){incoming.death_date=death.value;incoming.death_date_precision=death.precision;}
  if(JSON.stringify(incoming)!==JSON.stringify(old))proposals.push({target:'profile',key:'relatives',incoming,current:old,label:r.relationship+': '+r.full_name,relative_record:true});
  if(old&&['birth_date','address','phone','deceased','death_date'].some(k=>incoming[k]!==undefined&&old[k]!==undefined&&old[k]!==''&&norm(incoming[k])!==norm(old[k])))conflicts.push('Відомості родича '+r.full_name+' відрізняються від картки.');
 }
 const dates=partial(a.document_date);if(dates)add('profile','bio_document_date',dates,'Дата автобіографії',p.bio_document_date);
 if(a.employment_status?.value)add('profile','bio_employment_status',{...a.employment_status,as_of:partial(a.employment_status.as_of),source_document_id:source},'Зайнятість на дату автобіографії',p.bio_employment_status);
 return {issues,conflicts,proposals};
}
function selections(selected,p={}){
 const people=selected.filter(x=>x.relative_record),result=selected.filter(x=>!x.relative_record);
 if(people.length){const relatives=list(p.relatives).map(r=>({...r}));for(const x of people){const i=relatives.findIndex(r=>personKey(r)===personKey(x.incoming));if(i<0)relatives.push(x.incoming);else relatives[i]={...relatives[i],...x.incoming};}result.push({target:'profile',key:'relatives',incoming:relatives});}
 return result;
}
window.CRMBiography={isDocument,partial,review,selections};
})();