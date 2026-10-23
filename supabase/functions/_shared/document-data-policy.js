// Same document boundaries for browser previews and the protected processing function.
(function (root) {
  'use strict';
  const norm = v => String(v ?? '').normalize('NFKC').replace(/[’ʼ]/g, "'").replace(/\s+/g, ' ').trim().toLocaleLowerCase('uk-UA');
  function kind(doc, requirement = '') {
    const hint = norm(requirement || doc.requirement_type);
    const type = norm(doc.ai_document_type || doc.document_type);
    if (/убд|учасника бойових дій/.test(hint + ' ' + type)) return 'ubd';
    if (/посвідчення водія|водійськ/.test(hint + ' ' + type)) return 'driver';
    if (/шлюб/.test(hint + ' ' + type) && !/розірвання|розлуч/.test(hint + ' ' + type)) return 'marriage';
    if (/паспорт|\bid\b|ід[\s-]*карт/.test(type)) return 'identity';
    if (/диплом|атестат|освіту/.test(hint + ' ' + type)) return 'education';
    if (/місце проживання|зареєстроване|територіальн.*громад/.test(hint + ' ' + type)) return 'residence';
    return 'other';
  }
  function normalize(doc, requirement = '') {
    const extracted = structuredClone(doc.ai_extracted || {}), warnings = [], category = kind(doc, requirement);
    let type = doc.ai_document_type || doc.document_type;
    if (/^(?:витяг (?:з|із) )?резерв\+$/u.test(norm(type))) type = 'Військовий облік (витяг Резерв+ / приписне)';
    if (category === 'ubd') type = 'Копія УБД';
    if (category === 'driver') type = 'Посвідчення водія';
    if (category === 'marriage') type = 'Актовий запис про шлюб';
    if (category === 'driver') {
      extracted.driver_license_number = extracted.driver_license_number || extracted.document_number || null;
      extracted.driver_license_issue_date = extracted.driver_license_issue_date || extracted.document_date || null;
      extracted.driver_license_expiry_date = extracted.driver_license_expiry_date || extracted.passport_expiry_date || null;
      extracted.driver_license_categories = extracted.driver_license_categories || null;
    }
    if (category !== 'identity') {
      for (const section of [extracted, extracted.personal, extracted.meta].filter(Boolean)) {
        for (const key of ['passport_data', 'passport_number', 'passport_series', 'passport_issuer', 'passport_issue_date', 'passport_expiry_date']) {
          if (section[key] != null && section[key] !== '') {
            warnings.push('Паспортне поле ' + key + ' зі стороннього документа не переноситься.');
            section[key] = null;
          }
        }
      }
    }
    if (category === 'ubd') {
      for (const key of Object.keys(extracted)) {
        if (/^military_|^vlk_|^tcc$|^served_before$/.test(key)) extracted[key] = null;
      }
    }
    if (/військов(?:ий|ого) квит(?:ок|ка)/iu.test(String(type)) && Array.isArray(extracted.military_service_records)) {
      for (const record of extracted.military_service_records) {
        if (!record || !record.page || !record.raw_text || !/^[АA]\d{4}$/u.test(String(record.unit||'').trim()) || (record.military_specialty&&!/^\d{6}[А-ЯІЇЄҐA-Z]?$/u.test(String(record.military_specialty).trim()))) {
          if (record) record.requires_review = true;
          warnings.push('Період служби без читабельної ВОС, сторінки або цитати залишено для ручної звірки.');
        }
      }
    }
    return { category, type, extracted, warnings };
  }
  function savedReview(doc, requirement) {
    const raw=doc.ai_raw_response,canonical='Військовий облік (витяг Резерв+ / приписне)';
    const deny=reason=>({eligible:false,reason});
    if(doc.deleted_at||doc.verification_status==='Підтверджено'||doc.verified_at)return deny('Документ видалений або вже підтверджений.');
    if(doc.processing_status!=='AI оброблено'||!raw||typeof raw!=='object')return deny('Немає успішного збереженого OCR.');
    if(!/^(?:витяг (?:з|із) )?резерв\+$/u.test(norm(raw.document_type))||requirement?.document_type!==canonical||requirement.ai_enabled===false)return deny('Потрібна окрема звірка типу документа.');
    if(raw.review_required||raw.extracted?.meta?.requires_review||doc.ai_extracted?.meta?.requires_review||doc.ai_extracted?.meta?.manual_review||raw.meta?.conflicts?.length||raw.extracted?.meta?.conflicts?.length)return deny('Джерело має окреме застереження або ручні уточнення.');
    if(!Number.isFinite(Number(doc.ai_confidence))||Number(doc.ai_confidence)<0.85||Number(doc.ai_confidence)>1)return deny('Недостатня впевненість OCR.');
    if(doc.notes!=='AI REVIEW REQUIRED model='+doc.ai_model)return deny('Примітка вже змінена; автоматичне очищення заборонено.');
    const generic=['[Рекрутер] Є розбіжності або нерозбірливі дані. Збережені значення залишено без змін.','[Рекрутер] AI просить перевірити документ перед перенесенням.'];
    const fallback='Попередній AI-сервіс не відповів; документ розпізнав наступний сервіс у черзі.';
    if((raw.warnings||[]).some(w=>w!==fallback))return deny('AI має окреме застереження.');
    const reviewFields=[];
    for(const warning of (doc.ai_warnings||[])){
      if(String(warning).startsWith('[CRM AI sync] ')){
        try{const entry=JSON.parse(warning.slice('[CRM AI sync] '.length));if(entry.reason!=='AI просить перевірити документ перед перенесенням'||typeof entry.field!=='string')return deny('Є окрема суперечність поля.');reviewFields.push(entry.field);}catch{return deny('Нерозбірливе застереження поля.');}
      }else if(!generic.includes(warning)&&warning!==fallback&&warning!=='AI визначив інший тип: '+raw.document_type+'. Звірте тип документа.')return deny('Є окреме застереження документа.');
    }
    const warnings=(doc.ai_warnings||[]).filter(w=>!String(w).startsWith('[CRM AI sync] ')&&!generic.includes(w)&&w!=='AI визначив інший тип: '+raw.document_type+'. Звірте тип документа.');
    return {eligible:true,reviewFields,patch:{document_type:canonical,document_name:canonical,ai_document_type:canonical,requirement_id:requirement.id,notes:'AI OK model='+doc.ai_model,verification_status:'Не перевірено',ai_warnings:warnings,ai_processed_at:new Date().toISOString()}};
  }
  function marriage(extracted, candidate) {
    const people = Array.isArray(extracted.relatives) ? extracted.relatives : [];
    const matches = people.filter(r => norm(r.full_name) === norm(candidate.name_nominative || candidate.full_name) &&
      (!candidate.birth_date || r.birth_date === candidate.birth_date) &&
      (!r.rnokpp || !candidate.rnokpp || r.rnokpp === candidate.rnokpp));
    const explicitOwner = norm(extracted.full_name || extracted.name_nominative) === norm(candidate.name_nominative || candidate.full_name) &&
      (!extracted.birth_date || !candidate.birth_date || extracted.birth_date === candidate.birth_date);
    if (matches.length > 1 || (!matches.length && !explicitOwner)) return { blocked: true, issue: 'Учасника шлюбу не звірено за ПІБ та датою народження.', relatives: [] };
    if (people.some(r => norm(r.full_name) === norm(candidate.name_nominative || candidate.full_name) && r.birth_date && candidate.birth_date && r.birth_date !== candidate.birth_date)) return { blocked: true, issue: 'Дата народження учасника шлюбу не збігається.', relatives: [] };
    const owner = matches[0] || { full_name: extracted.full_name || extracted.name_nominative, birth_date: extracted.birth_date };
    const spouses = people.filter(r => r !== owner && norm(r.full_name) !== norm(candidate.name_nominative || candidate.full_name) && /^(наречена|наречений|дружина|чоловік|wife|husband|bride|groom)$/.test(norm(r.relationship || r.relation)));
    if (spouses.length !== 1 || spouses[0].requires_review) return { blocked: true, issue: 'Другого учасника шлюбу потрібно звірити.', relatives: [] };
    const spouse = { ...spouses[0] };
    spouse.relationship = /наречена|дружина|wife|bride/.test(norm(spouse.relationship || spouse.relation)) ? 'дружина' : 'чоловік';
    delete spouse.relation;
    return { blocked: false, owner, relatives: [spouse] };
  }
  function serviceSummary(records) {
    return (Array.isArray(records) ? records : []).filter(r => ['military_service','police_service'].includes(r.kind) && !r.requires_review)
      .map(r => [r.start_date, r.end_date || 'триває / завершення не зазначене', r.employer, r.position, r.military_specialty && 'ВОС ' + r.military_specialty, r.order_number && 'наказ ' + r.order_number].filter(Boolean).join(' · ')).join('\n');
  }
  function cardExtras(profile) {
    const escape = v => String(v ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    const labels = {number:'Номер',series:'Серія',issue_date:'Дата видачі',expiry_date:'Дійсне до',categories:'Категорії',act_number:'Номер актового запису',registration_date:'Дата реєстрації шлюбу',certificate_number:'Свідоцтво',address:'Адреса',registered_at:'Дата реєстрації',status:'Стан'};
    const groups = [];
    for (const [key,title] of [['marriage_record','Шлюб'],['driver_license','Посвідчення водія'],['ubd_certificate','УБД']]) if (profile[key]) groups.push([title,profile[key]]);
    if (profile.registration_records?.length) groups.push(['Реєстрація місця проживання',profile.registration_records.find(r=>r.status==='current')||profile.registration_records[0]]);
    if (profile.criminal_record_details) groups.push(['Деталізація довідки МВС',{details:profile.criminal_record_details}]);
    if (!groups.length) return '';
    const content = groups.map(([title,value]) => '<div style="padding:8px 0;border-top:1px solid #e1e7e9"><strong>'+escape(title)+'</strong><div>'+Object.entries(value).filter(([key,v])=>v!=null&&v!==''&&key!=='source_document_id').map(([key,v])=>escape(labels[key]||'Відомості')+': '+escape(Array.isArray(v)?v.join(', '):v)).join(' · ')+'</div>'+(/^[0-9a-f-]{36}$/i.test(value.source_document_id||'')?'<button type="button" data-extra-document="'+escape(value.source_document_id)+'">✦ Джерело</button>':'')+'</div>').join('');
    return '<details class="cc-wide"><summary>Інші реквізити документів</summary>'+content+'</details>';
  }
  root.CRMDocumentPolicy = { kind, normalize, savedReview, marriage, serviceSummary, cardExtras };
})(globalThis);
