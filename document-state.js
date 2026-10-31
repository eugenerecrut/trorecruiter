// Shared document requirements, file states and package readiness. Read-only.
(function () {
  'use strict';
  const conditions=()=>window.CRMCandidateConditions;
  const latest=docs=>window.CRMResponsibility?.latest(docs||[])||(docs||[]).filter(d=>!d.deleted_at);
  const match=(r,d)=>!!r.id&&r.id===d.requirement_id||r.document_type===d.document_type;
  const files=(r,docs)=>latest(docs).filter(d=>match(r,d));
  const groups=[
    ['Анкета',/анкета на контракт/iu],
    ['Паспорт або ID-картка',/паспорт|(?:^|[\s/])ID[\s‑–—-]*карт|^ID$/iu],
    ['ІПН / РНОКПП',/ідентифікаційн.*код|РНОКПП|платника податк/iu],
    ['Довідка ВЛК',/^Довідка ВЛК$/iu],
    ['Форма 13',/(?:додаток|картка|форма)\s*13|картка обстеження та медичного огляду/iu],
    ['Військово-обліковий документ',/військов.*квит|припис[нк]|резерв\s*\+/iu],
    ['Повна довідка про несудимість',/несудимість/iu],
    ['УБД',/УБД/iu,true], ['Посвідчення водія',/посвідчення водія/iu,true]
  ];
  function fileState(d,aiEnabled=true) {
    if(d.verification_status==='Підтверджено')return 'Перевірений';
    if(d.verification_status==='Потребує перевірки')return 'Є розбіжності';
    if(aiEnabled&&d.processing_status==='AI помилка')return 'Помилка розпізнавання';
    if(aiEnabled&&d.processing_status==='AI очікує')return 'Очікує опрацювання СПЛАВ';
    if(aiEnabled&&d.processing_status==='AI обробка')return 'Розпізнавання…';
    if(aiEnabled&&d.ai_extracted&&Object.keys(d.ai_extracted).length)return 'Розпізнано — перевірте дані';
    return 'Завантажено — перевірте документ';
  }
  const isPhotoRequirement = type => /фото\s*(?:3\s*[×xх\/]\s*4|9\s*[×xх\/]\s*12)/iu.test(String(type || '')) || /^фото/iu.test(String(type || '').trim());
  const isPhotoDoc = d => isPhotoRequirement(d.document_type || d.document_name || '');
  const isAsAvailableOnly = type => /змін.*(?:імен|прізвищ)|посвідчення водія|групи крові|довідка влк|додаток\s*13|картка обстеження|убд|витяг.*наказ|нагород|припис про направлення|реєстр кандидата/iu.test(String(type || ''));
  const isMilitaryTicket = type => /військов.*квит/iu.test(String(type || ''));
  function rows(c,requirements,documents) {
    const docs=latest(documents), p=conditions().value(c,'relatives');
    const children=Number(c.children_count)||(Array.isArray(p)?p.filter(r=>/син|доньк|дитин/iu.test(r.relationship||r.relation||'')).length:0);
    const output=[];
    let photoGroupAdded=false;
    for(const original of requirements||[]) {
      if(original.active===false)continue;
      const isPhoto = isPhotoRequirement(original.document_type);
      if(isPhoto) {
        if(photoGroupAdded) continue;
        photoGroupAdded = true;
        const photoReqs = (requirements||[]).filter(req => req.active !== false && isPhotoRequirement(req.document_type));
        const primeReq = photoReqs.find(req => /9\s*[×xх\/]\s*12/i.test(req.document_type)) || original;
        const normReq = conditions().normalizeRequirement(primeReq);
        const r = {
          ...normReq,
          id: primeReq.id,
          document_type: 'Фотокартки (3×4 або 9×12)',
          condition_note: 'Для справи потрібно 4 шт. 3×4 та 2 шт. 9×12. Достатньо завантажити будь-яке фото (3×4 або 9×12) та поставити галочку, що всі фото є.'
        };
        const photoDocs = docs.filter(isPhotoDoc);
        const mark = photoReqs.map(req => window.CRMDocumentPresence?.entry(req, c)).find(Boolean) ||
          window.CRMDocumentPresence?.byType('Фотокартки (3×4 або 9×12)', c) ||
          window.CRMDocumentPresence?.byType('Фото 9×12', c) ||
          window.CRMDocumentPresence?.byType('Фото 3×4', c) ||
          (conditions().value(c, 'all_photos_present') === true || conditions().value(c, 'photos_present') === true ? {
            available: true,
            document_type: 'Фотокартки (3×4 або 9×12)',
            checked_by_name: 'CRM',
            checked_at: c.updated_at
          } : null);
        const received = !!mark || photoDocs.length > 0;
        const verified = !!mark || photoDocs.some(d => d.verification_status === 'Підтверджено');
        output.push({
          r,
          files: photoDocs,
          condition: true,
          childIndex: null,
          received,
          verified,
          group: 'photo-bundle',
          allPhotoReqs: photoReqs
        });
        continue;
      }
      const r=conditions().forCandidate(conditions().normalizeRequirement(original),c);
      let condition=conditions().requirement(r,c);
      if(condition===false)continue;
      const allFiles=files(r,docs), child=r.condition_field==='has_children';
      const mark=window.CRMDocumentPresence?.entry(r,c);
      if(isAsAvailableOnly(r.document_type)&&allFiles.length===0&&!mark)continue;
      const served=conditions().bool(conditions().value(c,'served_before'));
      if(served!==true&&isMilitaryTicket(r.document_type)&&allFiles.length===0&&!mark)continue;
      const count=child&&condition===true?Math.max(1,children):1;
      for(let i=0;i<count;i++) {
        const rowFiles=child?(i===count-1?allFiles.slice(i):allFiles.slice(i,i+1)):allFiles;
        const mark=window.CRMDocumentPresence?.entry(r,c);
        const rowCondition=child&&condition===true&&!children?null:condition;
        const alternate=conditions().isMobilization(c)&&conditions().militaryDocument(r.document_type);
        const equivalent=alternate?docs.filter(d=>conditions().militaryDocument(d.document_type)):rowFiles;
        output.push({r,files:rowFiles,condition:rowCondition,childIndex:child?i+1:null,
          received:!!mark||equivalent.length>0,
          verified:!!mark||equivalent.some(d=>d.verification_status==='Підтверджено'),
          group:alternate?'military-alternative':r.id||r.document_type});
      }
    }
    return output;
  }
  function scope(c,requirements,documents) {
    const docs=latest(documents);
    const current=[],excluded=[];
    for(const d of docs){
      const isPhoto = isPhotoDoc(d);
      const original=isPhoto
        ? (requirements||[]).find(r=>isPhotoRequirement(r.document_type))
        : (requirements||[]).find(r=>match(r,d));
      const r=original&&conditions().forCandidate(conditions().normalizeRequirement(original),c);
      const applies=r?(r.active===false?false:conditions().requirement(r,c)):d.document_type?conditions().documentCondition(d.document_type,c):null;
      (applies===false?excluded:current).push(d); // Unknown conditions remain visible for review.
    }
    return {all:docs,current,excluded};
  }
  function summary(c,requirements,documents) {
    const list=rows(c,requirements,documents), {all:docs,current,excluded}=scope(c,requirements,documents), seen=new Set();
    const required=list.filter(row=>{
      if(!row.r.is_required||row.condition!==true)return false;
      if(row.group==='military-alternative'||row.group==='photo-bundle'){if(seen.has(row.group))return false;seen.add(row.group);}
      return true;
    });
    return {rows:list,total:required.length,received:required.filter(r=>r.received).length,
      verified:required.filter(r=>r.verified).length,unknown:list.filter(r=>r.r.is_required&&r.condition===null).length,
      copies:current.filter(d=>d.storage_path).length,
      review:current.filter(d=>d.verification_status!=='Підтверджено').length,
      errors:current.filter(d=>d.processing_status==='AI помилка').length,
      processing:current.filter(d=>d.processing_status==='AI обробка').length,
      excludedReview:excluded.filter(d=>d.verification_status!=='Підтверджено').length,
      excludedErrors:excluded.filter(d=>d.processing_status==='AI помилка').length,
      excludedProcessing:excluded.filter(d=>d.processing_status==='AI обробка').length,
      paper:window.CRMDocumentPresence?.withoutCopies(c,docs).length||0};
  }
  function packageState(c,documents) {
    const docs=latest(documents).filter(d=>d.storage_path), output=[];
    for(const [title,re,optional] of groups) {
      let found=docs.filter(d=>re.test(d.document_type));
      if(title==='Військово-обліковий документ') {
        const tickets=found.filter(d=>/військов.*квит/iu.test(d.document_type));
        const prescriptions=found.filter(d=>/припис[нк]/iu.test(d.document_type));
        found=tickets.length?tickets:prescriptions.length?prescriptions:found.filter(d=>/резерв\s*\+/iu.test(d.document_type));
      }
      const paper=(window.CRMDocumentPresence?.active(c)||[]).some(e=>re.test(e.document_type));
      const state=!found.length?(paper?(optional?'Є без файла — не увійде до PDF':'Є без файла — потрібна електронна копія'):optional?'За наявності — не додано':'Не завантажено'):found.some(d=>d.verification_status!=='Підтверджено')?'Потрібно підтвердити':'Готово';
      output.push({title,optional:!!optional,files:found,state,blocked:(!optional&&!found.length)||found.some(d=>d.verification_status!=='Підтверджено')});
    }
    return {rows:output,ready:output.every(r=>!r.blocked),files:output.flatMap(r=>r.files),missing:output.filter(r=>r.blocked)};
  }
  function requirementFor(d,requirements) {return (requirements||[]).find(r=>match(r,d));}
  window.CRMDocumentState={match,files,rows,scope,summary,fileState,packageState,requirementFor};
})();
