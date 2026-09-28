// TRORECRUITER CRM — Supabase data layer
// HelpCrunch is not used.

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
    <div class="page-title">Кандидати</div>
    <div class="page-subtitle">База кандидатів TRORECRUITER</div>
    <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap">
      <input id="candidateSearch" placeholder="Пошук за ПІБ, телефоном, посадою" style="flex:1;min-width:260px">
      <select id="candidateStatus" style="padding:12px;border-radius:8px;border:1px solid #3a4650;background:#0f171e;color:#fff">
        <option value="">Всі статуси</option>
        <option>Новий</option>
        <option>Співбесіда</option>
        <option>Документи</option>
        <option>ВЛК</option>
        <option>Призначений</option>
      </select>
      <button id="newCandidateButton" class="login-button" style="width:auto;margin-top:0;padding:12px 18px">+ Новий кандидат</button>
    </div>
    <div class="card" style="padding:0;overflow:auto">
      <table style="width:100%;border-collapse:collapse;min-width:760px">
        <thead><tr style="background:#1d2a35;text-align:left">
          <th style="padding:15px">ПІБ</th>
          <th style="padding:15px">Телефон</th>
          <th style="padding:15px">Посада</th>
          <th style="padding:15px">Напрям</th>
          <th style="padding:15px">Статус</th>
        </tr></thead>
        <tbody id="candidateRows"></tbody>
      </table>
    </div>`;

  document.getElementById('newCandidateButton').onclick = showNewCandidateForm;

  async function render() {
    const candidates = await getCandidates();
    const q = document.getElementById('candidateSearch').value.trim().toLowerCase();
    const status = document.getElementById('candidateStatus').value;

    const filtered = candidates.filter(c => {
      const text = [c.full_name, c.phone, c.email, c.desired_position, c.direction]
        .join(' ').toLowerCase();
      return (!q || text.includes(q)) && (!status || c.recruitment_status === status);
    });

    const rows = document.getElementById('candidateRows');
    rows.innerHTML = filtered.length ? filtered.map(c => `
      <tr style="border-top:1px solid #293742">
        <td style="padding:15px"><b>${escapeHtml(c.full_name || '')}</b></td>
        <td style="padding:15px">${escapeHtml(c.phone || '—')}</td>
        <td style="padding:15px">${escapeHtml(c.desired_position || '—')}</td>
        <td style="padding:15px">${escapeHtml(c.direction || '—')}</td>
        <td style="padding:15px">${escapeHtml(c.recruitment_status || 'Новий')}</td>
      </tr>`).join('') : `
      <tr><td colspan="5" style="padding:40px;text-align:center;color:#8997a3">Кандидатів поки немає</td></tr>`;
  }

  document.getElementById('candidateSearch').oninput = render;
  document.getElementById('candidateStatus').onchange = render;
  render();
}

function showNewCandidateForm() {
  const content = document.querySelector('.content');
  if (!content) return;

  content.innerHTML = `
    <div class="page-title">Нова особова справа</div>
    <div class="page-subtitle">Створення нового кандидата</div>
    <form id="candidateForm" class="card" style="max-width:950px">
      <label>ПІБ *</label><input name="full_name" required placeholder="Прізвище Ім'я По батькові">
      <label>Телефон</label><input name="phone" placeholder="+380...">
      <label>Email</label><input name="email" type="email">
      <label>Дата народження</label><input name="birth_date" type="date">
      <label>ІПН / РНОКПП</label><input name="rnokpp">
      <label>Військове звання</label><input name="military_rank">
      <label>Цивільна професія</label><input name="civilian_profession">
      <label>Бажана посада</label><input name="desired_position">
      <label>Напрям</label><input name="direction" placeholder="БпЛА, зв'язок, водії...">
      <label>ТЦК</label><input name="tcc">
      <label>Статус ВЛК</label><input name="vlk_status">
      <label>Примітки</label>
      <textarea name="notes" rows="5" style="width:100%;padding:13px;border-radius:8px;border:1px solid #3a4650;background:#0f171e;color:#fff"></textarea>
      <div style="display:flex;gap:10px;margin-top:20px">
        <button type="submit" class="login-button" style="width:auto;margin-top:0">Зберегти кандидата</button>
        <button type="button" id="cancelCandidate" class="logout">Скасувати</button>
      </div>
      <div id="saveStatus" style="margin-top:12px;color:#aeb9c4"></div>
    </form>`;

  document.getElementById('cancelCandidate').onclick = showCandidates;
  document.getElementById('candidateForm').onsubmit = saveCandidate;
}

async function saveCandidate(event) {
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
    email: String(fd.get('email') || '').trim() || null,
    birth_date: fd.get('birth_date') || null,
    rnokpp: String(fd.get('rnokpp') || '').trim() || null,
    military_rank: String(fd.get('military_rank') || '').trim() || null,
    civilian_profession: String(fd.get('civilian_profession') || '').trim() || null,
    desired_position: String(fd.get('desired_position') || '').trim() || null,
    direction: String(fd.get('direction') || '').trim() || null,
    tcc: String(fd.get('tcc') || '').trim() || null,
    vlk_status: String(fd.get('vlk_status') || '').trim() || null,
    notes: String(fd.get('notes') || '').trim() || null,
    recruitment_status: 'Новий',
    recruiter_id: user.id
  };

  status.textContent = 'Зберігаємо...';

  const { data, error } = await supabaseClient
    .from('candidates')
    .insert(candidate)
    .select()
    .single();

  if (error) {
    console.error(error);
    status.textContent = 'Помилка збереження: ' + error.message;
    return;
  }

  const { error: fileError } = await supabaseClient
    .from('personal_files')
    .insert({ candidate_id: data.id });

  if (fileError) console.error('Помилка створення особової справи:', fileError);

  await updateDashboard();
  showCandidates();
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
      if (text === 'Документи') alert('Документи підключимо до картки кандидата на наступному етапі.');
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
