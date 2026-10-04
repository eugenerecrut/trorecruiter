/* PSK_RECRUTER — full editable candidate card V2 */
(function () {
  const esc = window.escapeHtml || function (v) {
    return String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  };

  function boolValue(v) {
    if (v === true || v === 'true') return 'true';
    if (v === false || v === 'false') return 'false';
    return '';
  }

  function yesNo(value, yes, no) {
    const v = boolValue(value);
    return `<option value="" ${v === '' ? 'selected' : ''}>Не визначено</option><option value="true" ${v === 'true' ? 'selected' : ''}>${yes}</option><option value="false" ${v === 'false' ? 'selected' : ''}>${no}</option>`;
  }

  function marital(sex, current) {
    const base = sex === 'female' ? ['Одружена','Розлучена','Не одружена'] : sex === 'male' ? ['Одружений','Розлучений','Не одружений'] : ['Одружений','Одружена','Розлучений','Розлучена','Не одружений','Не одружена'];
    if (current && !base.includes(current)) base.unshift(current);
    return base.map(x => `<option value="${esc(x)}" ${x === current ? 'selected' : ''}>${esc(x)}</option>`).join('');
  }

  function val(c, pf, profile, key, fallback = '') {
    return c?.[key] ?? pf?.[key] ?? profile?.[key] ?? fallback;
  }

  function input(label, name, value, type = 'text', cls = '') {
    if(name==='phone'||name==='phone_secondary'){value=window.CRMPhone.normalize(value);type='tel';}
    return `<div class="cc-field ${cls}"><label>${esc(label)}</label><input name="${esc(name)}" type="${type}" value="${esc(value ?? '')}"></div>`;
  }

  function select(label, name, value, options, cls = '') {
    return `<div class="cc-field ${cls}"><label>${esc(label)}</label><select name="${esc(name)}">${options.map(([v,t]) => `<option value="${esc(v)}" ${String(v) === String(value ?? '') ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>`;
  }

  function textarea(label, name, value, cls = '') {
    return `<div class="cc-field ${cls}"><label>${esc(label)}</label><textarea name="${esc(name)}" rows="4">${esc(value ?? '')}</textarea></div>`;
  }

  function section(title, subtitle, body) {
    return `<section class="cc-section" data-section="${parseInt(title,10)}"><div class="cc-section-head"><div><h3>${esc(title)}</h3><small>${esc(subtitle || '')}</small></div></div><div class="cc-grid">${body}</div></section>`;
  }

  const RELATIONSHIP_OPTIONS = ['Батько','Мати','Чоловік','Дружина','Колишній чоловік','Колишня дружина','Син','Донька','Брат','Сестра','Інше'];

  function relativeRow(item = {}, index = 0) {
    const options = [['','Оберіть'], ...RELATIONSHIP_OPTIONS.map(x => [x, x])];
    return `<div class="cc-relative-row" data-relative-row="${index}">
      <div class="cc-relative-head"><strong>Близький родич</strong><button type="button" class="cc-relative-remove" data-remove-relative>Видалити</button></div>
      <div class="cc-grid">
        ${select('Ступінь споріднення','relationship',item.relationship || item.relation || '',options)}
        ${input('ПІБ','full_name',item.full_name || '')}
        ${input('Дата народження','birth_date',item.birth_date || '','date')}
        ${input('Місце народження','birth_place',item.birth_place || '')}
        ${input('Громадянство','citizenship',item.citizenship || '')}
        ${input('Місце проживання','address',item.address || '','text','cc-wide')}
        ${input('Телефон','phone',item.phone || '')}
        ${input('Місце роботи','workplace',item.workplace || '')}
        ${input('Посада','position',item.position || '')}
        ${textarea('Примітки','notes',item.notes || '','cc-wide')}
      </div>
    </div>`;
  }

  function nameNominative(value) {
    const parts = String(value || '').trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
    if (!parts.length) return '';
    parts[0] = parts[0].toLocaleUpperCase('uk-UA');
    return parts.join(' ');
  }

  function documentLabel(d) {
    return d.document_name || d.document_type || d.file_name || 'Документ';
  }

  async function openDoc(path) {
    if (!path) return;
    const { data, error } = await supabaseClient.storage.from('candidate-documents').createSignedUrl(path, 600);
    if (error) return alert('Не вдалося відкрити документ: ' + error.message);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener');
  }

  async function renderCard(candidateId) {
    const content = document.querySelector('.content');
    if (!content) return;
    content.innerHTML = '<div style="padding:40px;text-align:center;color:#7d8a93">Завантажуємо повну картку кандидата...</div>';

    const [cr, pr, dr] = await Promise.all([
      supabaseClient.from('candidates').select('*').eq('id', candidateId).single(),
      supabaseClient.from('personal_files').select('*').eq('candidate_id', candidateId).maybeSingle(),
      supabaseClient.from('documents').select('*').eq('candidate_id', candidateId).order('created_at', { ascending: true })
    ]);
    if (cr.error) throw cr.error;

    const c = cr.data || {};
    if(pr.error)throw pr.error;if(dr.error)throw dr.error;
    const pf = pr.data || {};
    let profile = c.profile_data && typeof c.profile_data === 'object' ? c.profile_data : {};
    if (typeof c.profile_data === 'string') { try { profile = JSON.parse(c.profile_data); } catch (_) {} }
    const docs = CRMResponsibility.latest(dr.data || []);
    CRMWorkspace.setContext(candidateId,c.name_nominative||c.full_name);
    const activeCardSection=window.crmActiveCardSection||'personal';
    const relatives = Array.isArray(profile.relatives) ? profile.relatives : [];
    const sex = c.sex || profile.sex || '';
    const maritalStatus = c.marital_status || pf.family_status || profile.marital_status || '';

    const statusOptions = ['Новий','Первинний контакт','Співбесіда','Перевірка документів','ВЛК','Рішення','Призначений','Відмова','Втрачено контакт','Відкладено'];
    const docTypeOptions = ['Паспорт громадянина України (ID-картка)','Паспорт громадянина України (книжечка)','РНОКПП','Військово-обліковий документ','Анкета','Згода на обробку персональних даних','Згода на збір та обробку даних','Заява на контракт','Розписка кандидата','Освіта','Трудова діяльність','ВЛК','Інше'];

    const documentRows = docs.length ? docs.map(d => `<div class="cc-doc"><div><b>${esc(documentLabel(d))}</b><small>${esc(d.file_name || '')} · ${d.required ? 'Обов’язковий' : 'Додатковий'} · ${esc(d.status || 'Завантажено')}</small></div><button type="button" data-open-doc="${esc(d.storage_path || '')}">Відкрити</button></div>`).join('') : '<div class="cc-empty">Документи ще не завантажені.</div>';

    content.innerHTML = `
      <style>
        .cc-wrap{max-width:1280px}.cc-section{background:#fff;border:1px solid #e0e6e8;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 8px 28px rgba(19,31,40,.04)}
        .cc-section-head{display:flex;justify-content:space-between;align-items:center;margin:-20px -20px 18px;padding:15px 20px;border-bottom:1px solid #e7ecee;background:#fbfcfc;border-radius:12px 12px 0 0}.cc-section-head h3{margin:0;font-size:15px}.cc-section-head small{display:block;color:#7d8a93;margin-top:4px;font-size:11px}.cc-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 16px}.cc-field label{display:block;color:#44515a;font-weight:700;font-size:12px;margin-bottom:6px}.cc-field input,.cc-field select,.cc-field textarea{width:100%;color:#24313a;background:#fff;border:1px solid #cfd8dc;border-radius:8px;padding:10px 11px;outline:none}.cc-field input:focus,.cc-field select:focus,.cc-field textarea:focus{border-color:#9ebd45;box-shadow:0 0 0 3px rgba(183,217,87,.16)}.cc-wide{grid-column:1/-1}.cc-actions{display:flex;gap:9px;flex-wrap:wrap;margin:4px 0 22px}.cc-actions button{border-radius:8px;padding:11px 16px;font-weight:800;border:1px solid #d8e0e3;background:#fff;color:#45525a}.cc-actions .primary{background:#18232d;color:#fff;border-color:#18232d}.cc-status{font-size:12px;color:#68757d;min-height:18px}.cc-docs{display:grid;gap:9px}.cc-doc{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px;border:1px solid #e6eaec;border-radius:9px;background:#fbfcfc}.cc-doc b{display:block;font-size:12px}.cc-doc small{display:block;color:#89959c;margin-top:4px;font-size:10px}.cc-doc button{border:1px solid #cfd8dc;background:#fff;border-radius:7px;padding:7px 10px;font-weight:800}.cc-templates{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.cc-template{padding:12px;border:1px solid #d8e0e3;background:#f7f9f9;border-radius:8px;text-align:left;font-weight:800;color:#45525a}.cc-hint{padding:11px 13px;background:#f7faed;border:1px solid #dce8b7;border-radius:8px;color:#68757d;font-size:11px;margin-bottom:14px}.cc-empty{text-align:center;color:#89959c;padding:18px}.cc-badge{padding:5px 9px;border-radius:12px;background:#e8f2cc;color:#5d741f;font-size:10px;font-weight:800}.cc-relative-row{border:1px solid #dfe6e9;border-radius:10px;padding:14px;margin-bottom:12px;background:#fbfcfc}.cc-relative-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;color:#44515a}.cc-relative-remove{border:1px solid #e1caca!important;background:#fff!important;color:#96504e!important;padding:6px 9px!important;font-size:11px}.cc-relative-add{margin-top:4px;border:1px solid #cfd8dc!important;background:#f7f9f9!important;color:#45525a!important}
      </style>
      <div class="dashboard-top cc-wrap"><div><div class="page-title">Картка кандидата</div><p class="page-subtitle">Усі дані кандидата в одному місці. Усі поля редагуються рекрутером.</p></div><div class="quick-actions"><span class="cc-badge">${esc(c.name_nominative||c.full_name)}</span><button type="button" onclick="crmNavigate('documents','${candidateId}')">Документи</button><button type="button" onclick="crmNavigate('information','${candidateId}')">Обов’язкова інформація</button><button onclick="crmNavigate('candidates')">← До кандидатів</button></div></div>
      <section class="crm-responsibility" data-responsibility></section>
      <nav class="crm-card-nav cc-wrap" id="crmCardNav" aria-label="Розділи картки"></nav>
      <form id="candidateCardV2" class="cc-wrap">
        <div class="crm-photo" data-card-photo><img id="crmCardPhoto" alt="Фото кандидата 9×12" hidden><div><strong>Фото кандидата 9×12</strong><p id="crmCardPhotoStatus" class="muted">Завантажуємо фото…</p><button type="button" onclick="crmNavigate('documents','${candidateId}')">Документи та фото</button></div></div>
        ${section('1. Персональні дані','Основні ідентифікаційні відомості',
          input('ПІБ у називному відмінку','name_nominative',c.name_nominative || c.full_name,'text')+
          input('ПІБ у родовому відмінку','name_genitive',CRMCandidateName.stored(c,profile))+
          input('Дата народження','birth_date',c.birth_date,'date')+
          input('Місце народження','birth_place',c.birth_place || pf.birth_place || profile.birth_place)+
          select('Стать','sex',sex,[['','Не визначено'],['male','Чоловіча'],['female','Жіноча']])+ 
          input('Громадянство','citizenship',c.citizenship || profile.citizenship || 'Україна')+
          input('РНОКПП','rnokpp',c.rnokpp)+
          input('УНЗР','unzr',profile.unzr)+
          input('Серія та № свідоцтва про народження','birth_certificate',profile.birth_certificate)+
          select('Сімейний стан','marital_status',maritalStatus, [['','Не визначено'],...((sex==='female'?['Одружена','Розлучена','Не одружена']:sex==='male'?['Одружений','Розлучений','Не одружений']:['Одружений','Одружена','Розлучений','Розлучена','Не одружений','Не одружена']).map(x=>[x,x]))])+
          select('Діти','has_children',boolValue(c.has_children ?? profile.has_children),[['','Не визначено'],['true','Є діти'],['false','Не має дітей']])+ 
          input('Кількість дітей','children_count',c.children_count??'','number')+textarea('Інформація про дітей','children_info',pf.children_info || profile.children_info,'cc-wide')
        )}
        ${section('2. Документ, що посвідчує особу','Паспорт / ID-картка',
          select('Тип документа','identity_document_type',profile.identity_document_type || '', [['','Не визначено'],['ID','Паспорт громадянина України (ID-картка)'],['passport','Паспорт громадянина України (книжечка)'],['birth','Свідоцтво про народження']])+ 
          input('Серія','passport_series',profile.passport_series)+
          input('Номер','passport_number',profile.passport_number)+
          input('Ким виданий','passport_issuer',profile.passport_issuer,'text','cc-wide')+
          input('Дата видачі','passport_issue_date',profile.passport_issue_date,'date')+
          input('Строк дії','passport_expiry_date',profile.passport_expiry_date,'date')+
          input('Паспортні дані (повний запис)','passport_data',c.passport_data || pf.passport_data,'text','cc-wide')
        )}
        ${section('3. Контактні дані','Зв’язок із кандидатом',
          input('Основний телефон','phone',c.phone)+input('Додатковий телефон','phone_secondary',profile.phone_secondary)+input('Email','email',c.email,'email')+input('Telegram / Viber','messenger',profile.messenger)
        )}
        ${section('4. Адреси','Зареєстроване та фактичне місце проживання',
          input('Зареєстроване місце проживання','registered_address',profile.registered_address || pf.registered_address,'text','cc-wide')+
          input('Фактичне місце проживання','address',pf.address,'text','cc-wide')+
          input('Область','region',profile.region)+input('Населений пункт','locality',profile.locality)+input('Вулиця','street',profile.street)+input('Будинок','house',profile.house)+input('Квартира','apartment',profile.apartment)+input('Індекс','postal_code',profile.postal_code)
        )}
        ${section('5. Освіта','Освітні документи та кваліфікація',
          select('Рівень освіти','education_level',profile.education_level || '',[['','Не визначено'],['середня','Середня'],['професійна','Професійно-технічна'],['фахова','Фахова передвища'],['вища','Вища']])+input('Заклад освіти','education_institution',profile.education_institution)+input('Спеціальність','education_specialty',profile.education_specialty)+input('Кваліфікація','education_qualification',profile.education_qualification)+input('Рік закінчення','education_year',profile.education_year,'number')+textarea('Деталі освіти','education',pf.education,'cc-wide')
        )}
        ${section('6. Трудова діяльність','Відомості про роботу',
          select('Працював / Працювала','worked_before',boolValue(c.worked_before ?? profile.worked_before),[['','Не визначено'],['true','Працював / Працювала'],['false','Не працював / Не працювала']])+input('Цивільна професія','civilian_profession',c.civilian_profession)+textarea('Трудова діяльність','work_history',pf.work_history || pf.civilian_experience,'cc-wide')
        )}
        ${section('7. Військова служба','Відомості про попередню та поточну службу',
          select('Служив / Служила','served_before',boolValue(c.served_before ?? profile.served_before),[['','Не визначено'],['true','Служив / Служила'],['false','Не служив / Не служила']])+input('Військове звання','military_rank',c.military_rank)+input('ВОС','military_specialty',c.military_specialty || profile.military_specialty)+input('Військова частина','military_unit',profile.military_unit)+input('Посада','military_position',profile.military_position)+input('Дата початку служби','service_start_date',profile.service_start_date,'date')+input('Дата закінчення служби','service_end_date',profile.service_end_date,'date')+input('Кількість днів бойових','combat_days',profile.combat_days,'number')+textarea('Військова служба','military_service_history',pf.military_service_history || pf.military_experience,'cc-wide')
        )}
        ${section('8. Військовий облік','Дані військового обліку',
          input('ТЦК та СП','tcc',c.tcc)+input('Номер військово-облікового документа','military_document_number',profile.military_document_number)+input('Дата взяття на облік','military_registration_date',profile.military_registration_date,'date')+input('Категорія обліку','military_registration_category',profile.military_registration_category)+input('Стан обліку','military_registration_status',profile.military_registration_status)+input('Військовий документ','military_document_type',profile.military_document_type)
        )}
        ${section('9. ВЛК','Військово-лікарська комісія',
          input('Номер довідки ВЛК','vlk_certificate_number',profile.vlk_certificate_number)+input('Дата проходження ВЛК','vlk_date',profile.vlk_date,'date')+input('Висновок','vlk_conclusion',profile.vlk_conclusion)+input('Категорія придатності','vlk_category',profile.vlk_category)+input('Дата наступного огляду','vlk_next_date',profile.vlk_next_date,'date')+input('Статус ВЛК','vlk_status',c.vlk_status)+textarea('Примітки ВЛК','vlk_notes',profile.vlk_notes,'cc-wide')
        )}
        ${section('10. Рекрутингові дані','Внутрішня робота рекрутера',
          input('Джерело кандидата','candidate_source',profile.candidate_source)+input('Хто прийняв кандидата','recruiter_name',profile.recruiter_name)+input('Напрям','desired_unit',c.direction)+input('Бажана посада','desired_position',c.desired_position)+textarea('Мотивація кандидата','motivation',profile.motivation)+textarea('Додаткова інформація','recruitment_notes',profile.recruitment_notes,'cc-wide')+input('Відомості про судимість','criminal_record_info',profile.criminal_record_info)+input('Відомості про психіатричний облік','psychiatric_record_info',profile.psychiatric_record_info)+textarea('Організаторські здібності','organizational_skills',profile.organizational_skills,'cc-wide')
        )}
        ${section('11. Контракт / оформлення','Етап оформлення',
          select('Вид контракту','contract_type',profile.contract_type || '',[['','Не визначено'],['мотиваційний','Мотиваційний контракт'],['звичайний','Звичайний контракт'],['інший','Інший']])+input('Дата підписання','contract_date',profile.contract_date,'date')+input('Строк, місяців','contract_term_months',profile.contract_term_months,'number')+select('Статус оформлення','contract_status',profile.contract_status || '',[['','Не визначено'],['підготовка','Підготовка'],['подано','Подано'],['погодження','На погодженні'],['підписано','Підписано'],['відмова','Відмова']])+textarea('Примітки щодо контракту','contract_notes',profile.contract_notes,'cc-wide')
        )}
        ${section('12. Статус кандидата','Поточний етап руху кандидата',select('Статус','recruitment_status',c.recruitment_status || 'Новий',statusOptions.map(x=>[x,x]),'cc-wide')+textarea('Примітки рекрутера','notes',c.notes,'cc-wide'))}
        <section class="cc-section" data-section="13"><div class="cc-section-head"><div><h3>13. Близькі родичі</h3><small>Батько, мати, чоловік/дружина, діти, брати, сестри та інші близькі родичі.</small></div><span class="cc-badge">${relatives.length} запис(ів)</span></div>
          <div id="ccRelatives">${(relatives.length ? relatives : [{},{}]).map((r,i)=>relativeRow(r,i)).join('')}</div>
          <button type="button" id="ccAddRelative" class="cc-relative-add">＋ Додати родича</button>
        </section>
        <section class="cc-section" data-section="14"><div class="cc-section-head"><div><h3>14. Документи кандидата</h3><small>Завантажені документи та їхній поточний статус.</small></div><span class="cc-badge">${docs.length} документ(ів)</span></div><div class="cc-docs">${documentRows}</div></section>
        <section class="cc-section" data-section="15"><h3>Бланки для друку</h3><p>Затверджені чисті бланки для заповнення кандидатом.</p><button type="button" onclick="crmNavigate('blanks')">Відкрити каталог бланків</button></section>
        <div class="cc-actions"><button type="submit" class="primary">Зберегти зміни</button><button type="button" onclick="crmNavigate('candidates')">Скасувати</button><span id="ccStatus" class="cc-status"></span></div>
      </form>`;

    content.querySelectorAll('[data-open-doc]').forEach(b => b.addEventListener('click', () => openDoc(b.dataset.openDoc)));



    await CRMResponsibility.mountCard(c,content);
    const formForNavigation=content.querySelector('#candidateCardV2');
    CRMCandidateName.bind(formForNavigation);
    const groups=[
      ['personal','Картка',[1,2,3,4]],['family','Рідні та близькі',[13]],['education','Освіта',[5]],
      ['work','Трудовий стаж',[6]],['service','Військова служба',[7]],['military','Військовий облік',[8]],
      ['vlk','ВЛК',[9]],['documents','Документи',[14]],['processing','Оформлення',[10,11,12]],['blanks','Бланки',[15]]
    ];
    const nav=content.querySelector('#crmCardNav');
    nav.innerHTML=groups.map(([key,title])=>'<button type="button" data-card-section="'+key+'">'+esc(title)+'</button>').join('');
    const selectSection=key=>{
      const group=groups.find(g=>g[0]===key)||groups[0];
      window.crmActiveCardSection=group[0];
      formForNavigation.querySelectorAll('[data-section]').forEach(section=>section.hidden=!group[2].includes(Number(section.dataset.section)));
      formForNavigation.querySelector('[data-card-photo]').hidden=group[0]!=='personal';
      nav.querySelectorAll('button').forEach(button=>{button.classList.toggle('active',button.dataset.cardSection===group[0]);button.setAttribute('aria-pressed',button.dataset.cardSection===group[0]?'true':'false')});
    };
    nav.addEventListener('click',e=>{const key=e.target.closest('[data-card-section]')?.dataset.cardSection;if(key)selectSection(key)});
    formForNavigation.addEventListener('invalid',e=>{const number=Number(e.target.closest('[data-section]')?.dataset.section);const group=groups.find(g=>g[2].includes(number));if(group)selectSection(group[0])},true);
    selectSection(activeCardSection);
    const photoDoc=[...docs].reverse().find(d=>/фото\s*9\s*[×xх\/]\s*12/i.test(d.document_type||d.document_name||''));
    CRMWorkspace.photo(photoDoc).then(photo=>{
      if(!formForNavigation.isConnected)return;
      const image=content.querySelector('#crmCardPhoto'),status=content.querySelector('#crmCardPhotoStatus');
      if(photo){image.src=photo;image.hidden=false;status.textContent='Фото 9×12'}
      else status.textContent='Фото 9×12 ще не додано або його не вдалося відкрити.';
    }).catch(()=>{if(formForNavigation.isConnected)content.querySelector('#crmCardPhotoStatus').textContent='Не вдалося відкрити фото.'});
    const identitySelect=formForNavigation.querySelector('[name=identity_document_type]');
    const updateIdentityFields=()=>{
      const type=identitySelect.value;
      ['passport_series','passport_number','passport_issuer','passport_issue_date','passport_expiry_date','passport_data'].forEach(key=>{
        const field=formForNavigation.querySelector('[name="'+key+'"]')?.closest('.cc-field');
        if(field)field.hidden=type==='birth'||(key==='passport_series'&&type==='ID')||(key==='passport_expiry_date'&&type==='passport');
      });
    };
    identitySelect.addEventListener('change',updateIdentityFields);updateIdentityFields();
    const childrenInput=formForNavigation.querySelector('[name=children_count]');childrenInput.min='0';childrenInput.step='1';
    const cardState={candidateId,form:formForNavigation,dirty:false,save:null,saving:null};
    CRMWorkspace.card=cardState;
    formForNavigation.addEventListener('input',()=>{cardState.dirty=true;content.querySelector('#ccStatus').textContent='Є незбережені зміни'});
    formForNavigation.addEventListener('change',()=>{cardState.dirty=true});

    const relBox = content.querySelector('#ccRelatives');
    const addRelativeButton = content.querySelector('#ccAddRelative');
    let relativeIndex = relBox ? relBox.querySelectorAll('[data-relative-row]').length : 0;
    addRelativeButton?.addEventListener('click', () => {
      relBox.insertAdjacentHTML('beforeend', relativeRow({}, relativeIndex++));cardState.dirty=true;
    });
    relBox?.addEventListener('click', event => {
      const remove = event.target.closest('[data-remove-relative]');
      if (!remove) return;
      const row = remove.closest('[data-relative-row]');
      row?.remove();cardState.dirty=true;
    });

    const sexEl = content.querySelector('[name="sex"]');
    const maritalEl = content.querySelector('[name="marital_status"]');
    if (sexEl && maritalEl) sexEl.addEventListener('change', () => {
      const current = maritalEl.value;
      const newOptions = sexEl.value === 'female' ? ['','Одружена','Розлучена','Не одружена'] : sexEl.value === 'male' ? ['','Одружений','Розлучений','Не одружений'] : ['','Одружений','Одружена','Розлучений','Розлучена','Не одружений','Не одружена'];
      maritalEl.innerHTML = newOptions.map(x => `<option value="${esc(x)}">${x || 'Не визначено'}</option>`).join('');
      if (newOptions.includes(current)) maritalEl.value = current;
    });

    const saveCard=async function (event) {
      event.preventDefault();
      const form = event.target;
      if(!form.reportValidity())return false;
      const status = document.getElementById('ccStatus');
      const fd = new FormData(form);
      const nom = nameNominative(fd.get('name_nominative'));
      if (!nom) { status.textContent = 'Потрібно вказати ПІБ у називному відмінку.'; return; }
      status.textContent = 'Зберігаємо дані...';
      const parseBool = v => v === '' ? null : v === 'true';
      const oldProfile = { ...profile };
      const profileKeys = [
        'citizenship','unzr','birth_certificate','phone_secondary','messenger','registered_address','region','locality','street','house','apartment','postal_code',
        'identity_document_type','passport_series','passport_number','passport_issuer','passport_issue_date','passport_expiry_date','education_level','education_institution','education_specialty','education_qualification','education_year',
        'military_specialty','military_unit','military_position','service_start_date','service_end_date','combat_days','military_document_number','military_registration_date','military_registration_category','military_registration_status','military_document_type',
        'vlk_certificate_number','vlk_date','vlk_conclusion','vlk_category','vlk_next_date','vlk_notes','criminal_record_info','psychiatric_record_info','organizational_skills','candidate_source','recruiter_name','motivation','recruitment_notes','contract_type','contract_date','contract_term_months','contract_status','contract_notes','name_genitive','has_children','worked_before','served_before','sex','marital_status','children_info'
      ];
      profileKeys.forEach(k => { if (fd.has(k)) oldProfile[k] = fd.get(k); });

      const savedRelatives = [...form.querySelectorAll('[data-relative-row]')].map(row => {
        const get = key => row.querySelector(`[name="${key}"]`)?.value?.trim() || '';
        return {
          relationship: get('relationship'), full_name: get('full_name'), birth_date: get('birth_date'),
          birth_place: get('birth_place'), citizenship: get('citizenship'), address: get('address'),
          phone: window.CRMPhone.normalize(get('phone')), workplace: get('workplace'), position: get('position'), notes: get('notes')
        };
      }).filter(r => Object.values(r).some(Boolean));
      oldProfile.relatives = savedRelatives;
      oldProfile.phone_secondary=window.CRMPhone.normalize(oldProfile.phone_secondary);

      const militaryUnit = String(fd.get('military_unit') || '').trim();
      const candidatePatch = {
        full_name: nom,
        name_nominative: nom,
        name_genitive: String(fd.get('name_genitive') || '').trim() || null,
        birth_date: fd.get('birth_date') || null,
        birth_place: String(fd.get('birth_place') || '').trim() || null,
        rnokpp: String(fd.get('rnokpp') || '').trim() || null,
        passport_data: String(fd.get('passport_data') || '').trim() || null,
        phone: window.CRMPhone.normalize(fd.get('phone')) || null,
        email: String(fd.get('email') || '').trim() || null,
        sex: String(fd.get('sex') || '') || null,
        marital_status: String(fd.get('marital_status') || '').trim() || null,
        has_children: parseBool(fd.get('has_children')),
        children_count: fd.get('children_count')===''?null:Math.max(0,Math.floor(Number(fd.get('children_count')))),
        worked_before: parseBool(fd.get('worked_before')),
        served_before: parseBool(fd.get('served_before')),
        desired_position: String(fd.get('desired_position') || '').trim() || null,
        direction: String(fd.get('desired_unit') || '').trim() || null,
        military_rank: String(fd.get('military_rank') || '').trim() || null,
        military_specialty: String(fd.get('military_specialty') || '').trim() || null,
        tcc: String(fd.get('tcc') || '').trim() || null,
        vlk_status: String(fd.get('vlk_status') || '').trim() || null,
        recruitment_status: String(fd.get('recruitment_status') || 'Новий'),
        civilian_profession: String(fd.get('civilian_profession') || '').trim() || null,
        notes: String(fd.get('notes') || '').trim() || null,
        profile_data: { ...oldProfile, military_unit: militaryUnit, updated_from_candidate_card: true },
        updated_at: new Date().toISOString()
      };
      const { error: ce } = await supabaseClient.from('candidates').update(candidatePatch).eq('id', candidateId);
      if (ce) { status.textContent = 'Помилка збереження кандидата: ' + ce.message; return; }

      const pfPatch = {
        candidate_id: candidateId,
        address: String(fd.get('address') || '').trim() || null,
        family_status: String(fd.get('marital_status') || '').trim() || null,
        birth_place: String(fd.get('birth_place') || '').trim() || null,
        passport_data: String(fd.get('passport_data') || '').trim() || null,
        children_info: String(fd.get('children_info') || '').trim() || null,
        work_history: String(fd.get('work_history') || '').trim() || null,
        military_service_history: String(fd.get('military_service_history') || '').trim() || null,
        education: String(fd.get('education') || '').trim() || null,
        updated_at: new Date().toISOString()
      };
      const { error: pe } = await supabaseClient.from('personal_files').upsert(pfPatch, { onConflict:'candidate_id' });
      if (pe) { status.textContent = 'Кандидата збережено, але особову справу не вдалося оновити: ' + pe.message; return; }
      status.textContent = 'Готово. Дані кандидата оновлено.';
      Object.assign(c,candidatePatch);Object.assign(pf,pfPatch);profile=candidatePatch.profile_data;cardState.dirty=false;
      return true;
    };
    cardState.save=()=>{
      if(cardState.saving)return cardState.saving;
      CRMWorkspace.busy=true;const button=formForNavigation.querySelector('[type=submit]');button.disabled=true;
      cardState.saving=saveCard({preventDefault(){},target:formForNavigation}).catch(err=>{content.querySelector('#ccStatus').textContent='Помилка збереження: '+err.message;return false}).finally(()=>{cardState.saving=null;CRMWorkspace.busy=false;button.disabled=false});
      return cardState.saving;
    };
    formForNavigation.addEventListener('submit',event=>{event.preventDefault();cardState.save()});
  }

  window.openCandidateCard = async function (candidateId) {
    try { await renderCard(candidateId); }
    catch (e) {
      console.error('Помилка відкриття картки кандидата V2:', e);
      const content = document.querySelector('.content');
      if (content) content.innerHTML = `<div class="card"><b>Помилка відкриття картки кандидата.</b><div style="margin-top:8px;color:#a23f38">${esc(e?.message || e || 'Невідома помилка')}</div><button type="button" onclick="crmNavigate('candidates')" style="margin-top:14px;padding:9px 12px;border:1px solid #cfd8dc;border-radius:7px;background:#fff">← Назад до кандидатів</button></div>`;
    }
  };
})();
