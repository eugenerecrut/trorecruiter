// Temporary paper-document presence, separate from uploaded files and AI data.
(function () {
  'use strict';
  const allowedTypes=Object.freeze([
    'Автобіографія рукописна','Заява на контракт','Згода на обробку даних',
    'Згода на обробку даних для психологічного тестування','Картка соціально-психологічного вивчення',
    'Анкета на контракт','Розписка кандидата на військову службу за контрактом','Фото 9×12','Фото 3×4',
    'Характеристика','Сертифікат від психіатра та нарколога / відповідні довідки',
    'Довідка з визначенням групи крові та резус-фактору','Додаток 13 (Картка обстеження та медичного огляду)',
    'Сертифікат психологічного тестування (перша сторінка)','Припис про направлення','Реєстр кандидата',
    'Довідка гінеколога','Копія УБД','Копія витягу з наказу','Нагороди',
    'Послужний список','Перелік документів','Титульний аркуш','Наказ про зарахування до ВЧ'
  ]);
  const allowed=r=>allowedTypes.includes(typeof r==='string'?r:r?.document_type);
  const profile=c=>{try{return typeof c?.profile_data==='string'?JSON.parse(c.profile_data):c?.profile_data||{};}catch{return {};}};
  const records=c=>profile(c).document_presence||{};
  const valid=e=>e?.available===true&&allowed(e.document_type)&&!!e.checked_by&&!!e.checked_at;
  function entry(r,c) {
    if(!r)return null;
    const e=records(c)[r.id];
    return allowed(r)&&valid(e)&&e.document_type===r.document_type?e:null;
  }
  function active(c) {
    return Object.entries(records(c)).filter(([,e])=>valid(e)&&window.CRMCandidateConditions?.documentCondition(e.document_type,c)!==false).map(([id,e])=>({id,...e}));
  }
  const byType=(type,c)=>active(c).find(e=>e.document_type===type)||null;
  const received=(r,docs,c)=>!!entry(r,c)||docs.some(d=>!d.deleted_at&&(d.requirement_id===r.id||d.document_type===r.document_type));
  const verifiedType=(type,docs,c)=>!!byType(type,c)||docs.some(d=>!d.deleted_at&&d.document_type===type&&d.verification_status==='Підтверджено');
  const withoutCopies=(c,docs)=>active(c).filter(e=>!docs.some(d=>!d.deleted_at&&(d.requirement_id===e.id||d.document_type===e.document_type)));
  function counts(c,docs) {
    const extra=withoutCopies(c,docs).length;
    return {total:docs.length+extra,verified:docs.filter(d=>d.verification_status==='Підтверджено'||byType(d.document_type,c)).length+extra};
  }
  function summary(e,esc,hasFile=false) {
    const date=window.CRMResponsibility?.date(e.checked_at)||e.checked_at;
    return '<details class="crm-presence-summary"><summary><span class="status status-done">'+(hasFile?'Наявність підтверджена прапорцем':'Перевірений · без файла')+'</span></summary><small>Позначив: '+esc(e.checked_by_name||'Працівник CRM')+' · '+esc(date)+'</small></details>';
  }
  function control(r,c,files,esc) {
    if(!r.id||!allowed(r)||files.length&&!entry(r,c))return '';
    return '<label class="crm-presence-control"><input type="checkbox" data-doc-presence="'+esc(r.id)+'" aria-label="Є в наявності без файла: '+esc(r.document_type)+'" '+(entry(r,c)?'checked':'')+'> Є в наявності без файла</label>';
  }
  function cardRows(c,docs,esc) {
    return withoutCopies(c,docs).map(e=>'<div class="cc-doc"><div><b>'+esc(e.document_type)+'</b>'+summary(e,esc)+'</div></div>').join('');
  }
  async function set(client,c,r,present) {
    if(!allowed(r))throw new Error('Для цього документа потрібен файл.');
    const result=await client.rpc('crm_set_document_presence',{
      p_candidate_id:c.id,p_requirement_id:r.id,p_present:present,p_expected:records(c)[r.id]||null
    });
    if(result.error)throw result.error;
    return result.data;
  }
  window.CRMDocumentPresence={allowedTypes,allowed,profile,records,entry,active,byType,received,verifiedType,withoutCopies,counts,summary,control,cardRows,set};
})();
