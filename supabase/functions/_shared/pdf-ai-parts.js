// Temporary in-memory PDFs only. Never writes Storage or candidate records.
(function(root){
'use strict';
const LIMITS=Object.freeze({originalBytes:30000000,partBytes:24000000,targetBytes:8000000,pagesPerPart:6,maxPages:120,maxParts:8,maxCalls:12,maxMs:115000});
async function prepare(bytes,PDFDocument){
 if(bytes.length>LIMITS.originalBytes)throw Error('PDF перевищує безпечний ліміт CRM 30 МБ. Оригінал збережено; розділіть файл.');
 let pdf;try{pdf=await PDFDocument.load(bytes,{updateMetadata:false});}catch(_){throw Error('Не вдалося відкрити PDF: файл пошкоджений або захищений паролем. Оригінал не змінено.');}const pages=pdf.getPageCount();
 if(!pages||pages>LIMITS.maxPages)throw Error('PDF має містити від 1 до 120 сторінок. Оригінал не змінено.');
 const parts=[];
 async function emit(indices){
  const out=await PDFDocument.create();for(const page of await out.copyPages(pdf,indices))out.addPage(page);
  const data=await out.save({useObjectStreams:true});
  if(data.length>LIMITS.targetBytes&&indices.length>1){const half=Math.ceil(indices.length/2);await emit(indices.slice(0,half));await emit(indices.slice(half));return;}
  if(data.length>LIMITS.partBytes)throw Error('Одна сторінка перевищує 24 МБ. Потрібне окреме стиснення; сторінку не пропущено.');
  parts.push({bytes:data,start:indices[0]+1,end:indices.at(-1)+1});
  if(parts.length>LIMITS.maxParts)throw Error('Для PDF потрібно більше 8 частин. Автоматичну обробку зупинено до витрат AI; сторінки не втрачено.');
 }
 for(let i=0;i<pages;i+=LIMITS.pagesPerPart)await emit(Array.from({length:Math.min(LIMITS.pagesPerPart,pages-i)},(_,j)=>i+j));
 return {pages,parts};
}
function offset(value,part){
 if(Array.isArray(value))return value.map(v=>offset(v,part));
 if(!value||typeof value!=='object')return value;
 const out={};for(const [k,v] of Object.entries(value)){
  if(k==='source_pages'&&Array.isArray(v)){out[k]=v.filter(n=>Number.isInteger(n)&&n>=1&&n<=part.end-part.start+1).map(n=>n+part.start-1);if(out[k].length!==v.length)out.requires_review=true;}
  else if(k==='page'&&Number.isInteger(v)){if(v>=1&&v<=part.end-part.start+1)out[k]=v+part.start-1;else out.requires_review=true;}
  else out[k]=offset(v,part);
 }return out;
}
function merge(results){
 if(!results.length)throw Error('Немає оброблених частин');
 const empty=v=>v==null||v===''||Array.isArray(v)&&!v.length;
 const disagreements=[];
 function join(a,b,path=''){
  if(empty(a))return structuredClone(b);if(empty(b))return a;
  if(Array.isArray(a)&&Array.isArray(b)){
   const out=[...a];for(const v of b){const signature=x=>JSON.stringify(x, (k,val)=>['source_pages','page','raw_text'].includes(k)?undefined:val);const old=out.find(x=>signature(x)===signature(v));if(!old){const collision=out.find(x=>x&&v&&typeof x==='object'&&typeof v==='object'&&(x.diploma_number&&x.diploma_number===v.diploma_number||x.relationship&&x.relationship===v.relationship&&x.full_name!==v.full_name));if(collision){collision.requires_review=true;if(v&&typeof v==='object')v.requires_review=true;disagreements.push({field:path,values:[collision,v]});}out.push(v);}else if(old&&typeof old==='object'&&v&&typeof v==='object'){old.source_pages=[...new Set([...(old.source_pages||[]),...(v.source_pages||[]),...(old.page?[old.page]:[]),...(v.page?[v.page]:[])])];}}return out;
  }
  if(typeof a==='object'&&typeof b==='object'&&!Array.isArray(a)&&!Array.isArray(b)){for(const [k,v]of Object.entries(b))a[k]=join(a[k],v,path?path+'.'+k:k);return a;}
  if(JSON.stringify(a)!==JSON.stringify(b)){disagreements.push({field:path,values:[a,b]});return null;}return a;
 }
 const extracted={};let out=extracted;for(const r of results)out=join(out,offset(r.result.extracted||{},r.part));
 // A third chunk must not resurrect a value already found contradictory.
 for(const conflict of disagreements){const keys=conflict.field.split('.');let target=out;for(const k of keys.slice(0,-1))target=target?.[k];if(target&&!Array.isArray(target[keys.at(-1)]))target[keys.at(-1)]=null;}
 const first=results[0].result,types=[...new Set(results.map(r=>r.result.document_type))];
 out.meta={...(out.meta||{}),chunk_conflicts:disagreements};
 return {...first,confidence:Math.min(...results.map(r=>Number(r.result.confidence)||0)),extracted:out,warnings:[...new Set(results.flatMap(r=>r.result.warnings||[])),...(disagreements.length?['Частини документа містять різні значення. Потрібна ручна звірка.']:[]),...(types.length>1?['У частинах визначено різні типи документа. Перевірте пакет.']:[])],review_required:disagreements.length>0||types.length>1,pdf_parts:results.map(r=>({start:r.part.start,end:r.part.end,model:r.result.model}))};
}
const api={LIMITS,prepare,offset,merge};root.CRMPDFAIParts=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis==='undefined'?window:globalThis);
