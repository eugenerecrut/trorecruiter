(function(){
'use strict';
const norm=v=>String(v??'').normalize('NFKC').replace(/[’ʼ]/g,"'").replace(/\s+/g,' ').trim().toLocaleLowerCase('uk-UA');
const ranks={'середня':1,'професійна':2,'молодший спеціаліст':3,'фаховий молодший бакалавр':3,'молодший бакалавр':4,'бакалавр':5,'спеціаліст':6,'магістр':6,'доктор філософії':7,'доктор наук':8};
const isDocument=t=>/диплом|атестат|свідоцтв.*освіт|документи про освіту/iu.test(String(t||''));
const key=r=>[r.degree,r.diploma_series,r.diploma_number,r.institution].map(norm).join('|');
function ownerMatches(r,c){
const a=norm(r.owner_full_name),b=norm(c.name_nominative||c.full_name);
if(!a||!b)return false;
if(r.owner_birth_date&&c.birth_date&&r.owner_birth_date!==c.birth_date)return false;
if(a===b)return true;
const words=a.split(' '),other=b.split(' ');
return words.length>=2&&words.every(w=>other.includes(w))&&!!r.owner_birth_date&&r.owner_birth_date===c.birth_date;
}
function review(e,c,p={}){
const issues=[],records=Array.isArray(p.education_records)?p.education_records.map(r=>({...r})):[];
const incoming=Array.isArray(e.education_records)?e.education_records:[];
let accepted=0;
for(const r of incoming){
if(!r||r.requires_review||r.diploma_present!==true||!ranks[r.degree]||(!r.diploma_number&&!(e.source_verified===true&&r.institution&&(r.graduation_year||r.study_end_date||r.diploma_issue_date)))||!ownerMatches(r,c)){issues.push('Запис освіти потребує перевірки власника, диплома або реквізитів.');continue;}
const entry={...r};const i=records.findIndex(x=>key(x)===key(entry));if(i<0)records.push(entry);else records[i]={...records[i],...Object.fromEntries(Object.entries(entry).filter(([k,v])=>v!==null&&v!==undefined&&v!==''))};accepted++;
}
const highest=records.reduce((best,r)=>(ranks[r.degree]||0)>(ranks[best?.degree]||0)?r:best,null);
return {records,highest,accepted,issues};
}
function historyText(records){
return (Array.isArray(records)?records:[]).filter(r=>r&&!r.requires_review).map(r=>{
 const date=v=>typeof v==='object'&&v?v.value:v;
 const period=[date(r.study_start_date||r.start_date),date(r.study_end_date||r.end_date)||r.graduation_year].filter(Boolean).join(' — ');
 return [period,r.institution,r.degree,r.specialty,r.qualification].filter(Boolean).join(', ');
}).filter(Boolean).join('\n');
}
function summary(p={},pf={}){
return pf.education||p.education||historyText(p.education_records)||[p.education_institution,p.education_specialty,p.education_qualification,p.education_year].filter(Boolean).join(', ')||historyText(p.bio_education_claims);
}
window.CRMEducation={isDocument,review,ranks,historyText,summary};
})();