// Shared, deterministic validation of structured facts. Never writes candidate data.
(function(root){
'use strict';
const arrays=['military_rank_records','combat_records','awards','reserve_training_records'];
const objects=['military_oath','military_discharge'];
const keys=[...objects,...arrays];
const types=/військов(?:ий|ого) квит|посвідчення офіцера|Резерв\s*\+|приписн|військовий облік|витяг.*наказ|нагород|бойов|присяг|збор/iu;
const norm=v=>String(v??'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('uk-UA');
const text=v=>typeof v==='string'&&v.trim().length>0&&v.trim().length<=2000?v.trim():null;
const date=v=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(String(v||'')))return null;const d=new Date(v+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v?v:null;};
const unit=v=>/^[АA]\d{4}$/u.test(String(v||'').trim().toUpperCase())?'А'+String(v).trim().slice(1):null;
const ranks=new Set('солдат|старший солдат|матрос|старший матрос|молодший сержант|сержант|старший сержант|головний сержант|штаб-сержант|майстер-сержант|старший майстер-сержант|головний майстер-сержант|старшина|головний старшина|молодший лейтенант|лейтенант|старший лейтенант|капітан|майор|підполковник|полковник|бригадний генерал|генерал-майор|генерал-лейтенант|генерал'.split('|'));
const ignored=new Set(['source_document_id','source_pages','raw_text','requires_review','accepted_by_ai','confirmed_by_user','confirmed_by_document','source_record_index']);
const isDocument=type=>types.test(String(type||''))&&!/УБД|учасника бойових дій/iu.test(String(type||''));
function normalize(key,r,doc,index){
 if(!r||typeof r!=='object'||Array.isArray(r)||r.requires_review||r.crossed_out||['low','unreadable'].includes(r.legibility))return null;
 const pages=[...new Set([...(Array.isArray(r.source_pages)?r.source_pages:[]),r.page].filter(v=>v!=null).map(Number))];
 if(!pages.length||pages.some(v=>!Number.isInteger(v)||v<1||v>1000)||!text(r.raw_text))return null;
 let out;
 if(key==='military_oath'){out={date:date(r.date),unit:unit(r.unit)};if(!out.date||!out.unit)return null;}
 if(key==='military_discharge'){out={unit:unit(r.unit),basis:text(r.basis),order_number:text(r.order_number),order_date:date(r.order_date)};if(!out.unit||!out.basis||!out.order_number||!out.order_date)return null;}
 if(key==='military_rank_records'){out={rank:norm(r.rank),date:date(r.date||r.order_date),unit:unit(r.unit),order_issuer:text(r.order_issuer)||unit(r.unit),order_number:text(r.order_number),order_date:date(r.order_date||r.date)};if(!ranks.has(out.rank)||!out.date||!out.unit||!out.order_number||!out.order_date)return null;}
 if(key==='combat_records'){out={location:text(r.location),start_date:date(r.start_date),end_date:date(r.end_date)};if(!out.location||!out.start_date||!out.end_date||out.end_date<out.start_date)return null;}
 if(key==='awards'){out={name:text(r.name),reason:text(r.reason),order_issuer:text(r.order_issuer),order_number:text(r.order_number),order_date:date(r.order_date)};if(!out.name||!out.order_issuer||!out.order_number||!out.order_date)return null;}
 if(key==='reserve_training_records'){out={unit:unit(r.unit),position:text(r.position),military_specialty:text(r.military_specialty),start_date:date(r.start_date),end_date:date(r.end_date),order_issuer:text(r.order_issuer)||unit(r.unit),order_number:text(r.order_number),order_date:date(r.order_date)};if(!out.unit||!out.position||!out.start_date||!out.end_date||out.end_date<out.start_date||!out.order_number||!out.order_date||out.military_specialty&&!/^(?:\d{3}|\d{6})[А-ЯІЇЄҐA-Z]?$/u.test(out.military_specialty))return null;}
 if(!out)return null;
 return {...out,source_document_id:doc.id,source_pages:pages,raw_text:r.raw_text.trim(),source_record_index:index,requires_review:false,accepted_by_ai:true};
}
function sameValues(a,b){return Object.keys(b).filter(k=>!ignored.has(k)).every(k=>(['unit','order_issuer'].includes(k)&&unit(a[k])&&unit(b[k])?unit(a[k])===unit(b[k]):norm(a[k])===norm(b[k])));}
function identity(key,r){const parts=key==='military_rank_records'?[r.rank,unit(r.unit)||r.unit,r.order_number]:key==='awards'?[r.name,r.order_issuer,r.order_number]:key==='combat_records'?[r.location,r.start_date]:[unit(r.unit||r.employer)||r.unit||r.employer,r.start_date,r.position];return parts.map(norm).join('|');}
function review(e,p,doc){
 const proposals=[],conflicts=[];
 for(const key of keys){
  const raw=e[key];if(raw==null||Array.isArray(raw)&&!raw.length)continue;
  const fail=(incoming,reason)=>conflicts.push({key,incoming,reason});
  const evidence=e.field_evidence?.[key]||e.meta?.field_evidence?.[key];
  if(evidence?.requires_review||['low','unreadable'].includes(evidence?.legibility)){fail(null,'AI позначив військові відомості як нерозбірливі.');continue;}
  if(doc.verification_status!=='Підтверджено'&&(!Number.isFinite(Number(doc.ai_confidence))||Number(doc.ai_confidence)<0.85||Number(doc.ai_confidence)>1)){fail(null,'Недостатня впевненість розпізнавання військових відомостей.');continue;}
  if(arrays.includes(key)){
   if(!Array.isArray(raw)||raw.length>150||p[key]!=null&&!Array.isArray(p[key])){fail(null,'Некоректна структура військових записів.');continue;}
   const current=p[key]??null,merged=structuredClone(current||[]);let added=0;
   for(const [index,row] of raw.entries()){
    const record=normalize(key,row,doc,index);if(!record){fail(null,'Запис '+(index+1)+': потрібна звірка дати, реквізитів, сторінки та читабельної цитати.');continue;}
    const existing=merged.find(r=>identity(key,r)===identity(key,record));
    if(existing){if(!sameValues(existing,record))fail(record,'Запис '+(index+1)+': збережені відомості відрізняються; вони залишені без змін.');continue;}
    merged.push(record);added++;
   }
   if(added)proposals.push({key,incoming:merged,current,merge_records:true});
  }else{
   const incoming=normalize(key,raw,doc,0);if(!incoming){fail(null,'Потрібна звірка військових реквізитів, сторінки та читабельної цитати.');continue;}
   if(p[key]!=null&&typeof p[key]==='object'&&Object.keys(p[key]).length){if(!sameValues(p[key],incoming))fail(incoming,'Збережене значення має пріоритет.');continue;}
   if(p[key]!=null&&JSON.stringify(p[key])!=='{}'){fail(incoming,'Збережене значення потребує ручної звірки.');continue;}
   proposals.push({key,incoming,current:p[key]??null,merge_records:false});
  }
 }
 return {proposals,conflicts};
}
const api=Object.freeze({keys:Object.freeze(keys),arrays:Object.freeze(arrays),isDocument,review});root.CRMMilitaryFacts=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window==='undefined'?globalThis:window);
