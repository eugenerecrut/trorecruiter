// One CRM, two layouts. Layout preference never changes candidate data.
(function () {
  'use strict';
  const root = document.documentElement;
  const storageKey = 'psk.crm.interface';
  const smallScreen = window.matchMedia('(max-width: 820px)');
  let preference = 'auto';
  try { preference = localStorage.getItem(storageKey) || 'auto'; } catch (_) {}
  if (!['auto', 'mobile', 'desktop'].includes(preference)) preference = 'auto';
  function apply() {
    const mobile = preference === 'mobile' || (preference === 'auto' && smallScreen.matches);
    root.dataset.crmLayout = mobile ? 'mobile' : 'desktop';
    root.dataset.crmPreference = preference;
    document.querySelectorAll('[data-interface-mode]').forEach(select => { select.value = preference; });
    closeMenu();
  }
  function closeMenu() {
    const sidebar = document.querySelector('.sidebar');
    sidebar?.classList.remove('open');
    if (sidebar) sidebar.inert = root.dataset.crmLayout === 'mobile';
    const button = document.querySelector('.mobile-menu');
    if (button) button.setAttribute('aria-expanded', 'false');
    document.querySelector('#crmMenuShade')?.setAttribute('hidden', '');
  }
  apply();
  if (smallScreen.addEventListener) smallScreen.addEventListener('change', apply);
  else smallScreen.addListener(apply);
  window.addEventListener('beforeunload', event => {
    const modal = document.querySelector('#documentModal');
    if (modal?.querySelector('#docFileInput')?.files?.length && modal.dataset.uploadComplete !== 'true') {event.preventDefault(); event.returnValue = '';}
  });
  window.CRMInterface = { closeMenu, get mode() { return root.dataset.crmLayout; } };
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-interface-mode]').forEach(select => {
      select.value = preference;
      select.addEventListener('change', () => {
        preference = select.value;
        try { localStorage.setItem(storageKey, preference); } catch (_) {}
        apply();
      });
    });
    const menu = document.querySelector('.mobile-menu');
    if (menu) {
      menu.removeAttribute('onclick');
      menu.addEventListener('click', () => {
        const sidebar = document.querySelector('.sidebar');
        if (!sidebar) return;
        const open = sidebar.classList.toggle('open');
        sidebar.inert = !open;
        menu.setAttribute('aria-expanded', String(open));
        document.querySelector('#crmMenuShade')?.toggleAttribute('hidden', !open);
      });
    }
    document.querySelector('#crmMenuShade')?.addEventListener('click', closeMenu);
    closeMenu();
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });
    document.querySelectorAll('[data-nav]').forEach(button => button.addEventListener('click', closeMenu));

    // Preserve the existing table and its event handlers, expose cell headings on mobile.
    const content = document.querySelector('.content');
    let queued = false;
    function labelTables() {
      queued = false;
      content?.querySelectorAll('table').forEach(table => {
        if (!table.classList.contains('crm-adaptive-table')) table.classList.add('crm-adaptive-table');
        const headings = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim());
        table.querySelectorAll('tbody tr').forEach(row => {
          [...row.cells].forEach((cell, index) => {
            if (cell.colSpan > 1) return;
            const label = headings[index] || '';
            if (cell.dataset.label !== label) cell.dataset.label = label;
          });
        });
      });
    }
    if (content) {
      new MutationObserver(() => {
        if (!queued) { queued = true; requestAnimationFrame(labelTables); }
      }).observe(content, {childList: true, subtree: true});
      labelTables();
    }
    // Camera access at the existing recommendation entry point as well as document uploads.
    document.addEventListener('click', event => {
      const button = event.target.closest('[data-scan-recommendation]');
      if (!button || !window.DocumentCamera) return;
      const target = document.querySelector('#recommendationFile');
      if (!target || window.CRMWorkspace?.busy) return;
      window.DocumentCamera.open({title: 'Рекомендаційний лист', recommendation: true, onComplete: async file => {
        if (!target.isConnected) throw new Error('Вікно рекомендаційного листа закрите. Відкрийте його знову.');
        const transfer = new DataTransfer(); transfer.items.add(file); target.files = transfer.files;
        target.dispatchEvent(new Event('change', {bubbles: true}));
      }});
    });
  });
})();
