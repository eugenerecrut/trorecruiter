// Loader for the temporary candidate deletion helper.
// This file is intentionally separate so the deletion feature can be removed later.
(function () {
  const script = document.createElement('script');
  script.src = 'delete-candidate.js';
  script.defer = true;
  document.head.appendChild(script);
})();
