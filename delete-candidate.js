// PSK_RECRUTER — temporary candidate deletion
// This file is loaded after script.js and explicitly exposes the handler on window.
(function () {
  async function deleteCandidateCase(candidateId, candidateName = 'кандидата') {
    if (!candidateId) {
      alert('Не вдалося визначити ID кандидата.');
      return;
    }

    const confirmed = window.confirm(
      `УВАГА! Видалити особову справу «${candidateName}»?\n\n` +
      'Буде видалено кандидата, особову справу та пов’язані записи. Дію поки що не можна скасувати.'
    );
    if (!confirmed) return;

    try {
      const { data: sessionData } = await supabaseClient.auth.getSession();
      if (!sessionData?.session?.user) {
        throw new Error('Сесія користувача не знайдена. Увійдіть до CRM повторно.');
      }

      const { error } = await supabaseClient
        .from('candidates')
        .delete()
        .eq('id', candidateId);

      if (error) throw error;

      alert(`Справу «${candidateName}» видалено.`);
      if (typeof updateDashboard === 'function') await updateDashboard();
      if (typeof showCandidates === 'function') await showCandidates();
    } catch (error) {
      console.error('Помилка видалення кандидата:', error);
      alert(`Не вдалося видалити справу:\n${error?.message || error}`);
    }
  }

  // Explicitly make the function available to inline onclick handlers.
  window.deleteCandidateCase = deleteCandidateCase;

  // Fallback: if the inline handler is not available for any reason,
  // catch clicks on the deletion button and invoke the same handler.
  document.addEventListener('click', function (event) {
    const button = event.target.closest('button');
    if (!button || !button.textContent.includes('Видалити справу')) return;
    if (typeof window.deleteCandidateCase !== 'function') return;

    const match = button.getAttribute('onclick')?.match(/deleteCandidateCase\('([^']+)'/);
    if (!match) return;

    event.preventDefault();
    event.stopPropagation();
    const candidateId = match[1];
    const nameMatch = button.getAttribute('onclick')?.match(/,\s*("(?:\\.|[^"\\])*")\)/);
    let candidateName = 'кандидата';
    if (nameMatch) {
      try { candidateName = JSON.parse(nameMatch[1]); } catch (_) {}
    }
    window.deleteCandidateCase(candidateId, candidateName);
  }, true);
})();
