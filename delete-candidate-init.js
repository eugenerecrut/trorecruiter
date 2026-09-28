// Temporary deletion helper bootstrap.
// It is safe to include this after supabase configuration is loaded.
window.addEventListener('DOMContentLoaded', function () {
  if (typeof deleteCandidateCase !== 'function') {
    console.warn('deleteCandidateCase helper is not loaded yet.');
  }
});
