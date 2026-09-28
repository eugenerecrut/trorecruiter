// PSK_RECRUTER CRM — temporary candidate deletion
(function () {
  async function deleteCandidateCase(candidateId, candidateName) {
    if (!candidateId) {
      alert('Не вдалося визначити ID кандидата.');
      return;
    }

    const name = candidateName || 'кандидата';
    if (!window.confirm(`УВАГА! Видалити особову справу «${name}»?\n\nДію поки що не можна скасувати.`)) return;

    try {
      if (typeof supabaseClient === 'undefined') {
        throw new Error('CRM не підключила Supabase. Оновіть сторінку.');
      }

      const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
      if (sessionError) throw sessionError;
      if (!sessionData?.session?.user) {
        throw new Error('Сесія користувача не знайдена. Увійдіть до CRM повторно.');
      }

      // Documents/personal-file cleanup will be handled separately later.
      // For now this button performs the temporary candidate deletion only.
      const { error } = await supabaseClient
        .from('candidates')
        .delete()
        .eq('id', candidateId);

      if (error) throw error;

      alert(`Справу «${name}» видалено.`);

      if (typeof updateDashboard === 'function') await updateDashboard();
      if (typeof showCandidates === 'function') showCandidates();
    } catch (error) {
      console.error('Помилка видалення кандидата:', error);
      alert(`Не вдалося видалити справу:\n${error?.message || error}`);
    }
  }

  window.deleteCandidateCase = deleteCandidateCase;

  // The candidates table currently builds an inline onclick containing JSON text.
  // That can break the HTML attribute when the candidate name contains quotes.
  // Capture the click before the inline handler and extract the UUID from the
  // generated attribute, then call the safe handler ourselves.
  document.addEventListener('click', function (event) {
    const button = event.target.closest('button');
    if (!button || !button.textContent.includes('Видалити справу')) return;

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
