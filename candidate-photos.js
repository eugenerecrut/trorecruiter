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

  function findPhotoDoc(docs) {
    const list = Array.isArray(docs) ? docs : [];
    const scored = list.map(doc => {
      const type = ((doc.document_type || '') + ' ' + (doc.document_name || '') + ' ' + (doc.file_name || '')).toLowerCase();
      let score = 0;
      if (/фото\s*3\s*[×xх\/]\s*4/i.test(type)) score = 100;
      else if (/фото\s*9\s*[×xх\/]\s*12/i.test(type)) score = 90;
      else if (/фото/i.test(type)) score = 80;
      else if ((/id[-_\s]?картка/i.test(type) || /паспорт.*id/i.test(type)) && !/зворот/i.test(type)) score = 70;
      else if (/водія|driver/i.test(type)) score = 60;
      else if (/паспорт.*(?:книжечка|1.*стор|фото)/i.test(type)) score = 55;
      else if (/паспорт/i.test(type) && !/зворот/i.test(type)) score = 50;
      else if (/військовий квиток/i.test(type)) score = 40;
      else if (/убд/i.test(type)) score = 30;
      return { doc, score };
    }).filter(item => item.score > 0 && item.doc.storage_path && !item.doc.deleted_at);

    scored.sort((a, b) => b.score - a.score || String(b.doc.created_at || '').localeCompare(String(a.doc.created_at || '')));
    return scored[0]?.doc || null;
  }

  function cropAndScale(canvas, x, y, cw, ch, targetW = 120, targetH = 160) {
    const out = document.createElement('canvas');
    out.width = targetW;
    out.height = targetH;
    const ctx = out.getContext('2d');
    if (!ctx) return canvas;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetW, targetH);

    const aspect = cw / ch;
    const targetAspect = targetW / targetH;
    let drawW = targetW, drawH = targetH, dx = 0, dy = 0;
    if (aspect > targetAspect) {
      drawH = Math.round(targetW / aspect);
      dy = Math.round((targetH - drawH) / 2);
    } else {
      drawW = Math.round(targetH * aspect);
      dx = Math.round((targetW - drawW) / 2);
    }
    ctx.drawImage(canvas, x, y, cw, ch, dx, dy, drawW, drawH);
    return out;
  }

  function cropAroundFace(canvas, box) {
    const w = canvas.width, h = canvas.height;
    const portraitH = Math.min(h, Math.max(80, Math.round(box.height * 2.1)));
    const portraitW = Math.min(w, Math.round(portraitH * 0.75));

    const faceCenterX = box.x + box.width / 2;
    let cropX = Math.round(faceCenterX - portraitW / 2);
    let cropY = Math.round(box.y - box.height * 0.35);

    if (cropX < 0) cropX = 0;
    if (cropX + portraitW > w) cropX = Math.max(0, w - portraitW);
    if (cropY < 0) cropY = 0;
    if (cropY + portraitH > h) cropY = Math.max(0, h - portraitH);

    return cropAndScale(canvas, cropX, cropY, portraitW, portraitH, 120, 160);
  }

  function isTrue4UpSheet(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    const w = canvas.width, h = canvas.height;
    if (w < 80 || h < 80) return false;

    let imgData;
    try { imgData = ctx.getImageData(0, 0, w, h); } catch (_) { return false; }
    const data = imgData.data;
    const getLum = (x, y) => {
      const idx = (Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4;
      return 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
    };

    const cx = Math.floor(w / 2);
    const cy = Math.floor(h / 2);

    // Center intersection must be bright paper gutter (> 175)
    const centerLum = getLum(cx, cy);
    if (centerLum < 175) return false;

    // Vertical center gutter must be bright paper
    let vertWhite = 0, vertTotal = 0;
    for (let y = Math.floor(h * 0.15); y < Math.floor(h * 0.85); y += 4) {
      if (getLum(cx, y) > 165) vertWhite++;
      vertTotal++;
    }
    if (!vertTotal || (vertWhite / vertTotal < 0.70)) return false;

    // Horizontal center gutter must be bright paper
    let horizWhite = 0, horizTotal = 0;
    for (let x = Math.floor(w * 0.15); x < Math.floor(w * 0.85); x += 4) {
      if (getLum(x, cy) > 165) horizWhite++;
      horizTotal++;
    }
    if (!horizTotal || (horizWhite / horizTotal < 0.70)) return false;

    // 4 quadrant centers must contain dark subjects (heads/faces)
    const q1 = getLum(Math.floor(w * 0.25), Math.floor(h * 0.25));
    const q2 = getLum(Math.floor(w * 0.75), Math.floor(h * 0.25));
    const q3 = getLum(Math.floor(w * 0.25), Math.floor(h * 0.75));
    const q4 = getLum(Math.floor(w * 0.75), Math.floor(h * 0.75));
    const avgQuad = (q1 + q2 + q3 + q4) / 4;
    return avgQuad < 155 && (centerLum - avgQuad > 25);
  }

  function frameSinglePortrait(canvas) {
    const w = canvas.width, h = canvas.height;
    const aspect = w / h;
    if (aspect >= 0.60 && aspect <= 0.85) {
      return cropAndScale(canvas, 0, 0, w, h, 120, 160);
    }
    let cropW, cropH, cropX, cropY;
    if (aspect > 0.75) {
      cropH = h;
      cropW = Math.round(h * 0.75);
      cropX = Math.round((w - cropW) / 2);
      cropY = 0;
    } else {
      cropW = w;
      cropH = Math.round(w / 0.75);
      cropX = 0;
      cropY = Math.round((h - cropH) / 2);
    }
    return cropAndScale(canvas, Math.max(0, cropX), Math.max(0, cropY), Math.min(w, cropW), Math.min(h, cropH), 120, 160);
  }

  async function isolatePortrait(canvas, docRecord) {
    if (!canvas) return canvas;
    const w = canvas.width, h = canvas.height;
    if (w < 40 || h < 40) return canvas;

    // 1. If AI extracted photo_box [ymin, xmin, ymax, xmax] is present in docRecord
    if (docRecord?.ai_extracted) {
      let extracted = docRecord.ai_extracted;
      if (typeof extracted === 'string') {
        try { extracted = JSON.parse(extracted); } catch (_) { extracted = null; }
      }
      const box = extracted?.photo_box || extracted?.avatar_box;
      if (Array.isArray(box) && box.length === 4) {
        const [ymin, xmin, ymax, xmax] = box;
        if (ymax > ymin && xmax > xmin) {
          const cropX = Math.round((xmin / 100) * w);
          const cropY = Math.round((ymin / 100) * h);
          const cropW = Math.round(((xmax - xmin) / 100) * w);
          const cropH = Math.round(((ymax - ymin) / 100) * h);
          return cropAndScale(canvas, cropX, cropY, cropW, cropH, 120, 160);
        }
      }
    }

    const docType = ((docRecord?.document_type || '') + ' ' + (docRecord?.document_name || '') + ' ' + (docRecord?.file_name || '')).toLowerCase();
    const isDoc = /id[-_\s]?картка|паспорт|водія|driver|квиток|убд/i.test(docType) && !/фото/i.test(docType);

    // 2. Try browser native FaceDetector (AI vision) if available
    if (typeof window !== 'undefined' && 'FaceDetector' in window) {
      try {
        const detector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 6 });
        const faces = await detector.detect(canvas);
        if (faces && faces.length > 0) {
          if (faces.length === 1) {
            return cropAroundFace(canvas, faces[0].boundingBox);
          } else {
            const topLeft = faces.slice().sort((a, b) => (a.boundingBox.y + a.boundingBox.x) - (b.boundingBox.y + b.boundingBox.x))[0];
            return cropAroundFace(canvas, topLeft.boundingBox);
          }
        }
      } catch (_) {}
    }

    // 3. Document photo extraction (ID card, driver's license, passport book)
    if (isDoc) {
      if (w >= h) {
        // Landscape ID card / Driver's license: photo is on the left
        const cropX = Math.round(w * 0.035);
        const cropY = Math.round(h * 0.16);
        const cropW = Math.round(w * 0.30);
        const cropH = Math.round(h * 0.68);
        return cropAndScale(canvas, cropX, cropY, cropW, cropH, 120, 160);
      } else {
        // Portrait page (e.g. passport book page 1)
        const cropX = Math.round(w * 0.08);
        const cropY = Math.round(h * 0.12);
        const cropW = Math.round(w * 0.42);
        const cropH = Math.round(h * 0.38);
        return cropAndScale(canvas, cropX, cropY, cropW, cropH, 120, 160);
      }
    }

    // 4. Standalone photo: 4-up sheet vs single photo
    if (isTrue4UpSheet(canvas)) {
      const cropW = Math.round(w * 0.44);
      const cropH = Math.round(h * 0.44);
      const cropX = Math.round(w * 0.04);
      const cropY = Math.round(h * 0.04);
      return cropAndScale(canvas, cropX, cropY, cropW, cropH, 120, 160);
    }

    // 5. Normal single portrait photo (e.g. Grechko Karina)
    return frameSinglePortrait(canvas);
  }

  async function cropDataUrl(dataUrl, docRecord) {
    if (!dataUrl || typeof dataUrl !== 'string') return dataUrl;
    return new Promise(resolve => {
      const img = new Image();
      img.onload = async () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || img.width;
          canvas.height = img.naturalHeight || img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const finalCanvas = await isolatePortrait(canvas, docRecord);
          resolve(finalCanvas.toDataURL('image/jpeg', 0.90));
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

    const finalCanvas = await isolatePortrait(canvas, docRecord);
    return new Promise(resolve => finalCanvas.toBlob(resolve, 'image/jpeg', 0.92));
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

      const finalCanvas = await isolatePortrait(canvas, doc);
      const preview = await new Promise(resolve => finalCanvas.toBlob(resolve, 'image/jpeg', 0.88));
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
          .or('document_type.ilike.%фото%,document_name.ilike.%фото%,document_type.ilike.%id-картка%,document_type.ilike.%паспорт%,document_type.ilike.%водія%,document_type.ilike.%квиток%,document_type.ilike.%убд%')
          .order('created_at', {ascending: false}).order('id', {ascending: false});
        if (error) return;
        documents.push(...(data || []));
      }
      if (!container.isConnected || started !== generation || renders.get(container) !== renderId) return;
      const latest = new Map();
      const byCandidate = new Map();
      CRMResponsibility.latest(documents).forEach(doc => {
        if (!doc.storage_path || doc.deleted_at) return;
        const list = byCandidate.get(doc.candidate_id) || [];
        list.push(doc);
        byCandidate.set(doc.candidate_id, list);
      });
      byCandidate.forEach((docs, candidateId) => {
        const best = findPhotoDoc(docs);
        if (best) latest.set(candidateId, best);
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
  window.CandidatePhotos = {markup, hydrate, clear, isolatePortrait, cropDataUrl, cropBlob, findPhotoDoc};
})();
