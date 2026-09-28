// Temporary candidate deletion helper.
// Loaded by the CRM page; defines the global handler used by the Candidates table.
window.deleteCandidateCase = async function(candidateId, candidateName = 'кандидата') {
  if (!candidateId) {
    alert('Не вдалося визначити ID кандидата.');
    return;
  }

  const confirmed = window.confirm(`УВАГА! Видалити особову справу «${candidateName}»?\n\nДію поки що не можна скасувати.`);
  if (!confirmed) return;

  try {
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
    alert(`Не вдалося видалити справу: ${error.message || error}`);
  }
};
