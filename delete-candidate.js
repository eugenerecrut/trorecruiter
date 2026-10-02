// PSK_RECRUTER CRM — candidate deletion helper
(function () {
  async function deleteCandidateCase(candidateId, candidateName) {
    if (!candidateId) { alert('Не вдалося визначити ID кандидата.'); return; }
    const name = candidateName || 'кандидата';
    if (!window.confirm(`УВАГА! Видалити особову справу «${name}»?\n\nКартка, особова справа та пов’язані документи будуть видалені.`)) return;
    try {
      if (typeof supabaseClient === 'undefined') throw new Error('CRM не підключила Supabase. Оновіть сторінку.');
      const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
      if (sessionError) throw sessionError;
      if (!sessionData?.session?.user) throw new Error('Сесія користувача не знайдена. Увійдіть до CRM повторно.');
      const { data: docs, error: docsError } = await supabaseClient.from('documents').select('storage_path').eq('candidate_id', candidateId);
      if (docsError) throw docsError;
      const paths = (docs || []).map(x => x.storage_path).filter(Boolean);
      if (paths.length) { const { error: storageError } = await supabaseClient.storage.from('candidate-documents').remove(paths); if (storageError) console.warn('Не всі файли зі сховища видалені:', storageError.message); }
      const { error: docError } = await supabaseClient.from('documents').delete().eq('candidate_id', candidateId); if (docError) throw docError;
      const { error: pfError } = await supabaseClient.from('personal_files').delete().eq('candidate_id', candidateId); if (pfError) throw pfError;
      const { error: candidateError } = await supabaseClient.from('candidates').delete().eq('id', candidateId); if (candidateError) throw candidateError;
      alert(`Справу «${name}» видалено.`); if (typeof updateDashboard === 'function') await updateDashboard(); if (typeof showCandidates === 'function') showCandidates();
    } catch (error) { console.error('Помилка видалення кандидата:', error); alert(`Не вдалося видалити справу:\n${error?.message || error}`); }
  }
  window.deleteCandidateCase = deleteCandidateCase;
  document.addEventListener('click', function (event) {
    const button = event.target.closest('button'); if (!button || !button.closest('#candidateRows') || !/deleteCandidateCase/.test(button.getAttribute('onclick') || '')) return;
    event.preventDefault(); event.stopImmediatePropagation(); const onclick = button.getAttribute('onclick') || ''; const match = onclick.match(/deleteCandidateCase\(['\"]([^'\"]+)['\"]/); const candidateId = match ? match[1] : ''; const row = button.closest('tr'); const candidateName = row?.querySelector('td')?.textContent?.trim() || 'кандидата'; deleteCandidateCase(candidateId, candidateName);
  }, true);
  document.addEventListener('click', function (event) {
    const target = event.target.closest('#candidateRows td:first-child, #candidateRows td:first-child *'); if (!target) return; const row = target.closest('tr'); if (!row) return; const openButton = Array.from(row.querySelectorAll('button')).find(button=>(button.getAttribute('onclick')||'').includes("crmNavigate('card'")); if (!openButton) return; const onclick = openButton.getAttribute('onclick') || ''; const match = onclick.match(/crmNavigate\('card','([^']+)'/); if (!match?.[1]) return; event.preventDefault(); event.stopPropagation(); window.crmNavigate('card',match[1]);
  });
  function installCandidateSubgroups() {
    const items = [...document.querySelectorAll('.menu-item')]; const candidateItem = items.find(el => (el.textContent || '').includes('Кандидати')); if (!candidateItem || candidateItem.hasAttribute('data-nav') || candidateItem.dataset.subgroupsInstalled) return; candidateItem.dataset.subgroupsInstalled = '1'; candidateItem.style.cursor = 'pointer';
    const sub = document.createElement('div'); sub.id = 'candidateSubgroups'; sub.style.cssText = 'display:none;margin:-1px 0 7px 25px;border-left:1px solid #33434f;padding-left:8px;'; sub.innerHTML = `<button type="button" data-candidate-filter="active">Активні</button><button type="button" data-candidate-filter="transferred">Передані</button><button type="button" data-candidate-filter="refusal">Відмова</button>`;
    [...sub.querySelectorAll('button')].forEach(btn => { btn.style.cssText = 'display:block;width:100%;border:0;background:transparent;color:#9eabb3;text-align:left;padding:8px 8px;border-radius:7px;font-size:13px;cursor:pointer;'; btn.addEventListener('mouseenter', () => btn.style.background = '#1c2a34'); btn.addEventListener('mouseleave', () => btn.style.background = 'transparent'); btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (typeof showCandidates === 'function') showCandidates(); setTimeout(() => filterCandidateRows(btn.dataset.candidateFilter), 80); }); });
    candidateItem.insertAdjacentElement('afterend', sub); candidateItem.addEventListener('click', (e) => { if (e.target.closest('button')) return; sub.style.display = sub.style.display === 'none' ? 'block' : 'none'; });
  }
  function filterCandidateRows(filter) { const rows = document.querySelectorAll('#candidateRows tr'); rows.forEach(row => { const text = (row.textContent || '').toLowerCase(); const isTransferred = /передан|передано|передана|transfer/.test(text); const isRefusal = /відмов|відмова|відмовив|відмовилась|refus|reject/.test(text); let visible = true; if (filter === 'transferred') visible = isTransferred; if (filter === 'refusal') visible = isRefusal; if (filter === 'active') visible = !isTransferred && !isRefusal; row.style.display = visible ? '' : 'none'; }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installCandidateSubgroups); else installCandidateSubgroups(); setTimeout(installCandidateSubgroups, 500);
})();
(function(){if(window.__pskCandidateCardV2Loader||document.querySelector('script[src^="candidate-card-v2.js"]'))return;window.__pskCandidateCardV2Loader=true;const s=document.createElement('script');s.src='candidate-card-v2.js?v=20260928-card8';s.async=false;s.onload=()=>console.log('PSK candidate card V2 loaded');s.onerror=()=>console.error('Не вдалося завантажити candidate-card-v2.js');document.head.appendChild(s);})();
(function(){if(window.__pskAiRetryLoader)return;window.__pskAiRetryLoader=true;const s=document.createElement('script');s.src='ai-retry.js?v=20260929-1';s.async=false;s.onload=()=>console.log('PSK AI retry loaded');s.onerror=()=>console.error('Не вдалося завантажити ai-retry.js');document.head.appendChild(s);})();