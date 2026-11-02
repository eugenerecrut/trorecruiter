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

  function isolatePortrait(canvas) {
    if (!canvas) return canvas;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return canvas;
    const w = canvas.width, h = canvas.height;
    if (w < 60 || h < 60) return canvas;

    let imgData;
    try {
      imgData = ctx.getImageData(0, 0, w, h);
    } catch (_) {
      return canvas;
    }
    const data = imgData.data;

    const getLum = (x, y) => {
      const idx = (y * w + x) * 4;
      return 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
    };

    const isPaper = (x, y) => {
      const idx = (y * w + x) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      return lum > 130 && (b <= r + 35);
    };

    // 1. Detect paper boundary (if photo sheet is on dark or colored desk/folder)
    let top = 0, bottom = h - 1, left = 0, right = w - 1;
    const minSpanX = Math.floor(w * 0.35);
    const minSpanY = Math.floor(h * 0.35);

    for (let y = 0; y < Math.floor(h * 0.4); y += 2) {
      let paperCount = 0;
      for (let x = 0; x < w; x += 3) {
        if (isPaper(x, y)) paperCount++;
      }
      if (paperCount * 3 > minSpanX) { top = y; break; }
    }

    for (let y = h - 1; y > Math.floor(h * 0.6); y -= 2) {
      let paperCount = 0;
      for (let x = 0; x < w; x += 3) {
        if (isPaper(x, y)) paperCount++;
      }
      if (paperCount * 3 > minSpanX) { bottom = y; break; }
    }

    for (let x = 0; x < Math.floor(w * 0.4); x += 2) {
      let paperCount = 0;
      for (let y = top; y <= bottom; y += 3) {
        if (isPaper(x, y)) paperCount++;
      }
      if (paperCount * 3 > minSpanY) { left = x; break; }
    }

    for (let x = w - 1; x > Math.floor(w * 0.6); x -= 2) {
      let paperCount = 0;
      for (let y = top; y <= bottom; y += 3) {
        if (isPaper(x, y)) paperCount++;
      }
      if (paperCount * 3 > minSpanY) { right = x; break; }
    }

    const pw = right - left;
    const ph = bottom - top;
    if (pw < w * 0.3 || ph < h * 0.3) return canvas;

    // 2. Check for 2-column or 2x2 multi-photo layout:
    // Center vertical line (between col 1 and col 2) is bright paper gutter
    const cx = Math.floor(left + pw * 0.5);
    const q1x = Math.floor(left + pw * 0.28);
    const q2x = Math.floor(left + pw * 0.72);

    let divLum = 0, q1Lum = 0, q2Lum = 0, samples = 0;
    for (let y = Math.floor(top + ph * 0.2); y < Math.floor(top + ph * 0.45); y += 3) {
      divLum += getLum(cx, y);
      q1Lum += getLum(q1x, y);
      q2Lum += getLum(q2x, y);
      samples++;
    }
    const avgDiv = samples ? divLum / samples : 0;
    const avgQ1 = samples ? q1Lum / samples : 0;
    const avgQ2 = samples ? q2Lum / samples : 0;

    const isMultiPhoto = (avgDiv > 165 && avgDiv > avgQ1 + 15 && avgDiv > avgQ2 + 15) ||
                         (pw > w * 0.5 && ph > h * 0.5 && (left > 10 || right < w - 10 || top > 10 || bottom < h - 10) && avgDiv > 160);

    if (!isMultiPhoto) return canvas;

    // 3. Crop top-left single portrait photo with exact 3:4 aspect ratio
    const cropX = Math.round(left + pw * 0.05);
    const cropY = Math.round(top + ph * 0.035);
    let cropW = Math.round(pw * 0.44);
    let cropH = Math.round(ph * 0.44);

    const targetAspect = 3 / 4;
    if (cropW / cropH > targetAspect) {
      cropW = Math.round(cropH * targetAspect);
    } else {
      cropH = Math.round(cropW / targetAspect);
    }

    const out = document.createElement('canvas');
    out.width = 120;
    out.height = 160;
    const outCtx = out.getContext('2d');
    outCtx.fillStyle = '#ffffff';
    outCtx.fillRect(0, 0, 120, 160);
    outCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, 120, 160);
    return out;
  }

  async function cropDataUrl(dataUrl) {
    if (!dataUrl || typeof dataUrl !== 'string') return dataUrl;
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || img.width;
          canvas.height = img.naturalHeight || img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const finalCanvas = isolatePortrait(canvas);
          resolve(finalCanvas.toDataURL('image/jpeg', 0.88));
        } catch (_) {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  async function cropBlob(blob, docRecord) {
    if (!blob) return null;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return null;

    const isPdf = /pdf/i.test(docRecord?.mime_type || blob.type || '') || /\.pdf$/i.test(docRecord?.file_name || '');
    if (isPdf) {
      pdfReady ||= loadExternalScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', 'pdfjsLib').catch(error => {pdfReady = null; throw error;});
      await pdfReady;
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const pdf = await pdfjsLib.getDocument({data: new Uint8Array(await blob.arrayBuffer())}).promise;
      try {
        const page = await pdf.getPage(1), size = page.getViewport({scale: 1});
        const renderScale = Math.min(2.5, 600 / Math.max(size.width, size.height));
        const viewport = page.getViewport({scale: Math.max(1, renderScale)});
        canvas.width = Math.max(1, Math.ceil(viewport.width));
        canvas.height = Math.max(1, Math.ceil(viewport.height));
        await page.render({canvasContext: context, viewport, background: '#ffffff'}).promise;
      } finally { await pdf.destroy(); }
    } else {
      const bitmap = await createImageBitmap(blob);
      try {
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        context.drawImage(bitmap, 0, 0);
      } finally { bitmap.close(); }
    }

    const finalCanvas = isolatePortrait(canvas);
    return new Promise(resolve => finalCanvas.toBlob(resolve, 'image/jpeg', 0.90));
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
          const renderScale = Math.min(2.5, 480 / Math.max(size.width, size.height));
          const viewport = page.getViewport({scale: Math.max(1, renderScale)});
          canvas.width = Math.max(1, Math.ceil(viewport.width)); canvas.height = Math.max(1, Math.ceil(viewport.height));
          await page.render({canvasContext: context, viewport, background: '#ffffff'}).promise;
        } finally {await pdf.destroy();}
      } else if (blob.type.startsWith('image/') && !/svg/i.test(blob.type)) {
        const bitmap = await createImageBitmap(blob);
        try {
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          context.drawImage(bitmap, 0, 0);
        } finally {bitmap.close();}
      } else return null;

      const finalCanvas = isolatePortrait(canvas);
      const preview = await new Promise(resolve => finalCanvas.toBlob(resolve, 'image/jpeg', 0.85));
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
          .select('id,candidate_id,document_type,document_name,storage_path,file_name,mime_type,created_at,version_group_id,version_number,deleted_at')
          .in('candidate_id', candidates.slice(i, i + 100).map(candidate => candidate.id))
          .or('document_type.ilike.%фото%,document_name.ilike.%фото%')
          .order('created_at', {ascending: false}).order('id', {ascending: false});
        if (error) return;
        documents.push(...(data || []));
      }
      if (!container.isConnected || started !== generation || renders.get(container) !== renderId) return;
      const latest = new Map();
      CRMResponsibility.latest(documents).forEach(doc => {
        if (!latest.has(doc.candidate_id) && /фото\s*3\s*[×xх\/]\s*4/i.test((doc.document_type || '') + ' ' + (doc.document_name || '')) && doc.storage_path) latest.set(doc.candidate_id, doc);
      });
      CRMResponsibility.latest(documents).forEach(doc => {
        if (!latest.has(doc.candidate_id) && /фото\s*9\s*[×xх\/]\s*12/i.test((doc.document_type || '') + ' ' + (doc.document_name || '')) && doc.storage_path) latest.set(doc.candidate_id, doc);
      });
      CRMResponsibility.latest(documents).forEach(doc => {
        if (!latest.has(doc.candidate_id) && /фото/i.test((doc.document_type || '') + ' ' + (doc.document_name || '')) && doc.storage_path) latest.set(doc.candidate_id, doc);
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
  window.CandidatePhotos = {markup, hydrate, clear, isolatePortrait, cropDataUrl, cropBlob};
})();
