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
    return `<div class="cc-field ${cls}"><label>${esc(label)}</label><input name="${esc(name)}" type="${type}" value="${esc(value || '')}"></div>`;
  }

  function select(label, name, value, options, cls = '') {
    return `<div class="cc-field ${cls}"><label>${esc(label)}</label><select name="${esc(name)}">${options.map(([v,t]) => `<option value="${esc(v)}" ${String(v) === String(value ?? '') ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>`;
  }

  function textarea(label, name, value, cls = '') {
    return `<div class="cc-field ${cls}"><label>${esc(label)}</label><textarea name="${esc(name)}" rows="4">${esc(value || '')}</textarea></div>`;
  }

  function section(title, subtitle, body) {
    return `<section class="cc-section"><div class="cc-section-head"><div><h3>${esc(title)}</h3><small>${esc(subtitle || '')}</small></div></div><div class="cc-grid">${body}</div></section>`;
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
    const pf = pr.data || {};
    let profile = c.profile_data && typeof c.profile_data === 'object' ? c.profile_data : {};
    if (typeof c.profile_data === 'string') { try { profile = JSON.parse(c.profile_data); } catch (_) {} }
    const docs = dr.data || [];
    const sex = c.sex || profile.sex || '';
    const maritalStatus = c.marital_status || pf.family_status || profile.marital_status || '';

    const statusOptions = ['Новий','Первинний контакт','Співбесіда','Перевірка документів','ВЛК','Рішення','Призначений','Відмова','Втрачено контакт','Відкладено'];
    const docTypeOptions = ['Паспорт громадянина України (ID-картка)','Паспорт громадянина України (книжечка)','РНОКПП','Військово-обліковий документ','Анкета','Згода на обробку персональних даних','Згода на збір та обробку даних','Заява на контракт','Розписка кандидата','Освіта','Трудова діяльність','ВЛК','Інше'];

    const documentRows = docs.length ? docs.map(d => `<div class="cc-doc"><div><b>${esc(documentLabel(d))}</b><small>${esc(d.file_name || '')} · ${d.required ? 'Обов’язковий' : 'Додатковий'} · ${esc(d.status || 'Завантажено')}</small></div><button type="button" data-open-doc="${esc(d.storage_path || '')}">Відкрити</button></div>`).join('') : '<div class="cc-empty">Документи ще не завантажені.</div>';

    content.innerHTML = `
      <style>
        .cc-wrap{max-width:1280px}.cc-section{background:#fff;border:1px solid #e0e6e8;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 8px 28px rgba(19,31,40,.04)}
        .cc-section-head{display:flex;justify-content:space-between;align-items:center;margin:-20px -20px 18px;padding:15px 20px;border-bottom:1px solid #e7ecee;background:#fbfcfc;border-radius:12px 12px 0 0}.cc-section-head h3{margin:0;font-size:15px}.cc-section-head small{display:block;color:#7d8a93;margin-top:4px;font-size:11px}.cc-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 16px}.cc-field label{display:block;color:#44515a;font-weight:700;font-size:12px;margin-bottom:6px}.cc-field input,.cc-field select,.cc-field textarea{width:100%;color:#24313a;background:#fff;border:1px solid #cfd8dc;border-radius:8px;padding:10px 11px;outline:none}.cc-field input:focus,.cc-field select:focus,.cc-field textarea:focus{border-color:#9ebd45;box-shadow:0 0 0 3px rgba(183,217,87,.16)}.cc-wide{grid-column:1/-1}.cc-actions{display:flex;gap:9px;flex-wrap:wrap;margin:4px 0 22px}.cc-actions button{border-radius:8px;padding:11px 16px;font-weight:800;border:1px solid #d8e0e3;background:#fff;color:#45525a}.cc-actions .primary{background:#18232d;color:#fff;border-color:#18232d}.cc-status{font-size:12px;color:#68757d;min-height:18px}.cc-docs{display:grid;gap:9px}.cc-doc{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px;border:1px solid #e6eaec;border-radius:9px;background:#fbfcfc}.cc-doc b{display:block;font-size:12px}.cc-doc small{display:block;color:#89959c;margin-top:4px;font-size:10px}.cc-doc button{border:1px solid #cfd8dc;background:#fff;border-radius:7px;padding:7px 10px;font-weight:800}.cc-templates{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.cc-template{padding:12px;border:1px solid #d8e0e3;background:#f7f9f9;border-radius:8px;text-align:left;font-weight:800;color:#45525a}.cc-hint{padding:11px 13px;background:#f7faed;border:1px solid #dce8b7;border-radius:8px;color:#68757d;font-size:11px;margin-bottom:14px}.cc-empty{text-align:center;color:#89959c;padding:18px}.cc-badge{padding:5px 9px;border-radius:12px;background:#e8f2cc;color:#5d741f;font-size:10px;font-weight:800}
        @media(max-width:800px){.cc-grid,.cc-templates{grid-template-columns:1fr}.cc-wide{grid-column:auto}}
      </style>
      <div class="dashboard-top cc-wrap"><div><div class="page-title">Картка кандидата</div><p class="page-subtitle">Усі дані кандидата в одному місці. Усі поля редагуються рекрутером.</p></div><div class="quick-actions"><span class="cc-badge">ID: ${esc(String(candidateId).slice(0,8))}</span><button onclick="showCandidates()">← До кандидатів</button></div></div>
      <form id="candidateCardV2" class="cc-wrap">
        ${section('1. Персональні дані','Основні ідентифікаційні відомості',
          input('ПІБ у називному відмінку','name_nominative',c.name_nominative || c.full_name,'text')+
          input('ПІБ у родовому відмінку','name_genitive',c.name_genitive || profile.name_genitive)+
          input('Дата народження','birth_date',c.birth_date,'date')+
          input('Місце народження','birth_place',pf.birth_place || profile.birth_place)+
          select('Стать','sex',sex,[['','Не визначено'],['male','Чоловіча'],['female','Жіноча']])+ 
          input('Громадянство','citizenship',c.citizenship || profile.citizenship || 'Україна')+
          input('РНОКПП','rnokpp',c.rnokpp)+
          input('УНЗР','unzr',profile.unzr)+
          input('Серія та № свідоцтва про народження','birth_certificate',profile.birth_certificate)+
          select('Сімейний стан','marital_status',maritalStatus, [['','Не визначено'],...((sex==='female'?['Одружена','Розлучена','Не одружена']:sex==='male'?['Одружений','Розлучений','Не одружений']:['Одружений','Одружена','Розлучений','Розлучена','Не одружений','Не одружена']).map(x=>[x,x]))])+
          select('Діти','has_children',boolValue(c.has_children ?? profile.has_children),[['','Не визначено'],['true','Є діти'],['false','Не має дітей']])+ 
          textarea('Інформація про дітей','children_info',pf.children_info || profile.children_info,'cc-wide')
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
          select('Працював / Працювала','worked_before',boolValue(c.worked_before ?? profile.worked_before),[['','Не визначено'],['true','Працював / Працювала'],['false','Не працював / Не працювала']])+textarea('Трудова діяльність','work_history',pf.work_history || pf.civilian_experience,'cc-wide')
        )}
        ${section('7. Військова служба','Відомості про попередню та поточну службу',
          select('Служив / Служила','served_before',boolValue(c.served_before ?? profile.served_before),[['','Не визначено'],['true','Служив / Служила'],['false','Не служив / Не служила']])+input('Військове звання','military_rank',c.military_rank)+input('ВОС','military_specialty',c.military_specialty || profile.military_specialty)+input('Військова частина','military_unit',profile.military_unit)+input('Посада','military_position',profile.military_position)+input('Дата початку служби','service_start_date',profile.service_start_date,'date')+input('Дата закінчення служби','service_end_date',profile.service_end_date,'date')+input('Кількість днів бойових','combat_days',profile.combat_days,'number')+textarea('Військова служба','military_service_history',pf.military_service_history || pf.military_experience,'cc-wide')
        )}
        ${section('8. Військовий облік','Дані військового обліку',
          input('ТЦК та СП','tcc',c.tcc)+input('Номер військово-облікового документа','military_document_number',profile.military_document_number)+input('Дата взяття на облік','military_registration_date',profile.military_registration_date,'date')+input('Категорія обліку','military_registration_category',profile.military_registration_category)+input('Стан обліку','military_registration_status',profile.military_registration_status)+input('Військовий документ','military_document_type',profile.military_document_type)
        )}
        ${section('9. ВЛК','Військово-лікарська комісія',
          input('Дата проходження ВЛК','vlk_date',profile.vlk_date,'date')+input('Висновок','vlk_conclusion',profile.vlk_conclusion)+input('Категорія придатності','vlk_category',profile.vlk_category)+input('Дата наступного огляду','vlk_next_date',profile.vlk_next_date,'date')+input('Статус ВЛК','vlk_status',c.vlk_status)+textarea('Примітки ВЛК','vlk_notes',profile.vlk_notes,'cc-wide')
        )}
        ${section('10. Рекрутингові дані','Внутрішня робота рекрутера',
          input('Джерело кандидата','candidate_source',profile.candidate_source)+input('Хто прийняв кандидата','recruiter_name',profile.recruiter_name)+input('Напрям','desired_unit',c.direction)+input('Бажана посада','desired_position',c.desired_position)+textarea('Мотивація кандидата','motivation',profile.motivation)+textarea('Додаткова інформація','recruitment_notes',profile.recruitment_notes,'cc-wide')
        )}
        ${section('11. Контракт / оформлення','Етап оформлення',
          select('Вид контракту','contract_type',profile.contract_type || '',[['','Не визначено'],['мотиваційний','Мотиваційний контракт'],['звичайний','Звичайний контракт'],['інший','Інший']])+input('Дата підписання','contract_date',profile.contract_date,'date')+input('Строк, місяців','contract_term_months',profile.contract_term_months,'number')+select('Статус оформлення','contract_status',profile.contract_status || '',[['','Не визначено'],['підготовка','Підготовка'],['подано','Подано'],['погодження','На погодженні'],['підписано','Підписано'],['відмова','Відмова']])+textarea('Примітки щодо контракту','contract_notes',profile.contract_notes,'cc-wide')
        )}
        ${section('12. Статус кандидата','Поточний етап руху кандидата',select('Статус','recruitment_status',c.recruitment_status || 'Новий',statusOptions.map(x=>[x,x]),'cc-wide')+textarea('Примітки рекрутера','notes',c.notes,'cc-wide'))}
        <section class="cc-section"><div class="cc-section-head"><div><h3>13. Документи кандидата</h3><small>Завантажені документи та їхній поточний статус.</small></div><span class="cc-badge">${docs.length} документ(ів)</span></div><div class="cc-docs">${documentRows}</div></section>
        <section class="cc-section"><div class="cc-section-head"><div><h3>14. Бланки CRM</h3><small>Підготовлені бланки, які будемо підключати до автозаповнення.</small></div></div><div class="cc-templates">${[['Анкета','anketa'],['Згода на обробку персональних даних','consent_processing'],['Згода на збір та обробку даних','consent_collection_processing'],['Заява на контракт','contract_application'],['Розписка кандидата','candidate_receipt']].map(([t,k])=>`<button type="button" class="cc-template" data-template-key="${esc(k)}">📝 ${esc(t)}</button>`).join('')}</div></section>
        <div class="cc-actions"><button type="submit" class="primary">Зберегти зміни</button><button type="button" onclick="showCandidates()">Скасувати</button><span id="ccStatus" class="cc-status"></span></div>
      </form>`;

    content.querySelectorAll('[data-open-doc]').forEach(b => b.addEventListener('click', () => openDoc(b.dataset.openDoc)));
    content.querySelectorAll('[data-template-key]').forEach(b => b.addEventListener('click', () => alert('Бланк «' + b.textContent.replace(/^📝\s*/, '') + '» підключимо після завантаження затвердженого шаблону.')));

    const sexEl = content.querySelector('[name="sex"]');
    const maritalEl = content.querySelector('[name="marital_status"]');
    if (sexEl && maritalEl) sexEl.addEventListener('change', () => {
      const current = maritalEl.value;
      const newOptions = sexEl.value === 'female' ? ['','Одружена','Розлучена','Не одружена'] : sexEl.value === 'male' ? ['','Одружений','Розлучений','Не одружений'] : ['','Одружений','Одружена','Розлучений','Розлучена','Не одружений','Не одружена'];
      maritalEl.innerHTML = newOptions.map(x => `<option value="${esc(x)}">${x || 'Не визначено'}</option>`).join('');
      if (newOptions.includes(current)) maritalEl.value = current;
    });

    content.querySelector('#candidateCardV2').addEventListener('submit', async function (event) {
      event.preventDefault();
      const form = event.target;
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
        'vlk_date','vlk_conclusion','vlk_category','vlk_next_date','vlk_notes','candidate_source','recruiter_name','motivation','recruitment_notes','contract_type','contract_date','contract_term_months','contract_status','contract_notes','name_genitive','has_children','worked_before','served_before','sex','marital_status','children_info'
      ];
      profileKeys.forEach(k => { if (fd.has(k)) oldProfile[k] = fd.get(k); });
      const militaryUnit = String(fd.get('military_unit') || '').trim();
      const candidatePatch = {
        full_name: nom,
        name_nominative: nom,
        name_genitive: String(fd.get('name_genitive') || '').trim() || null,
        birth_date: fd.get('birth_date') || null,
        birth_place: String(fd.get('birth_place') || '').trim() || null,
        rnokpp: String(fd.get('rnokpp') || '').trim() || null,
        passport_data: String(fd.get('passport_data') || '').trim() || null,
        phone: String(fd.get('phone') || '').trim() || null,
        email: String(fd.get('email') || '').trim() || null,
        sex: String(fd.get('sex') || '') || null,
        marital_status: String(fd.get('marital_status') || '').trim() || null,
        has_children: parseBool(fd.get('has_children')),
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
      setTimeout(() => renderCard(candidateId), 500);
    });
  }

  window.openCandidateCard = async function (candidateId) {
    try { await renderCard(candidateId); }
    catch (e) {
      console.error('Помилка відкриття картки кандидата V2:', e);
      const content = document.querySelector('.content');
      if (content) content.innerHTML = `<div class="card"><b>Помилка відкриття картки кандидата.</b><div style="margin-top:8px;color:#a23f38">${esc(e?.message || e || 'Невідома помилка')}</div><button type="button" onclick="showCandidates()" style="margin-top:14px;padding:9px 12px;border:1px solid #cfd8dc;border-radius:7px;background:#fff">← Назад до кандидатів</button></div>`;
    }
  };
})();