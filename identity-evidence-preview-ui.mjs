const labels={full_name:'ПІБ',birth_date:'Дата народження',birth_place:'Місце народження'};
const inputs={full_name:'name_nominative',birth_date:'birth_date',birth_place:'birth_place',rnokpp:'rnokpp'};
const reasons={unsupported_field:'Поле не підтримується',no_eligible_evidence:'Немає придатного підтвердженого джерела',
 same_source_disagreement:'Читання одного джерела відрізняються',independent_sources_disagree:'Джерела суперечать одне одному',
 existing_value_protected:'Збережене значення захищене',conflicts_with_existing_value:'Є розбіжність зі збереженим значенням',
 needs_verified_primary_source:'Потрібне перевірене первинне джерело',verified_primary_source:'Пропозиція з підтвердженого джерела'};

// Presentation only: reopening and editing always invalidate the old result.
// No form values are assigned and no planner, OCR or save action is called.
export function mountIdentityEvidencePreview({form,host,getSnapshot,load=()=>import('./identity-evidence-preview.mjs?v=3')}){
 const doc=host.ownerDocument,details=doc.createElement('details'),title=doc.createElement('summary');
 details.dataset.identityEvidencePreview='';
 title.textContent='Пріоритет джерел · попередня звірка';details.append(title);host.after(details);
 let revision=0;
 const message=text=>{const p=doc.createElement('p');p.textContent=text;details.append(p);};
 async function render(){
  const run=++revision;
  if(!details.open)return;
  details.replaceChildren(title);
  try{
   const {previewFromSnapshot}=await load();
   if(run!==revision||!form.isConnected||!details.isConnected||!details.open)return;
   const {candidate,documents}=getSnapshot();
   const changed=Object.entries(inputs).some(([field,name])=>{
    const input=form.querySelector('[name="'+name+'"]');
    return input&&input.value!==String(candidate?.[field]??'');
   });
   if(changed){message('Є незбережені зміни особистих даних. Збережіть картку для актуальної звірки джерел.');return;}
   for(const row of previewFromSnapshot(candidate,documents))
    message(labels[row.field]+': '+(reasons[row.reason]||'Потрібна ручна звірка')+(row.proposal?' · '+row.proposal.value:''));
  }catch{
   if(run===revision&&form.isConnected&&details.isConnected&&details.open)
    message('Попередня звірка джерел недоступна. Згорніть і відкрийте її, щоб повторити.');
  }
 }
 details.addEventListener('toggle',render);
 const changed=event=>{if(Object.values(inputs).includes(event.target?.name))return render();};
 form.addEventListener('input',changed);form.addEventListener('change',changed);
 return details;
}
