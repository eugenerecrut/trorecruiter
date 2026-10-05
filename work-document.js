(function(){
'use strict';
const norm=v=>String(v??'').normalize('NFKC').replace(/[’ʼ]/g,"'").replace(/\s+/g,' ').trim().toLocaleLowerCase('uk-UA');
const isDocument=t=>/трудов|відомості.*реєстр.*застрахован/iu.test(String(t||''));
const date=v=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(v||''))return null;const d=new Date(v+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v?v:null;};
const employer=r=>norm(r.employer_code||r.employer);
const eventKey=r=>[r.kind,r.event_date,employer(r),norm(r.order_number),norm(r.raw_text)].join('|');
const recordKey=r=>[r.kind,employer(r),r.start_date,r.end_date||''].join('|');
function summary(records){
 const spans=records.filter(r=>r.kind==='employment'&&date(r.start_date)&&date(r.end_date)&&r.end_date>=r.start_date).map(r=>[Date.parse(r.start_date)/86400000,Date.parse(r.end_date)/86400000]).sort((a,b)=>a[0]-b[0]);
 let days=0,last=null;
 for(const span of spans){if(last&&span[0]<=last[1]+1)last[1]=Math.max(last[1],span[1]);else{if(last)days+=last[1]-last[0]+1;last=[...span];}}
 if(last)days+=last[1]-last[0]+1;
 return {days,closed:spans.length,incomplete:records.filter(r=>r.kind==='employment'&&(!date(r.start_date)||!date(r.end_date))).length};
}
function historyText(records){
 const rows=(Array.isArray(records)?records:[]).filter(r=>r&&[r.employer,r.position,r.start_date,r.end_date].some(v=>String(v||'').trim()));
 if(!rows.length)return '';
 const displayDate=v=>date(v)?v.split('-').reverse().join('.'):String(v||'Не вказано');
 const kinds={employment:'Робота',military_service:'Військова служба',unemployment:'Облік безробітного'};
 const lines=rows.map((r,i)=>[
  (i+1)+'. '+(kinds[r.kind]||'Робота')+': '+(r.employer||'Організацію не вказано'),
  r.position?'Посада: '+r.position:null,
  'Період: '+displayDate(r.start_date)+' — '+displayDate(r.end_date),
  ...(Array.isArray(r.position_changes)?r.position_changes:[]).map(x=>'Зміна посади: '+displayDate(x.date)+' — '+(x.position||'Не вказано')),
  r.termination_reason?'Причина завершення: '+r.termination_reason:null
 ].filter(Boolean).join('\n'));
 const total=summary(rows);
 lines.push('Підтверджені завершені періоди роботи: '+total.days+' календарних днів. Неповних періодів: '+total.incomplete+'. Це не розрахунок страхового стажу.');
 return lines.join('\n\n');
}
function review(e,c,p={},documentId){
 const issues=[],pairs=[[e.full_name||e.name_nominative,c.name_nominative||c.full_name,'ПІБ'],[e.rnokpp,c.rnokpp,'РНОКПП'],[e.birth_date,c.birth_date,'дата народження']].filter(([a,b])=>a&&b);
 if(!pairs.length)issues.push('Немає достатніх реквізитів для звірки власника документа.');
 for(const [a,b,label] of pairs)if(norm(a)!==norm(b))issues.push('Розбіжність: '+label+'.');
 const records=Array.isArray(p.work_records)?p.work_records.map(r=>({...r})):[],events=Array.isArray(p.work_events)?p.work_events.map(r=>({...r})):[];
 if(issues.length)return {records,events,accepted:0,issues};
 const source=Array.isArray(e.work_events)?e.work_events:[];let accepted=0;const clean=[];
 for(const r of source){
  if(!r||r.requires_review||(r.event_date_scanned&&r.event_date_scanned!==r.event_date)||!['hire','dismissal','transfer','service_start','service_end','unemployment_start','unemployment_end'].includes(r.kind)||!date(r.event_date)||!r.employer){issues.push('Нечіткий або неповний запис залишено в контейнері для ручної перевірки.');continue;}
  const item={...r,event_date:date(r.event_date),source_document_id:documentId};
  if(!events.some(x=>eventKey(x)===eventKey(item)))events.push(item);
  clean.push(item);accepted++;
 }
 const pending=new Map(),built=[];
 for(const r of [...clean].sort((a,b)=>a.event_date.localeCompare(b.event_date)||(Number(a.row_number)||0)-(Number(b.row_number)||0))){
  const kind=r.kind.startsWith('service')?'military_service':r.kind.startsWith('unemployment')?'unemployment':'employment',k=kind+'|'+employer(r);
  if(['hire','service_start','unemployment_start'].includes(r.kind)){
   if(pending.has(k)){issues.push('Повторний початок без завершення: період потребує перевірки.');pending.delete(k);continue;}
   pending.set(k,{kind,employer:r.employer,employer_code:r.employer_code||null,position:r.position||null,start_date:r.event_date,end_date:null,termination_reason:null,order_number:r.order_number||null,order_date:date(r.order_date),source_document_id:documentId,source_pages:[r.page].filter(Boolean),position_changes:[],requires_review:false});
  }else if(r.kind==='transfer'){
   const open=pending.get(k);if(open){open.position_changes.push({date:r.event_date,position:r.position||null,order_number:r.order_number||null,order_date:date(r.order_date),page:r.page});if(r.page&&!open.source_pages.includes(r.page))open.source_pages.push(r.page);}else issues.push('Переведення без початкового запису: збережено як окрему подію.');
  }else{
   const open=pending.get(k);if(open){open.end_date=r.event_date;open.termination_reason=r.termination_reason||null;open.end_order_number=r.order_number||null;open.end_order_date=date(r.order_date);if(r.page&&!open.source_pages.includes(r.page))open.source_pages.push(r.page);built.push(open);pending.delete(k);}else issues.push('Завершення без початку: збережено як окрему подію, стаж не обчислюється.');
  }
 }
 for(const r of pending.values())built.push(r);
 for(const r of built){const same=records.find(x=>recordKey(x)===recordKey(r));if(!same)records.push(r);}
 return {records,events,accepted,issues,summary:summary(records)};
}
window.CRMWork={isDocument,review,summary,historyText,date,eventKey,recordKey};
})();
