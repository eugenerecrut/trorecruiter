/* Candidate presentation over the shared form/save core. */
(function () {
  'use strict';
  const openCore = window.CRMCandidateFormCore?.open || window.openCandidateCard;
  if (typeof openCore !== 'function') return;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const parse = v => { if (typeof v === 'string') { try { return JSON.parse(v) || {}; } catch { return {}; } } return v || {}; };
  const activeTabs=new Map();
  function readinessDetails(view,expanded=false) {
    const state=view?.readiness?.serviceRecord;
    if(!state||!Array.isArray(state.missing)||state.ready==null)return '<p class="muted">Дані послужного: перевірка недоступна.</p>';
    if(state.missing.length)return '<details data-case-data-review'+(expanded?' open':'')+'><summary>Дані послужного: уточнень '+state.missing.length+'</summary><ul>'+state.missing.map(issue=>'<li><strong>'+esc(issue.label||issue.fieldId||'Уточнення')+'</strong>: '+esc(issue.text||'Потрібна перевірка.')+(issue.fieldId?' <button type="button" data-case-jump="'+esc(issue.fieldId)+'">Відкрити поле</button>':'')+'</li>').join('')+'</ul><p>Виправте відомості у картці та збережіть зміни. Верстка PDF перевіряється під час формування.</p></details>';
    return '<p class="muted">Дані послужного: '+(state.ready===true?'основні дані заповнені. Верстка PDF перевіряється під час формування.':'потрібна перевірка.')+'</p>';
  }
  let opening = false, fieldSequence = 0;
  const tabs = [['documents','ДОДАТИ ДОКУМЕНТИ',[14]],['review','ВИРІШИТИ ПИТАННЯ',[1,2,3,4,5,6,7,8,9,10,11,12,13,16]],['case','СФОРМУВАТИ СПРАВУ',[]]];
  const advanced = new Set(('name_genitive unzr citizenship children_info signatory phone_secondary email messenger passport_data education_specialty_code education_start_date education_end_date education_diploma_series education_diploma_number education_diploma_issue_date education_supplement_number education_supplement_issue_date education combat_days military_service_history military_registry_number military_document_expiry_date military_data_updated_at military_deferment_type military_deferment_until military_registration_removal_reason military_training_status military_registration_date military_registration_category military_registration_status blood_data_in_passport vlk_commission vlk_next_date vlk_notes candidate_source recruiter_name motivation recruitment_notes psychiatric_record_info has_management_experience organizational_skills work_employer_code work_termination_reason work_order_number work_order_date work_end_order_number work_end_order_date').split(' '));
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
      details.open = !row.querySelector(kind === 'relative' ? '[data-relative-field=full_name],[name=full_name]' : '[name=work_employer]')?.value;
    }
    const value = n => row.querySelector('[data-relative-field="'+n+'"],[name="'+n+'"]')?.value || '';
    const title = kind === 'relative'
      ? [value('relationship') || 'Родич', value('full_name') || 'Новий запис', date(value('birth_date'))]
      : [date(value('work_start_date')) || '…', date(value('work_end_date')) || '…', value('work_employer') || 'Новий період', value('work_position')];
    const summary = details.querySelector(':scope > summary');
    if (summary && summary.textContent !== title.filter(Boolean).join(' · ')) summary.textContent = title.filter(Boolean).join(' · ');
    if (kind === 'relative') row.querySelectorAll('[name="birth_place"],[name="citizenship"],[name="workplace"],[name="position"],[name="notes"]').forEach(el => { const f = el.closest('.cc-field'); if (f) f.dataset.v3Advanced = 'true'; }); advancedControl(details.querySelector('.cc-v3-record-body'));
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
    const compact = window.CRMFeatureFlags?.compactCaseView !== false && typeof window.CRMCandidateCaseView?.build === 'function';
    root.classList.toggle('cc-compact-case', compact);
    const cleanup = new MutationObserver(() => {
      if (!form.isConnected) { root.classList.remove('cc-v3','cc-compact-case'); window.removeEventListener('resize',syncTop); cleanup.disconnect(); }
    });
    cleanup.observe(root,{childList:true});
    const header = document.createElement('section'); header.className = 'cc-v3-header'; header.setAttribute('aria-label','Кандидат');
    const syncTop = () => { header.style.top = (document.querySelector('.header')?.getBoundingClientRect().height || 0)+'px';header.style.setProperty('--v3-sticky-top',header.style.top); };
    syncTop(); window.addEventListener('resize',syncTop);
    header.innerHTML = '<div class="cc-v3-photo"></div><div class="cc-v3-identity"><h1 data-v3-name></h1><div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px"><a data-v3-phone></a><button type="button" class="cc-v3-wa-btn" data-v3-wa style="display:none;align-items:center;gap:3px;background:#25D366;color:#fff;border:none;border-radius:12px;padding:2px 8px;font-size:11px;font-weight:600;cursor:pointer;line-height:1.4" title="Написати кандидату у WhatsApp">💬 WhatsApp</button><button type="button" class="cc-v3-portal-btn" data-v3-portal style="display:none;align-items:center;gap:3px;background:#0284c7;color:#fff;border:none;border-radius:12px;padding:2px 8px;font-size:11px;font-weight:600;cursor:pointer;line-height:1.4" title="Посилання на особистий кабінет кандидата">🔗 Кабінет</button></div><span data-v3-stage></span></div><div class="cc-v3-context"><span>Бажана посада</span><b data-v3-position></b><span>Військова частина</span><b data-v3-unit></b></div><div class="cc-v3-unit-recruiter"><span>Рекрутер ВЧ</span><b data-v3-unit-recruiter></b><span>Телефон ВЧ</span><b data-v3-unit-phone-box><a data-v3-unit-phone></a></b></div><div class="cc-v3-owner"></div><div class="cc-v3-indicators"></div><div class="cc-v3-tools"></div>';
    form.prepend(header);
    const overview=form.querySelector('[data-card-photo]');
    const modes=document.createElement('div');modes.className='cc-v3-modes';
    overview.querySelectorAll('.crm-case-mode').forEach(el=>modes.append(el));header.append(modes);
    overview.hidden=true;
    const extra=document.createElement('button');extra.type='button';extra.className='cc-v3-header-toggle';extra.textContent='Деталі';extra.setAttribute('aria-expanded','false');
    extra.onclick=()=>{const expanded=header.classList.toggle('cc-v3-header-expanded');extra.setAttribute('aria-expanded',String(expanded));extra.textContent=expanded?'Згорнути':'Деталі';};header.querySelector('.cc-v3-identity').append(extra);
    header.querySelector('.cc-v3-photo').append(root.querySelector('.crm-card-photo-slot'));
    const owner = root.querySelector('.crm-recruiter-field'); if (owner) {header.querySelector('.cc-v3-owner').append(owner);owner.addEventListener('change',event=>event.stopPropagation());}
    const tools = root.querySelector('.dashboard-top .quick-actions'); if (tools) header.querySelector('.cc-v3-tools').append(tools);
    const footer=document.createElement('div');footer.className='cc-v3-header-footer';footer.append(header.querySelector('.cc-v3-indicators'),header.querySelector('.cc-v3-tools'));header.append(footer);
    root.querySelector('.dashboard-top').hidden = true;
    const responsibility = root.querySelector('[data-responsibility]'); if (responsibility) responsibility.hidden = true;
    const history = document.createElement('section'); history.className = 'cc-section'; history.dataset.section = '16';
    history.innerHTML = '<div class="cc-section-head"><h3>Історія справи</h3></div><div class="cc-v3-history-content" role="status">Завантаження журналу…</div>';
    form.querySelector('.cc-actions').before(history);
    const historyButton = root.querySelector('[data-history]'); if (historyButton) history.append(historyButton);
    const nav = document.createElement('nav'); nav.className = 'cc-v3-nav'; nav.setAttribute('aria-label','Вкладки картки'); nav.setAttribute('role','tablist');
    header.after(nav); root.querySelector('#crmCardNav').hidden = true;
    const caseSummary=document.createElement('section');caseSummary.className='cc-case-summary';caseSummary.setAttribute('aria-live','polite');caseSummary.hidden=!compact;nav.after(caseSummary);
    if(compact){
      const extraTools=document.createElement('details');extraTools.className='cc-case-extra';
      const summary=document.createElement('summary');summary.textContent='Додаткові дії';extraTools.append(summary);
      const toolHost=header.querySelector('.cc-v3-tools');while(toolHost.firstChild)extraTools.append(toolHost.firstChild);toolHost.append(extraTools);
    }
    const title = {1:'Персональні дані',2:'Паспорт',3:'Контакти',4:'Адреси',5:'Освіта',6:'Робота',7:'Військова служба',8:'Військовий облік',9:'ВЛК',10:'Рекрутинг',11:'Контракт',12:'Примітки',13:'Рідні та близькі',14:'Документи',15:'Бланки',16:'Історія'};
    let active = activeTabs.get(id)||'documents';if(!tabs.some(t=>t[0]===active))active='documents';
    let manualEditing=false,reviewLoaded=false,caseLoaded=false;
    const manager=document.createElement('section');manager.className='cc-v3-document-manager';manager.setAttribute('role','tabpanel');manager.setAttribute('aria-labelledby','cc-v3-tab-documents');manager.hidden=true;form.querySelector('.cc-actions').before(manager);
    for(const type of ['input','change','click'])manager.addEventListener(type,event=>event.stopPropagation());
    window.CRMCaseAssistant?.mount(form,id);
    const assistant=root.querySelector('.crm-case-assistant');if(assistant)caseSummary.after(assistant);
    const reviewHost=document.createElement('section');reviewHost.className='cc-v3-intake-review';reviewHost.hidden=true;caseSummary.after(reviewHost);
    const caseHost=document.createElement('section');caseHost.dataset.workflow='';caseHost.hidden=true;form.after(caseHost);
    const manual=document.createElement('button');manual.type='button';manual.textContent='Додатково: редагувати картку';manual.setAttribute('aria-expanded','false');manual.onclick=()=>{manualEditing=!manualEditing;manual.setAttribute('aria-expanded',String(manualEditing));select('review');if(manualEditing&&!window.CRMWorkspace?.card?.dirty)requestAnimationFrame(()=>{if(window.CRMWorkspace?.card?.dirty)return;form.querySelectorAll('[data-relative-row] [data-relative-field=full_name],[data-relative-row] [name=full_name]').forEach(input=>{input.value=input.defaultValue;const row=input.closest('[data-relative-row]'),summary=row.querySelector('summary');if(summary){const role=row.querySelector('[name=relationship]')?.value||'Родич';const birth=row.querySelector('[name=birth_date]')?.value||'';summary.textContent=[role,input.value,date(birth)].filter(Boolean).join(' · ');}});});};reviewHost.after(manual);manual.hidden=true;
    let managerLoading=false,managerLoaded=false;
    function loadManager(){
      if(managerLoaded||managerLoading||typeof showDocuments!=='function')return;managerLoading=true;manager.textContent='Завантажуємо документи…';
      showDocuments(id,{host:manager,reload:()=>open(id)}).then(()=>{managerLoaded=true;}).catch(error=>{if(manager.isConnected){manager.textContent='Документи не завантажилися: '+error.message;const retry=document.createElement('button');retry.type='button';retry.textContent='Повторити';retry.onclick=loadManager;manager.append(retry);}}).finally(()=>managerLoading=false);
    }
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
        const hasVal = input.type === 'checkbox' ? input.checked : !!String(input.value || '').trim();
        if (advanced.has(input.name) && !hasVal) field.dataset.v3Advanced = 'true';
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
      form.querySelectorAll('[data-relative-row]').forEach(row => {const input=row.querySelector('[data-relative-field=full_name],[name=full_name]');if(input&&!input.dataset.v3NameHydrated){input.autocomplete='off';input.value=input.defaultValue;input.dataset.v3NameHydrated='true';}fold(row,'relative');});
      form.querySelectorAll('[data-work-row]').forEach(row => fold(row,'work'));
      form.querySelectorAll('section[data-section]').forEach(section => {
        const number = Number(section.dataset.section), heading = section.querySelector('h3');
        if (heading) heading.textContent = title[number] || heading.textContent;
        if(number===7){for(const [name,text] of [['military_unit','ВЧ попередньої служби'],['military_position','Посада під час служби']]){const label=section.querySelector('[name="'+name+'"]')?.closest('.cc-field')?.querySelector('label');if(label&&!label.querySelector('.cc-v3-tip'))label.textContent=text;}}
        advancedControl(section);
      });
    }
    function select(tab, focus = false) {
      active = tab;
      const unit = value('case_mode') === 'unit', mobilization = value('service_type') === 'За мобілізацією';
      if(!tabs.some(t=>t[0]===active))active='documents';
      const group = tabs.find(t => t[0] === active) || tabs[0];
      form.querySelectorAll('section[data-section]').forEach(section => {
        const number = Number(section.dataset.section);
        section.hidden = (active==='review'&&!manualEditing) || (number===14&&typeof showDocuments==='function') || !group[2].includes(number) || (unit && ![1,14,15,16].includes(number)) || (mobilization && number === 13) || (number === 11 && value('service_type') !== 'За контрактом');
        section.setAttribute('role','tabpanel'); section.setAttribute('aria-labelledby','cc-v3-tab-'+(tabs.find(t => t[2].includes(number))?.[0] || 'main'));
      });
      form.querySelector('[data-card-photo]').hidden = true;
      activeTabs.set(id,active);manager.hidden=active!=='documents';reviewHost.hidden=active!=='review';manual.hidden=active!=='review';caseHost.hidden=active!=='case';
      if(active==='review'&&CRMWorkflow.readOnly?.(candidate)){reviewLoaded=true;reviewHost.textContent='Архівна справа: дані доступні для перегляду. Для перенесення полів або підтвердження документів поверніть справу в роботу.';manual.textContent='Переглянути картку';}
      if(active==='review'&&!reviewLoaded&&candidate.id){reviewLoaded=true;reviewHost.textContent='Звіряємо документи…';CRMIntake.review(reviewHost,candidate,documents).catch(e=>{reviewHost.textContent='Перевірку не завершено: '+e.message;const retry=document.createElement('button');retry.type='button';retry.textContent='Повторити';retry.onclick=()=>{reviewLoaded=false;select('review');};reviewHost.append(retry);});}
      if(active==='case'&&!caseLoaded&&candidate.id){caseLoaded=true;CRMWorkflow.mount(candidate,caseHost.parentElement).then(()=>{
        const tools=caseHost.querySelector('.wf-tools'),full=tools?.querySelector('[data-full-package]'),service=tools?.querySelector('[data-service]'),card13=tools?.querySelector('[data-card13]');
        if(full){const actions=document.createElement('div');actions.className='crm-case-primary';if(service)actions.append(service);if(card13)actions.append(card13);full.classList.add('primary');actions.append(full);tools.before(actions);const sumEl=tools.querySelector('summary');if(sumEl)sumEl.textContent='Окремі бланки та додаткові дії';}
        if(compact){const planning=caseHost.querySelector('.wf-panel');if(planning){
          // Generators are nested in the legacy stage panel. Move their existing
          // nodes/handlers out before folding stages, otherwise PDF actions disappear.
          const primary=caseHost.querySelector('.crm-case-primary');
          if(primary)planning.before(primary);if(tools)planning.before(tools);planning.open=false;
        }}
      }).catch(e=>{caseHost.textContent=e.message;caseLoaded=false;});}
      form.querySelector('.cc-actions').hidden=!(active==='review'&&manualEditing)&&!CRMWorkspace.card.dirty;
      if(active==='documents')loadManager();
      nav.querySelectorAll('[data-v3-tab]').forEach(button => {
        const selected = button.dataset.v3Tab === active; button.setAttribute('aria-selected',String(selected)); button.tabIndex = selected ? 0 : -1;
        button.hidden=false;
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
      decorate(); conditional();CRMWorkflow.protectCard?.(form,candidate); select(active);
      const nameEl = header.querySelector('[data-v3-name]'); if (nameEl) nameEl.textContent = value('name_nominative') || 'Кандидат';
      const phone = header.querySelector('[data-v3-phone]'); if (phone) { phone.textContent = value('phone') || 'Телефон не вказаний'; phone.href = 'tel:'+value('phone'); }
      const waBtn = header.querySelector('[data-v3-wa]');
      if (waBtn) {
        const phoneVal = value('phone') || candidate.phone;
        if (phoneVal) {
          waBtn.style.display = 'inline-flex';
          waBtn.onclick = (e) => {
            e.preventDefault(); e.stopPropagation();
            window.CRMWhatsApp?.openTemplateModal(candidate, phoneVal, documents, CRMWorkspace?.card?.requirements);
          };
        } else {
          waBtn.style.display = 'none';
        }
      }
      const portalBtn = header.querySelector('[data-v3-portal]');
      if (portalBtn) {
        if (candidate.portal_token || candidate.id) {
          portalBtn.style.display = 'inline-flex';
          portalBtn.onclick = (e) => {
            e.preventDefault(); e.stopPropagation();
            window.CRMWhatsApp?.openPortalShareModal(candidate);
          };
        } else {
          portalBtn.style.display = 'none';
        }
      }
      const posEl = header.querySelector('[data-v3-position]'); if (posEl) posEl.textContent = value('desired_position') || 'Не вказана';
      const unitEl = header.querySelector('[data-v3-unit]'); if (unitEl) unitEl.textContent = parse(candidate.profile_data).military_unit || value('military_unit') || candidate.recommender_unit || 'Не вказана';
      const prof = parse(candidate.profile_data);
      const unitRecruiterName = value('recruiter_name') || prof.recruiter_name || prof.unit_representative || (prof.signatory ? prof.signatory + ' (підписант)' : '') || 'Не вказано';
      const unitPhone = value('unit_phone') || prof.unit_phone || prof.recruiter_phone || prof.contact_phone || prof.recommender_phone || '';
      const unitRecruiterEl = header.querySelector('[data-v3-unit-recruiter]');
      if (unitRecruiterEl) {
        unitRecruiterEl.textContent = unitRecruiterName;
        if (prof.signatory && prof.recruiter_name && prof.signatory !== prof.recruiter_name) {
          unitRecruiterEl.title = 'Підписант РЛ: ' + prof.signatory;
        } else {
          unitRecruiterEl.removeAttribute('title');
        }
      }
      const unitPhoneEl = header.querySelector('[data-v3-unit-phone]');
      if (unitPhoneEl) {
        if (unitPhone) {
          unitPhoneEl.textContent = unitPhone;
          unitPhoneEl.href = 'tel:' + unitPhone.replace(/[^\d+]/g, '');
          unitPhoneEl.style.color = 'var(--v3-accent)';
          unitPhoneEl.title = 'Зателефонувати рекрутеру ВЧ';
        } else {
          unitPhoneEl.textContent = '—';
          unitPhoneEl.removeAttribute('href');
          unitPhoneEl.removeAttribute('title');
          unitPhoneEl.style.color = 'var(--v3-muted)';
        }
      }
      const stageEl = header.querySelector('[data-v3-stage]'); if (stageEl) stageEl.textContent = value('case_mode') === 'unit' ? 'Оформлює ВЧ' : CRMWorkflow.label(candidate);
      const totals=window.CRMDocumentState?.summary(candidate,CRMWorkspace.card.requirements||[],documents);
      const packet=window.CRMDocumentState?.packageState(candidate,documents);
      if(compact&&candidate.id){
        try{
          const view=window.CRMCandidateCaseView.build(candidate,CRMWorkspace.card.personalFile||{},documents,CRMWorkspace.card.requirements||[]);
          const text=CRMWorkspace.card.dirty?'Є незбережені зміни. Показники нижче — за збереженими даними.':view.nextAction.text;
          const markup='<strong>'+esc(text)+'</strong><p>Перевірено документів: '+view.completeness.verified+' / '+view.completeness.total+' · Питань у документах: '+view.issues.length+' · У роботі AI: '+view.completeness.processing+'</p><small>Паперові позначки: '+view.completeness.paper+'. Електронних копій: '+view.completeness.copies+'. Готовність верстки перевіряється під час формування PDF.</small>'+readinessDetails(view,caseSummary.querySelector('[data-case-data-review]')?.open===true)+(view.nextAction.kind==='wait'?'':'<p><button type="button" data-case-next="'+view.nextAction.kind+'">'+esc(view.nextAction.kind==='case'?'Перейти до формування':'Переглянути питання і дані')+'</button></p>');
          if(caseSummary.innerHTML!==markup)caseSummary.innerHTML=markup;
          caseSummary.onclick=event=>{const jump=event.target.closest('[data-case-jump]')?.dataset.caseJump;if(jump){const map={'identity.full_name':'[name="name_nominative"]','identity.birth_date':'[name="birth_date"]','identity.birth_place':'[name="birth_place"]','education.civil':'[data-education-field="institution"],[name="education_institution"]','employment.absence':'[name="worked_before"]','employment.periods':'[data-work-row] input,[name="worked_before"]','service.absence':'[name="served_before"]','service.periods':'[name="military_unit"],[name="served_before"]','family.marital_status':'[name="marital_status"]','family.parents':'[data-relative-row] [name="relationship"]','family.spouse':'[data-relative-row] [name="relationship"]'};manualEditing=true;manual.setAttribute('aria-expanded','true');select('review');const target=form.querySelector(map[jump]||'[name]');if(target){target.closest('details.cc-v3-record')?.setAttribute('open','');target.closest('[data-section]')?.classList.add('cc-v3-expanded');target.scrollIntoView?.({block:'center'});target.focus?.();}return;}const button=event.target.closest('[data-case-next]');if(button)select(button.dataset.caseNext==='case'?'case':'review',true);};
          for(const [tab,label] of [['documents','Додати документи'],['review','Перевірити питання'+(view.issues.length?' · '+view.issues.length:'')],['case','Сформувати справу']]) { const tabBtn = nav.querySelector('[data-v3-tab="'+tab+'"]'); if (tabBtn) tabBtn.textContent=label; }
        }catch(error){caseSummary.textContent='Не вдалося перевірити стан справи: '+error.message;}
      }
      const indicators=totals?
        '<button type="button" data-indicator="documents">Комплект · '+totals.verified+'/'+totals.total+(totals.unknown?' · уточнити '+totals.unknown:'')+'</button><button type="button" data-indicator="documents">Копії · '+totals.copies+'</button><button type="button" data-indicator="documents">AI · '+('помилок '+totals.errors+(totals.processing?' · обробляється '+totals.processing:''))+'</button><button type="button" data-indicator="documents">PDF · '+(packet.ready?'готовий':'бракує '+packet.missing.length)+'</button><button type="button" data-indicator="military">ВЛК · '+esc(value('vlk_conclusion')?'висновок є':'немає висновку')+'</button>':'';
      const indEl = header.querySelector('.cc-v3-indicators'); if(indEl && indEl.innerHTML!==indicators) indEl.innerHTML=indicators;

    }
    const documentsButton=[...header.querySelectorAll('.quick-actions button')].find(b=>b.textContent.trim()==='Документи');if(documentsButton){documentsButton.onclick=()=>select('documents');documentsButton.hidden=true;}

    header.addEventListener('click',event => { const tab = event.target.closest('[data-indicator]')?.dataset.indicator; if (tab) select(tab==='documents'?'documents':'review'); });
    form.addEventListener('submit',()=>{CRMWorkspace.card?.saving?.then(saved=>{if(saved){managerLoaded=false;refresh();}});});
    form.addEventListener('input',event => {
      const field = event.target.closest('.cc-field'); field?.querySelectorAll('.cc-v3-source').forEach(b => b.parentElement.remove());
      refresh();
    });
    form.addEventListener('change',() => queueMicrotask(refresh));
    form.addEventListener('click',event => {if(event.target.closest('[data-case-data-review]'))return;queueMicrotask(refresh);});
    form.addEventListener('invalid',event => {
      if(event.target.closest('.cc-v3-modes')){header.classList.add('cc-v3-header-expanded');extra.setAttribute('aria-expanded','true');}
      manualEditing=true;manual.setAttribute('aria-expanded','true');const section = event.target.closest('[data-section]');
      const group = tabs.find(t => t[2].includes(Number(section?.dataset.section || 1))); if (group) select(group[0]);
      event.target.closest('details.cc-v3-record')?.setAttribute('open',''); section?.classList.add('cc-v3-expanded');
    },true);
    refresh();
    // Extra reads are optional UI metadata. Failure must never block V2 editing/saving.
    candidate = CRMWorkspace.card.candidate || {};
    documents = CRMWorkspace.card.documents || [];
    refresh();
    const results = await Promise.allSettled([
      supabaseClient.from('crm_activity').select('id,candidate_id,action,changes,source_document_id,occurred_at,actor_name').eq('candidate_id',id).order('occurred_at',{ascending:false}).limit(250)
    ]);
    if (!form.isConnected) return;
    const result = i => results[i].status === 'fulfilled' && !results[i].value.error ? results[i].value.data : null;
    const events = result(0); sources = provenance(events || []);
    if(window.CRMCandidateFacts?.enabled()){
      const factHost=document.createElement('section');factHost.className='cc-facts-shadow-host';caseSummary.after(factHost);
      try{
        const baseline=window.CRMCaseAssistant?.build(candidate,CRMWorkspace.card.requirements||[],documents,CRMWorkspace.card.personalFile||{});
        const model=window.CRMCandidateFacts.build({candidate,personalFile:CRMWorkspace.card.personalFile||{},documents,requirements:CRMWorkspace.card.requirements||[],activity:events||[],comparison:baseline?{conflictCount:baseline.issues.filter(i=>i.kind==='conflict').length}:undefined});
        window.CRMCandidateFacts.render(factHost,model);
      }catch(error){factHost.textContent='Діагностика джерел недоступна. Чинні перевірки CRM працюють.';console.error('Facts shadow reader failed');}
    }
    const historyContent = history.querySelector('.cc-v3-history-content');
    if(historyContent) historyContent.textContent = '';
    if (!events && historyContent) historyContent.textContent = 'Журнал зараз недоступний. Редагування картки працює.';
    else if (!events.length && historyContent) historyContent.textContent = 'Змін поки немає.';
    else events.slice(0,25).forEach(event => {
      const details = document.createElement('details'); const summary = document.createElement('summary');
      summary.textContent = CRMResponsibility.date(event.occurred_at)+' · '+(event.actor_name || 'Працівник CRM');
      details.append(summary); const body = document.createElement('div'); body.innerHTML = CRMHistoryFormat.render(CRMHistoryFormat.changes(event.changes || {},{person:CRMResponsibility.name})); details.append(body); historyContent.append(details);
    });
    educationEditor(form,parse(candidate.profile_data),documents);
    const relativeRecords=parse(candidate.profile_data).relatives||[];
    form.querySelectorAll('[data-relative-row]').forEach(row=>{
      const record=relativeRecords[Number(row.dataset.relativeRow)];if(!record)return;
      row.querySelectorAll('[name]').forEach(input=>{
        const fieldName=input.dataset.relativeField||input.name;const source=Object.prototype.hasOwnProperty.call(record.field_sources||{},fieldName)?record.field_sources[fieldName]:record.source_document_id;
        const doc=documents.find(d=>d.id===source),label=input.closest('.cc-field')?.querySelector('label');
        if(doc&&label&&String(record[input.dataset.relativeField||input.name]??'')===String(input.value)&&String(input.value).trim())sourceButton(label,doc);
      });
    });

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
    const restoreReviewFocus=!!document.activeElement?.closest('.cc-v3-intake-review');
    try {
      document.querySelector('.content')?.classList.remove('cc-v3');
      await openCore.call(window,id);
      const form = document.getElementById('candidateCardV2'); if (!form) return;
      try { await mountV3(form,id);if(restoreReviewFocus)form.querySelector('[data-v3-tab=review]')?.focus(); }
      catch (error) {
        console.error('Candidate card presentation:',error);
        document.querySelector('.content')?.classList.remove('cc-v3');
        await openCore.call(window,id);
        const notice=document.createElement('p');notice.setAttribute('role','alert');
        notice.textContent='Спрощений екран не завантажився. Дані доступні у спільній формі; повторіть відкриття картки.';
        document.getElementById('candidateCardV2')?.prepend(notice);
      }
    } finally { opening = false; }
  }
  window.CRMCandidateCardV3 = {open,provenance,changedFields,tabs,advanced,readinessDetails};
  window.openCandidateCard = open;
})();
