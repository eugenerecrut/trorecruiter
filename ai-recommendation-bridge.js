// PSK_RECRUTER — AI recommendation bridge + close relatives module
(function () {
  if (window.__PSK_RELATIVES_MODULE_V1) return;
  window.__PSK_RELATIVES_MODULE_V1 = true;

  const ai = window.aiExtractRecommendation;
  if (typeof ai === 'function') {
    window.pskAIExtractRecommendation = ai;
    window.aiExtractRecommendation = async function (text) {
      const result = await window.pskAIExtractRecommendation(text);
      window.__PSK_PENDING_RELATIVES = Array.isArray(result?.relatives) ? result.relatives : [];
      return result;
    };
  }

  function db() {
    try { if (typeof supabaseClient !== 'undefined') return supabaseClient; } catch (_) {}
    return window.supabaseClient || null;
  }
  const esc = window.escapeHtml || (v => String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;'));
  const RELATION_OPTIONS = ['Батько','Мати','Чоловік','Дружина','Брат','Сестра','Інше'];

  function getCardForm() { return document.getElementById('candidateCardV2') || document.getElementById('candidateCardForm'); }

  async function getRelatives(candidateId) {
    const client=db(); if(!candidateId||!client)return[];
    const {data}=await client.from('candidates').select('profile_data').eq('id',candidateId).single();
    let p=data?.profile_data||{}; if(typeof p==='string'){try{p=JSON.parse(p)}catch(_){p={}}}
    return Array.isArray(p.relatives)?p.relatives:[];
  }

  function norm(r){return{relation:String(r?.relation||'').trim(),full_name:String(r?.full_name||'').trim(),birth_date:String(r?.birth_date||'').trim(),birth_place:String(r?.birth_place||'').trim(),citizenship:String(r?.citizenship||'').trim(),address:String(r?.address||'').trim(),phone:String(r?.phone||'').trim(),workplace:String(r?.workplace||'').trim(),position:String(r?.position||'').trim(),notes:String(r?.notes||'').trim()};}

  function row(r,i){r=norm(r);return `<div class="psk-relative-row" style="border:1px solid #e1e7e9;border-radius:10px;padding:14px;background:#fbfcfc;margin-bottom:10px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><strong style="font-size:12px">Родич №${i+1}</strong><button type="button" data-remove-relative="${i}" style="border:1px solid #e2b9b5;background:#fff5f4;color:#a23f38;border-radius:7px;padding:6px 9px;font-size:11px;font-weight:800">Видалити</button></div><div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 14px"><div><label>Ступінь споріднення</label><select data-relative-field="relation">${RELATION_OPTIONS.map(x=>`<option value="${esc(x)}" ${x===r.relation?'selected':''}>${esc(x)}</option>`).join('')}</select></div><div><label>ПІБ</label><input data-relative-field="full_name" value="${esc(r.full_name)}"></div><div><label>Дата народження</label><input data-relative-field="birth_date" type="date" value="${esc(r.birth_date)}"></div><div><label>Місце народження</label><input data-relative-field="birth_place" value="${esc(r.birth_place)}"></div><div><label>Громадянство</label><input data-relative-field="citizenship" value="${esc(r.citizenship)}"></div><div><label>Місце проживання</label><input data-relative-field="address" value="${esc(r.address)}"></div><div><label>Телефон</label><input data-relative-field="phone" value="${esc(r.phone)}"></div><div><label>Місце роботи</label><input data-relative-field="workplace" value="${esc(r.workplace)}"></div><div><label>Посада</label><input data-relative-field="position" value="${esc(r.position)}"></div><div><label>Примітки</label><input data-relative-field="notes" value="${esc(r.notes)}"></div></div></div>`;}

  function read(panel){return Array.from(panel.querySelectorAll('.psk-relative-row')).map(r=>{const x={};r.querySelectorAll('[data-relative-field]').forEach(e=>x[e.dataset.relativeField]=String(e.value||'').trim());return norm(x);}).filter(x=>x.relation||x.full_name||x.phone||x.address||x.workplace);}

  function addUI(form,relatives){if(!form||form.querySelector('#pskRelativesPanel'))return;const panel=document.createElement('section');panel.id='pskRelativesPanel';panel.className=form.id==='candidateCardV2'?'cc-section':'card';panel.style.cssText+=';margin-bottom:16px;padding:20px';panel.innerHTML=`<div class="panel-head" style="margin:-20px -20px 18px"><div><h3 style="margin:0">15. Близькі родичі</h3><small>Батьки, чоловік/дружина, брати, сестри та інші близькі родичі.</small></div></div><div id="pskRelativesList"></div><button type="button" id="pskAddRelative" style="border:1px solid #cfd8dc;background:#f7f9f9;color:#45525a;border-radius:8px;padding:9px 13px;font-weight:800">＋ Додати родича</button>`;const list=panel.querySelector('#pskRelativesList');let rows=Array.isArray(relatives)?relatives.map(norm):[];const render=()=>{list.innerHTML=rows.map(row).join('')||'<div style="padding:10px 0 14px;color:#89959c;font-size:11px">Родичів ще не додано.</div>';list.querySelectorAll('[data-remove-relative]').forEach(b=>b.onclick=()=>{rows.splice(+b.dataset.removeRelative,1);render();});};panel.querySelector('#pskAddRelative').onclick=()=>{rows.push(norm({}));render();};render();if(form.id==='candidateCardV2'){const first=form.querySelector('.cc-section');first?first.after(panel):form.prepend(panel);}else{const first=form.querySelector('.card');first?first.after(panel):form.prepend(panel);}form.__pskReadRelatives=()=>read(panel);}

  async function persist(id,relatives){const client=db();if(!id||!client)return;const {data,error}=await client.from('candidates').select('profile_data').eq('id',id).single();if(error)return;let p=data?.profile_data||{};if(typeof p==='string'){try{p=JSON.parse(p)}catch(_){p={}}}p.relatives=relatives;p.updated_from_relatives_module=true;p.relatives_updated_at=new Date().toISOString();await client.from('candidates').update({profile_data:p,updated_at:new Date().toISOString()}).eq('id',id);}

  let wrapped=false;function wrapOpen(){if(wrapped||typeof window.openCandidateCard!=='function')return;const original=window.openCandidateCard;window.openCandidateCard=async function(id){window.__PSK_CURRENT_CANDIDATE_ID=id;window.__PSK_RELATIVES_LAST_REFRESH=null;return original.apply(this,arguments);};wrapped=true;}

  const observer=new MutationObserver(async()=>{wrapOpen();const form=getCardForm();const id=window.__PSK_CURRENT_CANDIDATE_ID;if(form&&id&&!form.querySelector('#pskRelativesPanel')){const relatives=await getRelatives(id);if(!form.querySelector('#pskRelativesPanel'))addUI(form,relatives);if(!form.__pskRelativeSubmitAttached){form.__pskRelativeSubmitAttached=true;form.addEventListener('submit',()=>{const snapshot=form.__pskReadRelatives?form.__pskReadRelatives():[];setTimeout(async()=>{await persist(id,snapshot);if(window.__PSK_RELATIVES_LAST_REFRESH!==id){window.__PSK_RELATIVES_LAST_REFRESH=id;setTimeout(()=>window.openCandidateCard(id),150);}},1100);});}}const nf=document.getElementById('candidateForm');if(nf&&!nf.querySelector('#pskRelativesPanel')){addUI(nf,window.__PSK_PENDING_RELATIVES||[]);const original=nf.onsubmit;if(typeof original==='function'&&!nf.__pskRelativeSubmitWrapped){nf.__pskRelativeSubmitWrapped=true;nf.onsubmit=async function(e){const snapshot=nf.__pskReadRelatives?nf.__pskReadRelatives():[];await original.call(nf,e);const client=db();if(!client||!snapshot.length)return;const fullName=String(nf.elements.full_name?.value||'').trim();setTimeout(async()=>{const {data}=await client.from('candidates').select('id,profile_data').eq('full_name',fullName).order('created_at',{ascending:false}).limit(1).maybeSingle();if(!data?.id)return;let p=data.profile_data||{};if(typeof p==='string'){try{p=JSON.parse(p)}catch(_){p={}}}p.relatives=snapshot;p.updated_from_relatives_module=true;await client.from('candidates').update({profile_data:p,updated_at:new Date().toISOString()}).eq('id',data.id);},250);};}}});observer.observe(document.body,{childList:true,subtree:true});
  const timer=setInterval(()=>{wrapOpen();const f=getCardForm();const id=window.__PSK_CURRENT_CANDIDATE_ID;if(f&&id&&!f.querySelector('#pskRelativesPanel'))getRelatives(id).then(r=>{if(!f.querySelector('#pskRelativesPanel'))addUI(f,r)});const nf=document.getElementById('candidateForm');if(nf&&!nf.querySelector('#pskRelativesPanel'))addUI(nf,window.__PSK_PENDING_RELATIVES||[]);},300);setTimeout(()=>clearInterval(timer),30000);
  console.info('PSK close relatives module v1 loaded');
})();
