// Legacy compatibility entry point. The active upload/retry handlers live in documents.js.
// Never search by upload time: every write must name its exact source document.
(function () {
  window.reconcileAiWithCandidate = async function(candidateId, extracted, documentId) {
    if (!documentId) throw new Error('Для синхронізації потрібен ID вихідного документа');
    const report = await CRMDocumentSync.preview(supabaseClient, documentId);
    if (report.document.candidate_id !== candidateId) throw new Error('Документ належить іншому кандидату');
    await CRMDocumentSync.apply(supabaseClient, report);
    return {
      filled: report.rows.filter(r => r.action === 'fill').map(r => r.key),
      same: report.rows.filter(r => r.action === 'leave').map(r => r.key),
      conflicts: report.rows.filter(r => r.action === 'conflict')
    };
  };
})();
