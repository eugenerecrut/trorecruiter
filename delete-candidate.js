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

      const { error } = await supabaseClient
        .from('candidates')
        .delete()
        .eq('id', candidateId);

      if (error) throw error;

      alert(`Справу «${name}» видалено.`);

      if (typeof updateDashboard === 'function') {
        await updateDashboard();
      }
      if (typeof showCandidates === 'function') {
        showCandidates();
      }
    } catch (error) {
      console.error('Помилка видалення кандидата:', error);
      alert(`Не вдалося видалити справу:\n${error?.message || error}`);
    }
  }

  // Always expose the handler globally because the Candidates table uses onclick.
  window.deleteCandidateCase = deleteCandidateCase;
})();
