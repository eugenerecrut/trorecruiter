/* PSK_DOCUMENT_TYPE_FIELD_V2 */
(() => {
  const DOCUMENT_TYPE = 'Рекомендаційний лист';

  function ensureDocumentTypeField() {
    const form = document.getElementById('candidateForm');
    if (!form || form.elements.document_type) return;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <label>Тип документа</label>
      <input name="document_type" value="${DOCUMENT_TYPE}" readonly
        style="width:100%;padding:10px 11px;border:1px solid #cfd8dc;border-radius:8px;background:#f5f7f8;color:#24313a">
    `;

    const notes = form.elements.notes;
    if (notes?.parentElement) notes.parentElement.before(wrapper.firstElementChild);
    if (notes?.parentElement) notes.parentElement.before(wrapper.lastElementChild);
    else form.appendChild(wrapper);
  }

  function addExtractionField() {
    const grid = document.getElementById('extractionGrid');
    if (!grid || grid.querySelector('[data-document-type-field]')) return;

    const block = document.createElement('div');
    block.setAttribute('data-document-type-field', '1');
    block.style.cssText = 'padding:10px 0;border-bottom:1px solid #e6edcf';
    block.innerHTML = `
      <div style="font-size:10px;color:#89959c;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Тип документа</div>
      <div style="font-weight:800;color:#34414a">${DOCUMENT_TYPE}</div>
    `;
    grid.appendChild(block);
  }

  function enrichRecommenderUnit(parsed) {
    if (!parsed || parsed.recommender_unit || !parsed.raw_text) return parsed;
    const flat = String(parsed.raw_text).replace(/\s+/g, ' ').trim();
    const m = flat.match(/У\s+(\d+\s+центрі.+?військової\s+частини\s+[А-ЯІЇЄҐA-Z]\d{2,6})\s+попередньо\s+вивчено/iu);
    if (m?.[1]) parsed.recommender_unit = m[1].trim();
    return parsed;
  }

  async function ensureRecommendationDocumentRegistered(candidateId, userId) {
    if (!candidateId) return { ok: false, reason: 'Не визначено кандидата' };

    const { data: existing, error: existingError } = await supabaseClient
      .from('documents')
      .select('id,storage_path,document_type')
      .eq('candidate_id', candidateId)
      .eq('document_type', DOCUMENT_TYPE)
      .limit(1);

    if (existingError) return { ok: false, reason: existingError.message };
    if (existing?.length) return { ok: true, created: false };

    const { data: req } = await supabaseClient
      .from('document_requirements')
      .select('id')
      .eq('document_type', 'Копія рекомендаційного листа')
      .eq('active', true)
      .limit(1)
      .maybeSingle();

    const { data: objects, error: listError } = await supabaseClient.storage
      .from('candidate-documents')
      .list(`${candidateId}/recommendation`, { limit: 20, sortBy: { column: 'created_at', order: 'desc' } });

    if (listError) return { ok: false, reason: listError.message };
    const file = (objects || []).find(x => x.name && !x.name.endsWith('/'));
    if (!file) return { ok: false, reason: 'Файл рекомендаційного листа у Storage не знайдено' };

    const storagePath = `${candidateId}/recommendation/${file.name}`;
    const { error: insertError } = await supabaseClient.from('documents').insert({
      candidate_id: candidateId,
      requirement_id: req?.id || null,
      document_type: DOCUMENT_TYPE,
      document_name: DOCUMENT_TYPE,
      storage_path: storagePath,
      file_name: file.name,
      file_size: Number(file.metadata?.size || 0) || null,
      mime_type: file.metadata?.mimetype || null,
      uploaded_by: userId || null,
      status: 'Завантажено',
      verification_status: 'Не перевірено',
      processing_status: 'AI оброблено'
    });

    if (insertError) return { ok: false, reason: insertError.message };
    return { ok: true, created: true };
  }

  const originalParse = window.parseRecommendation;
  if (typeof originalParse === 'function') {
    window.parseRecommendation = function(text) {
      return enrichRecommenderUnit(originalParse(text));
    };
  }

  const originalRender = window.renderExtraction;
  if (typeof originalRender === 'function') {
    window.renderExtraction = function(parsed) {
      originalRender(enrichRecommenderUnit(parsed));
      addExtractionField();
    };
  }

  const originalFill = window.fillCandidateForm;
  if (typeof originalFill === 'function') {
    window.fillCandidateForm = function(parsed) {
      originalFill(enrichRecommenderUnit(parsed));
      ensureDocumentTypeField();
      const input = document.getElementById('candidateForm')?.elements?.document_type;
      if (input) input.value = DOCUMENT_TYPE;
    };
  }

  const originalSave = window.saveCandidateFromRecommendation;
  if (typeof originalSave === 'function') {
    window.saveCandidateFromRecommendation = async function(event) {
      ensureDocumentTypeField();
      const form = event?.target;
      const notes = form?.elements?.notes;
      const originalNotes = notes?.value || '';
      if (notes && !originalNotes.includes('Тип документа: Рекомендаційний лист')) {
        notes.value = `${originalNotes}${originalNotes ? '\n\n' : ''}Тип документа: ${DOCUMENT_TYPE}`;
      }
      try {
        const result = await originalSave(event);

        // The normal save path already writes to documents. This is a repair guard
        // for older/new-candidate flows where the file reached Storage but the DB row did not.
        const fullName = String(form?.elements?.full_name?.value || '').trim();
        if (fullName) {
          const { data: candidates } = await supabaseClient
            .from('candidates')
            .select('id,recruiter_id,created_at')
            .eq('full_name', fullName)
            .order('created_at', { ascending: false })
            .limit(1);
          const candidate = candidates?.[0];
          if (candidate) {
            const user = typeof getCurrentUser === 'function' ? await getCurrentUser() : null;
            const repair = await ensureRecommendationDocumentRegistered(candidate.id, user?.id || candidate.recruiter_id || null);
            if (repair.created) console.info('Документ рекомендаційного листа зареєстровано в documents.');
            if (!repair.ok) console.warn('Перевірка реєстрації рекомендаційного листа:', repair.reason);
          }
        }
        return result;
      } finally {
        if (notes) notes.value = originalNotes;
      }
    };
  }

  document.addEventListener('DOMContentLoaded', () => {
    ensureDocumentTypeField();
  });
})();
