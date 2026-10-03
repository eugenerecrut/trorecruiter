// Private candidate document previews. No photos or signed URLs are persisted locally.
(function () {
  'use strict';
  const cache = new Map();
  let pdfReady, observer, generation = 0;
  const pending = new WeakMap();
  const renders = new WeakMap();
  function initials(name) {
    return String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => Array.from(part)[0]).join('').toLocaleUpperCase('uk-UA') || '—';
  }
  function markup(candidate) {
    const name = candidate.name_nominative || candidate.full_name || 'Кандидат';
    return '<button type="button" class="candidate-identity" data-photo-open="' + escapeHtml(candidate.id) + '" aria-label="Відкрити справу: ' + escapeHtml(name) + '"><span class="candidate-avatar" data-candidate-photo="' + escapeHtml(candidate.id) + '" aria-hidden="true"><span>' + escapeHtml(initials(name)) + '</span></span><b>' + escapeHtml(name) + '</b></button>';
  }
  function clear() {
    generation++;
    observer?.disconnect();
    for (const value of cache.values()) if (value.url) URL.revokeObjectURL(value.url);
    cache.clear();
    document.querySelectorAll('[data-candidate-photo] img').forEach(image => image.remove());
  }
  async function thumbnail(doc) {
    const key = doc.id + ':' + doc.storage_path;
    const old = cache.get(key);
    if (old && old.expires > Date.now()) return old.promise;
    if (old?.url) URL.revokeObjectURL(old.url);
    const entry = {expires: Date.now() + 60000, url: null};
    const started = generation;
    entry.promise = (async () => {
      const {data, error} = await supabaseClient.storage.from('candidate-documents').createSignedUrl(doc.storage_path, 60);
      if (error || !data?.signedUrl) return null;
      const response = await fetch(data.signedUrl);
      if (!response.ok) return null;
      const blob = await response.blob();
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) return null;
      if (/pdf/i.test(doc.mime_type || '') || /\.pdf$/i.test(doc.file_name || '')) {
        pdfReady ||= loadExternalScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', 'pdfjsLib').catch(error => {pdfReady = null; throw error;});
        await pdfReady;
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        const pdf = await pdfjsLib.getDocument({data: new Uint8Array(await blob.arrayBuffer())}).promise;
        try {
          const page = await pdf.getPage(1), size = page.getViewport({scale: 1});
          const viewport = page.getViewport({scale: 160 / Math.max(size.width, size.height)});
          canvas.width = Math.max(1, Math.ceil(viewport.width)); canvas.height = Math.max(1, Math.ceil(viewport.height));
          await page.render({canvasContext: context, viewport, background: '#ffffff'}).promise;
        } finally {await pdf.destroy();}
      } else if (blob.type.startsWith('image/') && !/svg/i.test(blob.type)) {
        const bitmap = await createImageBitmap(blob);
        try {
          const scale = Math.min(1, 160 / Math.max(bitmap.width, bitmap.height));
          canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
          context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        } finally {bitmap.close();}
      } else return null;
      const preview = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82));
      if (!preview || started !== generation) return null;
      entry.url = URL.createObjectURL(preview);
      return entry.url;
    })().catch(() => null);
    cache.set(key, entry);
    if (cache.size > 100) {
      const first = cache.keys().next().value, removed = cache.get(first);
      if (removed?.url) URL.revokeObjectURL(removed.url);
      cache.delete(first);
    }
    return entry.promise;
  }
  async function load(slot, doc, started) {
    if (!slot.isConnected || started !== generation) return;
    const url = await thumbnail(doc);
    if (!url || !slot.isConnected || started !== generation) return;
    const image = document.createElement('img'); image.alt = ''; image.src = url; image.width = 48; image.height = 64;
    image.addEventListener('load', () => {if (slot.isConnected && image.isConnected && started === generation) {slot.querySelector('span').hidden = true;}});
    image.addEventListener('error', () => {image.remove(); slot.querySelector('span').hidden = false;});
    slot.append(image);
  }
  async function hydrate(container, candidates) {
    const started = generation;
    const renderId = (renders.get(container) || 0) + 1;
    renders.set(container, renderId);
    observer?.disconnect();
    if (!container?.isConnected || !candidates.length) return;
    container.querySelectorAll('[data-photo-open]').forEach(button => button.addEventListener('click', event => {
      event.stopPropagation(); crmNavigate('card', button.dataset.photoOpen);
    }));
    const documents = [];
    try {
      for (let i = 0; i < candidates.length; i += 100) {
        const {data, error} = await supabaseClient.from('documents')
          .select('id,candidate_id,document_type,document_name,storage_path,file_name,mime_type,created_at')
          .in('candidate_id', candidates.slice(i, i + 100).map(candidate => candidate.id))
          .or('document_type.ilike.%фото%,document_name.ilike.%фото%')
          .order('created_at', {ascending: false}).order('id', {ascending: false});
        if (error) return;
        documents.push(...(data || []));
      }
      if (!container.isConnected || started !== generation || renders.get(container) !== renderId) return;
      const latest = new Map();
      documents.forEach(doc => {
        if (!latest.has(doc.candidate_id) && /фото\s*9\s*[×xх\/]\s*12/i.test((doc.document_type || '') + ' ' + (doc.document_name || '')) && doc.storage_path) latest.set(doc.candidate_id, doc);
      });
      observer ||= new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          observer.unobserve(entry.target);
          const value = pending.get(entry.target);
          if (value) {pending.delete(entry.target); load(entry.target, value.doc, value.started);}
        });
      }, {rootMargin: '120px'});
      container.querySelectorAll('[data-candidate-photo]').forEach(slot => {
        const doc = latest.get(slot.dataset.candidatePhoto);
        if (!doc) {slot.title = 'Фото ще не додано'; return;}
        slot.title = 'Фото кандидата'; pending.set(slot, {doc, started}); observer.observe(slot);
      });
    } catch (_) { /* Initials remain available on network or storage errors. */ }
  }
  document.addEventListener('DOMContentLoaded', () => {
    supabaseClient.auth.onAuthStateChange(event => {if (event === 'SIGNED_OUT') clear();});
  });
  window.CandidatePhotos = {markup, hydrate, clear};
})();
