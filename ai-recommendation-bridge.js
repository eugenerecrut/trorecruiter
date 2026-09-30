// PSK_RECRUTER — AI recommendation bridge
// Preserve the AI implementation installed by recommendation-upload-fix.js
// and replace the legacy lexical function used by script.js.
(function () {
  const ai = window.aiExtractRecommendation;
  if (typeof ai !== 'function') return;
  window.pskAIExtractRecommendation = ai;
  window.aiExtractRecommendation = async function (text) {
    return window.pskAIExtractRecommendation(text);
  };
  console.info('PSK recommendation AI bridge loaded');
})();
