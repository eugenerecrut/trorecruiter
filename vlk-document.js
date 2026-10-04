(function(){
'use strict';
const norm=v=>String(v??'').normalize('NFKC').replace(/[’ʼ]/g,"'").replace(/\s+/g,' ').trim().toLocaleLowerCase('uk-UA');
const isDocument=t=>/довідк.*влк|довідк.*військово[-\s]?лікарськ/iu.test(String(t||''))&&!/додаток\s*13/iu.test(String(t||''));
const validDate=v=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(String(v||'')))return false;const d=new Date(v+'T00:00:00Z');return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===v;};
function review(e,c){
const issues=[];let compared=0;
for(const [label,a,b] of [['ПІБ',e.name_nominative||e.full_name,c.name_nominative||c.full_name],['Дата народження',e.birth_date,c.birth_date],['РНОКПП',e.rnokpp,c.rnokpp]]){if(a&&b){compared++;if(norm(a)!==norm(b))issues.push(label+' не збігається з карткою. Перенесення ВЛК заблоковано до перевірки.');}}
if(!compared)issues.push('Недостатньо даних для звірки власника довідки ВЛК.');
const fields={};
if(!issues.length)for(const k of ['vlk_certificate_number','vlk_date','vlk_commission','vlk_conclusion','vlk_category','vlk_next_date']){
const v=e[k];if(v===null||v===undefined||v==='')continue;
if(['vlk_date','vlk_next_date'].includes(k)&&!validDate(v)){issues.push('Некоректна дата '+k+' не переноситься.');continue;}
if(e.meta?.field_evidence?.[k]?.requires_review===true)continue;fields[k]=v;
}
return {fields,issues};
}
window.CRMVLK={isDocument,review};
})();