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
    try { if(typeof pendingRecommendationFile!=='undefined'&&pendingRecommendationFile)return pendingRecommendationFile; } catch(_) {}
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
    extracted = window.CRMDocumentSync.flatten(extracted);
    const p = extracted;
    const s = extracted;
    const n = {...(extracted?.name_cases || {})};
    for(const key of ['nominative','genitive','dative','accusative','instrumental','locative','vocative'])n[key]=n[key]||extracted['name_'+key];
    return {
      full_name: p.full_name || '', birth_date: p.birth_date || '', phone: p.phone || '', address: p.address || '',
      rnokpp: p.rnokpp || '', military_rank: p.military_rank || '', tcc: p.tcc || '', civilian_profession: p.civilian_profession || '',
      sex: ['male','female'].includes(p.sex) ? p.sex : '', name_gender: p.sex === 'male' ? 'Чоловіча' : p.sex === 'female' ? 'Жіноча' : n.gender || '',
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
      let token=accessToken;
      for(let attempt=0;attempt<2;attempt++){
        const result=await client.functions.invoke('ai-extract-recommendation',{body,headers:{Authorization:`Bearer ${token}`},timeout:110000});
        if(!result.error&&result.data?.extracted)return result.data;
        const status=result.error?.context?.status||result.error?.status;
        if(status===401&&attempt===0&&typeof client.auth.refreshSession==='function'){
          const refreshed=await client.auth.refreshSession();
          if(!refreshed.error&&refreshed.data?.session?.access_token){token=refreshed.data.session.access_token;continue;}
        }
        let detail=result.error?.message||'AI не повернув структурованих даних.';
        try{const server=await result.error?.context?.json?.();detail=server?.error||server?.message||detail;}catch(_){}
        if(status===401)detail='Сесія CRM завершилась. Увійдіть повторно та повторіть розпізнавання.';
        else if(status===403)detail='Немає доступу до AI-обробки. Перевірте обліковий запис CRM.';
        else if(status===429)detail='Ліміт AI тимчасово вичерпано. Повторіть пізніше.';
        else if(status===503)detail='Сервіс AI тимчасово недоступний. Повторіть пізніше.';
        const error=new Error(detail);error.status=status;throw error;
      }
    }
    throw new Error('Supabase Functions API недоступний у браузері.');
  }
  let recognizedFile=null,recognizedResponse=null;
  window.aiExtractRecommendation = async function (text) {
    recognizedFile=null;recognizedResponse=null;
    const file = await CRMUploadPDF.prepare(getRecommendationFile());
    const body = { text: String(text || '') };
    if (file) {
      if (file.size > 11000000) throw new Error('Файл завеликий для AI-виборки. Використайте PDF до 11 МБ.');
      body.file_base64 = await fileToBase64(file);
      body.mime_type = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
      body.filename = file.name || 'recommendation.pdf';
    }
    const data = await invokeAI(body);
    if (!data?.extracted) throw new Error(data?.error || 'AI не повернув структурованих даних.');
    recognizedFile=file;recognizedResponse=structuredClone(data);
    const flat=flattenAIExtraction(data.extracted);
    for(const k of ['full_name','military_specialty','shpk','tariff_grade','military_rank','recruiter_name','signatory','desired_position'])if(!window.CRMDocumentSync.valid(k,flat[k])){flat.warnings.push('Некоректне OCR-значення '+k+': '+flat[k]);flat[k]='';}
    return flat;
  };
  window.uploadRecommendation = async function (candidateId, user) {
    const client = getSupabaseClient(); let file;
    try { file = await CRMUploadPDF.prepare(getRecommendationFile()); } catch(error) { return { ok:false, reason:error.message }; }
    if (!client) return { ok:false, reason:'Supabase-клієнт CRM не ініціалізовано' };
    if (!candidateId) return { ok:false, reason:'Не визначено кандидата' };
    if (!file) return { ok:false, reason:'Файл рекомендаційного листа не вибрано' };
    const fileName = `${Date.now()}_${safeAsciiName(file.name)}`; const storagePath = `${candidateId}/recommendation/${fileName}`;
    const { error: uploadError } = await client.storage.from('candidate-documents').upload(storagePath,file,{upsert:false,contentType:file.type || 'application/pdf'});
    if (uploadError) return { ok:false, reason:`Storage: ${uploadError.message}` };
    const { data:req,error:reqError } = await client.from('document_requirements').select('id').eq('document_type','Копія рекомендаційного листа').eq('active',true).limit(1).maybeSingle();
    if (reqError) { await client.storage.from('candidate-documents').remove([storagePath]); return { ok:false, reason:`Вимога документа: ${reqError.message}` }; }
    const { data:savedDocument, error:docError } = await client.from('documents').insert({candidate_id:candidateId,requirement_id:req?.id||null,document_type:'Рекомендаційний лист',document_name:'Рекомендаційний лист',storage_path:storagePath,file_name:file.name,file_size:file.size,mime_type:file.type||'application/pdf',uploaded_by:user?.id||null,status:'Завантажено',processing_status:recognizedFile===file&&recognizedResponse?'AI оброблено':'Завантажено',verification_status:'Не перевірено',...(recognizedFile===file&&recognizedResponse?{ai_raw_response:recognizedResponse,ai_extracted:recognizedResponse.extracted,ai_model:recognizedResponse.model||null,ai_processed_at:new Date().toISOString(),ai_document_type:'Рекомендаційний лист',ai_warnings:recognizedResponse.warnings||[],ai_confidence:recognizedResponse.confidence??null}:{})}).select('id').single();
    if (docError) { await client.storage.from('candidate-documents').remove([storagePath]); return { ok:false, reason:`Реєстр документів: ${docError.message}` }; }
    let syncWarning='';
    if(recognizedFile===file&&recognizedResponse)try{await CRMDocumentSync.sync(client,savedDocument.id)}catch(err){syncWarning=err.message}
    return { ok:true, storagePath, verified:false, syncWarning };
  };

  console.info('PSK recommendation upload + AI extraction fix v8 loaded');
})();
