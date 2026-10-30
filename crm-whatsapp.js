// PSK_RECRUTER CRM — Інтеграція WhatsApp
// Забезпечує швидкий перехід у WhatsApp Web (wa.me), шаблони повідомлень, історію діалогів, шлюз Green API та прив’язку файлів.
(function(root){
  'use strict';

  function getSupabase(){
    if(typeof supabaseClient !== 'undefined') return supabaseClient;
    if(typeof window !== 'undefined' && window.supabaseClient) return window.supabaseClient;
    return null;
  }

  function cleanDigits(phone){
    const digits = String(phone||'').replace(/\D/g,'');
    if(!digits) return '';
    if(digits.length===10 && digits.startsWith('0')) return '38' + digits;
    if(digits.length===9) return '380' + digits;
    if(digits.length===12 && digits.startsWith('380')) return digits;
    return digits;
  }

  function getCandidateName(cand){
    const nom = String(cand.name_nominative || cand.full_name || '').trim();
    if(!nom) return 'Шановний кандидате';
    const parts = nom.split(/\s+/);
    if(parts.length >= 2){
      return parts[1];
    }
    return parts[0];
  }

  const standardTemplates = [
    {
      id: 'docs_all',
      title: '📋 Перелік документів для особової справи',
      build: function(cand) {
        const name = getCandidateName(cand);
        return 'Доброго дня, ' + name + '! Вас вітає рекрутинговий центр.\n\n' +
          'Для формування особової справи військовослужбовця просимо надіслати якісні фото або скан-копії таких документів:\n' +
          '1. Паспорт громадянина України (усі сторінки з відмітками або обидва боки ID-картки разом із витягом про місце проживання)\n' +
          '2. РНОКПП (довідка про присвоєння ідентифікаційного коду)\n' +
          '3. Документи про освіту (атестат, диплом та додатки з оцінками)\n' +
          '4. Військово-обліковий документ (військовий квиток, тимчасове посвідчення або посвідчення приписки — за наявності)\n' +
          '5. Свідоцтво про народження\n' +
          '6. Свідоцтва про одруження / розірвання шлюбу, народження дітей (за наявності)\n' +
          '7. Фотокартка 3х4 (4 шт. або якісне чітке фото обличчя на світлому однорідному фоні)\n' +
          '8. Витяг про несудимість (можна сформувати за 1 хвилину у застосунку Дія).\n\n' +
          'Фотографуйте, будь ласка, при денному світлі, тримаючи телефон рівно над документом, без обрізаних кутів і відблисків спалаху.';
      }
    },
    {
      id: 'docs_missing',
      title: '⏳ Залишок відсутніх документів',
      build: function(cand, extra) {
        const name = getCandidateName(cand);
        const missing = Array.isArray(extra?.missingDocs) && extra.missingDocs.length
          ? extra.missingDocs.map((d, i) => (i + 1) + '. ' + d).join('\n')
          : 'документи, які ми обговорювали';
        return 'Доброго дня, ' + name + '!\n\n' +
          'Нагадуємо про необхідність надіслати документи для завершення оформлення особової справи:\n' +
          missing + '\n\n' +
          'Ви можете надіслати їх прямо у цей чат WhatsApp фотографією або файлом PDF.';
      }
    },
    {
      id: 'invite_vlk',
      title: '🏥 Запрошення на співбесіду / ВЛК',
      build: function(cand) {
        const name = getCandidateName(cand);
        return 'Доброго дня, ' + name + '!\n\n' +
          'Запрошуємо Вас для проходження військово-лікарської комісії (ВЛК) та співбесіди.\n' +
          'При собі обов’язково мати оригінали документів:\n' +
          '- Паспорт або ID-картку\n' +
          '- Довідку про РНОКПП (код)\n' +
          '- Військово-обліковий документ (за наявності)\n' +
          '- Медичні довідки / виписки (за наявності хронічних захворювань).\n\n' +
          'У разі запитань чи уточнення часу зустрічі — пишіть або телефонуйте за цим номером.';
      }
    },
    {
      id: 'intro',
      title: '👋 Перший контакт рекрутера',
      build: function(cand) {
        const name = getCandidateName(cand);
        return 'Доброго дня, ' + name + '! Я Ваш відповідальний рекрутер з приводу оформлення на військову службу.\n\n' +
          'Звертаюся, щоб обговорити етапи оформлення та відповісти на всі Ваші запитання. Якщо Вам зручно вести переписку у WhatsApp — підтвердіть, будь ласка, отримання повідомлення.';
      }
    }
  ];

  function openWaMe(phone, text){
    const digits = cleanDigits(phone);
    if(!digits) {
      alert('Номер телефону не вказано або він має некоректний формат.');
      return;
    }
    const url = 'https://wa.me/' + digits + (text ? '?text=' + encodeURIComponent(text) : '');
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function getMissingDocumentsList(cand, documents, requirements){
    if(root.CRMDocumentState?.summary){
      const sum = root.CRMDocumentState.summary(cand, requirements||[], documents||[]);
      if(sum && Array.isArray(sum.missingLabels) && sum.missingLabels.length){
        return sum.missingLabels;
      }
    }
    if(Array.isArray(requirements) && Array.isArray(documents)){
      const existingTypes = new Set(documents.filter(d=>!d.deleted_at).map(d=>d.document_type));
      return requirements
        .filter(r => r.required && !existingTypes.has(r.document_type))
        .map(r => r.document_type);
    }
    return [];
  }

  async function getWhatsAppSettings(){
    const sb = getSupabase();
    if(!sb) return null;
    try {
      const { data } = await sb.from('whatsapp_settings').select('*').eq('id', 'default').maybeSingle();
      return data;
    } catch(e) {
      return null;
    }
  }

  function openSettingsModal(){
    const dialog = document.createElement('dialog');
    dialog.className = 'crm-dialog crm-whatsapp-settings-dialog';
    dialog.style.maxWidth = '620px';
    dialog.style.width = '95%';

    const webhookUrl = 'https://vhfysipxorlhuiaatxqi.supabase.co/functions/v1/whatsapp-webhook';

    dialog.innerHTML = '' +
      '<div class="crm-dialog-header" style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e2e8f0;padding-bottom:12px;margin-bottom:14px">' +
        '<div style="display:flex;align-items:center;gap:10px">' +
          '<span style="font-size:22px">⚙️</span>' +
          '<div>' +
            '<h3 style="margin:0;font-size:16px">Підключення WhatsApp до CRM</h3>' +
            '<small style="color:#64748b">Налаштування шлюзу для двостороннього чату та автоприйому документів</small>' +
          '</div>' +
        '</div>' +
        '<button type="button" class="btn secondary" data-settings-close style="padding:4px 8px;font-size:16px">✕</button>' +
      '</div>' +

      '<div style="font-size:13px;line-height:1.5;color:#334155;margin-bottom:16px">' +
        '<p style="margin:0 0 10px 0"><b>Як підключити робочий номер WhatsApp рекрутера:</b></p>' +
        '<ol style="margin:0 0 12px 0;padding-left:20px;display:flex;flex-direction:column;gap:6px">' +
          '<li>Зареєструйтеся безкоштовно на шлюзі <b>Green API</b> (<a href="https://green-api.com" target="_blank" style="color:#0284c7;font-weight:600">green-api.com</a>) та створіть тестовий/робочий інстанс.</li>' +
          '<li>У кабінеті Green API відскануйте QR-код за допомогою WhatsApp на телефоні (<i>Налаштування → Пов’язані пристрої → Прив’язати пристрій</i>).</li>' +
          '<li>У налаштуваннях інстансу Green API (розділ <b>Webhook</b>) увімкніть вебхуки та вставте цю URL-адресу:</li>' +
        '</ol>' +

        '<div style="background:#f1f5f9;border:1px solid #cbd5e1;border-radius:6px;padding:8px 12px;display:flex;align-items:center;gap:8px;margin-bottom:14px">' +
          '<code style="flex:1;font-size:11px;word-break:break-all;color:#0f172a">' + webhookUrl + '</code>' +
          '<button type="button" class="btn secondary" data-copy-webhook style="font-size:12px;padding:4px 8px;white-space:nowrap">Копіювати</button>' +
        '</div>' +

        '<p style="margin:0 0 10px 0"><b>Параметри шлюзу Green API для прямої відправки з CRM (опціонально):</b></p>' +
        '<div style="display:flex;flex-direction:column;gap:10px">' +
          '<label style="display:block">' +
            '<span style="font-size:12px;font-weight:600;color:#475569">IdInstance (наприклад, 11018...):</span>' +
            '<input type="text" data-settings-instance style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid #cbd5e1;border-radius:6px;margin-top:3px">' +
          '</label>' +
          '<label style="display:block">' +
            '<span style="font-size:12px;font-weight:600;color:#475569">ApiTokenInstance:</span>' +
            '<input type="text" data-settings-token style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid #cbd5e1;border-radius:6px;margin-top:3px">' +
          '</label>' +
        '</div>' +
      '</div>' +

      '<div style="display:flex;align-items:center;justify-content:space-between;border-top:1px solid #e2e8f0;padding-top:12px">' +
        '<span data-settings-status style="font-size:12px;color:#16a34a"></span>' +
        '<div style="display:flex;gap:8px">' +
          '<button type="button" class="btn secondary" data-settings-close>Закрити</button>' +
          '<button type="button" class="btn primary" data-settings-save style="background:#0284c7;color:#fff">Зберегти налаштування</button>' +
        '</div>' +
      '</div>';

    document.body.append(dialog);
    dialog.showModal();

    const closeBtn = dialog.querySelectorAll('[data-settings-close]');
    closeBtn.forEach(b => b.onclick = () => { dialog.close(); dialog.remove(); });

    dialog.querySelector('[data-copy-webhook]').onclick = async () => {
      try {
        await navigator.clipboard.writeText(webhookUrl);
        const btn = dialog.querySelector('[data-copy-webhook]');
        btn.textContent = '✓ Скопійовано';
        setTimeout(() => { btn.textContent = 'Копіювати'; }, 1500);
      } catch(e) {}
    };

    // Load existing settings
    getWhatsAppSettings().then(st => {
      if(st){
        if(st.instance_id) dialog.querySelector('[data-settings-instance]').value = st.instance_id;
        if(st.api_token) dialog.querySelector('[data-settings-token]').value = st.api_token;
      }
    });

    dialog.querySelector('[data-settings-save]').onclick = async () => {
      const sb = getSupabase();
      if(!sb){ alert('Помилка підключення Supabase'); return; }
      const instance = dialog.querySelector('[data-settings-instance]').value.trim();
      const token = dialog.querySelector('[data-settings-token]').value.trim();
      const statusEl = dialog.querySelector('[data-settings-status]');
      statusEl.textContent = 'Зберігаємо…';
      try {
        await sb.from('whatsapp_settings').upsert({
          id: 'default',
          provider: 'green_api',
          instance_id: instance || null,
          api_token: token || null,
          is_active: Boolean(instance && token),
          updated_at: new Date().toISOString()
        });
        statusEl.textContent = '✓ Збережено успішно!';
        setTimeout(() => { dialog.close(); dialog.remove(); }, 1200);
      } catch(e) {
        statusEl.textContent = 'Помилка: ' + e.message;
      }
    };
  }

  function openTemplateModal(cand, phoneOverride, documents, requirements){
    const targetPhone = phoneOverride || cand.phone || cand.profile_data?.phone_secondary;
    if(!targetPhone){
      alert('У кандидата немає збереженого номера телефону для зв’язку через WhatsApp.');
      return;
    }
    const missingDocs = getMissingDocumentsList(cand, documents, requirements);

    const dialog = document.createElement('dialog');
    dialog.className = 'crm-dialog crm-whatsapp-dialog';
    dialog.style.maxWidth = '640px';
    dialog.style.width = '95%';

    let currentTemplateId = 'docs_all';

    function render(){
      const candName = String(cand.name_nominative || cand.full_name || 'Кандидат');
      dialog.innerHTML = '' +
        '<div class="crm-dialog-header" style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e2e8f0;padding-bottom:12px;margin-bottom:16px">' +
          '<div style="display:flex;align-items:center;gap:10px">' +
            '<span style="display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;background:#25D366;color:#fff;border-radius:50%;font-size:20px;font-weight:bold">W</span>' +
            '<div>' +
              '<h3 style="margin:0;font-size:17px">Повідомлення у WhatsApp</h3>' +
              '<small style="color:#64748b">' + escapeHtml(candName) + ' · ' + escapeHtml(targetPhone) + '</small>' +
            '</div>' +
          '</div>' +
          '<button type="button" class="btn secondary" data-wa-close style="padding:4px 10px;font-size:18px;line-height:1">✕</button>' +
        '</div>' +

        '<div style="margin-bottom:14px">' +
          '<label style="display:block;font-size:12px;font-weight:600;color:#475569;margin-bottom:6px">Оберіть шаблон повідомлення:</label>' +
          '<div style="display:flex;flex-direction:column;gap:6px">' +
            standardTemplates.map(t =>
              '<label style="display:flex;align-items:center;gap:8px;padding:6px 10px;border:1px solid ' + (t.id === currentTemplateId ? '#25D366' : '#cbd5e1') + ';background:' + (t.id === currentTemplateId ? '#f0fdf4' : '#fff') + ';border-radius:6px;cursor:pointer">' +
                '<input type="radio" name="wa_tmpl" value="' + t.id + '" ' + (t.id === currentTemplateId ? 'checked' : '') + ' style="accent-color:#25D366">' +
                '<span style="font-size:13px;font-weight:500">' + escapeHtml(t.title) + '</span>' +
              '</label>'
            ).join('') +
          '</div>' +
        '</div>' +

        '<div style="margin-bottom:16px">' +
          '<label style="display:block;font-size:12px;font-weight:600;color:#475569;margin-bottom:6px">Текст повідомлення (можна відредагувати перед відправкою):</label>' +
          '<textarea data-wa-text rows="8" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #cbd5e1;border-radius:6px;font-family:inherit;font-size:13px;line-height:1.45;resize:vertical"></textarea>' +
        '</div>' +

        '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;padding-top:12px;border-top:1px solid #e2e8f0">' +
          '<button type="button" class="btn secondary" data-wa-copy style="font-size:13px">📋 Скопіювати текст</button>' +
          '<div style="display:flex;gap:8px">' +
            '<button type="button" class="btn" data-wa-open-chat style="font-size:13px;background:#0284c7;color:#fff">💬 Відкрити діалог в CRM</button>' +
            '<button type="button" class="btn" data-wa-send style="font-size:13px;background:#25D366;color:#fff;font-weight:600">🚀 Надіслати у WhatsApp (wa.me)</button>' +
          '</div>' +
        '</div>';

      const textarea = dialog.querySelector('[data-wa-text]');
      const tmpl = standardTemplates.find(t => t.id === currentTemplateId) || standardTemplates[0];
      textarea.value = tmpl.build(cand, { missingDocs });

      dialog.querySelectorAll('input[name="wa_tmpl"]').forEach(radio => {
        radio.onchange = () => {
          currentTemplateId = radio.value;
          render();
        };
      });

      dialog.querySelector('[data-wa-close]').onclick = () => { dialog.close(); dialog.remove(); };

      dialog.querySelector('[data-wa-copy]').onclick = async () => {
        try {
          await navigator.clipboard.writeText(textarea.value);
          const btn = dialog.querySelector('[data-wa-copy]');
          const old = btn.textContent;
          btn.textContent = '✓ Скопійовано!';
          setTimeout(() => { btn.textContent = old; }, 1500);
        } catch(e) {
          textarea.select();
          document.execCommand('copy');
        }
      };

      dialog.querySelector('[data-wa-send]').onclick = async () => {
        const text = textarea.value.trim();
        openWaMe(targetPhone, text);
        const sb = getSupabase();
        if(cand.id && sb){
          try {
            await sb.from('whatsapp_messages').insert({
              candidate_id: cand.id,
              phone: cleanDigits(targetPhone),
              direction: 'outbound',
              message_type: 'text',
              content: text,
              status: 'sent'
            });
          } catch(err) {
            console.warn('Could not record outbound whatsapp message:', err);
          }
        }
        dialog.close();
        dialog.remove();
      };

      dialog.querySelector('[data-wa-open-chat]').onclick = () => {
        dialog.close();
        dialog.remove();
        openChatDialog(cand, targetPhone);
      };
    }

    render();
    document.body.append(dialog);
    dialog.showModal();
  }

  async function openChatDialog(cand, phoneOverride){
    const targetPhone = phoneOverride || cand.phone || cand.profile_data?.phone_secondary;
    const digits = cleanDigits(targetPhone);
    const candName = String(cand.name_nominative || cand.full_name || 'Кандидат');

    const dialog = document.createElement('dialog');
    dialog.className = 'crm-dialog crm-whatsapp-chat-dialog';
    dialog.style.maxWidth = '760px';
    dialog.style.width = '95%';
    dialog.style.height = '85vh';
    dialog.style.padding = '0';
    dialog.style.display = 'flex';
    dialog.style.flexDirection = 'column';

    dialog.innerHTML = '' +
      '<div style="background:#075E54;color:#fff;padding:12px 18px;display:flex;align-items:center;justify-content:space-between">' +
        '<div style="display:flex;align-items:center;gap:12px">' +
          '<div style="width:38px;height:38px;border-radius:50%;background:#25D366;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:bold">W</div>' +
          '<div>' +
            '<div style="font-weight:600;font-size:15px">' + escapeHtml(candName) + '</div>' +
            '<small style="opacity:0.85;font-size:12px">' + escapeHtml(targetPhone || 'Немає номера') + '</small>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:8px">' +
          '<button type="button" class="btn" data-chat-settings style="background:rgba(255,255,255,0.18);color:#fff;font-size:12px;padding:5px 9px;border:none" title="Налаштування шлюзу та вебхука">⚙️ Підключення</button>' +
          '<button type="button" class="btn" data-chat-wame style="background:rgba(255,255,255,0.22);color:#fff;font-size:12px;padding:5px 10px;border:none">Відкрити wa.me</button>' +
          '<button type="button" data-chat-close style="background:transparent;border:none;color:#fff;font-size:20px;cursor:pointer;padding:4px 8px">✕</button>' +
        '</div>' +
      '</div>' +

      '<div data-chat-body style="flex:1;background:#EFEAE2;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px">' +
        '<div style="text-align:center;color:#64748b;font-size:12px">Завантаження повідомлень WhatsApp…</div>' +
      '</div>' +

      '<div style="background:#f0f2f5;padding:10px 14px;border-top:1px solid #d1d7db;display:flex;flex-direction:column;gap:8px">' +
        '<div style="display:flex;align-items:center;justify-content:space-between">' +
          '<button type="button" data-chat-templates style="background:none;border:none;color:#008069;font-size:12px;cursor:pointer;font-weight:500;padding:2px 0">⚡ Вставити готовий шаблон</button>' +
          '<small style="color:#64748b;font-size:11px">Повідомлення зберігаються у справі кандидата</small>' +
        '</div>' +
        '<div style="display:flex;gap:8px">' +
          '<textarea data-chat-input placeholder="Введіть повідомлення для кандидата…" rows="2" style="flex:1;padding:8px 12px;border:1px solid #ccd0d5;border-radius:8px;font-family:inherit;font-size:13px;resize:none"></textarea>' +
          '<button type="button" data-chat-send style="background:#008069;color:#fff;border:none;border-radius:8px;padding:0 18px;font-weight:600;cursor:pointer">Надіслати</button>' +
        '</div>' +
      '</div>';

    document.body.append(dialog);
    dialog.showModal();

    const body = dialog.querySelector('[data-chat-body]');
    const input = dialog.querySelector('[data-chat-input]');
    const closeBtn = dialog.querySelector('[data-chat-close]');

    closeBtn.onclick = () => { dialog.close(); dialog.remove(); };
    dialog.addEventListener('cancel', () => { dialog.close(); dialog.remove(); });

    dialog.querySelector('[data-chat-settings]').onclick = () => {
      openSettingsModal();
    };

    dialog.querySelector('[data-chat-wame]').onclick = () => {
      openWaMe(targetPhone, input.value.trim());
    };

    dialog.querySelector('[data-chat-templates]').onclick = () => {
      openTemplateModal(cand, targetPhone);
      dialog.close();
      dialog.remove();
    };

    async function loadMessages(){
      const sb = getSupabase();
      if(!sb) {
        body.innerHTML = '<div style="text-align:center;color:#64748b;padding:20px">Клієнт Supabase ініціалізується… Будь ласка, оновіть картку.</div>';
        return;
      }
      try {
        let query = sb.from('whatsapp_messages').select('*');
        if(cand.id && digits) {
          query = query.or('candidate_id.eq.' + cand.id + ',phone.eq.' + digits);
        } else if(cand.id) {
          query = query.eq('candidate_id', cand.id);
        } else if(digits) {
          query = query.eq('phone', digits);
        }
        const { data, error } = await query.order('created_at', { ascending: true });
        if(error) throw error;

        if(!data || !data.length){
          body.innerHTML = '' +
            '<div style="text-align:center;background:#fff;border-radius:10px;padding:18px 20px;margin:24px auto;max-width:440px;box-shadow:0 1px 3px rgba(0,0,0,0.08);line-height:1.5">' +
              '<p style="margin:0 0 8px 0;font-weight:600;font-size:15px;color:#1e293b">💬 Чат WhatsApp готовий до роботи</p>' +
              '<p style="margin:0 0 12px 0;font-size:13px;color:#475569">Ви можете надіслати повідомлення або шаблон кандидату через кнопку <b>«Відкрити wa.me»</b> або ввести текст нижче.</p>' +
              '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px;font-size:12px;color:#64748b;text-align:left">' +
                '💡 <b>Автоматичний прийом документів:</b><br>' +
                'Коли кандидат надсилатиме фото або PDF у WhatsApp, вони автоматично збережуться в цьому чаті та в переліку документів кандидата.' +
              '</div>' +
              '<p style="margin:12px 0 0 0"><button type="button" data-setup-prompt style="background:#0284c7;color:#fff;border:none;border-radius:6px;padding:6px 12px;font-size:12px;cursor:pointer;font-weight:500">⚙️ Як підключити автоматичний шлюз</button></p>' +
            '</div>';

          const setupBtn = body.querySelector('[data-setup-prompt]');
          if(setupBtn) setupBtn.onclick = () => openSettingsModal();
          return;
        }

        body.innerHTML = data.map(msg => {
          const isOut = msg.direction === 'outbound';
          const time = msg.created_at ? new Date(msg.created_at).toLocaleTimeString('uk-UA', {hour:'2-digit',minute:'2-digit'}) : '';
          const hasMedia = msg.media_url || msg.document_id;
          return '' +
            '<div style="display:flex;justify-content:' + (isOut ? 'flex-end' : 'flex-start') + ';margin:3px 0">' +
              '<div style="max-width:75%;padding:8px 12px;border-radius:8px;background:' + (isOut ? '#d9fdd3' : '#fff') + ';box-shadow:0 1px 1px rgba(0,0,0,0.06);position:relative">' +
                (!isOut && msg.sender_name ? '<div style="font-size:11px;font-weight:bold;color:#128c7e;margin-bottom:2px">' + escapeHtml(msg.sender_name) + '</div>' : '') +
                (msg.content ? '<div style="font-size:13px;color:#111b21;white-space:pre-wrap;word-break:break-word">' + escapeHtml(msg.content) + '</div>' : '') +
                (hasMedia ? '' +
                  '<div style="margin-top:6px;padding:6px;background:rgba(0,0,0,0.04);border-radius:6px;display:flex;align-items:center;gap:8px">' +
                    '<span style="font-size:16px">📎</span>' +
                    '<span style="font-size:12px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(msg.file_name || 'Вкладений документ') + '</span>' +
                    (msg.media_url ? '<a href="' + escapeHtml(msg.media_url) + '" target="_blank" style="font-size:11px;color:#0284c7;text-decoration:none;font-weight:600">Переглянути</a>' : '') +
                  '</div>' : '') +
                '<div style="display:flex;align-items:center;justify-content:flex-end;gap:4px;margin-top:3px">' +
                  '<span style="font-size:10px;color:#667781">' + time + '</span>' +
                  (isOut ? '<span style="font-size:11px;color:#53bdeb">✓✓</span>' : '') +
                '</div>' +
              '</div>' +
            '</div>';
        }).join('');

        body.scrollTop = body.scrollHeight;
      } catch(err) {
        body.innerHTML = '<div style="text-align:center;color:#ef4444;padding:16px">Помилка завантаження повідомлень: ' + escapeHtml(err.message) + '</div>';
      }
    }

    dialog.querySelector('[data-chat-send]').onclick = async () => {
      const text = input.value.trim();
      if(!text) return;
      const sb = getSupabase();
      if(!sb) return;

      const sendBtn = dialog.querySelector('[data-chat-send]');
      sendBtn.disabled = true;

      try {
        // Check if Green API gateway is configured for direct send
        const settings = await getWhatsAppSettings();
        let sentViaGateway = false;
        if(settings && settings.is_active && settings.instance_id && settings.api_token && digits) {
          try {
            const gwUrl = 'https://api.green-api.com/waInstance' + settings.instance_id + '/sendMessage/' + settings.api_token;
            const res = await fetch(gwUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chatId: digits + '@c.us', message: text })
            });
            if(res.ok) sentViaGateway = true;
          } catch(gwErr) {
            console.warn('Gateway send error:', gwErr);
          }
        }

        await sb.from('whatsapp_messages').insert({
          candidate_id: cand.id || null,
          phone: digits,
          direction: 'outbound',
          message_type: 'text',
          content: text,
          status: sentViaGateway ? 'delivered' : 'sent'
        });
        input.value = '';
        await loadMessages();

        // If not sent via background gateway, open wa.me
        if(!sentViaGateway) {
          openWaMe(targetPhone, text);
        }
      } catch(err) {
        alert('Помилка відправки повідомлення: ' + err.message);
      } finally {
        sendBtn.disabled = false;
      }
    };

    loadMessages();
  }

  function escapeHtml(str){
    return String(str??'').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }

  root.CRMWhatsApp = {
    cleanDigits,
    templates: standardTemplates,
    openWaMe,
    openTemplateModal,
    openChatDialog,
    openSettingsModal,
    getSupabase
  };

})(typeof window === 'undefined' ? globalThis : window);
