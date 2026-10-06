(function(){
 'use strict';
 const profile=c=>{if(typeof c.profile_data==='string'){try{return JSON.parse(c.profile_data)||{}}catch{return {}}}return c.profile_data||{}};
 const value=(c,key)=>c[key]??profile(c)[key]??null;
 const bool=v=>v===true||v==='true'?true:v===false||v==='false'?false:null;
 const marital=v=>{const t=String(v||'').trim().toLocaleLowerCase('uk-UA');return ['одружений','одружена','married'].includes(t)?'married':['розлучений','розлучена','divorced'].includes(t)?'divorced':['не одружений','не одружена','неодружений','неодружена','single'].includes(t)?'single':null};
 const unitTypes=['Припис про направлення','Реєстр кандидата'];
 const isUnit=c=>value(c,'case_mode')==='unit';
 const unitDocument=type=>/рекомендаційн.*лист/iu.test(String(type||''))||unitTypes.includes(type);
 const optionalDocument=type=>/УБД|нагород|витягу? з наказу/iu.test(String(type||''));
 const normalizeRequirement=r=>optionalDocument(r.document_type)?{...r,is_required:false,condition_field:null,condition_value:null,condition_note:'За наявності документа.'}:{...r};
 const isMobilization=c=>/мобілізац/iu.test(String(profile(c).service_type||c.service_type||String(profile(c).form_data?.additional_notes||'').match(/Вид служби:\s*([^\n]+)/iu)?.[1]||''));
 const militaryDocument=t=>/військового квитка|військовий облік|резерв\s*\+|тимчасов.*посвідч|приписне/iu.test(t||'');
 const mobilizationDocument=t=>unitDocument(t)||militaryDocument(t)||/паспорта|ID Картки|ідентифікаційного коду|Фото |посвідчення водія|Довідка ВЛК|Додаток 13|групи крові|місце проживання|Довідка з МВС|гінеколога|УБД/iu.test(t||'');
 const forCandidate=(r,c)=>{
  if(!isMobilization(c)||isUnit(c))return r;
  const out={...r};
  if(militaryDocument(r.document_type)){out.condition_field=null;out.condition_value=null;out.condition_note='Достатньо одного: військовий квиток, приписне / тимчасове посвідчення або Резерв+.';}
  if(/Фото 3/.test(r.document_type))out.condition_note='6 фото 3×4, матові, без головного убору й окулярів. До CRM достатньо одного файла.';
  if(/Фото 9/.test(r.document_type))out.condition_note='2 фото 9×12, матові, без головного убору й окулярів. До CRM достатньо одного файла.';
  if(/групи крові/.test(r.document_type))out.condition_note='Потрібна, якщо група крові та резус не зазначені в паспорті.';
  return out;
 };
 const covered=(r,docs,c)=>docs.some(d=>d.verification_status==='Підтверджено'&&(d.requirement_id===r.id||d.document_type===r.document_type||(isMobilization(c)&&militaryDocument(r.document_type)&&militaryDocument(d.document_type))));
 function applyNewCaseMode(form){
  if(!form)return;
  const unit=form.elements.case_mode?.value==='unit';
  const allowed=new Set(['full_name','phone','military_unit','desired_position','notes','case_mode']);
  [...form.children].forEach(el=>{
    if(el.querySelector('[type="submit"]'))return;
    const inputs=[...el.querySelectorAll('input,select,textarea')];
    el.hidden=unit&&(inputs.length?!inputs.some(i=>allowed.has(i.name)):true);
    inputs.forEach(i=>i.disabled=unit&&!allowed.has(i.name));
  });
 }
 function documentCondition(type,c){
  if(isUnit(c))return unitDocument(type);
  if(unitTypes.includes(type))return true;
  if(/гінеколога/iu.test(type)){if(!isMobilization(c))return false;const sex=value(c,'sex');return sex==='female'?true:sex==='male'?false:null;}
  if(isMobilization(c)){if(!mobilizationDocument(type))return false;if(/групи крові/iu.test(type))return bool(value(c,'blood_data_in_passport'))!==true;return true;}
  const t=String(type||'').toLocaleLowerCase('uk-UA');
  if(optionalDocument(type))return true;
  if(/резерв\s*\+|припис|військовий облік/.test(t)){const b=bool(value(c,'served_before'));return b===null?null:!b;}
  if(/убд|військового квитка|витягу? з наказу|нагород/.test(t))return bool(value(c,'served_before'));
  if(/народження дітей/.test(t))return bool(value(c,'has_children'));
  if(/трудов|трудову діяльність/.test(t))return bool(value(c,'worked_before'));
  if(/шлюб/.test(t)){const m=marital(value(c,'marital_status'));if(m===null)return null;return /розірвання/.test(t)?m==='divorced':m==='married';}
  return true;
 }
 function requirement(r,c){
  if(isUnit(c))return unitDocument(r.document_type);
  const special=documentCondition(r.document_type,c);if(special!==true)return special;
  if(isMobilization(c))return true;
  if(!r.condition_field)return true;
  const v=value(c,r.condition_field);if(v===null||v==='')return null;
  if(r.condition_field==='marital_status'){const m=marital(v);return m===null?null:m===r.condition_value;}
  return String(v)===String(r.condition_value);
 }
 function bind(form){
  const fields=(keys,hidden)=>keys.forEach(k=>{const el=form.querySelector('[name="'+k+'"]');if(el?.closest('.cc-field'))el.closest('.cc-field').hidden=hidden;});
  const update=()=>{
   if(form.elements.case_mode?.value==='unit')return;
   const get=k=>form.querySelector('[name="'+k+'"]')?.value;
   const worked=form.querySelector('[name="worked_before"]');
   if(worked){
    const female=get('sex')==='female',male=get('sex')==='male';
    const yes=female?'Працювала':male?'Працював':'Працював / Працювала';
    const no=female?'Не працювала':male?'Не працював':'Не працював / Не працювала';
    const label=worked.closest('.cc-field')?.querySelector('label');if(label)label.textContent=yes;
    for(const option of worked.options){if(option.value==='true')option.textContent=yes;else if(option.value==='false')option.textContent=no;}
   }
   const served=form.querySelector('[name="served_before"]');
   if(served){
    const female=get('sex')==='female',male=get('sex')==='male';
    const yes=female?'Служила':male?'Служив':'Служив / Служила';
    const no=female?'Не служила':male?'Не служив':'Не служив / Не служила';
    const label=served.closest('.cc-field')?.querySelector('label');if(label)label.textContent=yes;
    for(const option of served.options){if(option.value==='true')option.textContent=yes;else if(option.value==='false')option.textContent=no;}
   }
   fields(['children_count','children_info'],bool(get('has_children'))===false);
   fields(['work_history'],bool(get('worked_before'))===false);
   fields(['military_unit','military_position','service_start_date','service_end_date','combat_days','military_service_history'],bool(get('served_before'))===false);
   form.querySelectorAll('[data-relative-row]').forEach(row=>{
    const relation=row.querySelector('[name="relationship"]')?.value||'';
    row.hidden=(bool(get('has_children'))===false&&/син|доньк|дочк|дитин/i.test(relation))||(marital(get('marital_status'))==='single'&&/дружин|чоловік/i.test(relation));
   });
  };
  form.addEventListener('change',update);form.addEventListener('click',()=>queueMicrotask(update));update();return update;
 }
 window.CRMCandidateConditions={isMobilization,militaryDocument,forCandidate,covered,value,bool,marital,documentCondition,requirement,bind,isUnit,unitDocument,applyNewCaseMode,normalizeRequirement};
})();
