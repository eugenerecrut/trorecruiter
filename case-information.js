// Shared presentation of stored facts; never changes or merges candidate data.
(function () {
  'use strict';
  const profile=c=>{try{return typeof c.profile_data==='string'?JSON.parse(c.profile_data):c.profile_data||{};}catch{return {};}};
  const female=c=>/^(female|жінка|жіноча|f)$/iu.test(c.sex||profile(c).sex||'');
  function work(c,pf={}) {
    const p=profile(c),flag=CRMCandidateConditions.bool(c.worked_before??p.worked_before);
    if(flag===false)return female(c)?'Не працювала':/^(male|чоловік|чоловіча|m)$/iu.test(c.sex||p.sex||'')?'Не працював':'Не працював / не працювала';
    return window.CRMWork?.historyText(p.work_records)||pf.work_history||pf.civilian_experience||p.work_history||'';
  }
  function service(c,pf={}) {
    const p=profile(c),flag=CRMCandidateConditions.bool(c.served_before??p.served_before);
    if(flag===false)return female(c)?'Військову службу не проходила.':/^(male|чоловік|чоловіча|m)$/iu.test(c.sex||p.sex||'')?'Військову службу не проходив.':'Немає попередньої військової служби.';
    if(flag!==true)return '';
    return pf.military_service_history||pf.military_experience||p.military_service_history||window.CRMDocumentPolicy?.serviceSummary(p.work_records)||'';
  }
  const education=(c,pf={})=>CRMEducation.summary(profile(c),pf);
  window.CRMCaseInformation={profile,work,service,education};
})();
