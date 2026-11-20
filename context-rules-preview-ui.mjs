const reasons={protected_manual_value:'Збережене значення захищене',missing_evidence_location:'У джерелі не зазначено сторінку',
 factual_value_requires_review:'Потрібна звірка реквізитів',requires_human_review:'Потрібна ручна звірка'};

export function mountContextRulesPreview({form,host,getSnapshot,getDependencies,load=()=>import('./education-rule-preview.mjs?v=1')}){
 const doc=host.ownerDocument,details=doc.createElement('details'),summary=doc.createElement('summary');
 details.dataset.contextRulesPreview='';summary.textContent='Словник · перевірка нормалізації';details.append(summary);host.after(details);
 let revision=0;
 const message=value=>{const p=doc.createElement('p');p.textContent=value;details.append(p);};
 async function render(){
  const run=++revision;if(!details.open)return;details.replaceChildren(summary);
  try{
   const {previewEducationRules}=await load();
   if(run!==revision||!details.open||!form.isConnected||!details.isConnected)return;
   const snapshot=getSnapshot();
   if(snapshot.dirty){message('Є незбережені зміни. Збережіть картку для актуальної перевірки словника.');return;}
   const result=previewEducationRules(snapshot,getDependencies());
   message('Реєстр: '+(result.registry_version||'недоступний')+'. Перегляд не змінює дані.');
   if(result.diagnostics.length)message('Частина перевірок недоступна. Чинні перевірки документів CRM працюють.');
   if(!result.rows.length&&!result.diagnostics.length)message('Немає нових пропозицій нормалізації з перевірених документів про освіту.');
   for(const row of result.rows){
    const page=row.evidence_location?.page;
    message(row.file_name+(page?' · стор. '+page:'')+' · Рівень освіти: '+row.raw_value+
     (row.proposed_value?' → '+row.proposed_value:' · '+(reasons[row.reason]||'Потрібна звірка')));
    for(const rule of row.matches){
     const p=doc.createElement('p'),link=doc.createElement('a');
     p.append(doc.createTextNode('Правило '+rule.rule_id+' · '+rule.rule_version+' · '));
     // References come exclusively from the bundled registry, never OCR.
     link.textContent='Джерело правила';link.href=rule.source_reference;link.target='_blank';link.rel='noopener noreferrer';p.append(link);details.append(p);
    }
   }
  }catch{if(run===revision&&details.open&&form.isConnected&&details.isConnected)message('Перевірка словника недоступна. Згорніть і відкрийте її, щоб повторити.');}
 }
 details.addEventListener('toggle',render);form.addEventListener('input',render);form.addEventListener('change',render);
 return details;
}
