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
})();
