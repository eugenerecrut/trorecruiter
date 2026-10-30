// PSK_RECRUTER CRM — Клієнтська логіка Кабінету кандидата
(function(){
  'use strict';

  const SUPABASE_URL = 'https://vhfysipxorlhuiaatxqi.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_o8ZTKE4Ek0m58zq1q0QpFQ_domIX0Yz';
  const supabase = window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY);

  const app = document.getElementById('portalApp');
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');

  let currentFilter = 'missing'; // 'all', 'missing', 'uploaded'
  let caseData = null;

  function escapeHtml(str){
    return String(str??'').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }

  function renderError(message){
    app.innerHTML = '' +
      '<div class="card" style="text-align:center;padding:40px 20px">' +
        '<div style="font-size:40px;margin-bottom:12px">🔒</div>' +
        '<h2 style="font-size:18px;margin:0 0 8px 0;color:#0f172a">Доступ до кабінету обмежено</h2>' +
        '<p style="font-size:13px;color:#64748b;margin:0 0 20px 0">' + escapeHtml(message) + '</p>' +
        '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;font-size:12px;color:#475569">' +
          'Зверніться, будь ласка, до Вашого рекрутера для отримання актуального посилання.' +
        '</div>' +
      '</div>';
  }

  async function loadCase(){
    if(!token){
      renderError('У посиланні відсутній ключ доступу. Перевірте правильність переходу або зверніться до рекрутера.');
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

    app.innerHTML = '' +
      '<header class="portal-header">' +
        '<div class="portal-brand">' +
          '<div class="portal-brand-badge">PSK</div>' +
          '<div class="portal-brand-title">Особистий кабінет кандидата</div>' +
        '</div>' +
        '<div style="font-size:12px;color:#64748b;font-weight:600">ЗСУ / ТрО</div>' +
      '</header>' +

      '<div class="card">' +
        '<div class="candidate-card-top">' +
          '<h1 class="candidate-name">' + escapeHtml(c.name) + '</h1>' +
          '<div class="candidate-meta">' +
            '<span class="badge badge-stage">' + escapeHtml(c.stage) + '</span>' +
            '<span class="badge badge-service">' + escapeHtml(c.service_type || 'За контрактом') + '</span>' +
            '<span>В/ч: <b>' + escapeHtml(c.military_unit) + '</b></span>' +
          '</div>' +
          '<div style="font-size:12px;color:#475569;margin-top:4px">' +
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

      '<div class="section-title">' +
        '<span>Необхідні документи</span>' +
        '<small style="font-size:12px;color:#64748b;font-weight:normal">' + escapeHtml(c.service_type || 'За контрактом') + '</small>' +
      '</div>' +

      '<div class="filter-tabs">' +
        '<button type="button" class="tab-btn ' + (currentFilter === 'missing' ? 'active' : '') + '" data-filter="missing">Потрібно надати (' + (stats.total - stats.uploaded) + ')</button>' +
        '<button type="button" class="tab-btn ' + (currentFilter === 'uploaded' ? 'active' : '') + '" data-filter="uploaded">Завантажені (' + stats.uploaded + ')</button>' +
        '<button type="button" class="tab-btn ' + (currentFilter === 'all' ? 'active' : '') + '" data-filter="all">Усі (' + stats.total + ')</button>' +
      '</div>' +

      '<div class="card" style="padding:4px 16px">' +
        (filteredItems.length === 0 ? '' +
          '<div style="text-align:center;padding:24px 10px;color:#64748b;font-size:13px">' +
            (currentFilter === 'missing' ? '🎉 Усі обов’язкові документи завантажено! Рекрутер перевіряє Вашу справу.' : 'Немає документів у цьому списку.') +
          '</div>' : '') +
        filteredItems.map(it => renderChecklistItem(it, c.id)).join('') +
      '</div>' +

      '<details class="card" style="padding:12px 16px;margin-top:14px">' +
        '<summary style="font-size:13px;font-weight:700;color:#0284c7;cursor:pointer">＋ Надіслати додатковий документ</summary>' +
        '<div style="margin-top:12px">' +
          '<p style="font-size:12px;color:#64748b;margin:0 0 10px 0">Якщо у Вас є водійське посвідчення, посвідчення УБД або інші додаткові довідки, Ви можете завантажити їх сюди:</p>' +
          '<select id="extraDocType" style="padding:8px 10px;border-radius:8px;border:1px solid #cbd5e1;font-size:13px;width:100%;margin-bottom:10px;background:#fff">' +
            '<option value="Копія посвідчення водія / інші посвідчення">Посвідчення водія</option>' +
            '<option value="Копія УБД">Посвідчення УБД</option>' +
            '<option value="Свідоцтво про зміну імені / прізвища">Свідоцтво про зміну імені / прізвища</option>' +
            '<option value="Копія свідоцтва про шлюб">Свідоцтво про шлюб</option>' +
            '<option value="Копія свідоцтва про народження дітей">Свідоцтво про народження дитини</option>' +
            '<option value="Інший документ">Інший документ / довідка</option>' +
          '</select>' +
          '<label class="upload-btn-label" style="text-align:center;display:block">' +
            '<span class="upload-btn-text">📷 Сфотографувати / Завантажити</span>' +
            '<input type="file" accept="image/*,application/pdf" capture="environment" id="extraDocInput">' +
          '</label>' +
        '</div>' +
      '</details>' +

      '<div class="tip-box">' +
        '<b>💡 Як зробити якісне фото документа:</b>' +
        '<ul style="margin:6px 0 0;padding-left:18px">' +
          '<li>Фотографуйте при денному світлі, тримаючи телефон рівно над документом.</li>' +
          '<li>Усі 4 кути документа мають бути чітко видно в кадрі.</li>' +
          '<li>Уникайте відблисків спалаху на глянцевих сторінках.</li>' +
        '</ul>' +
      '</div>';

    attachEvents();
  }

  function renderChecklistItem(item, candidateId){
    const hasDoc = item.has_document;
    const isVerified = item.status === 'Підтверджено' || item.status === 'verified';

    return '' +
      '<div class="checklist-item" data-req-id="' + escapeHtml(item.requirement_id) + '">' +
        '<div class="checklist-item-header">' +
          '<div>' +
            '<div class="doc-title">' + escapeHtml(item.document_type) + '</div>' +
            (item.condition_note ? '<div class="doc-note">' + escapeHtml(item.condition_note) + '</div>' : '') +
          '</div>' +
          '<div>' +
            (isVerified ? '<span class="badge badge-success">✓ Перевірено</span>' :
             hasDoc ? '<span class="badge badge-stage">⏳ На перевірці</span>' :
             '<span class="badge badge-warning">Потрібно надати</span>') +
          '</div>' +
        '</div>' +

        (hasDoc ? '' +
          '<div class="uploaded-info">' +
            '<span>📄 ' + escapeHtml(item.file_name || 'Файл збережено') + '</span>' +
            '<label class="upload-btn-label" style="background:transparent;color:#0284c7;border:1px solid #cbd5e1;padding:3px 8px;font-size:11px;margin:0 0 0 8px">' +
              '<span class="upload-btn-text">Замінити</span>' +
              '<input type="file" accept="image/*,application/pdf" capture="environment" data-upload-input data-type="' + escapeHtml(item.document_type) + '" data-req="' + escapeHtml(item.requirement_id) + '">' +
            '</label>' +
          '</div>' :
          '<label class="upload-btn-label">' +
            '<span class="upload-btn-text">📷 Сфотографувати / Завантажити</span>' +
            '<input type="file" accept="image/*,application/pdf" capture="environment" data-upload-input data-type="' + escapeHtml(item.document_type) + '" data-req="' + escapeHtml(item.requirement_id) + '">' +
          '</label>') +
      '</div>';
  }

  function attachEvents(){
    app.querySelectorAll('[data-filter]').forEach(btn => {
      btn.onclick = () => {
        currentFilter = btn.dataset.filter;
        renderPortal();
      };
    });

    app.querySelectorAll('[data-upload-input]').forEach(input => {
      input.onchange = async () => {
        const file = input.files?.[0];
        if(!file) return;

        const reqId = input.dataset.req;
        const docType = input.dataset.type;
        const candId = caseData.candidate.id;

        const parentLabel = input.closest('label');
        const btnText = parentLabel ? parentLabel.querySelector('.upload-btn-text') : null;
        const oldText = btnText ? btnText.textContent : 'Завантажити';
        if (btnText) btnText.textContent = '⏳ Завантажуємо…';
        if (parentLabel) {
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

          // 2. Call RPC to record document
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

          // 3. Reload case data and re-render
          await loadCase();
        } catch(err){
          alert('Помилка завантаження файлу: ' + (err.message || err));
          if (btnText) btnText.textContent = oldText;
          if (parentLabel) {
            parentLabel.style.opacity = '1';
            parentLabel.style.pointerEvents = 'auto';
          }
        }
      };
    });

    const extraInput = app.querySelector('#extraDocInput');
    if (extraInput) {
      extraInput.onchange = async () => {
        const file = extraInput.files?.[0];
        if (!file) return;

        const select = app.querySelector('#extraDocType');
        const docType = select ? select.value : 'Інший документ';
        const candId = caseData.candidate.id;

        const parentLabel = extraInput.closest('label');
        const btnText = parentLabel ? parentLabel.querySelector('.upload-btn-text') : null;
        const oldText = btnText ? btnText.textContent : 'Завантажити';
        if (btnText) btnText.textContent = '⏳ Завантажуємо…';
        if (parentLabel) {
          parentLabel.style.opacity = '0.7';
          parentLabel.style.pointerEvents = 'none';
        }

        try {
          const cleanName = (file.name || 'document').replace(/[^\w.-]/g, '_');
          const storagePath = `${candId}/portal/${Date.now()}_${cleanName}`;

          const uploadRes = await supabase.storage
            .from('candidate-documents')
            .upload(storagePath, file, { cacheControl: '3600', upsert: true });

          if (uploadRes.error) throw uploadRes.error;

          const rpcRes = await supabase.rpc('crm_portal_submit_document', {
            p_token: token,
            p_document_type: docType,
            p_file_name: file.name,
            p_file_size: file.size,
            p_mime_type: file.type || 'image/jpeg',
            p_storage_path: storagePath,
            p_requirement_id: null
          });

          if (rpcRes.error) throw rpcRes.error;

          await loadCase();
        } catch (err) {
          alert('Помилка завантаження файлу: ' + (err.message || err));
          if (btnText) btnText.textContent = oldText;
          if (parentLabel) {
            parentLabel.style.opacity = '1';
            parentLabel.style.pointerEvents = 'auto';
          }
        }
      };
    }
  }

  loadCase();
})();
