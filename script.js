// PSK_RECRUTER CRM — Supabase data layer
// HelpCrunch is not used.

let pendingRecommendationFile = null;
let pendingRecommendationText = '';

async function getCurrentUser() {
  const { data, error } = await supabaseClient.auth.getUser();
  if (error) {
    console.error('Помилка отримання користувача:', error);
    return null;
  }
  return data.user || null;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function getCount(table) {
  const { count, error } = await supabaseClient
    .from(table)
    .select('*', { count: 'exact', head: true });

  if (error) {
    console.error(`Помилка підрахунку ${table}:`, error);
    return 0;
  }
  return count || 0;
}

async function updateDashboard() {
  const cards = document.querySelectorAll('.card-number');
  if (cards.length < 3) return;

  cards[0].textContent = await getCount('candidates');
  cards[1].textContent = await getCount('personal_files');
  cards[2].textContent = await getCount('documents');
}

async function getCandidates() {
  const { data, error } = await supabaseClient
    .from('candidates')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Помилка завантаження кандидатів:', error);
    return [];
  }
  return data || [];
}

function showCandidates() {
  const content = document.querySelector('.content');
  if (!content) return;

  content.innerHTML = `
    <div class="dashboard-top">
      <div>
        <div class="page-title">Кандидати</div>
        <div class="page-subtitle">База кандидатів PSK_RECRUTER</div>
      </div>
      <div class="quick-actions">
        <button onclick="showNewCandidateForm()">+ Нова особова справа</button>
      </div>
    </div>

    <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap">
      <input id="candidateSearch" placeholder="Пошук за ПІБ, телефоном, посадою" style="flex:1;min-width:260px;padding:12px;border:1px solid #cfd8dc;border-radius:8px;background:#fff;color:#24313a">
      <select id="candidateStatus" style="padding:12px;border-radius:8px;border:1px solid #cfd8dc;background:#fff;color:#24313a">
        <option value="">Всі статуси</option>
        <option>Новий</option>
        <option>Первинний контакт</option>
        <option>Співбесіда</option>
        <option>Перевірка документів</option>
        <option>ВЛК</option>
        <option>Рішення</option>
        <option>Призначений</option>
        <option>Відмова</option>
        <option>Втрачено контакт</option>
        <option>Відкладено</option>
      </select>
    </div>

    <div class="card" style="padding:0;overflow:auto">
      <table style="width:100%;border-collapse:collapse;min-width:820px">
        <thead>
          <tr style="background:#f7f9f9;text-align:left">
            <th style="padding:14px;border-bottom:1px solid #e0e6e8">ПІБ</th>
            <th style="padding:14px;border-bottom:1px solid #e0e6e8">Телефон</th>
            <th style="padding:14px;border-bottom:1px solid #e0e6e8">Бажана посада</th>
            <th style="padding:14px;border-bottom:1px solid #e0e6e8">Напрям</th>
            <th style="padding:14px;border-bottom:1px solid #e0e6e8">Статус</th>
          </tr>
        </thead>
        <tbody id="candidateRows"></tbody>
      </table>
    </div>`;

  async function render() {
    const candidates = await getCandidates();
    const q = document.getElementById('candidateSearch').value.trim().toLowerCase();
    const status = document.getElementById('candidateStatus').value;

    const filtered = candidates.filter(c => {
      const text = [
        c.full_name, c.phone, c.email, c.desired_position, c.direction,
        c.military_rank, c.rnokpp, c.tcc
      ].join(' ').toLowerCase();

      return (!q || text.includes(q)) &&
        (!status || c.recruitment_status === status);
    });

    const rows = document.getElementById('candidateRows');
    rows.innerHTML = filtered.length ? filtered.map(c => `
      <tr style="border-top:1px solid #edf0f1">
        <td style="padding:14px"><b>${escapeHtml(c.full_name || '')}</b></td>
        <td style="padding:14px">${escapeHtml(c.phone || '—')}</td>
        <td style="padding:14px">${escapeHtml(c.desired_position || '—')}</td>
        <td style="padding:14px">${escapeHtml(c.direction || '—')}</td>
        <td style="padding:14px"><span class="status status-new">${escapeHtml(c.recruitment_status || 'Новий')}</span></td>
      </tr>`).join('') : `
      <tr><td colspan="5" style="padding:46px;text-align:center;color:#89969d">Кандидатів поки немає</td></tr>`;
  }

  document.getElementById('candidateSearch').oninput = render;
  document.getElementById('candidateStatus').onchange = render;
  render();
}

function showNewCandidateForm() {
  pendingRecommendationFile = null;
  pendingRecommendationText = '';

  const content = document.querySelector('.content');
  if (!content) return;

  content.innerHTML = `
    <div class="dashboard-top">
      <div>
        <div class="page-title">Нова особова справа</div>
        <div class="page-subtitle">Спочатку завантажте рекомендаційний лист — він є основою для формування справи.</div>
      </div>
      <div class="quick-actions">
        <button onclick="showCandidates()">← Назад до кандидатів</button>
      </div>
    </div>

    <section class="card" style="max-width:1050px">
      <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:18px">
        <div style="width:42px;height:42px;border-radius:11px;background:#e8f2cc;color:#5d741f;display:grid;place-items:center;font-weight:900;font-size:18px">1</div>
        <div>
          <h3 style="margin:0 0 5px;font-size:17px">Рекомендаційний лист</h3>
          <div style="color:#7d8a93;font-size:12px">PDF, JPG, JPEG або PNG. Документ буде збережений у захищеному сховищі.</div>
        </div>
      </div>

      <label for="recommendationFile" style="display:block">
        <div id="uploadZone" style="border:2px dashed #c6d1d6;border-radius:12px;padding:34px 22px;text-align:center;background:#fbfcfc;transition:.15s">
          <div style="font-size:30px;margin-bottom:8px">⇧</div>
          <div style="font-weight:800;color:#34414a">Натисніть, щоб вибрати файл</div>
          <div style="color:#8a969d;font-size:11px;margin-top:5px">або перетягніть документ сюди</div>
          <div id="selectedFile" style="margin-top:13px;color:#5d741f;font-weight:700"></div>
        </div>
      </label>
      <input id="recommendationFile" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" style="display:none">

      <div id="ocrStatus" style="margin-top:15px;color:#68757d;font-size:12px;min-height:18px"></div>

      <div id="ocrResultBox" class="hidden" style="margin-top:15px">
        <div style="font-weight:800;font-size:13px;margin-bottom:7px">Розпізнаний текст</div>
        <textarea id="ocrText" rows="10" style="width:100%;padding:12px;border:1px solid #cfd8dc;border-radius:8px;background:#fff;color:#24313a"></textarea>
        <div style="font-size:11px;color:#89959c;margin-top:6px">Перед створенням справи перевірте текст — OCR може помилятися.</div>
      </div>

      <div id="candidateStage" class="hidden" style="margin-top:24px;border-top:1px solid #e5eaec;padding-top:22px">
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:18px">
          <div style="width:42px;height:42px;border-radius:11px;background:#e8f2cc;color:#5d741f;display:grid;place-items:center;font-weight:900;font-size:18px">2</div>
          <div>
            <h3 style="margin:0 0 5px;font-size:17px">Перевірка даних кандидата</h3>
            <div style="color:#7d8a93;font-size:12px">Перевірте автоматично заповнені поля та доповніть те, чого немає в рекомендаційному листі.</div>
          </div>
        </div>

        <form id="candidateForm" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 16px">
          <div>
            <label>ПІБ *</label>
            <input name="full_name" required placeholder="Прізвище Ім'я По батькові">
          </div>
          <div>
            <label>Дата народження</label>
            <input name="birth_date" type="date">
          </div>
          <div>
            <label>Телефон</label>
            <input name="phone" placeholder="+380...">
          </div>
          <div>
            <label>ІПН / РНОКПП</label>
            <input name="rnokpp">
          </div>
          <div>
            <label>Військове звання</label>
            <input name="military_rank">
          </div>
          <div>
            <label>Військовий статус</label>
            <input name="military_status" placeholder="військовослужбовець / цивільний">
          </div>
          <div>
            <label>ВОС / військова спеціальність</label>
            <input name="military_specialty">
          </div>
          <div>
            <label>Військовий досвід</label>
            <input name="military_experience">
          </div>
          <div>
            <label>Цивільна професія</label>
            <input name="civilian_profession">
          </div>
          <div>
            <label>Бажана посада</label>
            <input name="desired_position">
          </div>
          <div>
            <label>Бажаний підрозділ</label>
            <input name="desired_unit">
          </div>
          <div>
            <label>Район / область</label>
            <input name="region">
          </div>
          <div>
            <label>ТЦК</label>
            <input name="tcc">
          </div>
          <div>
            <label>Статус ВЛК</label>
            <input name="vlk_status" placeholder="не проходив / придатний / уточнення">
          </div>
          <div>
            <label>Рекрутер</label>
            <input name="recruiter_name" placeholder="Заповниться пізніше">
          </div>
          <div>
            <label>Джерело кандидата</label>
            <input name="candidate_source" value="Рекомендаційний лист">
          </div>
          <div style="grid-column:1/-1">
            <label>Примітки</label>
            <textarea name="notes" rows="4" placeholder="Додаткові відомості"></textarea>
          </div>

          <div style="grid-column:1/-1;display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:4px">
            <button type="submit" class="login-button" style="width:auto;margin-top:0">Створити особову справу</button>
            <button type="button" id="cancelCandidate" class="logout">Скасувати</button>
            <span id="saveStatus" style="font-size:12px;color:#68757d"></span>
          </div>
        </form>
      </div>
    </section>`;

  const fileInput = document.getElementById('recommendationFile');
  const uploadZone = document.getElementById('uploadZone');

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) handleRecommendationFile(file);
  });

  uploadZone.addEventListener('dragover', e => {
    e.preventDefault();
    uploadZone.style.borderColor = '#9ebd45';
    uploadZone.style.background = '#f7faed';
  });
  uploadZone.addEventListener('dragleave', () => {
    uploadZone.style.borderColor = '#c6d1d6';
    uploadZone.style.background = '#fbfcfc';
  });
  uploadZone.addEventListener('drop', e => {
    e.preventDefault();
    uploadZone.style.borderColor = '#c6d1d6';
    uploadZone.style.background = '#fbfcfc';
    const file = e.dataTransfer.files?.[0];
    if (file) {
      fileInput.files = e.dataTransfer.files;
      handleRecommendationFile(file);
    }
  });

  document.getElementById('cancelCandidate').onclick = showCandidates;
  document.getElementById('candidateForm').onsubmit = saveCandidateFromRecommendation;
}

async function loadExternalScript(url, testName) {
  if (window[testName]) return;
  await new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-psk-lib="' + testName + '"]');
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.dataset.pskLib = testName;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Не вдалося завантажити бібліотеку OCR.'));
    document.head.appendChild(script);
  });
}

async function pdfToImages(file, maxPages = 5) {
  await loadExternalScript(
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs',
    'pdfjsLib'
  ).catch(async () => {
    await loadExternalScript(
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
      'pdfjsLib'
    );
  });

  const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = Math.min(pdf.numPages, maxPages);
  const images = [];

  for (let i = 1; i <= pages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.8 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    images.push(canvas.toDataURL('image/png'));
  }

  return images;
}

async function extractPdfText(file) {
  try {
    const pdfjsUrl = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    await loadExternalScript(pdfjsUrl, 'pdfjsLib');
    const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    let text = '';
    const pages = Math.min(pdf.numPages, 10);

    for (let i = 1; i <= pages; i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      text += tc.items.map(x => x.str).join(' ') + '\n';
    }
    return text.trim();
  } catch (err) {
    console.warn('Не вдалося прочитати текстовий шар PDF:', err);
    return '';
  }
}

async function runOcr(input) {
  await loadExternalScript(
    'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
    'Tesseract'
  );

  const result = await Tesseract.recognize(input, 'ukr+rus+eng', {
    logger: message => {
      if (message.status === 'recognizing text' && typeof message.progress === 'number') {
        const pct = Math.round(message.progress * 100);
        const box = document.getElementById('ocrStatus');
        if (box) box.textContent = `Розпізнавання документа: ${pct}%...`;
      }
    }
  });

  return result.data.text?.trim() || '';
}

function normalizeText(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\u00a0/g, ' ')
    .trim();
}

function guessDate(value) {
  if (!value) return '';
  const m = value.match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
  if (!m) return '';
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

function guessField(text, patterns) {
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1].trim().replace(/\s+/g, ' ');
  }
  return '';
}

function parseRecommendation(text) {
  const t = normalizeText(text);

  const fullName =
    guessField(t, [
      /(?:ПІБ|П\.\s*І\.\s*Б\.|прізвище\s*,?\s*ім['’]?я\s*,?\s*по\s*батькові)\s*[:\-–]\s*([^\n]{5,80})/iu,
      /(?:громадянин|кандидат)\s+([А-ЯІЇЄҐ][а-яіїєґ'’\-]+\s+[А-ЯІЇЄҐ][а-яіїєґ'’\-]+(?:\s+[А-ЯІЇЄҐ][а-яіїєґ'’\-]+)?)/u
    ]);

  const phone = guessField(t, [
    /(?:тел(?:ефон)?|моб(?:ільний)?|контакт(?:ний)?)\s*[:\-]\s*(\+?\d[\d ()-]{7,})/iu
  ]).replace(/[^+\d]/g, '');

  const rnokpp = guessField(t, [
    /(?:РНОКПП|ІПН|ідентифікацій(?:ний)?\s*(?:номер|код))\s*[:\-]?\s*(\d{10})/iu
  ]).replace(/\D/g, '');

  const birthRaw = guessField(t, [
    /(?:дата\s*народження|народився|народилася)\s*[:\-]?\s*([^\n,;]{8,20})/iu
  ]);

  const rank = guessField(t, [
    /(?:військове\s*звання|звання)\s*[:\-]\s*([^\n,;]{2,60})/iu
  ]);

  const desiredPosition = guessField(t, [
    /(?:бажана\s*посада|посада\s*кандидата|пропонована\s*посада)\s*[:\-]\s*([^\n;]{2,100})/iu
  ]);

  const desiredUnit = guessField(t, [
    /(?:бажаний\s*підрозділ|підрозділ|військова\s*частина)\s*[:\-]\s*([^\n;]{2,100})/iu
  ]);

  const tcc = guessField(t, [
    /(?:ТЦК(?:\s*та\s*СП)?|військкомат)\s*[:\-]\s*([^\n;]{2,100})/iu
  ]);

  const civilian = guessField(t, [
    /(?:цивільна\s*професія|професія|спеціальність)\s*[:\-]\s*([^\n;]{2,100})/iu
  ]);

  const militarySpecialty = guessField(t, [
    /(?:ВОС|військово\s*облікова\s*спеціальність|військова\s*спеціальність)\s*[:\-]\s*([^\n;]{2,100})/iu
  ]);

  const region = guessField(t, [
    /(?:область|район|місце\s*проживання)\s*[:\-]\s*([^\n;]{2,100})/iu
  ]);

  return {
    full_name: fullName,
    phone,
    rnokpp,
    birth_date: guessDate(birthRaw),
    military_rank: rank,
    desired_position: desiredPosition,
    desired_unit: desiredUnit,
    tcc,
    civilian_profession: civilian,
    military_specialty: militarySpecialty,
    region,
    raw_text: t
  };
}

function fillCandidateForm(parsed) {
  const form = document.getElementById('candidateForm');
  if (!form) return;

  Object.entries(parsed).forEach(([name, value]) => {
    const input = form.elements[name];
    if (input && value) input.value = value;
  });

  const text = document.getElementById('ocrText');
  if (text) text.value = parsed.raw_text || pendingRecommendationText || '';
}

async function handleRecommendationFile(file) {
  pendingRecommendationFile = file;
  pendingRecommendationText = '';

  const selected = document.getElementById('selectedFile');
  const status = document.getElementById('ocrStatus');
  if (selected) selected.textContent = `Обрано: ${file.name} • ${Math.round(file.size / 1024)} КБ`;
  if (status) status.textContent = 'Аналізуємо документ...';

  try {
    let text = '';

    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      text = await extractPdfText(file);

      if (!text || text.length < 100) {
        status.textContent = 'PDF — скан. Готуємо сторінки для OCR...';
        const images = await pdfToImages(file, 5);
        const parts = [];

        for (let i = 0; i < images.length; i++) {
          status.textContent = `OCR сторінки ${i + 1} з ${images.length}...`;
          const pageText = await runOcr(images[i]);
          if (pageText) parts.push(pageText);
        }
        text = parts.join('\n\n').trim();
      }
    } else {
      status.textContent = 'Запускаємо OCR зображення...';
      text = await runOcr(file);
    }

    pendingRecommendationText = normalizeText(text);

    const box = document.getElementById('ocrResultBox');
    const stage = document.getElementById('candidateStage');
    if (box) box.classList.remove('hidden');
    if (stage) stage.classList.remove('hidden');

    if (!pendingRecommendationText) {
      status.textContent = 'Текст не вдалося розпізнати. Заповніть дані вручну.';
    } else {
      status.textContent = 'Документ розпізнано. Перевірте поля нижче.';
    }

    const parsed = parseRecommendation(pendingRecommendationText);
    fillCandidateForm(parsed);
  } catch (error) {
    console.error('OCR error:', error);
    status.textContent = 'Не вдалося автоматично розпізнати документ. Його все одно можна зберегти та заповнити дані вручну.';
    document.getElementById('ocrResultBox')?.classList.remove('hidden');
    document.getElementById('candidateStage')?.classList.remove('hidden');
    document.getElementById('ocrText').value = pendingRecommendationText || '';
  }
}

function safeFileName(name) {
  return String(name || 'recommendation').replace(/[^a-zA-Z0-9а-яА-ЯіїєґІЇЄҐ._-]/g, '_');
}

async function uploadRecommendation(candidateId, user) {
  if (!pendingRecommendationFile) return { ok: false, reason: 'Файл не вибрано' };

  const safeName = `${Date.now()}_${safeFileName(pendingRecommendationFile.name)}`;
  const storagePath = `${candidateId}/recommendation/${safeName}`;

  const { error: uploadError } = await supabaseClient
    .storage
    .from('candidate-documents')
    .upload(storagePath, pendingRecommendationFile, {
      upsert: false,
      contentType: pendingRecommendationFile.type || 'application/octet-stream'
    });

  if (uploadError) {
    console.error('Помилка завантаження рекомендаційного листа:', uploadError);
    return { ok: false, reason: uploadError.message };
  }

  const { error: docError } = await supabaseClient
    .from('documents')
    .insert({
      candidate_id: candidateId,
      document_type: 'Рекомендаційний лист',
      document_name: 'Рекомендаційний лист',
      storage_path: storagePath,
      file_name: pendingRecommendationFile.name,
      file_size: pendingRecommendationFile.size,
      mime_type: pendingRecommendationFile.type || null,
      uploaded_by: user.id
    });

  if (docError) {
    console.error('Помилка запису документа:', docError);
    return { ok: false, reason: docError.message };
  }

  return { ok: true, storagePath };
}

async function saveCandidateFromRecommendation(event) {
  event.preventDefault();

  const form = event.target;
  const status = document.getElementById('saveStatus');
  const user = await getCurrentUser();

  if (!user) {
    status.textContent = 'Сесія завершилась. Увійдіть повторно.';
    return;
  }

  const fd = new FormData(form);
  const candidate = {
    full_name: String(fd.get('full_name') || '').trim(),
    phone: String(fd.get('phone') || '').trim() || null,
    email: null,
    birth_date: fd.get('birth_date') || null,
    rnokpp: String(fd.get('rnokpp') || '').trim() || null,
    military_rank: String(fd.get('military_rank') || '').trim() || null,
    military_status: String(fd.get('military_status') || '').trim() || null,
    civilian_profession: String(fd.get('civilian_profession') || '').trim() || null,
    desired_position: String(fd.get('desired_position') || '').trim() || null,
    direction: String(fd.get('desired_unit') || '').trim() || null,
    tcc: String(fd.get('tcc') || '').trim() || null,
    vlk_status: String(fd.get('vlk_status') || '').trim() || null,
    notes: String(fd.get('notes') || '').trim() || null,
    recruitment_status: 'Новий',
    recruiter_id: user.id
  };

  if (!candidate.full_name) {
    status.textContent = 'Потрібно вказати ПІБ.';
    return;
  }

  status.textContent = 'Створюємо кандидата та особову справу...';

  const { data, error } = await supabaseClient
    .from('candidates')
    .insert(candidate)
    .select()
    .single();

  if (error) {
    console.error(error);
    status.textContent = 'Помилка збереження кандидата: ' + error.message;
    return;
  }

  const { error: fileError } = await supabaseClient
    .from('personal_files')
    .insert({
      candidate_id: data.id,
      civilian_experience: String(fd.get('military_experience') || '').trim() || null,
      additional_notes: [
        String(fd.get('military_specialty') || '').trim(),
        String(fd.get('region') || '').trim(),
        String(fd.get('desired_unit') || '').trim()
      ].filter(Boolean).join(' • ') || null
    });

  if (fileError) {
    console.error('Помилка створення особової справи:', fileError);
    status.textContent = 'Кандидата створено, але особову справу не вдалося створити: ' + fileError.message;
    await updateDashboard();
    return;
  }

  if (pendingRecommendationFile) {
    status.textContent = 'Зберігаємо рекомендаційний лист у сховищі...';
    const uploadResult = await uploadRecommendation(data.id, user);

    if (!uploadResult.ok) {
      status.textContent = 'Особову справу створено. Рекомендаційний лист не зберігся: ' + uploadResult.reason;
    } else {
      status.textContent = 'Готово: кандидат, особова справа та рекомендаційний лист збережені.';
    }
  } else {
    status.textContent = 'Кандидата та особову справу створено.';
  }

  await updateDashboard();

  setTimeout(() => {
    showCandidates();
  }, 1100);
}

function setupMenu() {
  document.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.menu-item').forEach(x => x.classList.remove('active'));
      item.classList.add('active');

      const text = item.textContent.trim();
      if (text === 'Головна') location.reload();
      if (text === 'Кандидати') showCandidates();
      if (text === 'Нова особова справа') showNewCandidateForm();
      if (text === 'Документи') alert('Документи будуть доступні в картці кандидата.');
      if (text === 'Пошук') showCandidates();
      if (text === 'Налаштування') alert('Налаштування ролей додамо наступним етапом.');
    });
  });
}

async function startCRM() {
  const user = await getCurrentUser();
  if (!user) return;
  await updateDashboard();
  setupMenu();
}

startCRM();
