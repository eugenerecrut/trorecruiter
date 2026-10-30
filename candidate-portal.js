// PSK_RECRUTER CRM — Клієнтська логіка Кабінету кандидата
// Підтримує автовизначення пристрою (комп'ютер / смартфон), drag-and-drop, QR-синхронізацію та автозбереження сесії.
(function(){
  'use strict';

  const SUPABASE_URL = 'https://vhfysipxorlhuiaatxqi.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_o8ZTKE4Ek0m58zq1q0QpFQ_domIX0Yz';
  const supabase = window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY);

  const app = document.getElementById('portalApp');
  const params = new URLSearchParams(window.location.search);
  let token = params.get('token');

  // Автовизначення збереженого токена (якщо кандидат відкрив сайт на ПК без query-параметрів)
  if (token) {
    try { localStorage.setItem('psk_candidate_portal_token', token); } catch(_) {}
  } else {
    try { token = localStorage.getItem('psk_candidate_portal_token'); } catch(_) {}
  }

  let currentFilter = 'missing'; // 'all', 'missing', 'uploaded'
  let caseData = null;

  function checkIsDesktop(){
    const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 1);
    const isWide = window.innerWidth >= 860;
    return (isWide && !isMobileUA) || (!hasTouch && window.innerWidth >= 768);
  }

  let isDesktop = checkIsDesktop();
  document.body.classList.toggle('is-desktop', isDesktop);
  document.body.classList.toggle('is-mobile', !isDesktop);

  window.addEventListener('resize', () => {
    const next = checkIsDesktop();
    if(next !== isDesktop){
      isDesktop = next;
      document.body.classList.toggle('is-desktop', isDesktop);
      document.body.classList.toggle('is-mobile', !isDesktop);
      if(caseData) renderPortal();
    }
  });

  function escapeHtml(str){
    return String(str??'').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }

  function renderLoginPrompt(){
    app.innerHTML = '' +
      '<div class="card" style="text-align:center;padding:40px 24px;max-width:480px;margin:40px auto">' +
        '<div style="font-size:42px;margin-bottom:12px">🪪</div>' +
        '<h2 style="font-size:18px;margin:0 0 8px 0;color:#0f172a">Особистий кабінет кандидата</h2>' +
        '<p style="font-size:13px;color:#64748b;margin:0 0 20px 0">' +
          'Введіть персональний ключ доступу з SMS/повідомлення рекрутера або вставте повне посилання:' +
        '</p>' +
        '<form id="tokenForm" style="display:flex;flex-direction:column;gap:10px">' +
          '<input type="text" id="tokenInput" placeholder="Вставте посилання або ключ доступу…" style="padding:10px 14px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;text-align:center" required>' +
          '<button type="submit" style="background:#0284c7;color:#fff;border:none;border-radius:8px;padding:11px;font-weight:600;font-size:14px;cursor:pointer">Увійти в кабінет</button>' +
        '</form>' +
        '<div style="margin-top:20px;font-size:12px;color:#94a3b8">' +
          'Якщо Ви не маєте посилання, зверніться до закріпленого рекрутера.' +
        '</div>' +
      '</div>';

    const form = app.querySelector('#tokenForm');
    if(form){
      form.onsubmit = (e) => {
        e.preventDefault();
        const raw = app.querySelector('#tokenInput').value.trim();
        let extracted = raw;
        if(raw.includes('token=')){
          try {
            const u = new URL(raw.startsWith('http') ? raw : 'https://dummy.invalid/' + raw);
            extracted = u.searchParams.get('token') || raw;
          } catch(_) {}
        }
        if(extracted){
          token = extracted;
          try { localStorage.setItem('psk_candidate_portal_token', token); } catch(_) {}
          const url = new URL(window.location.href);
          url.searchParams.set('token', token);
          window.history.replaceState({}, '', url.toString());
          loadCase();
        }
      };
    }
  }

  function renderError(message){
    app.innerHTML = '' +
      '<div class="card" style="text-align:center;padding:40px 20px;max-width:500px;margin:30px auto">' +
        '<div style="font-size:40px;margin-bottom:12px">🔒</div>' +
        '<h2 style="font-size:18px;margin:0 0 8px 0;color:#0f172a">Доступ до кабінету обмежено</h2>' +
        '<p style="font-size:13px;color:#64748b;margin:0 0 20px 0">' + escapeHtml(message) + '</p>' +
        '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;font-size:12px;color:#475569">' +
          'Зверніться, будь ласка, до Вашого рекрутера для отримання нового посилання.' +
        '</div>' +
        '<button type="button" id="btnChangeToken" style="margin-top:16px;background:transparent;border:1px solid #cbd5e1;padding:6px 12px;border-radius:6px;font-size:12px;color:#64748b;cursor:pointer">Ввести інший ключ</button>' +
      '</div>';

    const btnChange = app.querySelector('#btnChangeToken');
    if(btnChange){
      btnChange.onclick = () => {
        try { localStorage.removeItem('psk_candidate_portal_token'); } catch(_) {}
        token = null;
        renderLoginPrompt();
      };
    }
  }

  async function loadCase(){
    if(!token){
      renderLoginPrompt();
      return;
    }
    if(!supabase){
      renderError('Помилка підключення до сервера. Будь ласка, спробуйте пізніше.');
      return;
    }

    try {
      const { data, error } = await supabase.rpc('crm_portal_get_case', { p_token: token });
      if(error) throw error;
      if(data.error) throw new Error(data.error);

      caseData = data;
      renderPortal();
    } catch(err){
      renderError(err.message || 'Не вдалося завантажити дані Вашої справи.');
    }
  }

  function renderPortal(){
    if(!caseData) return;
    const c = caseData.candidate;
    const stats = caseData.stats;
    const items = caseData.checklist || [];

    const filteredItems = items.filter(it => {
      if(currentFilter === 'missing') return !it.has_document;
      if(currentFilter === 'uploaded') return it.has_document;
      return true;
    });

    const standardItems = filteredItems.filter(it => !it.is_template_blank);
    const templateItems = filteredItems.filter(it => it.is_template_blank);

    const portalUrl = window.location.href;
    const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=150x150&margin=4&data=' + encodeURIComponent(portalUrl);

    // Left Column / Sidebar content (candidate info, progress, recruiter, mobile sync)
    const sidebarHtml = '' +
      '<div class="card">' +
        '<div class="candidate-card-top">' +
          '<h1 class="candidate-name">' + escapeHtml(c.name) + '</h1>' +
          '<div class="candidate-meta">' +
            '<span class="badge badge-stage">' + escapeHtml(c.stage) + '</span>' +
            '<span class="badge badge-service">' + escapeHtml(c.service_type || 'За контрактом') + '</span>' +
            '<span>В/ч: <b>' + escapeHtml(c.military_unit) + '</b></span>' +
          '</div>' +
          '<div style="font-size:12px;color:#475569;margin-top:6px">' +
            'Бажана посада: <b>' + escapeHtml(c.desired_position) + '</b>' +
          '</div>' +
        '</div>' +

        '<div class="progress-bar-wrap">' +
          '<div class="progress-labels">' +
            '<span>Комплект документів</span>' +
            '<span>' + stats.uploaded + ' з ' + stats.total + ' (' + stats.percent + '%)</span>' +
          '</div>' +
          '<div class="progress-track">' +
            '<div class="progress-fill" style="width:' + stats.percent + '%"></div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="card recruiter-card">' +
        '<div class="recruiter-info">' +
          '<div class="recruiter-avatar">Р</div>' +
          '<div>' +
            '<div style="font-size:11px;color:#15803d;font-weight:600">Ваш рекрутер</div>' +
            '<div style="font-size:14px;font-weight:700;color:#0f172a">' + escapeHtml(c.recruiter_name) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="recruiter-actions">' +
          (c.recruiter_phone ? '<a class="btn-icon btn-phone" href="tel:' + escapeHtml(c.recruiter_phone) + '" title="Зателефонувати">📞</a>' : '') +
          (c.recruiter_phone ? '<a class="btn-icon btn-wa" href="https://wa.me/' + escapeHtml(c.recruiter_phone.replace(/\D/g,'')) + '" target="_blank" title="Написати у WhatsApp">💬 WhatsApp</a>' : '') +
        '</div>' +
      '</div>' +

      (isDesktop ? '' +
        '<div class="card" style="background:#f8fafc;border:1px solid #cbd5e1;text-align:center;padding:14px">' +
          '<div style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:4px">📱 Потрібно сфотографувати?</div>' +
          '<p style="font-size:11px;color:#64748b;margin:0 0 10px 0;line-height:1.4">' +
            'Відскануйте QR-код смартфоном, щоб відкрити цей кабінет і фотографувати документи камерою:' +
          '</p>' +
          '<img src="' + qrUrl + '" alt="QR для смартфона" style="width:130px;height:130px;background:#fff;padding:4px;border-radius:8px;border:1px solid #e2e8f0;margin:0 auto 10px;display:block">' +
          '<button type="button" data-copy-link style="background:#fff;border:1px solid #cbd5e1;border-radius:6px;padding:6px 12px;font-size:11px;font-weight:600;color:#334155;cursor:pointer;width:100%">' +
            '📋 Скопіювати посилання' +
          '</button>' +
        '</div>' : '');

    // Right Column / Main content (checklist, blanks, additional docs, tips)
    const mainHtml = '' +
      '<div class="section-title">' +
        '<div>' +
          '<span style="font-size:16px">Необхідні документи</span>' +
          (isDesktop ? '<span style="font-size:12px;color:#0284c7;margin-left:10px;font-weight:500">💡 Можна перетягувати файли мишкою прямо на позиції списку</span>' : '') +
        '</div>' +
        '<span class="badge badge-service">' + escapeHtml(c.service_type || 'За контрактом') + '</span>' +
      '</div>' +

      '<div class="filter-tabs">' +
        '<button type="button" class="tab-btn ' + (currentFilter === 'missing' ? 'active' : '') + '" data-filter="missing">Потрібно надати (' + (stats.total - stats.uploaded) + ')</button>' +
        '<button type="button" class="tab-btn ' + (currentFilter === 'uploaded' ? 'active' : '') + '" data-filter="uploaded">Завантажені (' + stats.uploaded + ')</button>' +
        '<button type="button" class="tab-btn ' + (currentFilter === 'all' ? 'active' : '') + '" data-filter="all">Усі (' + stats.total + ')</button>' +
      '</div>' +

      '<div class="card" style="padding:10px 14px;background:#fff">' +
        (standardItems.length === 0 ? '' +
          '<div style="text-align:center;padding:24px 10px;color:#64748b;font-size:13px">' +
            (currentFilter === 'missing' ? '🎉 Усі обов’язкові документи завантажено! Рекрутер перевіряє Вашу справу.' : 'Немає документів у цьому списку.') +
          '</div>' : '') +
        standardItems.map(it => renderChecklistItem(it)).join('') +
      '</div>' +

      (templateItems.length > 0 ? '' +
        '<div class="card" style="padding:14px 16px;margin-top:16px;background:#f0f9ff;border:1px solid #bae6fd">' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">' +
            '<span style="font-size:18px">📝</span>' +
            '<div style="font-size:14px;font-weight:700;color:#0369a1">Бланки для друку та підпису</div>' +
          '</div>' +
          '<p style="font-size:12px;color:#0369a1;margin:0 0 12px 0;line-height:1.4">' +
            'Потрібні за умови, якщо рекрутер надіслав Вам бланки або Ви завантажили шаблони нижче, роздрукували та заповнили власноруч:' +
          '</p>' +
          templateItems.map(it => renderChecklistItem(it)).join('') +
        '</div>' : '') +

      '<details class="card" style="padding:12px 16px;margin-top:14px" id="extraDocCard">' +
        '<summary style="font-size:13px;font-weight:700;color:#0284c7;cursor:pointer">＋ Надіслати додатковий документ</summary>' +
        '<div style="margin-top:12px">' +
          '<p style="font-size:12px;color:#64748b;margin:0 0 10px 0">Якщо у Вас є посвідчення водія, УБД або інші додаткові довідки, Ви можете завантажити їх сюди:</p>' +
          '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px">' +
            '<select id="extraDocType" style="flex:1;min-width:200px;padding:8px 10px;border-radius:8px;border:1px solid #cbd5e1;font-size:13px;background:#fff">' +
              '<option value="Копія посвідчення водія / інші посвідчення">Посвідчення водія</option>' +
              '<option value="Копія УБД">Посвідчення УБД</option>' +
              '<option value="Свідоцтво про зміну імені / прізвища">Свідоцтво про зміну імені / прізвища</option>' +
              '<option value="Копія свідоцтва про шлюб">Свідоцтво про шлюб</option>' +
              '<option value="Копія свідоцтва про народження дітей">Свідоцтво про народження дитини</option>' +
              '<option value="Інший документ">Інший документ / довідка</option>' +
            '</select>' +
            '<label class="upload-btn-label" style="margin:0">' +
              '<span class="upload-btn-text">' + (isDesktop ? '📁 Вибрати файл' : '📷 Завантажити') + '</span>' +
              '<input type="file" accept="' + (isDesktop ? '.pdf,.jpg,.jpeg,.png,.webp,image/*,application/pdf' : 'image/*,application/pdf') + '"' + (isDesktop ? '' : ' capture="environment"') + ' id="extraDocInput">' +
            '</label>' +
          '</div>' +
        '</div>' +
      '</details>' +

      '<div class="tip-box">' +
        '<b>💡 ' + (isDesktop ? 'Підказка для комп’ютера:' : 'Як зробити якісне фото смартфонами:') + '</b>' +
        '<ul style="margin:6px 0 0;padding-left:18px">' +
          (isDesktop ?
            '<li>Підтримуються файли <b>PDF, JPG, PNG</b> до 25 МБ.</li>' +
            '<li>Ви можете просто перетягнути мишкою файл із папки комп\'ютера на потрібний рядок у списку.</li>' +
            '<li>Якщо документ сфотографовано телефоном, перетягніть готове фото або відкрийте посилання у смартфоні.</li>' :
            '<li>Фотографуйте при денному світлі, тримаючи телефон рівно над документом.</li>' +
            '<li>Усі 4 кути документа мають бути чітко видно в кадрі.</li>' +
            '<li>Уникайте відблисків спалаху на сторінках.</li>') +
        '</ul>' +
      '</div>';

    // Combine into Responsive Layout
    app.innerHTML = '' +
      '<header class="portal-header">' +
        '<div class="portal-brand">' +
          '<div class="portal-brand-badge">PSK</div>' +
          '<div class="portal-brand-title">Особистий кабінет кандидата</div>' +
        '</div>' +
        '<div class="device-indicator">' +
          (isDesktop ? '💻 Комп’ютер' : '📱 Смартфон') +
        '</div>' +
      '</header>' +
      (isDesktop ?
        '<div class="portal-grid">' +
          '<div class="portal-sidebar">' + sidebarHtml + '</div>' +
          '<div class="portal-main">' + mainHtml + '</div>' +
        '</div>' :
        sidebarHtml + mainHtml
      );

    attachEvents();
  }

  function renderChecklistItem(item){
    const hasDoc = item.has_document;
    const isVerified = item.status === 'Підтверджено' || item.status === 'verified';
    const isTemplate = item.is_template_blank;

    const acceptTypes = isDesktop ? '.pdf,.jpg,.jpeg,.png,.webp,image/*,application/pdf' : 'image/*,application/pdf';
    const captureAttr = isDesktop ? '' : ' capture="environment"';
    const btnLabel = isDesktop ? '📁 Вибрати файл' : '📷 Сфотографувати / Завантажити';

    return '' +
      '<div class="checklist-item" data-req-id="' + escapeHtml(item.requirement_id) + '" data-doc-type="' + escapeHtml(item.document_type) + '" style="' + (isTemplate ? 'background:#fff;border-radius:8px;padding:12px;margin-bottom:8px;border:1px solid #bae6fd;' : '') + '">' +
        '<div class="checklist-item-header">' +
          '<div>' +
            '<div class="doc-title">' + escapeHtml(item.document_type) + '</div>' +
            (item.template_url ? '<div style="margin:4px 0 2px 0"><a href="' + escapeHtml(item.template_url) + '" target="_blank" download style="display:inline-flex;align-items:center;gap:4px;font-size:12px;color:#0284c7;font-weight:600;text-decoration:none">📥 Завантажити чистий бланк PDF</a></div>' : '') +
            (item.condition_note ? '<div class="doc-note">' + escapeHtml(item.condition_note) + '</div>' : '') +
          '</div>' +
          '<div>' +
            (isVerified ? '<span class="badge badge-success">✓ Перевірено</span>' :
             hasDoc ? '<span class="badge badge-stage">⏳ На перевірці</span>' :
             isTemplate && !item.is_required ? '<span class="badge badge-stage" style="background:#e2e8f0;color:#475569">Якщо є шаблони</span>' :
             '<span class="badge badge-warning">Потрібно надати</span>') +
          '</div>' +
        '</div>' +

        (hasDoc ? '' +
          '<div class="uploaded-info">' +
            '<span>📄 ' + escapeHtml(item.file_name || 'Файл збережено') + '</span>' +
            (!isVerified ? '' +
              '<label class="upload-btn-label" style="background:transparent;color:#0284c7;border:1px solid #cbd5e1;padding:3px 8px;font-size:11px;margin:0 0 0 8px">' +
                '<span class="upload-btn-text">Замінити</span>' +
                '<input type="file" accept="' + acceptTypes + '"' + captureAttr + ' data-upload-input data-type="' + escapeHtml(item.document_type) + '" data-req="' + escapeHtml(item.requirement_id) + '">' +
              '</label>' :
              '<span style="font-size:11px;color:#16a34a;margin-left:8px;font-weight:600">🔒 Підтверджено</span>') +
          '</div>' :
          '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px">' +
            '<label class="upload-btn-label">' +
              '<span class="upload-btn-text">' + btnLabel + '</span>' +
              '<input type="file" accept="' + acceptTypes + '"' + captureAttr + ' data-upload-input data-type="' + escapeHtml(item.document_type) + '" data-req="' + escapeHtml(item.requirement_id) + '">' +
            '</label>' +
            '<span class="drag-hint">або перетягніть файл сюди</span>' +
          '</div>') +
      '</div>';
  }

  async function uploadFile(file, reqId, docType, sourceElement){
    if(!file || !caseData) return;
    const candId = caseData.candidate.id;

    const parentLabel = sourceElement ? (sourceElement.closest ? sourceElement.closest('label') : null) : null;
    const btnText = parentLabel ? parentLabel.querySelector('.upload-btn-text') : null;
    const oldText = btnText ? btnText.textContent : 'Завантажити';
    if(btnText) btnText.textContent = '⏳ Завантажуємо…';
    if(parentLabel){
      parentLabel.style.opacity = '0.7';
      parentLabel.style.pointerEvents = 'none';
    }

    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = candId + '/portal/' + Date.now() + '_' + safeName;

      // 1. Upload to Supabase Storage
      const uploadRes = await supabase.storage
        .from('candidate-documents')
        .upload(storagePath, file, { cacheControl: '3600', upsert: true });

      if(uploadRes.error) throw uploadRes.error;

      // 2. Record document in CRM database via RPC
      const rpcRes = await supabase.rpc('crm_portal_submit_document', {
        p_token: token,
        p_document_type: docType,
        p_file_name: file.name,
        p_file_size: file.size,
        p_mime_type: file.type || 'image/jpeg',
        p_storage_path: storagePath,
        p_requirement_id: reqId || null
      });

      if(rpcRes.error) throw rpcRes.error;

      await loadCase();
    } catch(err){
      alert('Помилка завантаження файлу: ' + (err.message || err));
      if(btnText) btnText.textContent = oldText;
      if(parentLabel){
        parentLabel.style.opacity = '1';
        parentLabel.style.pointerEvents = 'auto';
      }
    }
  }

  function attachEvents(){
    app.querySelectorAll('[data-filter]').forEach(btn => {
      btn.onclick = () => {
        currentFilter = btn.dataset.filter;
        renderPortal();
      };
    });

    const copyBtn = app.querySelector('[data-copy-link]');
    if(copyBtn){
      copyBtn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(window.location.href);
          copyBtn.textContent = '✓ Посилання скопійовано!';
          setTimeout(() => { copyBtn.textContent = '📋 Скопіювати посилання'; }, 2000);
        } catch(_) {
          prompt('Скопіюйте посилання на кабінет:', window.location.href);
        }
      };
    }

    app.querySelectorAll('[data-upload-input]').forEach(input => {
      input.onchange = async () => {
        const file = input.files?.[0];
        if(!file) return;
        await uploadFile(file, input.dataset.req, input.dataset.type, input);
      };
    });

    // Drag and Drop на десктопі
    if(isDesktop){
      app.querySelectorAll('.checklist-item').forEach(itemEl => {
        const reqId = itemEl.dataset.reqId;
        const docType = itemEl.dataset.docType;

        itemEl.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.stopPropagation();
          itemEl.classList.add('drag-over');
        });

        itemEl.addEventListener('dragleave', (e) => {
          e.preventDefault();
          e.stopPropagation();
          itemEl.classList.remove('drag-over');
        });

        itemEl.addEventListener('drop', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          itemEl.classList.remove('drag-over');

          const files = e.dataTransfer?.files;
          if(files && files.length > 0){
            await uploadFile(files[0], reqId, docType, itemEl);
          }
        });
      });
    }

    const extraInput = app.querySelector('#extraDocInput');
    if(extraInput){
      extraInput.onchange = async () => {
        const file = extraInput.files?.[0];
        if(!file) return;
        const select = app.querySelector('#extraDocType');
        const docType = select ? select.value : 'Інший документ';
        await uploadFile(file, null, docType, extraInput);
      };
    }
  }

  loadCase();
})();
