// Local OCR-only bridge for recommendation documents.
// Loaded after script.js. Disables the AI extraction branch without changing
// the existing OCR, parser, preview, or save flow.
(function () {
  window.aiExtractRecommendation = async function (text) {
    if (typeof window.parseRecommendation !== 'function') {
      throw new Error('Локальний parser рекомендаційного листа недоступний');
    }
    return window.parseRecommendation(text);
  };
})();
