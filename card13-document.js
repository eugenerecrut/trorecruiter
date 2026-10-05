// Appendix 13: local PDF generation; no changes to the candidate or medical results.
(function () {
  'use strict';
  const esc = v => CRMWorkspace.escape(v);
  const parse = v => { if (typeof v !== 'string') return v || {}; try { return JSON.parse(v) || {}; } catch { return {}; } };
  const service = (c, p, pf) => {
    const notes = String(pf.additional_notes || '').replace(/\\n/g, '\n');
    const raw = String(p.service_type || c.service_type || notes.match(/(?:^|\n)Вид служби:\s*([^\n]+)/i)?.[1] || '');
    return /мобілізац/i.test(raw) ? 'За мобілізацією' : /контракт/i.test(raw) ? 'За контрактом' : '';
  };
  async function bytes(url) { const r = await fetch(url); if (!r.ok) throw Error('Не вдалося завантажити бланк або шрифт PDF.'); return r.arrayBuffer(); }
  async function generate(values, photo) {
    await loadExternalScript('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js', 'PDFLib');
    await loadExternalScript('https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js', 'fontkit');
    const pdf = await PDFLib.PDFDocument.load(await bytes('templates/card13-blank.pdf?v=1.1.0.402'));
    pdf.registerFontkit(window.fontkit);
    const font = await pdf.embedFont(await bytes('templates/fonts/DejaVuSans.ttf'), { subset: true });
    const form = pdf.getForm();
    for (const [key, value] of Object.entries(values)) {
      const field = form.getTextField(key), rect = field.acroField.getWidgets()[0].getRectangle();
      let size = 10;
      const lines = String(value).split('\n');
      if (lines.length > (field.isMultiline() ? 2 : 1)) throw Error('Забагато рядків для поля: ' + key);
      while (size > 7 && lines.some(s => font.widthOfTextAtSize(s, size) > rect.width - 6)) size -= .5;
      if (lines.some(s => font.widthOfTextAtSize(s, size) > rect.width - 6)) throw Error('Значення задовге для бланка. Скоротіть: ' + key);
      field.acroField.setDefaultAppearance('/Helv 10 Tf 0 g');
      field.setText(String(value)); field.setFontSize(size);
    }
    form.updateFieldAppearances(font);
    if (photo) {
      const r = await fetch(photo); if (!r.ok) throw Error('Не вдалося прочитати фото.');
      const data = await r.arrayBuffer();
      const image = /png/i.test(r.headers.get('content-type') || photo.slice(0,40)) ? await pdf.embedPng(data) : await pdf.embedJpg(data);
      const page = pdf.getPages()[0], mm = 72 / 25.4;
      const box = { x: 17 * mm, y: 247 * mm, width: 30 * mm, height: 40 * mm };
      page.drawRectangle({ ...box, color: PDFLib.rgb(1,1,1) });
      const dims = image.scale(Math.min(box.width / image.width, box.height / image.height));
      page.drawImage(image, { x: box.x + (box.width-dims.width)/2, y: box.y+(box.height-dims.height)/2, ...dims });
    }
    return pdf.save();
  }
  async function open(candidate) {
    if (!await CRMWorkspace.guard()) return;
    try {
      const [cr, pr, docs] = await Promise.all([
        supabaseClient.from('candidates').select('*').eq('id', candidate.id).single(),
        supabaseClient.from('personal_files').select('*').eq('candidate_id', candidate.id).maybeSingle(),
        getCandidateDocuments(candidate.id)
      ]);
      if (cr.error) throw cr.error; if (pr.error) throw pr.error;
      const c = cr.data, p = parse(c.profile_data), pf = pr.data || {};
      const current = CRMResponsibility.latest(docs);
      const rl = current.filter(d => /рекомендац/i.test(d.document_type || '')).sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
      const e = parse(rl?.ai_extracted), personal = e.personal || {}, s = e.service || {};
      const values = {
        category: (c.sex || p.sex) === 'male' ? 'Військовозобов’язаний' : (c.sex || p.sex) === 'female' ? 'Військовозобов’язана' : '',
        name_identifier: [c.name_nominative || c.full_name || '', c.rnokpp ? 'РНОКПП: ' + c.rnokpp : ''].filter(Boolean).join('\n'),
        birth_date: /^\d{4}-\d{2}-\d{2}$/.test(c.birth_date || '') ? c.birth_date.split('-').reverse().join('.') : '',
        military_rank: e.military_rank || personal.military_rank || s.military_rank || '',
        military_unit: e.military_unit || s.military_unit || '',
        military_service: service(c,p,pf)
      };
      const labels = { category:'Категорія', name_identifier:'ПІБ та РНОКПП · із CRM', birth_date:'Дата народження · із CRM', military_rank:'Військове звання · із РЛ', military_unit:'Військова частина · із РЛ', military_service:'Вид служби · із картки' };
      const d = document.createElement('dialog'); d.className = 'crm-dialog crm-workflow-dialog';
      d.innerHTML = '<h2>Картка 13</h2><p>КНП «МКЛ № 6» ДМР. Мета: визначення придатності до військової служби. Дві окремі сторінки А4. Медичні дані та підписи порожні.</p><form class="crm-workflow-grid">' + Object.entries(values).map(([k,v]) => '<label>'+esc(labels[k])+(k==='name_identifier'?'<textarea rows="2" name="'+k+'">'+esc(v)+'</textarea>':k==='military_service'?'<select name="'+k+'">'+['','За контрактом','За мобілізацією'].map(x=>'<option '+(x===v?'selected':'')+'>'+esc(x)+'</option>').join('')+'</select>':'<input name="'+k+'" value="'+esc(v)+'">')+'</label>').join('')+'<p data-photo-status>Завантажуємо фото з CRM…</p><p data-status role="status"></p><button type="submit">Сформувати PDF</button></form><iframe title="Картка 13 PDF" hidden style="width:100%;height:55vh"></iframe><a data-download hidden>Завантажити PDF</a><div class="crm-actions"><button data-close>Закрити</button></div>';
      document.body.append(d); d.showModal();
      let photo = null, url = null, photoReady = false;
      const close = () => { if (url) URL.revokeObjectURL(url); d.close(); d.remove(); };
      d.querySelector('[data-close]').onclick = close;
      d.addEventListener('cancel', ev => { ev.preventDefault(); close(); });
      const photoDoc = current.find(x => /фото\s*9\s*[×xх\/]\s*12/i.test(x.document_type || ''));
      try { if (photoDoc) photo = await CRMWorkspace.photo(photoDoc); }
      catch { /* A missing photo remains visible in the review; never invent it. */ }
      photoReady = true;
      d.querySelector('[data-photo-status]').textContent = photo ? 'Фото з CRM буде вписане у рамку 3×4 см без розтягування.' : 'Фото недоступне в CRM. У PDF залишиться місце для фото.';
      if (rl && rl.verification_status !== 'Підтверджено') d.querySelector('[data-status]').textContent = 'РЛ ще не перевірений. Звірте звання та ВЧ перед друком.';
      d.querySelector('form').onsubmit = async ev => {
        ev.preventDefault(); if (!photoReady) return;
        const button = d.querySelector('[type=submit]'), status = d.querySelector('[data-status]');
        button.disabled = true; status.textContent = 'Формуємо PDF…';
        try {
          const values = Object.fromEntries(new FormData(ev.target));
          if (!values.category || !values.name_identifier) throw Error('Уточніть категорію та ПІБ.');
          const result = await generate(values, photo);
          if (!d.isConnected) return;
          if (url) URL.revokeObjectURL(url); url = URL.createObjectURL(new Blob([result], { type:'application/pdf' }));
          const frame = d.querySelector('iframe'); frame.src = url; frame.hidden = false;
          const a = d.querySelector('[data-download]'); a.href = url; a.download = 'Картка_13.pdf'; a.hidden = false;
          status.textContent = 'PDF готовий. Для двох окремих аркушів оберіть односторонній друк, 1 сторінка на аркуші.';
        } catch (error) { status.textContent = error.message; }
        finally { button.disabled = false; }
      };
    } catch (error) { alert('Не вдалося відкрити Картку 13: ' + error.message); }
  }
  window.CRMCard13 = { open, generate, service };
})();
