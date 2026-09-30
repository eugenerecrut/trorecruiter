// PSK_RECRUTER — AI recommendation bridge
// The main script contains a legacy lexical aiExtractRecommendation(text) function.
// This later-loaded function intentionally replaces that legacy binding and delegates
// to recommendation-upload-fix.js, which sends OCR + the original file to Supabase AI.
async function aiExtractRecommendation(text) {
  if (typeof window.aiExtractRecommendation === 'function' && window.aiExtractRecommendation !== aiExtractRecommendation) {
    return window.aiExtractRecommendation(text);
  }
  throw new Error('AI recommendation bridge is not initialized');
}
