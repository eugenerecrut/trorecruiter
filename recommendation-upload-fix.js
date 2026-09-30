// PSK_RECRUTER CRM — recommendation upload compatibility fix v3
// Storage-safe upload + AI extraction from the original recommendation file.
(function () {
  function safeAsciiName(name) {
    const original = String(name || 'recommendation.pdf');
    const extMatch = original.match(/(\.[A-Za-z0-9]{1,8})$/);
    const ext = extMatch ? extMatch[1].toLowerCase() : '.pdf';
    const base = original.slice(0, original.length - (extMatch ? ext.length : 0));
    const ascii = base.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120) || 'recommendation';
    return `${ascii}${ext}`;
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = () => reject(reader.error || new Error('Не вдалося прочитати файл'));
      reader.readAsDataURL(file);
    });
  }

  // For recommendation letters, AI receives the original file as well as OCR text.
  window.aiExtractRecommendation = async function (text) {
    const file = document.getElementById('recommendationFile')?.files?.[0] || null;
    const body = { text: String(text || '') };

    if (file) {
      if (file.size > 11000000) throw new Error('Файл завеликий для AI-виборки. Використайте PDF до 11 МБ.');
      body.file_base64 = await fileToBase64(file);
      body.mime_type = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
      body.filename = file.name || 'recommendation.pdf';
    }

    const { data, error } = await supabaseClient.functions.invoke('ai-extract-recommendation', { body });
    if (error) throw new Error(error.message || 'Не вдалося викликати AI-виборку.');
    if (!data?.extracted) throw new Error(data?.error || 'AI не повернув структурованих даних.');
    return flattenAIExtraction(data.extracted);
  };

  window.uploadRecommendation = async function (candidateId, user) {
    const file = document.getElementById('recommendationFile')?.files?.[0] || null;
    if (!candidateId) return { ok: false, reason: 'Не визначено кандидата' };
    if (!file) return { ok: false, reason: 'Файл рекомендаційного листа не вибрано' };

    const fileName = `${Date.now()}_${safeAsciiName(file.name)}`;
    const storagePath = `${candidateId}/recommendation/${fileName}`;

    const { error: uploadError } = await supabaseClient.storage.from('candidate-documents').upload(storagePath, file, {
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

    const { error: docError } = await supabaseClient.from('documents').insert({
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
      processing_status: 'AI-структуровано',
      verification_status: 'Підтверджено'
    });

    if (docError) {
      console.error('Recommendation documents insert:', docError);
      await supabaseClient.storage.from('candidate-documents').remove([storagePath]);
      return { ok: false, reason: `Реєстр документів: ${docError.message}` };
    }

    return { ok: true, storagePath, verified: true };
  };

  console.info('PSK recommendation upload + AI extraction fix v3 loaded');
})();
