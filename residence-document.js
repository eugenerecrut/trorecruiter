(function(){
 'use strict';
 const norm=v=>String(v??'').normalize('NFKC').replace(/[’ʼ]/g,"'").replace(/\s+/g,' ').trim().toLocaleLowerCase('uk-UA');
 const isDocument=t=>/місц[яе] проживання|реєстраці[яюї] місця проживання|реєстр[у]? територіальної громади/iu.test(String(t||''));
 function review(e,c,p={}){
  const issues=[];let compared=0;
  for(const [key,a,b] of [['ПІБ',e.name_nominative||e.full_name,c.name_nominative||c.full_name],['Дата народження',e.birth_date,c.birth_date],['РНОКПП',e.rnokpp,c.rnokpp],['УНЗР',e.unzr,p.unzr]]){
   if(a&&b){compared++;if(norm(a)!==norm(b))issues.push(key+' не збігається з карткою кандидата.');}
  }
  if(!compared)issues.push('Не вистачає даних для звірки власника документа з кандидатом.');
  const identityVerified=compared>0&&issues.length===0;
  const rawUnzr=String(e.unzr||'').trim();
  const unzr=identityVerified&&/^\d{8}-\d{5}$/.test(rawUnzr)?rawUnzr:null;
  let address=null;
  if(Array.isArray(e.registration_records)){
   const active=e.registration_records.filter(r=>r.status==='current'&&!r.deregistered_at&&r.address);
   const addresses=[...new Set(active.map(r=>norm(r.address)))];
   if(addresses.length===1)address=active[0].address;
   else issues.push(addresses.length?'Документ містить кілька чинних адрес; потрібна ручна перевірка.':'Не знайдено чинної реєстрації; скасовані адреси не переносяться.');
  }else if(e.residence_registration_status==='current'&&e.registered_address)address=e.registered_address;
  else issues.push('AI не підтвердив чинну зареєстровану адресу.');
  return {address:issues.length?null:address,unzr,issues};
 }
 window.CRMResidence={isDocument,review};
})();
