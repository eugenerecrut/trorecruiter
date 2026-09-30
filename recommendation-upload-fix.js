// PSK_RECRUTER CRM — recommendation upload + AI extraction compatibility fix v8
// AI extraction is performed by the protected Supabase Edge Function.
(function () {
  function getSupabaseClient() {
    if (window.supabaseClient) return window.supabaseClient;
    try { if (typeof supabaseClient !== 'undefined') return supabaseClient; } catch (_) {}
    return null;
  }
  function safeAsciiName(name) {
    const original = String(name || 'recommendation.pdf');
    const extMatch = original.match(/(\.[A-Za-z0-9]{1,8})$/);
    const ext = extMatch ? extMatch[1].toLowerCase() : '.pdf';
    const base = original.slice(0, original.length - (extMatch ? ext.length : 0));
    const ascii = base.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120) || 'recommendation';
    return `${ascii}${ext}`;
  }
  function getRecommendationFile() {
    const exact = document.getElementById('recommendationFile')?.files?.[0];
    if (exact) return exact;
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    const selected = inputs.flatMap(i => Array.from(i.files || []));
    return selected.find(f => /рекомендац|recommendation/i.test(f.name)) || selected.find(f => /\.pdf$/i.test(f.name)) || selected[0] || null;
  }
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => { const result = String(reader.result || ''); const comma = result.indexOf(','); resolve(comma >= 0 ? result.slice(comma + 1) : result); };
      reader.onerror = () => reject(reader.error || new Error('Не вдалося прочитати файл'));
      reader.readAsDataURL(file);
    });
  }
  function flattenAIExtraction(extracted) {
    const p = extracted?.personal || {};
    const s = extracted?.service || {};
    const n = extracted?.name_cases || {};
    return {
      full_name: p.full_name || '', birth_date: p.birth_date || '', phone: p.phone || '', address: p.address || '',
      rnokpp: p.rnokpp || '', military_rank: p.military_rank || '', tcc: p.tcc || '', civilian_profession: p.civilian_profession || '',
      gender: n.gender || '', name_nominative: n.nominative || p.full_name || '', name_genitive: n.genitive || '', name_dative: n.dative || '',
      name_accusative: n.accusative || '', name_instrumental: n.instrumental || '', name_locative: n.locative || '', name_vocative: n.vocative || '',
      military_unit: s.military_unit || '', desired_unit: s.desired_unit || '', desired_position: s.desired_position || '', shpk: s.shpk || '',
      military_specialty: s.military_specialty || '', tariff_grade: s.tariff_grade || '', service_type: s.service_type || '',
      recommender_unit: s.recommender_unit || '', recruiter_name: s.recruiter_name || '', signatory: s.signatory || '',
      relatives: Array.isArray(extracted?.relatives) ? extracted.relatives : [],
      source: extracted?.meta?.source || 'Рекомендаційний лист',
      missing_fields: Array.isArray(extracted?.meta?.missing_fields) ? extracted.meta.missing_fields : [],
      warnings: Array.isArray(extracted?.meta?.warnings) ? extracted.meta.warnings : []
    };
  }
  async function invokeAI(body) {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase-клієнт CRM не ініціалізовано.');
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw new Error(`Сесія CRM: ${sessionError.message}`);
    const accessToken = sessionData?.session?.access_token;
    if (!accessToken) throw new Error('Немає активної сесії CRM. Увійдіть повторно.');
    if (client.functions?.invoke) {
      const result = await client.functions.invoke('ai-extract-recommendation', { body });
      if (!result.error && result.data?.extracted) return result.data;
      let detail = result?.error?.message || 'AI-виборка не виконана.';
      try { const ctx = result.error?.context; if (ctx && typeof ctx.json === 'function') { const server = await ctx.json(); detail = server?.error || server?.message || detail; } } catch (_) {}
      try {
        const response = await fetch('https://vhfysipxorlhuiaatxqi.supabase.co/functions/v1/ai-extract-recommendation', { method:'POST', headers:{'Authorization':`Bearer ${accessToken}`,'apikey':'sb_publishable_o8ZTKE4Ek0m58zq1q0QpFQ_domIX0Yz','Content-Type':'application/json'}, body:JSON.stringify(body) });
        const raw = await response.text(); let parsed = null; try { parsed = JSON.parse(raw); } catch (_) {}
        if (!response.ok) throw new Error(parsed?.error || parsed?.message || `HTTP ${response.status}: ${raw.slice(0,300)}`);
        if (!parsed?.extracted) throw new Error('Edge Function не повернула структурованих даних.');
        return parsed;
      } catch (directError) { throw new Error(`${detail} ${directError?.message || ''}`.trim()); }
    }
    throw new Error('Supabase Functions API недоступний у браузері.');
  }
  window.aiExtractRecommendation = async function (text) {
    const file = getRecommendationFile();
    const body = { text: String(text || '') };
    if (file) {
      if (file.size > 11000000) throw new Error('Файл завеликий для AI-виборки. Використайте PDF до 11 МБ.');
      body.file_base64 = await fileToBase64(file);
      body.mime_type = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
      body.filename = file.name || 'recommendation.pdf';
    }
    const data = await invokeAI(body);
    if (!data?.extracted) throw new Error(data?.error || 'AI не повернув структурованих даних.');
    return flattenAIExtraction(data.extracted);
  };
  window.uploadRecommendation = async function (candidateId, user) {
    const client = getSupabaseClient(); const file = getRecommendationFile();
    if (!client) return { ok:false, reason:'Supabase-клієнт CRM не ініціалізовано' };
    if (!candidateId) return { ok:false, reason:'Не визначено кандидата' };
    if (!file) return { ok:false, reason:'Файл рекомендаційного листа не вибрано' };
    const fileName = `${Date.now()}_${safeAsciiName(file.name)}`; const storagePath = `${candidateId}/recommendation/${fileName}`;
    const { error: uploadError } = await client.storage.from('candidate-documents').upload(storagePath,file,{upsert:false,contentType:file.type || 'application/pdf'});
    if (uploadError) return { ok:false, reason:`Storage: ${uploadError.message}` };
    const { data:req,error:reqError } = await client.from('document_requirements').select('id').eq('document_type','Копія рекомендаційного листа').eq('active',true).limit(1).maybeSingle();
    if (reqError) { await client.storage.from('candidate-documents').remove([storagePath]); return { ok:false, reason:`Вимога документа: ${reqError.message}` }; }
    const { error:docError } = await client.from('documents').insert({candidate_id:candidateId,requirement_id:req?.id||null,document_type:'Рекомендаційний лист',document_name:'Рекомендаційний лист',storage_path:storagePath,file_name:file.name,file_size:file.size,mime_type:file.type||'application/pdf',uploaded_by:user?.id||null,status:'Завантажено',processing_status:'AI-структуровано',verification_status:'Підтверджено'});
    if (docError) { await client.storage.from('candidate-documents').remove([storagePath]); return { ok:false, reason:`Реєстр документів: ${docError.message}` }; }
    return { ok:true, storagePath, verified:true };
  };
  console.info('PSK recommendation upload + AI extraction fix v8 loaded');
})();
