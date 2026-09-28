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
      <table style="width:100%;border-collapse:collapse;min-width:920px">
        <thead>
          <tr style="background:#f7f9f9;text-align:left">
            <th style="padding:14px;border-bottom:1px solid #e0e6e8">ПІБ</th>
            <th style="padding:14px;border-bottom:1px solid #e0e6e8">Телефон</th>
            <th style="padding:14px;border-bottom:1px solid #e0e6e8">Бажана посада</th>
            <th style="padding:14px;border-bottom:1px solid #e0e6e8">Напрям</th>
            <th style="padding:14px;border-bottom:1px solid #e0e6e8">Статус</th>
            <th style="padding:14px;border-bottom:1px solid #e0e6e8">Дії</th>
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
        <td style="padding:14px"><b>${escapeHtml(c.name_nominative || c.full_name || '')}</b></td>
        <td style="padding:14px">${escapeHtml(c.phone || '—')}</td>
        <td style="padding:14px">${escapeHtml(c.desired_position || '—')}</td>
        <td style="padding:14px">${escapeHtml(c.direction || '—')}</td>
        <td style="padding:14px"><span class="status status-new">${escapeHtml(c.recruitment_status || 'Новий')}</span></td>
        <td style="padding:14px;white-space:nowrap;display:flex;gap:7px">
          <button type="button" onclick="openCandidateCard('${c.id}')" style="padding:8px 11px;border:1px solid #cfd8dc;border-radius:7px;background:#fff;color:#34414a;font-weight:800;cursor:pointer">↗ Відкрити</button>
          <button type="button" onclick="showDocuments('${c.id}')" style="padding:8px 11px;border:1px solid #cfd8dc;border-radius:7px;background:#fff;color:#34414a;font-weight:800;cursor:pointer">▣ Документи</button>
          <button type="button" onclick="deleteCandidateCase('${c.id}', ${JSON.stringify(c.name_nominative || c.full_name || 'кандидата')})" style="padding:8px 11px;border:1px solid #e2b9b5;border-radius:7px;background:#fff5f4;color:#a23f38;font-weight:800;cursor:pointer">🗑 Видалити</button>
        </td>
      </tr>`).join('') : `
      <tr><td colspan="6" style="padding:46px;text-align:center;color:#89969d">Кандидатів поки немає</td></tr>`;

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
        <div class="page-subtitle">Вихідна точка — рекомендаційний лист. Система робить виборку, а рекрутер підтверджує дані.</div>
      </div>
      <div class="quick-actions">
        <button onclick="showCandidates()">← Назад до кандидатів</button>
      </div>
    </div>

    <section class="card" style="max-width:1120px">
      <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:18px">
        <div style="width:42px;height:42px;border-radius:11px;background:#e8f2cc;color:#5d741f;display:grid;place-items:center;font-weight:900;font-size:18px">1</div>
        <div>
          <h3 style="margin:0 0 5px;font-size:17px">Завантаження рекомендаційного листа</h3>
          <div style="color:#7d8a93;font-size:12px">PDF, JPG, JPEG або PNG. Оригінал після створення справи збережеться у захищеному сховищі.</div>
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

      <div id="extractionBox" class="hidden" style="margin-top:18px">
        <div style="background:#f7faed;border:1px solid #dce8b7;border-radius:12px;padding:18px">
          <div style="font-weight:900;font-size:14px;color:#35421f">Виборка з рекомендаційного листа</div>
          <div style="margin-top:5px;font-size:10px;font-weight:800;color:#708337;letter-spacing:.7px;text-transform:uppercase">Службова інформація для CRM</div>
          <div style="color:#68757d;font-size:11px;margin:4px 0 15px">Система показує лише те, що вдалося знайти в документі. Незаповнені поля не вигадуються.</div>
          <div id="extractionGrid" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 22px"></div>
        </div>
      </div>

      <div id="ocrResultBox" class="hidden" style="margin-top:15px">
        <div style="font-weight:800;font-size:13px;margin-bottom:7px">Розпізнаний текст</div>
        <textarea id="ocrText" rows="8" style="width:100%;padding:12px;border:1px solid #cfd8dc;border-radius:8px;background:#fff;color:#24313a"></textarea>
        <div style="font-size:11px;color:#89959c;margin-top:6px">Текст можна виправити вручну. Він використовується тільки як допоміжний матеріал для виборки.</div>
        <div id="aiWarnings" class="hidden" style="margin-top:12px;padding:11px 13px;border-radius:8px;background:#fff7e6;border:1px solid #efd9aa;color:#7b5b22;font-size:11px;line-height:1.45"></div>
      </div>

      <div id="candidateStage" class="hidden" style="margin-top:24px;border-top:1px solid #e5eaec;padding-top:22px">
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:18px">
          <div style="width:42px;height:42px;border-radius:11px;background:#e8f2cc;color:#5d741f;display:grid;place-items:center;font-weight:900;font-size:18px">2</div>
          <div>
            <h3 style="margin:0 0 5px;font-size:17px">Перевірка та підтвердження даних</h3>
            <div style="color:#7d8a93;font-size:12px">Виправте OCR-помилки або доповніть дані, яких немає у рекомендаційному листі.</div>
          </div>
        </div>

        <form id="candidateForm" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 16px">
          <div><label>ПІБ *</label><input name="full_name" required placeholder="Прізвище Ім'я По батькові"></div>
          <div><label>Дата народження</label><input name="birth_date" type="date"></div>

          <div><label>Телефон</label><input name="phone" placeholder="+380..."></div>
          <div><label>Адреса проживання</label><input name="address" placeholder="Населений пункт, вулиця, будинок, квартира"></div>

          <div><label>Військова частина</label><input name="military_unit"></div>
          <div><label>Підрозділ / центр</label><input name="desired_unit"></div>

          <div style="grid-column:1/-1"><label>Запланована посада</label><input name="desired_position"></div>

          <div><label>ШПК</label><input name="shpk" placeholder="наприклад: солдат"></div>
          <div><label>ВОС</label><input name="military_specialty"></div>

          <div><label>Тарифний розряд</label><input name="tariff_grade"></div>
          <div><label>Вид служби</label><input name="service_type" placeholder="за контрактом"></div>

          <div><label>Рекомендуючий підрозділ</label><input name="recommender_unit"></div>
          <div><label>Підписант</label><input name="signatory"></div>

          <div><label>ІПН / РНОКПП</label><input name="rnokpp"></div>
          <div><label>Військове звання кандидата</label><input name="military_rank"></div>

          <div><label>ТЦК</label><input name="tcc"></div>
          <div><label>Статус ВЛК</label><input name="vlk_status" placeholder="не проходив / придатний / уточнення"></div>

          <div><label>Цивільна професія</label><input name="civilian_profession"></div>
          <div style="grid-column:1/-1;border-top:1px solid #e5eaec;padding-top:18px;margin-top:4px">
            <div style="font-size:11px;font-weight:900;color:#6f8b28;text-transform:uppercase;letter-spacing:.8px;margin-bottom:12px">Службова інформація CRM</div>
          </div>

          <div><label>Рекомендуючий підрозділ</label><input name="recommender_unit"></div>
          <div><label>Рекрутер за рекомендаційним листом</label><input name="recruiter_name"></div>
          <div><label>Підписант РЛ</label><input name="signatory"></div>
          <div><label>Вид служби</label><input name="service_type"></div>
          <div><label>ШПК</label><input name="shpk"></div>
          <div><label>Тарифний розряд</label><input name="tariff_grade"></div>

          <div style="grid-column:1/-1">
            <label>Примітки рекрутера</label>
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
      const lines = {};
      tc.items.forEach(item => {
        const y = Math.round(item.transform?.[5] || 0);
        const key = String(y);
        (lines[key] ||= []).push(item.str);
      });

      const pageLines = Object.entries(lines)
        .sort((a, b) => Number(b[0]) - Number(a[0]))
        .map(([, parts]) => parts.join(' ').replace(/\s+/g, ' ').trim())
        .filter(Boolean);

      text += pageLines.join('\n') + '\n';
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

function normalizeLine(value) {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function normalizeDocumentText(text) {
  return String(text || '')
    .split('\n')
    .map(normalizeLine)
    .filter(Boolean)
    .join('\n');
}

function oneLine(text) {
  return normalizeDocumentText(text).replace(/\n/g, ' ');
}

function guessDate(value) {
  const m = String(value || '').match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
  if (!m) return '';
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

function guessField(text, patterns) {
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m?.[1]) return normalizeLine(m[1]);
  }
  return '';
}

function parseRecommendation(rawText) {
  const t = normalizeDocumentText(rawText);
  const flat = oneLine(t);

  // Виборка під фактичний формат рекомендаційного листа.
  let fullName = '';
  const namePatterns = [
    /призовника\s+([А-ЯІЇЄҐA-Z][А-ЯІЇЄҐA-Zа-яіїєґ'’\-]+\s+[А-ЯІЇЄҐA-Z][а-яіїєґ'’\-]+\s+[А-ЯІЇЄҐA-Z][а-яіїєґ'’\-]+)/u,
    /призовника\s+([А-ЯІЇЄҐA-Z][А-ЯІЇЄҐA-Zа-яіїєґ'’\-]+\s+[А-ЯІЇЄҐA-Z][а-яіїєґ'’\-]+\s+[А-ЯІЇЄҐA-Z][а-яіїєґ'’\-]+)/u,
    /кандидат(?:а)?\s+([А-ЯІЇЄҐA-Z][А-ЯІЇЄҐA-Zа-яіїєґ'’\-]+\s+[А-ЯІЇЄҐA-Z][а-яіїєґ'’\-]+\s+[А-ЯІЇЄҐA-Z][а-яіїєґ'’\-]+)/u,
    /(?:ПІБ|П\.\s*І\.\s*Б\.)\s*[:\-–]\s*([А-ЯІЇЄҐA-Z][^\n]{5,100})/iu
  ];

  for (const pattern of namePatterns) {
    const m = flat.match(pattern);
    if (m?.[1]) {
      fullName = normalizeLine(m[1]).trim().replace(/[,.]$/, '');
      break;
    }
  }

  const dateMatch =
    flat.match(/(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4})\s*р\.н\./iu) ||
    flat.match(/(?:дата\s*народження|народився|народилася)\s*[:\-]?\s*(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4})/iu);
  const birthDate = dateMatch?.[1] ? guessDate(dateMatch[1]) : '';

  const phoneMatch =
    flat.match(/\((0\d{2}[ \-]?\d{3}[ \-]?\d{2}[ \-]?\d{2})\)/u) ||
    flat.match(/(?:тел(?:ефон)?|моб(?:ільний)?|контакт(?:ний)?)\s*[:\-]?\s*(\+?\d[\d ()-]{7,})/iu);
  const phone = phoneMatch?.[1] ? phoneMatch[1].replace(/[^+\d]/g, '') : '';

  const addressMatch = flat.match(/мешкає\s+за\s+адресою\s*:\s*(.+?)\s*\(0\d{2}[ \-]?\d{3}[ \-]?\d{2}[ \-]?\d{2}\)/iu);
  const address = addressMatch?.[1] ? normalizeLine(addressMatch[1]) : '';

  const positionMatch =
    flat.match(/планується\s+на\s+посаду\s+(.+?)\s*,\s*ШПК/iu);
  const desiredPosition = positionMatch?.[1] ? normalizeLine(positionMatch[1]) : '';

  const shpkMatch = flat.match(/ШПК\s*[“"«]?\s*([^”"»\n,]+?)(?:[”"»])?\s*,?\s*ВОС/iu);
  const shpk = shpkMatch?.[1] ? normalizeLine(shpkMatch[1]) : '';

  const vosMatch = flat.match(/ВОС\s*[-–:]\s*([0-9]{3,8}[А-ЯІЇЄҐA-Z]?)/iu);
  const militarySpecialty = vosMatch?.[1] ? normalizeLine(vosMatch[1]) : '';

  const tariffMatch = flat.match(/тарифний\s+розряд\s*[-–:]\s*(\d+)/iu);
  const tariffGrade = tariffMatch?.[1] || '';

  const serviceMatch = flat.match(/військової\s+служби\s+(за\s+контрактом)/iu);
  const serviceType = serviceMatch?.[1] ? normalizeLine(serviceMatch[1]) : '';

  const unitMatch = flat.match(/планується\s+на\s+посаду\s+.+?військової\s+частини\s+([А-ЯІЇЄҐA-Z]\d{2,6})/iu);
  const militaryUnit = unitMatch?.[1] || '';

  const recommendationBlock =
    flat.match(/\bУ\s+(\d+\s+центрі[^.]*?військової\s+частини\s+[А-ЯІЇЄҐA-Z]\d{2,6})\s+попередньо\s+вивчено/iu);
  const recommenderUnit = recommendationBlock?.[1] ? normalizeLine(recommendationBlock[1]) : '';

  const desiredUnitMatch =
    flat.match(/направити\s+призовника\s+.+?\s+до\s+(\d+\s+центру\s+.+?військової\s+частини\s+[А-ЯІЇЄҐA-Z]\d{2,6})\s*,?\s*для/iu);
  const desiredUnit = desiredUnitMatch?.[1] ? normalizeLine(desiredUnitMatch[1]) : '';

  const signatoryMatch =
    flat.match(/підполковник\s+([А-ЯІЇЄҐA-Z][а-яіїєґ'’\-]+\s+[А-ЯІЇЄҐA-Z][а-яіїєґ'’\-]+)/iu) ||
    flat.match(/полковник\s+([А-ЯІЇЄҐA-Z][а-яіїєґ'’\-]+\s+[А-ЯІЇЄҐA-Z][а-яіїєґ'’\-]+)/iu);
  const signatory = signatoryMatch?.[1] ? normalizeLine(signatoryMatch[1]) : '';

  // У зразку після підписанта окремо вказаний Сергій Козлов з реєстраційним номером.
  // Не плутаємо його з підписантом рекомендаційного листа.
  const recruiterMatch =
    flat.match(/підполковник\s+[А-ЯІЇЄҐA-Z][а-яіїєґ'’\-]+\s+[А-ЯІЇЄҐA-Z][а-яіїєґ'’\-]+\s+([А-ЯІЇЄҐA-Z][а-яіїєґ'’\-]+\s+[А-ЯІЇЄҐA-Z][А-ЯІЇЄҐA-Z'’\-]+),\s*\d+[-–]\d+\s*\(ЗСУ\s*\d+\)/iu);
  const recruiterName = recruiterMatch?.[1] ? normalizeLine(recruiterMatch[1]) : '';

  return {
    full_name: fullName,
    birth_date: birthDate,
    phone,
    address,
    military_unit: militaryUnit,
    desired_unit: desiredUnit,
    desired_position: desiredPosition,
    shpk,
    military_specialty: militarySpecialty,
    tariff_grade: tariffGrade,
    service_type: serviceType,
    recommender_unit: recommenderUnit,
    signatory,
    recruiter_name: recruiterName,
    rnokpp: '',
    military_rank: '',
    tcc: '',
    vlk_status: '',
    civilian_profession: '',
    notes: '',
    raw_text: t
  };
}

function renderExtraction(parsed) {
  const box = document.getElementById('extractionBox');
  const grid = document.getElementById('extractionGrid');
  if (!box || !grid) return;

  const fields = [
    ['ПІБ', parsed.full_name],
    ['Дата народження', parsed.birth_date ? parsed.birth_date.split('-').reverse().join('.') : ''],
    ['Телефон', parsed.phone],
    ['Адреса', parsed.address],
    ['Військова частина', parsed.military_unit],
    ['Підрозділ', parsed.desired_unit || ''],
    ['Запланована посада', parsed.desired_position],
    ['ШПК', parsed.shpk],
    ['ВОС', parsed.military_specialty],
    ['Тарифний розряд', parsed.tariff_grade],
    ['Вид служби', parsed.service_type],
    ['Рекомендуючий підрозділ', parsed.recommender_unit],
    ['Підписант', parsed.signatory],
    ['Рекрутер за РЛ', parsed.recruiter_name]
  ];

  grid.innerHTML = fields.map(([label, value]) => `
    <div style="padding:10px 0;border-bottom:1px solid #e6edcf">
      <div style="font-size:10px;color:#89959c;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">${escapeHtml(label)}</div>
      <div style="font-weight:800;color:#34414a">${escapeHtml(value || '—')}</div>
    </div>`).join('');

  box.classList.remove('hidden');
}

function fillCandidateForm(parsed) {
  const form = document.getElementById('candidateForm');
  if (!form) return;

  const supported = [
    'full_name','birth_date','phone','address','military_unit','desired_unit',
    'desired_position','shpk','military_specialty','tariff_grade','service_type',
    'recommender_unit','signatory','recruiter_name','rnokpp','military_rank','tcc','vlk_status',
    'civilian_profession','notes'
  ];

  supported.forEach(name => {
    const input = form.elements[name];
    if (input && parsed[name]) input.value = parsed[name];
  });

  const text = document.getElementById('ocrText');
  if (text) text.value = parsed.raw_text || pendingRecommendationText || '';
}

function flattenAIExtraction(extracted) {
  if (!extracted || typeof extracted !== 'object') return null;

  const personal = extracted.personal || {};
  const service = extracted.service || {};
  const meta = extracted.meta || {};

  return {
    full_name: personal.full_name || '',
    birth_date: personal.birth_date || '',
    phone: personal.phone || '',
    address: personal.address || '',
    rnokpp: personal.rnokpp || '',
    military_rank: personal.military_rank || '',
    tcc: personal.tcc || '',
    civilian_profession: personal.civilian_profession || '',
    military_unit: service.military_unit || '',
    desired_unit: service.desired_unit || '',
    desired_position: service.desired_position || '',
    shpk: service.shpk || '',
    military_specialty: service.military_specialty || '',
    tariff_grade: service.tariff_grade || '',
    service_type: service.service_type || '',
    recommender_unit: service.recommender_unit || '',
    recruiter_name: service.recruiter_name || '',
    signatory: service.signatory || '',
    notes: '',
    raw_text: pendingRecommendationText,
    ai_missing_fields: Array.isArray(meta.missing_fields) ? meta.missing_fields : [],
    ai_warnings: Array.isArray(meta.warnings) ? meta.warnings : []
  };
}

async function aiExtractRecommendation(text) {
  const { data, error } = await supabaseClient.functions.invoke('ai-extract-recommendation', {
    body: { text }
  });

  if (error) {
    throw new Error(error.message || 'Не вдалося викликати AI-виборку.');
  }

  if (!data?.extracted) {
    throw new Error('AI не повернув структуровану виборку.');
  }

  return flattenAIExtraction(data.extracted);
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

    pendingRecommendationText = normalizeDocumentText(text);

    const ocrBox = document.getElementById('ocrResultBox');
    const stage = document.getElementById('candidateStage');
    if (ocrBox) ocrBox.classList.remove('hidden');
    if (stage) stage.classList.remove('hidden');

    let parsed = null;

    if (!pendingRecommendationText) {
      status.textContent = 'Текст не вдалося розпізнати. Заповніть дані вручну.';
    } else {
      try {
        status.textContent = 'OCR готовий. Передаємо текст до AI для точної структурованої виборки...';
        parsed = await aiExtractRecommendation(pendingRecommendationText);
        status.textContent = 'AI-виборка готова. Перевірте дані перед створенням справи.';
      } catch (aiError) {
        console.warn('AI extraction unavailable, using local parser:', aiError);
        parsed = parseRecommendation(pendingRecommendationText);
        status.textContent = 'AI-виборка наразі недоступна. Використано локальну виборку OCR. Перевірте дані.';
      }
    }

    if (parsed) {
      renderExtraction(parsed);
      fillCandidateForm(parsed);

      const warningBox = document.getElementById('aiWarnings');
      if (warningBox) {
        const missing = parsed.ai_missing_fields || [];
        const warnings = parsed.ai_warnings || [];

        if (missing.length || warnings.length) {
          warningBox.classList.remove('hidden');
          warningBox.innerHTML = `
            <div style="font-weight:800;color:#7b5b22;margin-bottom:5px">Перевірка AI</div>
            ${missing.length ? `<div>Відсутні у документі: ${escapeHtml(missing.join(', '))}</div>` : ''}
            ${warnings.length ? `<div style="margin-top:4px">Увага: ${escapeHtml(warnings.join(' • '))}</div>` : ''}
          `;
        }
      }
    }
  } catch (error) {
    console.error('OCR error:', error);
    status.textContent = 'Автоматичне розпізнавання не вдалося. Заповніть дані вручну — оригінал документа все одно можна зберегти.';
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
    military_status: null,
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

  const serviceInfo = [
    ['Військова частина', fd.get('military_unit')],
    ['Підрозділ', fd.get('desired_unit')],
    ['ВОС', fd.get('military_specialty')],
    ['ШПК', fd.get('shpk')],
    ['Тарифний розряд', fd.get('tariff_grade')],
    ['Вид служби', fd.get('service_type')],
    ['Рекомендуючий підрозділ', fd.get('recommender_unit')],
    ['Рекрутер за РЛ', fd.get('recruiter_name')],
    ['Підписант РЛ', fd.get('signatory')],
    ['Джерело', 'Рекомендаційний лист']
  ]
    .filter(([, value]) => String(value || '').trim())
    .map(([label, value]) => label + ': ' + String(value).trim())
    .join('\\n');

  const additional = serviceInfo ? 'СЛУЖБОВА ІНФОРМАЦІЯ CRM\\n' + serviceInfo : '';

  const { error: fileError } = await supabaseClient
    .from('personal_files')
    .insert({
      candidate_id: data.id,
      address: String(fd.get('address') || '').trim() || null,
      additional_notes: additional || null
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

/* PSK_NAME_CASES_INTEGRATION_V1 */
(() => {
  const originalFlattenAIExtraction = window.flattenAIExtraction;
  const originalFillCandidateForm = window.fillCandidateForm;
  const originalRenderExtraction = window.renderExtraction;
  const originalSaveCandidate = window.saveCandidateFromRecommendation;

  function getNameCases(parsed) {
    const c = parsed?.name_cases || {};
    return {
      gender: parsed?.name_gender || c.gender || '',
      nominative: c.nominative || parsed?.full_name || '',
      genitive: c.genitive || '',
      dative: c.dative || '',
      accusative: c.accusative || '',
      instrumental: c.instrumental || '',
      locative: c.locative || '',
      vocative: c.vocative || ''
    };
  }

  function ensureNameCasesUI() {
    const form = document.getElementById('candidateForm');
    if (!form || document.getElementById('nameCasesPanel')) return;

    const panel = document.createElement('div');
    panel.id = 'nameCasesPanel';
    panel.style.cssText = 'grid-column:1/-1;margin-top:4px;padding:18px;border:1px solid #dce8b7;border-radius:12px;background:#f7faed';
    panel.innerHTML = `
      <div style="font-size:11px;font-weight:900;color:#6f8b28;text-transform:uppercase;letter-spacing:.8px;margin-bottom:4px">ПІБ та відмінювання</div>
      <div style="font-size:11px;color:#68757d;margin-bottom:14px">Форми ПІБ автоматично визначаються AI. Перед збереженням рекрутер може їх перевірити та виправити.</div>
      <div id="nameCasesGrid" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 16px"></div>
      <input type="hidden" name="__name_cases_payload" id="nameCasesPayload">
    `;

    const notes = form.elements.notes;
    if (notes?.parentElement) notes.parentElement.before(panel);
    else form.appendChild(panel);
  }

  function renderNameCases(parsed) {
    ensureNameCasesUI();
    const grid = document.getElementById('nameCasesGrid');
    const payload = document.getElementById('nameCasesPayload');
    if (!grid || !payload) return;

    const cases = getNameCases(parsed);
    const labels = [
      ['Називний', 'nominative'],
      ['Родовий', 'genitive'],
      ['Давальний', 'dative'],
      ['Знахідний', 'accusative'],
      ['Орудний', 'instrumental'],
      ['Місцевий', 'locative'],
      ['Кличний', 'vocative']
    ];

    grid.innerHTML = `
      <div style="grid-column:1/-1;padding:8px 0;color:#34414a;font-weight:800">Стать: ${escapeHtml(cases.gender || 'не визначено')}</div>
      ${labels.map(([label, key]) => `
        <div>
          <label>${escapeHtml(label)}</label>
          <input data-name-case="${key}" value="${escapeHtml(cases[key])}" style="width:100%;padding:10px 11px;border:1px solid #cfd8dc;border-radius:8px;background:#fff;color:#24313a">
        </div>
      `).join('')}
    `;

    function syncPayload() {
      const out = { gender: cases.gender || '' };
      labels.forEach(([, key]) => {
        const input = grid.querySelector(`[data-name-case="${key}"]`);
        out[key] = input ? input.value.trim() : '';
      });
      payload.value = JSON.stringify(out);
    }

    grid.querySelectorAll('[data-name-case]').forEach(input => input.addEventListener('input', syncPayload));
    syncPayload();
  }

  window.flattenAIExtraction = function(extracted) {
    const base = originalFlattenAIExtraction(extracted) || {};
    const nameCases = extracted?.name_cases || {};
    base.name_gender = nameCases.gender || '';
    base.name_cases = nameCases;
    return base;
  };

  window.renderExtraction = function(parsed) {
    originalRenderExtraction(parsed);
    renderNameCases(parsed);
  };

  window.fillCandidateForm = function(parsed) {
    originalFillCandidateForm(parsed);
    renderNameCases(parsed);
  };

  window.saveCandidateFromRecommendation = async function(event) {
    const form = event.target;
    ensureNameCasesUI();
    const payloadInput = document.getElementById('nameCasesPayload');
    const notesInput = form?.elements?.notes;
    const payload = payloadInput?.value || '';
    const originalNotes = notesInput?.value || '';

    if (notesInput && payload) {
      notesInput.value = `${originalNotes}${originalNotes ? '\n\n' : ''}[[PSK_NAME_CASES]]${payload}[[/PSK_NAME_CASES]]`;
    }

    try {
      return await originalSaveCandidate(event);
    } finally {
      if (notesInput) notesInput.value = originalNotes;
    }
  };
})();


/* PSK_CANDIDATE_CARD_V1 */
function candidateBoolValue(value) {
  if (value === true) return 'true';
  if (value === false) return 'false';
  return '';
}

function normalizeNameForStorage(value) {
  const parts = String(value || '').trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
  if (!parts.length) return '';
  return [parts[0].toLocaleUpperCase('uk-UA'), ...parts.slice(1)].join(' ');
}

function maritalOptions(sex, current) {
  const common = sex === 'female'
    ? ['Одружена','Розлучена','Не одружена']
    : sex === 'male'
      ? ['Одружений','Розлучений','Не одружений']
      : ['Одружений','Одружена','Розлучений','Розлучена','Не одружений','Не одружена'];
  const values = current && !common.includes(current) ? [current, ...common] : common;
  return values.map(v => `<option value="${escapeHtml(v)}" ${v === current ? 'selected' : ''}>${escapeHtml(v)}</option>`).join('');
}

function yesNoOptions(value) {
  return `
    <option value="" ${value === '' ? 'selected' : ''}>Не визначено</option>
    <option value="true" ${value === 'true' ? 'selected' : ''}>Так</option>
    <option value="false" ${value === 'false' ? 'selected' : ''}>Ні</option>`;
}

function profileField(label, name, value, extra='') {
  return `<div><label>${escapeHtml(label)}</label><input name="${escapeHtml(name)}" value="${escapeHtml(value || '')}" ${extra}></div>`;
}

async function openCandidateDocument(path) {
  if (!path) return;
  try {
    const { data, error } = await supabaseClient.storage
      .from('candidate-documents')
      .createSignedUrl(path, 600);
    if (error) throw error;
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener');
  } catch (e) {
    alert('Не вдалося відкрити документ: ' + (e.message || e));
  }
}

async function renderCandidateCard(candidateId) {
  const content = document.querySelector('.content');
  if (!content || !candidateId) return;

  content.innerHTML = `
    <div style="padding:40px;text-align:center;color:#7d8a93">Завантажуємо картку кандидата...</div>`;

  const [candidateRes, fileRes, docsRes] = await Promise.all([
    supabaseClient.from('candidates').select('*').eq('id', candidateId).single(),
    supabaseClient.from('personal_files').select('*').eq('candidate_id', candidateId).maybeSingle(),
    supabaseClient.from('documents').select('*').eq('candidate_id', candidateId).order('created_at', { ascending: true })
  ]);

  if (candidateRes.error) {
    content.innerHTML = `<div class="card"><b>Не вдалося завантажити кандидата.</b><div style="margin-top:8px;color:#a23f38">${escapeHtml(candidateRes.error.message || '')}</div></div>`;
    return;
  }

  const c = candidateRes.data || {};
  const pf = fileRes.data || {};
  const docs = docsRes.data || [];

  const nameNom = c.name_nominative || c.full_name || '';
  const nameGen = c.name_genitive || '';
  const sex = c.sex || '';
  const marital = c.marital_status || '';
  const hasChildren = candidateBoolValue(c.has_children);
  const worked = candidateBoolValue(c.worked_before);
  const served = candidateBoolValue(c.served_before);

  content.innerHTML = `
    <div class="dashboard-top">
      <div>
        <div class="page-title">Картка кандидата</div>
        <p class="page-subtitle">Єдина форма перевірки та підтвердження даних з документів.</p>
      </div>
      <div class="quick-actions">
        <button onclick="showCandidates()">← До кандидатів</button>
      </div>
    </div>

    <form id="candidateCardForm" style="max-width:1220px">
      <div class="card" style="margin-bottom:16px">
        <div class="panel-head" style="margin:-20px -20px 20px">
          <div><h3 style="margin:0">Основні дані</h3><small>Дані, які CRM зібрала та обробила з документів.</small></div>
          <span class="status status-new">ID: ${escapeHtml(candidateId.slice(0,8))}</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 16px">
          ${profileField('ПІБ у називному відмінку','name_nominative',nameNom,'data-nominative="1"')}
          ${profileField('ПІБ у родовому відмінку','name_genitive',nameGen)}
          ${profileField('Дата народження','birth_date',c.birth_date,'type="date"')}
          ${profileField('Місце народження','birth_place',c.birth_place || pf.birth_place)}
          ${profileField('РНОКПП','rnokpp',c.rnokpp)}
          ${profileField('Паспортні дані','passport_data',c.passport_data || pf.passport_data)}
          ${profileField('Телефон','phone',c.phone)}
          ${profileField('Email','email',c.email)}
          ${profileField('Адреса','address',pf.address)}
          <div>
            <label>Стать</label>
            <select name="sex" id="candidateSex">
              <option value="">Не визначено</option>
              <option value="male" ${sex === 'male' ? 'selected' : ''}>Чоловіча</option>
              <option value="female" ${sex === 'female' ? 'selected' : ''}>Жіноча</option>
            </select>
          </div>
          <div>
            <label>Сімейний стан</label>
            <select name="marital_status" id="maritalStatus">${maritalOptions(sex, marital)}</select>
          </div>
          <div>
            <label>Діти</label>
            <select name="has_children">${yesNoOptions(hasChildren).replace('Так','Є діти').replace('Ні','Не має дітей')}</select>
          </div>
          ${profileField('Інформація про дітей','children_info',pf.children_info)}
        </div>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="panel-head" style="margin:-20px -20px 20px">
          <div><h3 style="margin:0">Освіта та робота</h3><small>Інформація, зібрана з анкети, автобіографії та інших документів.</small></div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 16px">
          <div>
            <label>Працював / Працювала</label>
            <select name="worked_before">${yesNoOptions(worked).replace('Так','Працював / Працювала').replace('Ні','Не працював / Не працювала')}</select>
          </div>
          <div>
            <label>Служив / Служила</label>
            <select name="served_before">${yesNoOptions(served).replace('Так','Служив / Служила').replace('Ні','Не служив / Не служила')}</select>
          </div>
          <div style="grid-column:1/-1">
            <label>Освіта</label>
            <textarea name="education" rows="4">${escapeHtml(pf.education || '')}</textarea>
          </div>
          <div style="grid-column:1/-1">
            <label>Трудова діяльність</label>
            <textarea name="work_history" rows="5">${escapeHtml(pf.work_history || pf.civilian_experience || '')}</textarea>
          </div>
          <div style="grid-column:1/-1">
            <label>Військова служба</label>
            <textarea name="military_service_history" rows="5">${escapeHtml(pf.military_service_history || pf.military_experience || '')}</textarea>
          </div>
        </div>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="panel-head" style="margin:-20px -20px 20px">
          <div><h3 style="margin:0">Військові дані та рекрутинг</h3><small>Поточні службові та рекрутингові відомості.</small></div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 16px">
          ${profileField('Військове звання','military_rank',c.military_rank)}
          ${profileField('ВОС','military_specialty',c.military_specialty)}
          ${profileField('Військова частина','military_unit',(c.profile_data && c.profile_data.military_unit) || '')}
          ${profileField('Бажаний підрозділ / напрям','desired_unit',c.direction)}
          ${profileField('Бажана посада','desired_position',c.desired_position)}
          ${profileField('ТЦК','tcc',c.tcc)}
          ${profileField('Статус ВЛК','vlk_status',c.vlk_status)}
          <div>
            <label>Статус кандидата</label>
            <select name="recruitment_status">
              ${['Новий','Первинний контакт','Співбесіда','Перевірка документів','ВЛК','Рішення','Призначений','Відмова','Втрачено контакт','Відкладено'].map(v=>`<option ${c.recruitment_status===v?'selected':''}>${escapeHtml(v)}</option>`).join('')}
            </select>
          </div>
          <div style="grid-column:1/-1">
            <label>Примітки рекрутера</label>
            <textarea name="notes" rows="5">${escapeHtml(c.notes || '')}</textarea>
          </div>
        </div>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="panel-head" style="margin:-20px -20px 20px">
          <div><h3 style="margin:0">Документи</h3><small>Завантажені документи та їхній поточний статус.</small></div>
          <span style="color:#7d8a93;font-size:11px">${docs.length} документ(ів)</span>
        </div>
        <div style="display:grid;gap:9px">
          ${docs.length ? docs.map(d => `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px;border:1px solid #e6eaec;border-radius:9px;background:#fbfcfc">
              <div>
                <div style="font-weight:800;color:#34414a">${escapeHtml(d.document_name || d.document_type || d.file_name || 'Документ')}</div>
                <div style="font-size:10px;color:#89959c;margin-top:3px">${escapeHtml(d.file_name || '')} · ${d.required ? 'Обов’язковий' : 'Додатковий'} · ${escapeHtml(d.status || 'Завантажено')}</div>
              </div>
              <button type="button" onclick="openCandidateDocument(this.dataset.path)" data-path="${escapeHtml(d.storage_path || '')}" style="border:1px solid #cfd8dc;background:#fff;border-radius:7px;padding:7px 10px;font-weight:800">Відкрити</button>
            </div>`).join('') : '<div style="padding:18px;color:#89959c;text-align:center">Документи ще не завантажені.</div>'}
        </div>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="panel-head" style="margin:-20px -20px 20px">
          <div><h3 style="margin:0">Бланки CRM</h3><small>Підготовлені точки для майбутніх шаблонів документів.</small></div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px">
          ${[
            ['Анкета','anketa'],
            ['Згода на обробку персональних даних','consent_processing'],
            ['Згода на збір та обробку даних','consent_collection_processing'],
            ['Заява на контракт','contract_application'],
            ['Розписка кандидата','candidate_receipt']
          ].map(([label,key]) => `
            <button type="button" data-template-key="${key}" onclick="alert('Бланк «${label}» буде підключено після завантаження затвердженого шаблону.')" style="padding:13px;border:1px solid #d8e0e3;background:#f7f9f9;border-radius:8px;text-align:left;font-weight:800;color:#45525a">📝 ${label}</button>
          `).join('')}
        </div>
      </div>

      <div style="display:flex;gap:9px;flex-wrap:wrap">
        <button type="submit" style="background:#18232d;color:#fff">Зберегти зміни</button>
        <button type="button" onclick="showCandidates()" style="border:1px solid #d8e0e3;background:#fff;color:#45525a">Скасувати</button>
      </div>
      <div id="candidateCardSaveStatus" style="margin-top:12px;color:#68757d;font-size:12px;min-height:18px"></div>
    </form>`;

  const sexEl = document.getElementById('candidateSex');
  const maritalEl = document.getElementById('maritalStatus');
  if (sexEl && maritalEl) {
    sexEl.addEventListener('change', () => {
      maritalEl.innerHTML = maritalOptions(sexEl.value, '');
    });
  }

  document.getElementById('candidateCardForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target;
    const status = document.getElementById('candidateCardSaveStatus');
    const fd = new FormData(form);

    const nameNominative = normalizeNameForStorage(fd.get('name_nominative'));
    if (!nameNominative) {
      status.textContent = 'Потрібно вказати ПІБ у називному відмінку.';
      return;
    }

    const parseBool = v => v === '' ? null : v === 'true';
    const previousProfile = c.profile_data && typeof c.profile_data === 'object' ? c.profile_data : {};

    status.textContent = 'Зберігаємо підтверджені дані...';

    const { error: candidateError } = await supabaseClient
      .from('candidates')
      .update({
        full_name: nameNominative,
        name_nominative: nameNominative,
        name_genitive: String(fd.get('name_genitive') || '').trim() || null,
        birth_date: fd.get('birth_date') || null,
        birth_place: String(fd.get('birth_place') || '').trim() || null,
        rnokpp: String(fd.get('rnokpp') || '').trim() || null,
        passport_data: String(fd.get('passport_data') || '').trim() || null,
        sex: String(fd.get('sex') || '') || null,
        marital_status: String(fd.get('marital_status') || '').trim() || null,
        has_children: parseBool(fd.get('has_children')),
        worked_before: parseBool(fd.get('worked_before')),
        served_before: parseBool(fd.get('served_before')),
        phone: String(fd.get('phone') || '').trim() || null,
        email: String(fd.get('email') || '').trim() || null,
        desired_position: String(fd.get('desired_position') || '').trim() || null,
        direction: String(fd.get('desired_unit') || '').trim() || null,
        military_rank: String(fd.get('military_rank') || '').trim() || null,
        military_specialty: String(fd.get('military_specialty') || '').trim() || null,
        tcc: String(fd.get('tcc') || '').trim() || null,
        vlk_status: String(fd.get('vlk_status') || '').trim() || null,
        recruitment_status: String(fd.get('recruitment_status') || 'Новий'),
        civilian_profession: String(fd.get('civilian_profession') || '').trim() || null,
        notes: String(fd.get('notes') || '').trim() || null,
        profile_data: {
          ...previousProfile,
          military_unit: String(fd.get('military_unit') || '').trim() || '',
          updated_from_candidate_card: true
        },
        updated_at: new Date().toISOString()
      })
      .eq('id', candidateId);

    if (candidateError) {
      status.textContent = 'Помилка збереження кандидата: ' + candidateError.message;
      return;
    }

    const personalPayload = {
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

    const { error: fileError } = await supabaseClient
      .from('personal_files')
      .upsert(personalPayload, { onConflict:'candidate_id' });

    if (fileError) {
      status.textContent = 'Кандидата збережено, але особову справу не вдалося оновити: ' + fileError.message;
      return;
    }

    status.textContent = 'Готово. Дані кандидата оновлено.';
    setTimeout(() => renderCandidateCard(candidateId), 500);
  });
}

/* PSK_DELETE_CANDIDATE_V1 */
async function deleteCandidate(candidateId, candidateName) {
  if (!candidateId) return;
  const ok = window.confirm(`Видалити кандидата «${candidateName || 'Без ПІБ'}»?\n\nБуде видалена особова справа та пов'язані записи документів. Цю дію не можна скасувати.`);
  if (!ok) return;

  const status = document.getElementById('candidateDeleteStatus');
  if (status) status.textContent = 'Видалення…';

  const { error } = await supabaseClient
    .from('candidates')
    .delete()
    .eq('id', candidateId);

  if (error) {
    console.error('Помилка видалення кандидата:', error);
    alert(`Не вдалося видалити кандидата: ${error.message || 'невідома помилка'}`);
    if (status) status.textContent = '';
    return;
  }

  if (typeof updateDashboard === 'function') await updateDashboard();
  showCandidates();
}

function addDeleteCandidateColumn() {
  const table = document.querySelector('#candidateRows')?.closest('table');
  if (!table) return;
  const headRow = table.querySelector('thead tr');
  if (headRow && !headRow.querySelector('[data-delete-column]')) {
    const th = document.createElement('th');
    th.dataset.deleteColumn = '1';
    th.style.cssText = 'padding:14px;border-bottom:1px solid #e0e6e8;text-align:right';
    th.textContent = 'Дії';
    headRow.appendChild(th);
  }
  const rows = document.querySelectorAll('#candidateRows > tr');
  rows.forEach(row => {
    if (row.querySelector('[data-delete-candidate]')) return;
    const cells = row.querySelectorAll('td');
    if (!cells.length || cells.length < 5) return;
    const pib = cells[0]?.textContent?.trim() || 'кандидата';
    const first = cells[0]?.querySelector('b');
    const id = row.dataset.candidateId;
    if (!id) return;
    const td = document.createElement('td');
    td.style.cssText = 'padding:10px 14px;text-align:right';
    td.innerHTML = `<button data-delete-candidate="1" style="border:1px solid #e7c7c5;background:#fff5f4;color:#a34f4a;border-radius:7px;padding:7px 10px;font-weight:800;font-size:11px">🗑 Видалити</button>`;
    td.querySelector('button').onclick = () => deleteCandidate(id, pib);
    row.appendChild(td);
  });
}

const originalShowCandidatesForDelete = window.showCandidates;
if (typeof originalShowCandidatesForDelete === 'function') {
  window.showCandidates = async function() {
    await originalShowCandidatesForDelete();
    const rows = document.querySelectorAll('#candidateRows > tr');
    const candidates = await getCandidates();
    const byName = new Map(candidates.map(c => [String(c.full_name || ''), c]));
    rows.forEach(row => {
      const name = row.querySelector('td b')?.textContent?.trim() || '';
      const c = byName.get(name);
      if (c) row.dataset.candidateId = c.id;
    });
    addDeleteCandidateColumn();
  };
}

/* PSK_GLOBAL_API_V2 */
window.showCandidates = showCandidates;
window.showNewCandidateForm = showNewCandidateForm;
window.openCandidateCard = async function(candidateId) {
  try {
    return await renderCandidateCard(candidateId);
  } catch (e) {
    console.error('Помилка відкриття картки кандидата:', e);
    const content = document.querySelector('.content');
    if (content) {
      content.innerHTML = '<div class="card"><b>Помилка відкриття картки кандидата.</b><div style="margin-top:8px;color:#a23f38">' + escapeHtml(e?.message || e || 'Невідома помилка') + '</div><button type="button" onclick="showCandidates()" style="margin-top:14px;padding:9px 12px;border:1px solid #cfd8dc;border-radius:7px;background:#fff">← Назад до кандидатів</button></div>';
    } else {
      alert('Помилка відкриття картки кандидата: ' + (e?.message || e || 'Невідома помилка'));
    }
  }
};
