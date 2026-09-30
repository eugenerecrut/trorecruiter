// PSK_RECRUTER CRM — recommendation upload compatibility fix v2
// Canonical fix for Storage InvalidKey caused by non-ASCII filenames.
// Recommendation letters do NOT require AI: OCR is sufficient and the document
// is marked verified immediately after successful registration for a new candidate.
(function () {
  function safeAsciiName(name) {
    const original = String(name || 'recommendation.pdf');
    const extMatch = original.match(/(\.[A-Za-z0-9]{1,8})$/);
    const ext = extMatch ? extMatch[1].toLowerCase() : '.pdf';
    const base = original.slice(0, original.length - (extMatch ? ext.length : 0));
    const ascii = base
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9._-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 120) || 'recommendation';
    return `${ascii}${ext}`;
  }

  window.uploadRecommendation = async function (candidateId, user) {
    const file = document.getElementById('recommendationFile')?.files?.[0] || null;
    if (!candidateId) return { ok: false, reason: 'Не визначено кандидата' };
    if (!file) return { ok: false, reason: 'Файл рекомендаційного листа не вибрано' };

    const fileName = `${Date.now()}_${safeAsciiName(file.name)}`;
    const storagePath = `${candidateId}/recommendation/${fileName}`;

    const { error: uploadError } = await supabaseClient
      .storage
      .from('candidate-documents')
      .upload(storagePath, file, {
        upsert: false,
        contentType: file.type || 'application/pdf'
      });

    if (uploadError) {
      console.error('Recommendation Storage upload:', uploadError);
      return { ok: false, reason: `Storage: ${uploadError.message}` };
    }

    const { data: req, error: reqError } = await supabaseClient
      .from('document_requirements')
      .select('id')
      .eq('document_type', 'Копія рекомендаційного листа')
      .eq('active', true)
      .limit(1)
      .maybeSingle();

    if (reqError) {
      console.error('Recommendation requirement lookup:', reqError);
      await supabaseClient.storage.from('candidate-documents').remove([storagePath]);
      return { ok: false, reason: `Вимога документа: ${reqError.message}` };
    }

    const { error: docError } = await supabaseClient
      .from('documents')
      .insert({
        candidate_id: candidateId,
        requirement_id: req?.id || null,
        document_type: 'Рекомендаційний лист',
        document_name: 'Рекомендаційний лист',
        storage_path: storagePath,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type || 'application/pdf',
        uploaded_by: user?.id || null,
        status: 'Завантажено',
        processing_status: 'Не потребує AI',
        verification_status: 'Підтверджено'
      });

    if (docError) {
      console.error('Recommendation documents insert:', docError);
      await supabaseClient.storage.from('candidate-documents').remove([storagePath]);
      return { ok: false, reason: `Реєстр документів: ${docError.message}` };
    }

    return { ok: true, storagePath, verified: true };
  };

  console.info('PSK recommendation upload fix v2 loaded');
})();
