(function () {
  'use strict';
  window.editDocumentExtraction = async function (id) {
    const {data:d,error}=await supabaseClient.from('documents').select('*').eq('id',id).single();
    if(error)throw error;if(d.deleted_at)throw new Error('Документ видалено.');
    const user=await getCurrentUser();if(!user)throw new Error('Увійдіть у CRM.');
    const e=structuredClone(d.ai_extracted||{}),esc=docEscape;
    const fields=[['Тип документа','document_type',d.ai_document_type||d.document_type],['ПІБ власника','full_name',e.full_name],['Дата народження','birth_date',e.birth_date,'date'],['Серія документа','document_series',e.document_series],['Номер документа','document_number',e.document_number],['Дата видачі','document_date',e.document_date,'date'],['Орган видачі','document_issuer',e.document_issuer]];
    const docType=String(d.ai_document_type||d.document_type||'');
    if(!CRMDocumentPolicy.isChildBirth(d)){
      fields.push(['РНОКПП','rnokpp',e.rnokpp||e.personal?.rnokpp],['Місце народження','birth_place',e.birth_place||e.personal?.birth_place]);
    }
    if(/паспорт|id[\s-]*карт/iu.test(docType)){
      fields.push(['Дійсний до','passport_expiry_date',e.passport_expiry_date||e.personal?.passport_expiry_date,'date'],['УНЗР','unzr',e.unzr||e.personal?.unzr],['ПІБ у родовому відмінку','name_genitive',e.name_genitive||e.personal?.name_genitive||e.name_cases?.genitive]);
    }
    if(/рекомендац/iu.test(docType)){
      fields.push(['Телефон','phone',e.phone||e.personal?.phone],['Військове звання','military_rank',e.military_rank||e.service?.military_rank],['Бажана посада','desired_position',e.desired_position||e.service?.desired_position],['ВОС','military_specialty',e.military_specialty||e.service?.military_specialty],['ШПК','shpk',e.shpk||e.service?.shpk],['Тарифний розряд','tariff_grade',e.tariff_grade||e.service?.tariff_grade],['Військова частина','military_unit',e.military_unit||e.service?.military_unit],['Підрозділ / центр','desired_unit',e.desired_unit||e.service?.desired_unit],['Рекомендуючий підрозділ','recommender_unit',e.recommender_unit||e.service?.recommender_unit],['Підписант','signatory',e.signatory||e.service?.signatory],['Рекрутер','recruiter_name',e.recruiter_name||e.service?.recruiter_name]);
    }
    const kind=CRMDocumentPolicy.kind(d);
    if(!CRMDocumentPolicy.isChildBirth(d)&&/(?:свідоцтво|акт(?:овий|ового) запис|витяг).{0,35}народження/iu.test(docType)){
      (e.relatives||[]).forEach((r,i)=>fields.push(['Родич '+(i+1)+' · ПІБ ('+(r.relationship||'не вказано')+')','relatives.'+i+'.full_name',r.full_name]));
    }
    if(kind==='education'){
      (e.education_records||[]).forEach((r,i)=>{
        for(const [label,key,type] of [['ПІБ власника','owner_full_name'],['Дата народження','owner_birth_date','date'],['Ступінь','degree'],['Заклад освіти','institution'],['Спеціальність','specialty'],['Кваліфікація','qualification'],['Код спеціальності','specialty_code'],['Серія диплома','diploma_series'],['Номер диплома','diploma_number'],['Дата видачі диплома','diploma_issue_date','date'],['Початок навчання','study_start_date'],['Завершення навчання','study_end_date'],['Номер додатка','supplement_number'],['Дата видачі додатка','supplement_issue_date','date']])fields.push(['Освіта '+(i+1)+' · '+label,'education_records.'+i+'.'+key,r[key],type]);
      });
    }
    if(kind==='driver')fields.push(['Номер посвідчення водія','driver_license_number',e.driver_license_number||e.document_number],['Дійсне до','driver_license_expiry_date',e.driver_license_expiry_date||e.passport_expiry_date,'date'],['Категорії водія','driver_license_categories',(e.driver_license_categories||[]).join(', ')]);
    if(kind==='marriage')fields.push(['Номер актового запису','marriage_record.act_number',e.marriage_record?.act_number],['Дата реєстрації шлюбу','marriage_record.registration_date',e.marriage_record?.registration_date,'date'],['Номер свідоцтва','marriage_record.certificate_number',e.marriage_record?.certificate_number]);
    const military=/військов(?:ий|ого) квит(?:ок|ка)/iu.test(String(d.document_type));
    if(military){
      fields.push(['Номер військового квитка','military_document_number',e.military_document_number],['ТЦК та СП','tcc',e.tcc],['Дата взяття на облік','military_registration_date',e.military_registration_date,'date'],['Військова підготовка','military_training_status',e.military_training_status],['Звання у військовому квитку','military_rank',e.military_rank],['Освіта у військовому квитку','education',e.education],['Цивільна спеціальність у ВК','civilian_profession',e.civilian_profession]);
      for(const [key,title,keys] of [
        ['military_oath','Присяга',[['Дата','date','date'],['Військова частина','unit'],['Сторінка PDF','page','number'],['Текст із документа','raw_text']]],
        ['military_discharge','Звільнення',[['Військова частина','unit'],['Підстава','basis'],['Номер наказу','order_number'],['Дата наказу','order_date','date'],['Сторінка PDF','page','number'],['Текст із документа','raw_text']]]
      ])if(e[key]&&typeof e[key]==='object'&&!Array.isArray(e[key]))for(const [label,field,type] of keys)fields.push([title+' · '+label,key+'.'+field,e[key][field],type]);
      (Array.isArray(e.military_service_records)?e.military_service_records:[]).forEach((r,i)=>{
        for(const [label,key,type] of [['Військова частина','unit'],['Початок','start_date','date'],['Завершення','end_date','date'],['Посада','position'],['ВОС','military_specialty'],['Наказ про зарахування','order_number'],['Наказ про виключення','end_order_number'],['Сторінка PDF','page','number'],['Текст із документа','raw_text']])fields.push(['Служба '+(i+1)+' · '+label,'military_service_records.'+i+'.'+key,r[key],type]);
      });
    }
    const dialog=document.createElement('dialog');dialog.className='crm-dialog';
    dialog.innerHTML='<h2>Уточнити реквізити документа</h2><p>'+esc(d.file_name)+'</p><p>Вносьте лише дані, звірені з оригіналом. Початкова відповідь AI зберігається. Дані картки переносимо окремо після звірки.</p><button type="button" data-review-original>Відкрити оригінал</button><form><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">'+fields.map(([label,key,value,type])=>'<label>'+esc(label)+'<input style="width:100%" data-review-key="'+esc(key)+'" type="'+(type||'text')+'" value="'+esc(value||'')+'"></label>').join('')+'</div>'+(military?'<label><input type="checkbox" data-review-service> Періоди служби потребують ручної звірки</label>':'')+(Array.isArray(e.work_events)?'<details><summary>Події роботи / служби</summary>'+e.work_events.map((r,i)=>'<label style="display:block"><input type="checkbox" data-review-event="'+i+'" '+(r.requires_review?'checked':'')+'> Рядок '+(r.row_number||i+1)+': '+esc(r.employer)+' · '+esc(r.event_date)+' · наказ '+esc(r.order_number)+' — потребує звірки</label>').join('')+'</details>':'')+'<p role="status"></p><div class="crm-actions"><button type="submit">Зберегти уточнення</button><button type="button" data-review-close>Скасувати</button></div></form>';
    document.body.append(dialog);dialog.showModal();
    if(military&&Array.isArray(e.military_service_records)){
      const section=document.createElement('details');section.innerHTML='<summary>Помилкові фрагменти служби</summary><p>Позначте лише зайві фрагменти OCR. Оригінал та початкова відповідь AI зберігаються. Позначку потреби звірки знімайте лише після перевірки рядка за оригіналом.</p>'+e.military_service_records.map((r,i)=>'<label style="display:block"><input type="checkbox" data-review-service-row="'+i+'" '+(r.requires_review?'checked':'')+'> Служба '+(i+1)+' · потребує звірки</label><label style="display:block"><input type="checkbox" data-review-remove-service="'+i+'"> Прибрати фрагмент '+(i+1)+' · '+esc(r.unit||'Частину не визначено')+' · '+esc(r.start_date||'')+'</label>').join('');
      dialog.querySelector('form').insertBefore(section,dialog.querySelector('[role="status"]'));
    }
    dialog.querySelector('[data-review-original]').onclick=()=>openDocument(id);
    dialog.querySelector('[data-review-close]').onclick=()=>{dialog.close();dialog.remove();};
    dialog.querySelector('form').onsubmit=async event=>{
      event.preventDefault();const status=dialog.querySelector('[role="status"]');
      const extracted=structuredClone(e);let documentType=d.ai_document_type||d.document_type;
      for(const input of dialog.querySelectorAll('[data-review-key]')){
        const key=input.dataset.reviewKey,raw=input.value.trim(),value=input.type==='number'&&raw?Number(raw):raw;
        if(input.type==='number'&&raw&&(!Number.isSafeInteger(value)||value<1)){status.textContent='Сторінка PDF має бути цілим додатним числом.';return;}
        if(key==='birth_date'&&value!==String(e.birth_date??'')){
          extracted.birth_year=value?Number(value.slice(0,4)):null;
          if(extracted.personal&&Object.prototype.hasOwnProperty.call(extracted.personal,'birth_year'))extracted.personal.birth_year=extracted.birth_year;
        }
        if(key==='document_type'){documentType=value;continue;}
        if(key==='driver_license_categories'){extracted[key]=value?value.split(/[,;\s]+/).filter(Boolean):null;continue;}
        if(key.includes('.')){const parts=key.split('.');let target=extracted;for(const part of parts.slice(0,-1))target=target[part];target[parts.at(-1)]=value||null;}
        else{extracted[key]=value||null;for(const s of ['personal','service'])if(extracted[s]&&typeof extracted[s]==='object'&&Object.prototype.hasOwnProperty.call(extracted[s],key))extracted[s][key]=value||null;if(key==='name_genitive'&&extracted.name_cases&&typeof extracted.name_cases==='object')extracted.name_cases.genitive=value||null;}
      }
      if(!documentType){status.textContent='Вкажіть тип документа.';return;}
      if(extracted.driver_license_categories?.some(v=>!['A1','A','B1','B','C1','C','D1','D','BE','C1E','CE','D1E','DE','T'].includes(v.toUpperCase()))){status.textContent='Перевірте категорії водія.';return;}
      for(const box of dialog.querySelectorAll('[data-review-service-row]'))extracted.military_service_records[Number(box.dataset.reviewServiceRow)].requires_review=box.checked;
      if(dialog.querySelector('[data-review-service]')?.checked)extracted.military_service_records=(extracted.military_service_records||[]).map(r=>({...r,requires_review:true}));
      const removed=new Set([...dialog.querySelectorAll('[data-review-remove-service]:checked')].map(box=>Number(box.dataset.reviewRemoveService)));
      if(removed.size)extracted.military_service_records=extracted.military_service_records.filter((_,i)=>!removed.has(i));
      for(const box of dialog.querySelectorAll('[data-review-event]'))extracted.work_events[Number(box.dataset.reviewEvent)].requires_review=box.checked;
      const policy=CRMDocumentPolicy.normalize({...d,document_type:documentType,ai_document_type:documentType,ai_extracted:extracted});
      policy.extracted.meta={...policy.extracted.meta,manual_review:{user_id:user.id,reviewed_at:new Date().toISOString()}};
      const processedAt=new Date().toISOString();CRMWorkspace.busy=true;dialog.querySelectorAll('button,input').forEach(el=>el.disabled=true);
      try{
        const newer=await supabaseClient.from('documents').select('id').eq('version_group_id',d.version_group_id).gt('version_number',d.version_number).limit(1);
        if(newer.error)throw newer.error;if(newer.data?.length)throw new Error('Це архівна версія. Уточнюйте чинний документ.');
        let query=supabaseClient.from('documents').update({document_type:policy.type,document_name:policy.type,ai_document_type:policy.type,ai_extracted:policy.extracted,ai_processed_at:processedAt,ai_warnings:[...new Set([...(d.ai_warnings||[]),...policy.warnings,'Реквізити уточнено після звірки з оригіналом; початкову відповідь AI збережено.'])]});
        query=d.ai_processed_at?query.eq('ai_processed_at',d.ai_processed_at):query.is('ai_processed_at',null);
        const saved=await query.eq('id',id).select('id');if(saved.error)throw saved.error;if(!saved.data?.length)throw new Error('Результат змінився. Відкрийте уточнення знову.');
        dialog.close();dialog.remove();if(document.getElementById('candidateCardV2')&&typeof window.openCandidateCard==='function')await window.openCandidateCard(d.candidate_id);else await showDocuments(d.candidate_id);
      }catch(err){status.textContent='Не збережено: '+err.message;dialog.querySelectorAll('button,input').forEach(el=>el.disabled=false);}
      finally{CRMWorkspace.busy=false;}
    };
  };
})();
