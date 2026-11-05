/* PSK_RECRUITER — document lifecycle module
   Tracks: uploaded -> recognized -> verified.
   Safe to load on pages without the Documents UI.
*/
(function () {
  'use strict';

  const STATUS = {
    uploaded: { label: 'Завантажений', cls: 'status-doc' },
    recognized: { label: 'Розпізнаний', cls: 'status-work' },
    verified: { label: 'Перевірений', cls: 'status-done' }
  };

  function getStore() {
    try { return JSON.parse(localStorage.getItem('psk_document_registry') || '[]'); }
    catch (_) { return []; }
  }
  function setStore(items) {
    localStorage.setItem('psk_document_registry', JSON.stringify(items));
  }

  window.PSKDocumentLifecycle = {
    register(file, meta) {
      const item = {
        id: 'doc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        candidateId: meta && meta.candidateId ? meta.candidateId : null,
        candidateName: meta && meta.candidateName ? meta.candidateName : '',
        type: meta && meta.type ? meta.type : 'Інший документ',
        fileName: file && file.name ? file.name : '',
        size: file && file.size ? file.size : 0,
        status: 'uploaded',
        createdAt: new Date().toISOString(),
        recognizedAt: null,
        verifiedAt: null
      };
      const items = getStore();
      items.unshift(item);
      setStore(items);
      return item;
    },
    setRecognized(id) {
      return update(id, { status: 'recognized', recognizedAt: new Date().toISOString() });
    },
    setVerified(id) {
      return update(id, { status: 'verified', verifiedAt: new Date().toISOString() });
    },
    list() { return getStore(); },
    render(container) {
      if (!container) return;
      const items = getStore();
      container.innerHTML = items.length ? items.map(renderItem).join('') : '<div class="muted" style="padding:20px">Документів поки немає</div>';
      container.querySelectorAll('[data-verify-document]').forEach(btn => {
        btn.addEventListener('click', function () {
          const item = window.PSKDocumentLifecycle.setVerified(this.dataset.verifyDocument);
          if (item) window.PSKDocumentLifecycle.render(container);
        });
      });
    }
  };

  function update(id, patch) {
    const items = getStore();
    const index = items.findIndex(x => x.id === id);
    if (index < 0) return null;
    items[index] = Object.assign({}, items[index], patch);
    setStore(items);
    return items[index];
  }

  function renderItem(item) {
    const s = STATUS[item.status] || STATUS.uploaded;
    const action = item.status === 'recognized'
      ? '<button type="button" data-verify-document="' + item.id + '" style="padding:7px 10px;border:1px solid #cfd8dc;border-radius:7px;background:#fff;font-weight:700">Підтвердити перевірку</button>'
      : '';
    return '<div style="display:flex;justify-content:space-between;gap:14px;align-items:center;padding:13px 0;border-bottom:1px solid #edf0f1">' +
      '<div><b>' + escapeHtml(item.type) + '</b><div class="muted" style="margin-top:4px">' + escapeHtml(item.fileName) + '</div>' +
      (item.candidateName ? '<div class="muted" style="margin-top:3px">Кандидат: ' + escapeHtml(item.candidateName) + '</div>' : '') + '</div>' +
      '<div style="display:flex;align-items:center;gap:8px"><span class="status ' + s.cls + '">' + s.label + '</span>' + action + '</div></div>';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }
})();
