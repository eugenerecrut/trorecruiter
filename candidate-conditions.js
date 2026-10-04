(function(){
 'use strict';
 const profile=c=>{if(typeof c.profile_data==='string'){try{return JSON.parse(c.profile_data)||{}}catch{return {}}}return c.profile_data||{}};
 const value=(c,key)=>c[key]??profile(c)[key]??null;
 const bool=v=>v===true||v==='true'?true:v===false||v==='false'?false:null;
 const marital=v=>{const t=String(v||'').trim().toLocaleLowerCase('uk-UA');return ['одружений','одружена','married'].includes(t)?'married':['розлучений','розлучена','divorced'].includes(t)?'divorced':['не одружений','не одружена','неодружений','неодружена','single'].includes(t)?'single':null};
 function documentCondition(type,c){
  const t=String(type||'').toLocaleLowerCase('uk-UA');
  if(/резерв\s*\+|приписного/.test(t)){const b=bool(value(c,'served_before'));return b===null?null:!b;}
  if(/убд|військового квитка|витягу? з наказу|нагород/.test(t))return bool(value(c,'served_before'));
  if(/народження дітей/.test(t))return bool(value(c,'has_children'));
  if(/трудов|трудову діяльність/.test(t))return bool(value(c,'worked_before'));
  if(/шлюб/.test(t)){const m=marital(value(c,'marital_status'));if(m===null)return null;return /розірвання/.test(t)?m==='divorced':m==='married';}
  return true;
 }
 function requirement(r,c){
  const special=documentCondition(r.document_type,c);if(special!==true)return special;
  if(!r.condition_field)return true;
  const v=value(c,r.condition_field);if(v===null||v==='')return null;
  if(r.condition_field==='marital_status'){const m=marital(v);return m===null?null:m===r.condition_value;}
  return String(v)===String(r.condition_value);
 }
 function bind(form){
  const fields=(keys,hidden)=>keys.forEach(k=>{const el=form.querySelector('[name="'+k+'"]');if(el?.closest('.cc-field'))el.closest('.cc-field').hidden=hidden;});
  const update=()=>{
   const get=k=>form.querySelector('[name="'+k+'"]')?.value;
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
  form.addEventListener('change',update);form.addEventListener('click',()=>queueMicrotask(update));update();
 }
 window.CRMCandidateConditions={value,bool,marital,documentCondition,requirement,bind};
})();
