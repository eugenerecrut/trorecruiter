// Camera/photos -> reviewed pages -> PDF File -> the existing CRM uploader.
// Photos stay in browser memory until the user explicitly uploads the PDF.
(function () {
  'use strict';
  const MAX_PAGES = 30;
  const MAX_SOURCES = 45 * 1024 * 1024;
  const MAX_FILE = 20 * 1024 * 1024;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;'}[c]));
  let session = null;

  function imageFromBlob(blob) {
    return new Promise((resolve, reject) => {
      const image = new Image(), url = URL.createObjectURL(blob);
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Фото не вдалося відкрити. Збережіть його як JPG або PNG та спробуйте ще раз.')); };
      image.src = url;
    });
  }
  function jpeg(canvas, quality = 0.9) {
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Не вдалося підготувати сторінку.')), 'image/jpeg', quality));
  }
  function newCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d', {alpha: false});
    if (!ctx) throw new Error('Браузер не підтримує обробку фото.');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
    return {canvas, ctx};
  }
  async function normalizePhoto(file) {
    if (file.size > 25 * 1024 * 1024) throw new Error('Окреме фото більше за 25 МБ. Виберіть менше фото.');
    if (file.type && !file.type.startsWith('image/')) throw new Error('Для сканування виберіть фото. Готовий PDF завантажується через «Додати документи».');
    const image = await imageFromBlob(file);
    const scale = Math.min(1, 2400 / Math.max(image.naturalWidth, image.naturalHeight));
    const {canvas, ctx} = newCanvas(Math.max(1, Math.round(image.naturalWidth * scale)), Math.max(1, Math.round(image.naturalHeight * scale)));
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const source = await jpeg(canvas);
    canvas.width = canvas.height = 0;
    return source;
  }

  // A small PDF writer for RGB JPEG pages. Byte offsets use encoded lengths.
  async function buildPDF(pages) {
    const encoder = new TextEncoder(), chunks = [], offsets = [0];
    let length = 0;
    const append = value => {
      const bytes = typeof value === 'string' ? encoder.encode(value) : value;
      chunks.push(bytes); length += bytes.length;
    };
    const object = (id, body) => { offsets[id] = length; append(id + ' 0 obj\n'); append(body); append('\nendobj\n'); };
    append('%PDF-1.4\n'); append(new Uint8Array([37,226,227,207,211,10]));
    object(1, '<< /Type /Catalog /Pages 2 0 R >>');
    object(2, '<< /Type /Pages /Count ' + pages.length + ' /Kids [' + pages.map((_, i) => (3 + i * 3) + ' 0 R').join(' ') + '] >>');
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i], id = 3 + i * 3, landscape = page.width > page.height;
      const pw = landscape ? 841.89 : 595.28, ph = landscape ? 595.28 : 841.89;
      const scale = Math.min((pw - 24) / page.width, (ph - 24) / page.height);
      const w = page.width * scale, h = page.height * scale;
      const content = 'q\n' + [w, 0, 0, h, (pw - w) / 2, (ph - h) / 2].map(x => x.toFixed(3)).join(' ') + ' cm\n/Photo Do\nQ\n';
      object(id, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pw + ' ' + ph + '] /Resources << /XObject << /Photo ' + (id + 1) + ' 0 R >> >> /Contents ' + (id + 2) + ' 0 R >>');
      const bytes = new Uint8Array(await page.image.arrayBuffer());
      offsets[id + 1] = length;
      append((id + 1) + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + page.width + ' /Height ' + page.height + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + bytes.length + ' >>\nstream\n');
      append(bytes); append('\nendstream\nendobj\n');
      object(id + 2, '<< /Length ' + encoder.encode(content).length + ' >>\nstream\n' + content + 'endstream');
    }
    const xref = length, count = 3 + pages.length * 3;
    append('xref\n0 ' + count + '\n0000000000 65535 f \n');
    for (let id = 1; id < count; id++) append(String(offsets[id]).padStart(10, '0') + ' 00000 n \n');
    append('trailer\n<< /Size ' + count + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    return new Blob(chunks, {type: 'application/pdf'});
  }

  function status(s, text, error = false) {
    const node = s.dialog.querySelector('[data-scan-status]');
    node.textContent = text; node.dataset.error = String(error);
  }
  function dirty(s) { return !!(s.pages.length || s.editor || s.queue.length); }
  function release(s) {
    s.urls.forEach(url => URL.revokeObjectURL(url)); s.urls = [];
    if (s.editor?.canvas) s.editor.canvas.width = s.editor.canvas.height = 0;
    s.dialog.close(); s.dialog.remove(); s.pages = []; s.queue = []; s.editor = null;
    if (session === s) session = null;
  }
  function requestClose(s) {
    if (s.busy) return;
    if (!dirty(s)) return release(s);
    const discard = s.dialog.querySelector('[data-scan-discard]');
    discard.hidden = false; discard.querySelector('button').focus();
  }
  function update(s) {
    s.dialog.querySelectorAll('[data-scan-action]').forEach(button => { button.disabled = s.busy; });
    s.dialog.querySelector('[data-scan-action="finish"]').disabled = s.busy || !!s.editor || !!s.queue.length || !s.pages.length;
    s.dialog.querySelector('[data-scan-action="camera"]').disabled = s.busy || !!s.editor || s.pages.length >= MAX_PAGES;
    s.dialog.querySelector('[data-scan-action="gallery"]').disabled = s.busy || !!s.editor || s.pages.length >= MAX_PAGES;
    s.dialog.querySelectorAll('[data-scan-action="up"]').forEach(button => {button.disabled = s.busy || Number(button.dataset.index) === 0;});
    s.dialog.querySelectorAll('[data-scan-action="down"]').forEach(button => {button.disabled = s.busy || Number(button.dataset.index) === s.pages.length - 1;});
    s.dialog.querySelector('[data-scan-editor]').hidden = !s.editor;
    s.dialog.querySelector('[data-scan-action="save-page"]').textContent = s.editor?.index >= 0 ? 'Зберегти сторінку' : 'Додати сторінку';
    s.dialog.querySelector('[data-scan-count]').textContent = s.pages.length ? 'Сторінок у PDF: ' + s.pages.length : 'Ще немає сторінок';
  }
  function renderPages(s) {
    s.urls.forEach(url => URL.revokeObjectURL(url)); s.urls = [];
    const root = s.dialog.querySelector('[data-scan-pages]');
    root.innerHTML = s.pages.map((page, index) => {
      const url = URL.createObjectURL(page.image); s.urls.push(url);
      return '<section class="scan-page"><strong>Сторінка ' + (index + 1) + '</strong><img loading="lazy" decoding="async" src="' + url + '" alt="Перегляд сторінки ' + (index + 1) + '"><div class="scan-tools"><button type="button" data-scan-action="edit" data-index="' + index + '">Редагувати</button><button type="button" data-scan-action="remove" data-index="' + index + '">Видалити</button></div><div class="scan-tools"><button type="button" data-scan-action="up" data-index="' + index + '" aria-label="Перемістити сторінку ' + (index + 1) + ' вище" ' + (index === 0 ? 'disabled' : '') + '>↑ Вище</button><button type="button" data-scan-action="down" data-index="' + index + '" aria-label="Перемістити сторінку ' + (index + 1) + ' нижче" ' + (index === s.pages.length - 1 ? 'disabled' : '') + '>↓ Нижче</button></div></section>';
    }).join('');
    update(s);
    root.querySelector('[data-scan-action="up"][data-index="0"]')?.setAttribute('disabled', '');
    root.querySelector('[data-scan-action="down"][data-index="' + (s.pages.length - 1) + '"]')?.setAttribute('disabled', '');
  }
  function drawCrop(s) {
    const crop = s.editor.crop, frame = s.dialog.querySelector('.scan-crop');
    frame.style.left = crop.left + '%'; frame.style.top = crop.top + '%';
    frame.style.width = (100 - crop.left - crop.right) + '%'; frame.style.height = (100 - crop.top - crop.bottom) + '%';
    Object.entries(crop).forEach(([key, value]) => { s.dialog.querySelector('[data-crop="' + key + '"]').value = Math.round(value); });
  }
  function drawEditor(s) {
    const e = s.editor, swapped = e.rotation % 180 !== 0;
    if (e.canvas) e.canvas.width = e.canvas.height = 0;
    const {canvas, ctx} = newCanvas(swapped ? e.photo.naturalHeight : e.photo.naturalWidth, swapped ? e.photo.naturalWidth : e.photo.naturalHeight);
    ctx.translate(canvas.width / 2, canvas.height / 2); ctx.rotate(e.rotation * Math.PI / 180);
    ctx.drawImage(e.photo, -e.photo.naturalWidth / 2, -e.photo.naturalHeight / 2);
    e.canvas = canvas;
    const preview = s.dialog.querySelector('[data-scan-canvas]'), scale = Math.min(1, 1000 / Math.max(canvas.width, canvas.height));
    preview.width = Math.round(canvas.width * scale); preview.height = Math.round(canvas.height * scale);
    preview.getContext('2d').drawImage(canvas, 0, 0, preview.width, preview.height);
    drawCrop(s); update(s);
  }
  async function editSource(s, source, index = -1) {
    const old = index >= 0 ? s.pages[index] : null;
    s.editor = {source, index, photo: await imageFromBlob(source), rotation: old?.rotation || 0, crop: {...(old?.crop || {left:0, right:0, top:0, bottom:0})}};
    drawEditor(s);
    s.dialog.querySelector('[data-scan-editor]').scrollIntoView({block:'start', behavior:'smooth'});
    status(s, 'Обріжте зайве, перевірте орієнтацію та читабельність. ' + (s.queue.length ? 'Далі ще фото: ' + s.queue.length + '.' : ''));
  }
  async function nextPhoto(s) {
    if (!s.queue.length) return;
    const source = s.queue.shift();
    await editSource(s, source);
  }
  async function importPhotos(s, files) {
    if (!files.length || s.busy || s.editor) return;
    s.busy = true; update(s);
    try {
      if (s.pages.length + files.length > MAX_PAGES) throw new Error('В одному документі може бути до ' + MAX_PAGES + ' сторінок.');
      let sourceSize = s.pages.reduce((sum, page) => sum + page.source.size, 0);
      const prepared = [];
      for (let i = 0; i < files.length; i++) {
        status(s, 'Підготовка фото ' + (i + 1) + ' із ' + files.length + '…');
        const source = await normalizePhoto(files[i]); sourceSize += source.size;
        if (sourceSize > MAX_SOURCES) throw new Error('Забагато фото для пам’яті телефона. Збережіть документ частинами.');
        prepared.push(source);
      }
      s.queue = prepared; await nextPhoto(s);
    } catch (error) { status(s, error.message, true); }
    finally { s.busy = false; update(s); }
  }
  async function savePage(s) {
    const e = s.editor; if (!e) return;
    const {left, right, top, bottom} = e.crop;
    const x = Math.round(e.canvas.width * left / 100), y = Math.round(e.canvas.height * top / 100);
    const width = Math.max(1, Math.round(e.canvas.width * (100 - left - right) / 100));
    const height = Math.max(1, Math.round(e.canvas.height * (100 - top - bottom) / 100));
    const {canvas, ctx} = newCanvas(width, height);
    ctx.drawImage(e.canvas, x, y, width, height, 0, 0, width, height);
    const image = await jpeg(canvas); canvas.width = canvas.height = 0;
    const page = {source:e.source, rotation:e.rotation, crop:{...e.crop}, image, width, height};
    if (e.index >= 0) s.pages[e.index] = page; else s.pages.push(page);
    e.canvas.width = e.canvas.height = 0; s.editor = null;
    renderPages(s); status(s, 'Сторінку додано. Можна зняти наступну або сформувати PDF.');
    await nextPhoto(s);
  }
  async function finish(s) {
    status(s, 'Формування PDF…');
    const pdf = await buildPDF(s.pages);
    if (pdf.size > s.maxSize) throw new Error('PDF більше за ' + (s.recommendation ? '11' : '20') + ' МБ. Видаліть зайві сторінки або збережіть документ частинами.');
    const name = s.dialog.querySelector('[name="scanName"]').value.replace(/\.pdf$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 100) || 'Документ';
    const file = new File([pdf], name + '.pdf', {type:'application/pdf', lastModified:Date.now()});
    await s.onComplete(file);
    release(s);
  }
  function cropValue(s, key, rawValue) {
    const opposite = {left:'right', right:'left', top:'bottom', bottom:'top'}[key];
    s.editor.crop[key] = Math.max(0, Math.min(90 - s.editor.crop[opposite], Number(rawValue) || 0));
    drawCrop(s);
  }
  function open({title = 'Документ', onComplete, recommendation = false} = {}) {
    if (session || typeof onComplete !== 'function') return;
    const dialog = document.createElement('dialog'); dialog.className = 'scan-dialog';
    dialog.setAttribute('aria-labelledby', 'scanTitle');
    const s = {dialog, onComplete, recommendation, maxSize:recommendation ? 11000000 : MAX_FILE, pages:[], queue:[], urls:[], editor:null, busy:false}; session = s;
    dialog.innerHTML = '<div class="scan-heading"><div><h2 id="scanTitle">Сканувати документ</h2><p>' + escape(title) + ' · зберіть усі сторінки одного документа в PDF.</p></div><button type="button" data-scan-action="close" aria-label="Закрити сканер">✕</button></div><div class="scan-tools"><button type="button" data-scan-action="camera">📷 Зняти сторінку</button><button type="button" data-scan-action="gallery">▧ Фото з галереї</button></div><input type="file" data-scan-camera accept="image/*" capture="environment" hidden><input type="file" data-scan-gallery accept="image/*" multiple hidden><p class="muted" style="font-size:12px">Покладіть документ рівно, знімайте зверху при доброму освітленні. Перевірте, що дрібний текст читається.</p><div data-scan-discard class="scan-discard" hidden><strong>Вийти та втратити незбережені сторінки?</strong><div class="scan-tools"><button type="button" data-scan-action="keep">Продовжити сканування</button><button type="button" data-scan-action="discard">Вийти без збереження</button></div></div><section data-scan-editor hidden><h3>Перевірка сторінки</h3><div class="scan-tools"><button type="button" data-scan-action="rotate">↻ Повернути 90°</button><button type="button" data-scan-action="reset">Скинути обрізання</button></div><div class="scan-preview"><canvas data-scan-canvas aria-label="Фото документа"></canvas><div class="scan-crop">' + [['tl','Верхній лівий'],['tr','Верхній правий'],['br','Нижній правий'],['bl','Нижній лівий']].map(([corner, label]) => '<button type="button" class="scan-handle" data-corner="' + corner + '" aria-label="' + label + ' кут обрізання"></button>').join('') + '</div></div><p class="muted" style="font-size:12px">Перетягніть зелені кути або задайте обрізання у відсотках.</p><div class="scan-crop-fields">' + [['left','Зліва'],['right','Справа'],['top','Зверху'],['bottom','Знизу']].map(([key, label]) => '<label>' + label + ', % <input data-crop="' + key + '" type="number" min="0" max="90" value="0" inputmode="numeric"></label>').join('') + '</div><div class="scan-tools"><button type="button" data-scan-action="skip">Не додавати це фото</button><button type="button" class="primary" data-scan-action="save-page">Додати сторінку</button></div></section><h3 data-scan-count>Ще немає сторінок</h3><div class="scan-pages" data-scan-pages></div><div class="scan-status" role="status" aria-live="polite" data-scan-status></div><div class="scan-footer"><label>Назва PDF<input name="scanName" value="' + escape(title) + '"></label><div class="scan-tools"><button type="button" class="primary" data-scan-action="finish" disabled>Сформувати PDF і продовжити</button></div><small class="muted">PDF буде передано у вікно завантаження. Там перевірте тип документа та натисніть «Завантажити».</small></div>';
    dialog.addEventListener('cancel', event => {event.preventDefault(); requestClose(s);});
    dialog.querySelector('[data-scan-camera]').addEventListener('change', event => importPhotos(s, [...event.target.files]));
    dialog.querySelector('[data-scan-gallery]').addEventListener('change', event => importPhotos(s, [...event.target.files]));
    dialog.querySelectorAll('[data-crop]').forEach(input => input.addEventListener('input', () => { if (s.editor && !s.busy) cropValue(s, input.dataset.crop, input.value); }));
    dialog.querySelectorAll('[data-corner]').forEach(handle => {
      handle.addEventListener('pointerdown', event => {
        if (!s.editor || s.busy) return; event.preventDefault(); handle.setPointerCapture(event.pointerId);
        const move = event => {
          if (!s.editor) return;
          const bounds = dialog.querySelector('.scan-preview').getBoundingClientRect();
          const x = (event.clientX - bounds.left) / bounds.width * 100, y = (event.clientY - bounds.top) / bounds.height * 100;
          cropValue(s, handle.dataset.corner.endsWith('l') ? 'left' : 'right', handle.dataset.corner.endsWith('l') ? x : 100 - x);
          cropValue(s, handle.dataset.corner.startsWith('t') ? 'top' : 'bottom', handle.dataset.corner.startsWith('t') ? y : 100 - y);
        };
        const stop = () => {handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', stop); handle.removeEventListener('pointercancel', stop);};
        handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', stop); handle.addEventListener('pointercancel', stop);
      });
    });
    dialog.addEventListener('click', async event => {
      const button = event.target.closest('[data-scan-action]'); if (!button || button.disabled || s.busy) return;
      const action = button.dataset.scanAction, index = Number(button.dataset.index);
      if (action === 'close') return requestClose(s);
      if (action === 'discard') return release(s);
      if (action === 'keep') {dialog.querySelector('[data-scan-discard]').hidden = true; return;}
      if (action === 'camera' || action === 'gallery') {const input = dialog.querySelector('[data-scan-' + action + ']'); input.value = ''; input.click(); return;}
      if (s.editor && ['edit','remove','up','down'].includes(action)) {status(s, 'Спочатку збережіть або відхиліть сторінку, яку редагуєте.', true); return;}
      s.busy = true; update(s);
      try {
        if (action === 'rotate' && s.editor) {s.editor.rotation = (s.editor.rotation + 90) % 360; s.editor.crop = {left:0,right:0,top:0,bottom:0}; drawEditor(s);}
        else if (action === 'reset' && s.editor) {s.editor.crop = {left:0,right:0,top:0,bottom:0}; drawCrop(s);}
        else if (action === 'save-page') await savePage(s);
        else if (action === 'skip') {if (s.editor?.canvas) s.editor.canvas.width = s.editor.canvas.height = 0; s.editor = null; await nextPhoto(s);}
        else if (action === 'edit') await editSource(s, s.pages[index].source, index);
        else if (action === 'remove') {s.pages.splice(index, 1); renderPages(s);}
        else if (action === 'up' || action === 'down') {const to = index + (action === 'up' ? -1 : 1); if (to >= 0 && to < s.pages.length) {[s.pages[index],s.pages[to]] = [s.pages[to],s.pages[index]]; renderPages(s);}}
        else if (action === 'finish') await finish(s);
      } catch (error) {status(s, error.message || 'Не вдалося підготувати документ.', true);}
      finally {s.busy = false; if (session === s) update(s);}
    });
    document.body.append(dialog); dialog.showModal(); update(s);
    if (recommendation) {
      dialog.querySelector('[data-scan-action="finish"]').textContent = 'Сформувати PDF і розпізнати лист';
      dialog.querySelector('.scan-footer small').textContent = 'PDF передається у наявне розпізнавання рекомендаційного листа. Перевірте результат перед створенням справи.';
    }
  }
  window.addEventListener('beforeunload', event => {if (session && dirty(session)) {event.preventDefault(); event.returnValue = '';}});
  window.DocumentCamera = {open};
})();
