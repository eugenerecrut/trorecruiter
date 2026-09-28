// Temporary candidate deletion helper for PSK_RECRUTER CRM.
// The UI button calls deleteCandidateCase(candidateId, candidateName).
async function deleteCandidateCase(candidateId, candidateName = 'кандидата') {
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
}
