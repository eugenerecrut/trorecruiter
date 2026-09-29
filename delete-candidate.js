// PSK_RECRUTER CRM — candidate deletion helper
(function () {
  async function deleteCandidateCase(candidateId, candidateName) {
    if (!candidateId) { alert('Не вдалося визначити ID кандидата.'); return; }
    const name = candidateName || 'кандидата';
    if (!window.confirm(`УВАГА! Видалити особову справу «${name}»?\n\nКартка, особова справа та пов’язані документи будуть видалені.`)) return;
    try {
      if (typeof supabaseClient === 'undefined') throw new Error('CRM не підключила Supabase. Оновіть сторінку.');
      const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
      if (sessionError) throw sessionError;
      if (!sessionData?.session?.user) throw new Error('Сесія користувача не знайдена. Увійдіть до CRM повторно.');

      const { data: docs, error: docsError } = await supabaseClient.from('documents').select('storage_path').eq('candidate_id', candidateId);
      if (docsError) throw docsError;
      const paths = (docs || []).map(x => x.storage_path).filter(Boolean);
      if (paths.length) {
        const { error: storageError } = await supabaseClient.storage.from('candidate-documents').remove(paths);
        if (storageError) console.warn('Не всі файли зі сховища видалені:', storageError.message);
      }

      const { error: docError } = await supabaseClient.from('documents').delete().eq('candidate_id', candidateId);
      if (docError) throw docError;
      const { error: pfError } = await supabaseClient.from('personal_files').delete().eq('candidate_id', candidateId);
      if (pfError) throw pfError;
      const { error: candidateError } = await supabaseClient.from('candidates').delete().eq('id', candidateId);
      if (candidateError) throw candidateError;

      alert(`Справу «${name}» видалено.`);
      if (typeof updateDashboard === 'function') await updateDashboard();
      if (typeof showCandidates === 'function') showCandidates();
    } catch (error) {
      console.error('Помилка видалення кандидата:', error);
      alert(`Не вдалося видалити справу:\n${error?.message || error}`);
    }
  }
  window.deleteCandidateCase = deleteCandidateCase;

  document.addEventListener('click', function (event) {
    const button = event.target.closest('button');
    if (!button || !/Видалити/.test(button.textContent || '')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const onclick = button.getAttribute('onclick') || '';
    const match = onclick.match(/deleteCandidateCase\(['\"]([^'\"]+)['\"]/);
    const candidateId = match ? match[1] : '';
    const row = button.closest('tr');
    const candidateName = row?.querySelector('td')?.textContent?.trim() || 'кандидата';
    deleteCandidateCase(candidateId, candidateName);
  }, true);

  // Клік по ПІБ відкриває повну картку кандидата.
  document.addEventListener('click', function (event) {
    const target = event.target.closest('#candidateRows td:first-child, #candidateRows td:first-child *');
    if (!target) return;
    const row = target.closest('tr');
    if (!row) return;
    const openButton = row.querySelector('button[onclick*="openCandidateCard"]');
    if (!openButton) return;
    const onclick = openButton.getAttribute('onclick') || '';
    const match = onclick.match(/openCandidateCard\(['\"]([^'\"]+)['\"]/);
    if (!match?.[1]) return;
    event.preventDefault();
    event.stopPropagation();
    window.openCandidateCard(match[1]);
  });
})();

/* PSK_CANDIDATE_CARD_V2_LOADER */
(function () {
  if (window.__pskCandidateCardV2Loader) return;
  window.__pskCandidateCardV2Loader = true;
  const s = document.createElement('script');
  s.src = 'candidate-card-v2.js?v=20260928-card8';
  s.async = false;
  s.onload = () => console.log('PSK candidate card V2 loaded');
  s.onerror = () => console.error('Не вдалося завантажити candidate-card-v2.js');
  document.head.appendChild(s);
})();