// PSK_RECRUTER CRM — recommendation extraction bridge
// OCR remains local. Structured extraction uses the dedicated AI function.
// Local parser is kept only as an explicit fallback and no longer overrides AI.
(function () {
  window.aiExtractRecommendationLocalFallback = async function (text) {
    if (typeof window.parseRecommendation !== 'function') {
      throw new Error('Локальний parser рекомендаційного листа недоступний');
    }
    return window.parseRecommendation(text);
  };

  console.info('PSK recommendation bridge: AI extraction enabled; local parser kept as fallback');
})();
