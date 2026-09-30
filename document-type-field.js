/* PSK_DOCUMENT_TYPE_FIELD_V1 */
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
        return await originalSave(event);
      } finally {
        if (notes) notes.value = originalNotes;
      }
    };
  }

  document.addEventListener('DOMContentLoaded', () => {
    ensureDocumentTypeField();
  });
})();
