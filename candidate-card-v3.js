/* Candidate Card V3: optional presentation over the shared, existing V2 form. */
(function () {
  'use strict';
  const openV2 = window.openCandidateCard;
  if (typeof openV2 !== 'function') return;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const parse = v => { if (typeof v === 'string') { try { return JSON.parse(v) || {}; } catch { return {}; } } return v || {}; };
  const key = 'crm.candidateCard.version';
  let version = 'v2', opening = false, fieldSequence = 0;
  try { if (localStorage.getItem(key) === 'v3') version = 'v3'; } catch {}
  const tabs = [
    ['main','ОСНОВНЕ',[1,3,4,10,11,12]], ['military','ВІЙСЬКОВЕ',[7,8,9]],
    ['documents','ДОКУМЕНТИ',[2,14,15]], ['family','РОДИНА',[13]],
    ['education','ОСВІТА / РОБОТА',[5,6]], ['history','ІСТОРІЯ',[16]]
  ];
  const advanced = new Set(('name_genitive unzr birth_certificate phone_secondary email messenger passport_data education_specialty_code education_start_date education_end_date education_diploma_series education_diploma_number education_diploma_issue_date education_supplement_number education_supplement_issue_date education military_registry_number military_document_expiry_date military_data_updated_at military_deferment_type military_deferment_until military_registration_removal_reason military_training_status military_registration_date military_registration_category military_registration_status candidate_source recruiter_name recruitment_notes psychiatric_record_info work_employer_code work_termination_reason work_order_number work_order_date work_end_order_number work_end_order_date').split(' '));
  const educationFields = {
    degree:['Рівень освіти','text'], institution:['Заклад освіти','text'], specialty:['Спеціальність','text'], qualification:['Кваліфікація','text'],
    graduation_year:['Рік закінчення','number'], study_start_date:['Початок навчання','date'], study_end_date:['Завершення навчання','date'],
    diploma_series:['Серія диплома','text'], diploma_number:['Номер диплома','text'], diploma_issue_date:['Дата видачі','date'],
    specialty_code:['Код спеціальності','text'], supplement_number:['Номер додатка','text'], supplement_issue_date:['Дата додатка','date']
  };
  const date = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v.split('-').reverse().join('.') : v || '';
  function changedFields(event) {
    const output = [];
    for (const [name, change] of Object.entries(event.changes || {})) {
      if (name === 'profile_data') {
        const before = parse(change.before), after = parse(change.after);
        for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
          if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) output.push([field, after[field]]);
        }
      } else if (change && JSON.stringify(change.before) !== JSON.stringify(change.after)) output.push([name, change.after]);
    }
    return output;
  }
  function provenance(events) {
    const latest = new Map();
    for (const event of events) {
      if (!['candidates_update','personal_files_update','candidates_insert','personal_files_insert'].includes(event.action)) continue;
      for (const [name, value] of changedFields(event)) {
        if (!latest.has(name)) latest.set(name, {id:event.source_document_id || null, value});
      }
    }
    return latest;
  }
  function hint(label, message, symbol = 'ⓘ') {
    const wrapper = document.createElement('span'); wrapper.className = 'cc-v3-tip';
    const button = document.createElement('button'); button.type = 'button'; button.textContent = symbol;
    button.setAttribute('aria-label', message); button.title = message;
    const text = document.createElement('span'); text.className = 'cc-v3-tooltip'; text.role = 'tooltip'; text.textContent = message;
    wrapper.append(button, text); label.append(wrapper);
    return button;
  }
  function advancedControl(container) {
    if (!container.querySelector(':scope > [data-v3-advanced], :scope > .cc-grid > [data-v3-advanced]')) return;
    if (container.querySelector(':scope > .cc-v3-advanced-toggle')) return;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'cc-v3-advanced-toggle';
    button.textContent = 'Додатково'; button.setAttribute('aria-expanded','false');
    button.onclick = () => { const open = container.classList.toggle('cc-v3-expanded'); button.setAttribute('aria-expanded', String(open)); button.textContent = open ? 'Згорнути додаткові поля' : 'Додатково'; };
    container.append(button);
  }
  function fold(row, kind) {
    let details = row.querySelector(':scope > details.cc-v3-record');
    if (!details) {
      details = document.createElement('details'); details.className = 'cc-v3-record';
      const summary = document.createElement('summary'); details.append(summary);
      const content = document.createElement('div'); content.className = 'cc-v3-record-body';
      while (row.firstChild) content.append(row.firstChild);
      details.append(content); row.append(details);
      details.open = !row.querySelector('[name="'+(kind === 'relative' ? 'full_name' : 'work_employer')+'"]')?.value;
    }
    const value = n => row.querySelector('[name="'+n+'"]')?.value || '';
    const title = kind === 'relative'
      ? [value('relationship') || 'Родич', value('full_name') || 'Новий запис', date(value('birth_date'))]
      : [date(value('work_start_date')) || '…', date(value('work_end_date')) || '…', value('work_employer') || 'Новий період', value('work_position')];
    const summary = details.querySelector(':scope > summary');
    if (summary.textContent !== title.filter(Boolean).join(' · ')) summary.textContent = title.filter(Boolean).join(' · ');
    advancedControl(details.querySelector('.cc-v3-record-body'));
  }
  async function sourceButton(label, doc) {
    const button = hint(label, 'Джерело: '+(doc.document_name || doc.document_type || doc.file_name || 'Документ'), '✦');
    button.className = 'cc-v3-source';
    if (!doc.storage_path) return;
    button.onclick = async () => {
      button.disabled = true;
      // Open synchronously so browser popup protection does not discard the signed URL.
      const popup = window.open('about:blank','_blank'); if (popup) popup.opener = null;
      try {
        const {data,error} = await supabaseClient.storage.from('candidate-documents').createSignedUrl(doc.storage_path,600);
        if (error || !data?.signedUrl) throw error || new Error('Документ недоступний');
        if (popup) popup.location.replace(data.signedUrl); else alert('Дозвольте відкриття документа в новій вкладці.');
      } catch (e) { popup?.close(); alert(e.message || 'Не вдалося відкрити джерело'); }
      finally { button.disabled = false; }
    };
  }
  function educationEditor(form, profile, documents) {
    const records = Array.isArray(profile.education_records) ? structuredClone(profile.education_records) : [];
    const section = form.querySelector('[data-section="5"]');
    if (!section || !records.length) return;
    const stored = [...section.querySelectorAll('h4')].find(h => h.textContent === 'Збережені дипломи')?.parentElement;
    if (!stored) return;
    stored.replaceChildren(); const heading = document.createElement('h4'); heading.textContent = 'Записи освіти'; stored.append(heading);
    records.forEach((record,index) => {
      const details = document.createElement('details'); details.className = 'cc-v3-record'; details.dataset.educationRecord = index;
      const summary = document.createElement('summary'); details.append(summary);
      const grid = document.createElement('div'); grid.className = 'cc-grid cc-v3-record-body'; details.append(grid);
      for (const [field,[label,type]] of Object.entries(educationFields)) {
        const wrapper = document.createElement('div'); wrapper.className = 'cc-field';
        wrapper.innerHTML = '<label>'+esc(label)+'</label><input type="'+type+'" value="'+esc(record[field] ?? '')+'">';
        const input = wrapper.querySelector('input'); input.dataset.educationField = field;
        if (!['degree','institution','specialty','qualification','graduation_year'].includes(field)) wrapper.dataset.v3Advanced = 'true';
        input.addEventListener('input', () => { record[field] = input.value; update(); }); grid.append(wrapper);
      }
      function update() {
        summary.textContent = [record.graduation_year || date(record.study_end_date),record.institution,record.degree].filter(Boolean).join(' · ') || 'Освіта';
        grid.querySelectorAll('[data-education-field="specialty"],[data-education-field="qualification"],[data-education-field="specialty_code"]').forEach(input => input.closest('.cc-field').hidden = record.degree === 'середня');
      }
      const doc = documents.find(d => d.id === record.source_document_id);
      if (doc) sourceButton(grid.querySelector('label'),doc);
      const technical = document.createElement('details'); technical.className = 'cc-wide';
      const technicalTitle = document.createElement('summary'); technicalTitle.textContent = 'Дані джерела';
      const pre = document.createElement('pre'); pre.textContent = JSON.stringify(Object.fromEntries(Object.entries(record).filter(([field]) => !(field in educationFields))),null,2);
      technical.append(technicalTitle,pre); grid.append(technical); advancedControl(grid); update(); stored.append(details);
    });
    // Shared V2 save merges these edited records atomically into the existing profile.
    form.__crmEducationRecords = () => structuredClone(records);
  }
  async function mountV3(form, id) {
    const root = form.closest('.content'); root.classList.add('cc-v3'); form.dataset.cardVersion = 'v3';
    const cleanup = new MutationObserver(() => {
      if (!form.isConnected) { root.classList.remove('cc-v3'); window.removeEventListener('resize',syncTop); cleanup.disconnect(); }
    });
    cleanup.observe(root,{childList:true});
    const header = document.createElement('section'); header.className = 'cc-v3-header'; header.setAttribute('aria-label','Кандидат');
    const syncTop = () => { header.style.top = (document.querySelector('.header')?.getBoundingClientRect().height || 0)+'px'; };
    syncTop(); window.addEventListener('resize',syncTop);
    header.innerHTML = '<div class="cc-v3-photo"></div><div class="cc-v3-identity"><h1 data-v3-name></h1><a data-v3-phone></a><span data-v3-stage></span></div><div class="cc-v3-context"><span>Бажана посада</span><b data-v3-position></b><span>Військова частина</span><b data-v3-unit></b></div><div class="cc-v3-owner"></div><div class="cc-v3-indicators"></div><div class="cc-v3-tools"></div>';
    root.querySelector('.dashboard-top').before(header);
    header.querySelector('.cc-v3-photo').append(root.querySelector('.crm-card-photo-slot'));
    const owner = root.querySelector('.crm-recruiter-field'); if (owner) header.querySelector('.cc-v3-owner').append(owner);
    const tools = root.querySelector('.dashboard-top .quick-actions'); if (tools) header.querySelector('.cc-v3-tools').append(tools);
    root.querySelector('.dashboard-top').hidden = true;
    const responsibility = root.querySelector('[data-responsibility]'); if (responsibility) responsibility.hidden = true;
    const history = document.createElement('section'); history.className = 'cc-section'; history.dataset.section = '16';
    history.innerHTML = '<div class="cc-section-head"><h3>Історія справи</h3></div><div class="cc-v3-history-content" role="status">Завантаження журналу…</div>';
    form.querySelector('.cc-actions').before(history);
    const historyButton = root.querySelector('[data-history]'); if (historyButton) history.append(historyButton);
    const nav = document.createElement('nav'); nav.className = 'cc-v3-nav'; nav.setAttribute('aria-label','Вкладки картки'); nav.setAttribute('role','tablist');
    root.querySelector('#crmCardNav').before(nav); root.querySelector('#crmCardNav').hidden = true;
    const title = {1:'Персональні дані',2:'Паспорт / ID-картка',3:'Контакти',4:'Адреси',5:'Освіта',6:'Робота',7:'Військова служба',8:'Військовий облік',9:'ВЛК',10:'Рекрутинг',11:'Контракт',12:'Примітки',13:'Рідні та близькі',14:'Документи',15:'Бланки',16:'Історія'};
    let active = 'main';
    const value = name => form.querySelector('[name="'+name+'"]')?.value || '';
    const display = name => form.querySelector('[name="'+name+'"]')?.selectedOptions?.[0]?.textContent || value(name);
    const conditional = () => {
      // V2 applies conditions first. Only visibility is adjusted here; values are never cleared.
      const type = value('identity_document_type');
      if (value('case_mode') !== 'unit') {
        for (const name of ['children_count','children_info']) {
          const field = form.querySelector('[name="'+name+'"]')?.closest('.cc-field');
          if (field) field.hidden = value('has_children') !== 'true' || value('service_type') === 'За мобілізацією';
        }
        form.querySelectorAll('[data-relative-row]').forEach(row => {
          const field = row.querySelector('[name=death_date]')?.closest('.cc-field');
          if (field) field.hidden = row.querySelector('[name=deceased]')?.value !== 'true';
        });
      }
      for (const name of ['passport_series','passport_number','passport_issuer','passport_issue_date','passport_expiry_date','passport_data']) {
        const field = form.querySelector('[name="'+name+'"]')?.closest('.cc-field');
        if (field && value('case_mode') !== 'unit') field.hidden = type === 'birth' || (name === 'passport_series' && type === 'ID') || (name === 'passport_expiry_date' && type === 'passport');
      }
    };
    function decorate() {
      form.querySelectorAll('.cc-field').forEach((field,index) => {
        const input = field.querySelector('input,select,textarea'); if (!input) return;
        if (advanced.has(input.name)) field.dataset.v3Advanced = 'true';
        const label = field.querySelector('label');
        if (label && !label.htmlFor) { if (!input.id) input.id = 'cc-v3-field-'+(++fieldSequence); label.htmlFor = input.id; }
        if (input.name === 'death_date' && label && !label.querySelector('.cc-v3-tip')) {
          label.textContent = 'Дата смерті'; hint(label,'Допустимі формати: 2012, 2012-05 або 2012-05-17');
        }
      });
      form.querySelectorAll('.cc-hint').forEach(node => {
        if (node.dataset.v3Hint) return; node.dataset.v3Hint = 'true';
        const label = node.previousElementSibling?.querySelector('label') || node.parentElement.querySelector('h4,label');
        if (label) { hint(label,node.textContent); node.hidden = true; }
        else { const details = document.createElement('details'); details.className = 'cc-v3-explanation'; const summary = document.createElement('summary'); summary.textContent = 'ⓘ Пояснення'; node.before(details); details.append(summary,node); }
      });
      form.querySelectorAll('[data-relative-row]').forEach(row => fold(row,'relative'));
      form.querySelectorAll('[data-work-row]').forEach(row => fold(row,'work'));
      form.querySelectorAll('section[data-section]').forEach(section => {
        const number = Number(section.dataset.section), heading = section.querySelector('h3');
        if (heading) heading.textContent = title[number] || heading.textContent;
        advancedControl(section);
      });
    }
    function select(tab, focus = false) {
      active = tab;
      const unit = value('case_mode') === 'unit', mobilization = value('service_type') === 'За мобілізацією';
      if ((unit && !['main','documents','history'].includes(active)) || (mobilization && active === 'family')) active = 'main';
      const group = tabs.find(t => t[0] === active) || tabs[0];
      form.querySelectorAll('section[data-section]').forEach(section => {
        const number = Number(section.dataset.section);
        section.hidden = !group[2].includes(number) || (unit && ![1,14,15,16].includes(number)) || (mobilization && number === 13) || (number === 11 && value('service_type') !== 'За контрактом');
        section.setAttribute('role','tabpanel'); section.setAttribute('aria-labelledby','cc-v3-tab-'+(tabs.find(t => t[2].includes(number))?.[0] || 'main'));
      });
      form.querySelector('[data-card-photo]').hidden = active !== 'main';
      nav.querySelectorAll('[data-v3-tab]').forEach(button => {
        const selected = button.dataset.v3Tab === active; button.setAttribute('aria-selected',String(selected)); button.tabIndex = selected ? 0 : -1;
        button.hidden = (unit && !['main','documents','history'].includes(button.dataset.v3Tab)) || (mobilization && button.dataset.v3Tab === 'family');
        if (selected && focus) button.focus();
      });
    }
    nav.innerHTML = tabs.map(([tab,label]) => '<button type="button" role="tab" id="cc-v3-tab-'+tab+'" data-v3-tab="'+tab+'">'+label+'</button>').join('');
    nav.onclick = event => { const button = event.target.closest('[data-v3-tab]'); if (button) select(button.dataset.v3Tab); };
    nav.onkeydown = event => {
      const keys = ['ArrowLeft','ArrowRight','Home','End']; if (!keys.includes(event.key)) return;
      event.preventDefault(); const buttons = [...nav.querySelectorAll('button')].filter(b => !b.hidden);
      const index = buttons.findIndex(b => b.dataset.v3Tab === active);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length-1 : (index+(event.key === 'ArrowRight'?1:-1)+buttons.length)%buttons.length;
      select(buttons[next].dataset.v3Tab,true);
    };
    let candidate = {}, documents = [], sources = new Map();
    function refresh() {
      if (!form.isConnected) return;
      decorate(); conditional(); select(active);
      header.querySelector('[data-v3-name]').textContent = value('name_nominative') || 'Кандидат';
      const phone = header.querySelector('[data-v3-phone]'); phone.textContent = value('phone') || 'Телефон не вказаний'; phone.href = 'tel:'+value('phone');
      header.querySelector('[data-v3-position]').textContent = value('desired_position') || 'Не вказана';
      header.querySelector('[data-v3-unit]').textContent = value('military_unit') || candidate.recommender_unit || 'Не вказана';
      header.querySelector('[data-v3-stage]').textContent = value('case_mode') === 'unit' ? 'Оформлює ВЧ' : CRMWorkflow.label(candidate);
      header.querySelector('.cc-v3-indicators').innerHTML = '<button type="button" data-indicator="documents">Документи · '+documents.filter(d => d.verification_status === 'Підтверджено').length+'/'+documents.length+'</button><button type="button" data-indicator="documents">AI · '+documents.filter(d => d.ai_extracted).length+'</button><button type="button" data-indicator="military">ВЛК · '+esc(value('vlk_conclusion') ? 'висновок є' : value('vlk_status') || 'немає висновку')+'</button><button type="button" data-indicator="main">'+esc(value('service_type') === 'За мобілізацією' ? 'Мобілізація' : 'Контракт · '+display('contract_status'))+'</button>';
    }
    header.addEventListener('click',event => { const tab = event.target.closest('[data-indicator]')?.dataset.indicator; if (tab) select(tab); });
    form.addEventListener('input',event => {
      const field = event.target.closest('.cc-field'); field?.querySelectorAll('.cc-v3-source').forEach(b => b.parentElement.remove());
      refresh();
    });
    form.addEventListener('change',() => queueMicrotask(refresh));
    form.addEventListener('click',() => queueMicrotask(refresh));
    form.addEventListener('invalid',event => {
      const section = event.target.closest('[data-section]');
      const group = tabs.find(t => t[2].includes(Number(section?.dataset.section || 1))); if (group) select(group[0]);
      event.target.closest('details.cc-v3-record')?.setAttribute('open',''); section?.classList.add('cc-v3-expanded');
    },true);
    refresh();
    // Extra reads are optional UI metadata. Failure must never block V2 editing/saving.
    candidate = CRMWorkspace.card.candidate || {};
    documents = CRMWorkspace.card.documents || [];
    refresh();
    const results = await Promise.allSettled([
      supabaseClient.from('crm_activity').select('action,changes,source_document_id,occurred_at,actor_name').eq('candidate_id',id).order('occurred_at',{ascending:false}).limit(250)
    ]);
    if (!form.isConnected) return;
    const result = i => results[i].status === 'fulfilled' && !results[i].value.error ? results[i].value.data : null;
    const events = result(0); sources = provenance(events || []);
    const historyContent = history.querySelector('.cc-v3-history-content');
    historyContent.textContent = '';
    if (!events) historyContent.textContent = 'Журнал зараз недоступний. Редагування картки працює.';
    else if (!events.length) historyContent.textContent = 'Змін поки немає.';
    else events.slice(0,25).forEach(event => {
      const details = document.createElement('details'); const summary = document.createElement('summary');
      summary.textContent = CRMResponsibility.date(event.occurred_at)+' · '+(event.actor_name || 'Працівник CRM');
      details.append(summary); const body = document.createElement('div'); body.innerHTML = CRMHistoryFormat.render(CRMHistoryFormat.changes(event.changes || {},{person:CRMResponsibility.name})); details.append(body); historyContent.append(details);
    });
    educationEditor(form,parse(candidate.profile_data),documents);
    form.querySelectorAll('.cc-field').forEach(field => {
      const input = field.querySelector('[name]'); if (!input || field.closest('[data-relative-row],[data-work-row]')) return;
      const source = sources.get(input.name === 'name_nominative' ? 'full_name' : input.name);
      const doc = documents.find(d => d.id === source?.id);
      if (doc && String(source.value ?? '') === String(input.value) && field.querySelector('label')) sourceButton(field.querySelector('label'),doc);
    });
    refresh();
  }
  async function open(id) {
    if (opening) return; opening = true;
    try {
      document.querySelector('.content')?.classList.remove('cc-v3');
      await openV2.call(window,id);
      const form = document.getElementById('candidateCardV2'); if (!form) return;
      if (version === 'v3') {
        try { await mountV3(form,id); }
        catch (error) { console.error('Candidate Card V3:',error); document.querySelector('.content')?.classList.remove('cc-v3'); await openV2.call(window,id); version = 'v2'; try { localStorage.setItem(key,version); } catch {} }
      }
      const target = document.querySelector('.cc-v3-tools .quick-actions') || document.querySelector('.dashboard-top .quick-actions');
      if (target) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'cc-version-switch';
        button.textContent = version === 'v3' ? 'Повернути V2' : 'Спробувати V3';
        button.onclick = async () => {
          if (CRMWorkspace.busy || !await CRMWorkspace.guard()) return;
          version = version === 'v3' ? 'v2' : 'v3'; try { localStorage.setItem(key,version); } catch {}
          await open(id);
        }; target.append(button);
      }
    } finally { opening = false; }
  }
  window.CRMCandidateCardV3 = {open,provenance,changedFields,tabs,advanced};
  window.openCandidateCard = open;
})();
