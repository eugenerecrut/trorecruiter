(function(){
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  let staff=[],user=null;
  async function ready(){
    const [r,u]=await Promise.all([supabaseClient.from('crm_staff').select('*').order('display_name'),supabaseClient.auth.getUser()]);
    if(r.error)throw r.error;if(u.error)throw u.error;staff=r.data||[];user=u.data.user;return staff;
  }
  const name=id=>staff.find(s=>s.user_id===id)?.display_name||(id?'Автор не записаний у довіднику':'Не призначено');
  const date=v=>v?new Date(v).toLocaleString('uk-UA',{timeZone:'Europe/Kyiv'}):'Час не записаний';
  const canAssign=()=>staff.some(s=>s.user_id===user?.id&&s.active&&['owner','lead'].includes(s.role));
  const options=(current=null)=>'<option value="">Не призначено</option>'+staff.filter(s=>s.active&&['lead','recruiter'].includes(s.role)||s.user_id===current).map(s=>'<option value="'+esc(s.user_id)+'" '+(s.user_id===current?'selected':'')+'>'+esc(s.display_name)+(s.active?'':' (неактивний)')+'</option>').join('');
  const control=c=>canAssign()?'<select class="crm-owner-select" aria-label="Відповідальний рекрутер" data-assign="'+esc(c.id)+'">'+options(c.responsible_recruiter_id)+'</select>':'<strong>'+esc(name(c.responsible_recruiter_id))+'</strong>';
  async function assign(c,value){
    let q=supabaseClient.from('candidates').update({responsible_recruiter_id:value||null}).eq('id',c.id);
    q=c.responsible_recruiter_id?q.eq('responsible_recruiter_id',c.responsible_recruiter_id):q.is('responsible_recruiter_id',null);
    const r=await q.select('id');if(r.error)throw r.error;if(!r.data?.length)throw new Error('Призначення вже змінилося. Оновіть список.');c.responsible_recruiter_id=value||null;
  }
  function bind(root,candidates){root.querySelectorAll('[data-assign]').forEach(select=>select.onchange=async()=>{const c=candidates.find(c=>c.id===select.dataset.assign),old=c.responsible_recruiter_id;select.disabled=true;try{await assign(c,select.value)}catch(e){select.value=old||'';alert(e.message)}finally{select.disabled=false}})}
  async function mountCard(c,root){await ready();const box=root.querySelector('[data-responsibility]');if(!box)return;box.innerHTML='<div class="crm-recruiter-field"><span class="crm-recruiter-icon" aria-hidden="true">'+ '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="8" r="3.5"/><path d="M5 21v-3a7 7 0 0 1 14 0v3"/></svg>'+'</span><label class="crm-recruiter-label"><span>Закріплений рекрутер</span>'+control(c)+'</label></div><button type="button" class="crm-history-button" data-history><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M3 11a9 9 0 1 1 2.6 7"/><path d="M3 4v7h7M12 7v5l3 2"/></svg>Історія справи</button>';bind(box,[c]);box.querySelector('[data-history]').onclick=()=>history(c.id).catch(e=>alert(e.message))}
  const latest=docs=>docs.filter(d=>!d.deleted_at&&!docs.some(other=>d.version_group_id&&other.version_group_id===d.version_group_id&&other.version_number>d.version_number));
  function documentInfo(d){
    const author=d.uploaded_by?name(d.uploaded_by):'Автор не записаний';
    return '<div class="crm-doc-accountability"><b>Завантажив: '+esc(author)+'</b><small>'+esc(date(d.created_at))+' · версія '+esc(d.version_number||1)+'</small><small>'+(d.verified_by?'Перевірив: '+esc(name(d.verified_by))+' · '+esc(date(d.verified_at)):d.verification_status==='Підтверджено'?'Підтверджено раніше; автор перевірки не записаний':'Ручну перевірку ще не виконано')+'</small></div>'+
      ((d.ai_extracted||d.ai_raw_response||d.processing_status==='AI помилка')?'<details class="crm-ai-container"><summary>Контейнер AI · '+esc(d.processing_status||'Архівний результат')+'</summary><p>Модель: '+esc(d.ai_model||'не записана')+' · '+esc(date(d.ai_processed_at))+'</p><p>Тип: '+esc(d.ai_document_type||d.document_type)+' · впевненість: '+esc(d.ai_confidence??'не записана')+'</p><pre>'+esc(JSON.stringify({fields:d.ai_extracted,warnings:d.ai_warnings},null,2))+'</pre><details><summary>Повна відповідь AI</summary><pre>'+esc(d.ai_raw_response?JSON.stringify(d.ai_raw_response,null,2):'Для цього старого результату повна відповідь не зберігалася.')+'</pre></details><button type="button" data-ai-history="'+esc(d.id)+'">Історія розпізнавань</button></details>':'');
  }
  function dialog(title,html){const d=document.createElement('dialog');d.className='crm-dialog crm-history';d.innerHTML='<h2>'+esc(title)+'</h2><button type="button" data-close>Закрити</button>'+html;document.body.append(d);d.showModal();const close=()=>{d.close();d.remove()};d.querySelector('[data-close]').onclick=close;d.addEventListener('cancel',e=>{e.preventDefault();close()});return d}
  async function aiHistory(id){
    await ready();
    const r=await supabaseClient.from('document_ai_runs').select('*').eq('document_id',id).order('recorded_at',{ascending:false});if(r.error)throw r.error;
    dialog('Історія розпізнавань',(r.data||[]).map(run=>{
      const result=typeof run.result==='object'&&run.result?run.result:{};
      return '<article><h3>'+esc(date(run.processed_at||run.recorded_at))+'</h3><p>'+esc(run.actor_name||'Автор не записаний')+(run.is_legacy?' · архівний результат':'')+'</p><p>Тип документа: '+esc(result.document_type||'Не визначено')+'</p>'+CRMHistoryFormat.fields(result.extracted||result.fields||{},{person:name})+'</article>';
    }).join('')||'<p>Розпізнавань ще немає.</p>');
  }
  async function history(id){
    await ready();
    const r=await supabaseClient.from('crm_activity').select('*').eq('candidate_id',id).order('occurred_at',{ascending:false});if(r.error)throw r.error;
    const documents=await supabaseClient.from('documents').select('id,file_name,document_type').eq('candidate_id',id);if(documents.error)throw documents.error;
    const lookup=new Map((documents.data||[]).map(d=>[d.id,d.file_name||d.document_type]));
    const actions={recruiter_assigned:'Зміна відповідального рекрутера',document_uploaded:'Завантажено документ',document_replaced:'Завантажено нову версію',document_verified:'Змінено перевірку документа',document_deleted:'Документ видалено',document_restored:'Документ відновлено',candidates_update:'Змінено картку кандидата',personal_files_update:'Змінено особову справу',documents_update:'Оновлено документ',candidates_insert:'Створено кандидата',personal_files_insert:'Створено особову справу',documents_delete:'Документ видалено',personal_files_delete:'Особову справу видалено',candidates_delete:'Кандидата видалено'};
    const articles=(r.data||[]).map(a=>{
      const changes=a.changes||{},rows=CRMHistoryFormat.changes(changes,{person:name});
      const title=changes.deleted_at&&Boolean(changes.deleted_at.before)!==Boolean(changes.deleted_at.after)?(changes.deleted_at.after?'Документ видалено':'Документ відновлено'):(a.action==='document_restored'&&changes.deleted_at&&!changes.deleted_at.before&&!changes.deleted_at.after?'Завантажено документ':actions[a.action]||'Оновлено відомості справи');
      const file=changes.file_name?.after||changes.file_name?.before||lookup.get(a.document_id);
      const source=a.source_document_id?lookup.get(a.source_document_id)||'документ особової справи':null;
      return '<article><h3>'+esc(title)+'</h3><p>'+esc(a.actor_name||name(a.actor_id))+' · '+esc(date(a.occurred_at))+'</p>'+(file?'<p><b>Документ:</b> '+esc(file)+'</p>':'')+(source?'<p><b>Перенесено з документа:</b> '+esc(source)+'</p>':'')+'<details'+(rows.length<=4?' open':'')+'><summary>Що змінилося'+(rows.length?' · '+rows.length:'')+'</summary>'+CRMHistoryFormat.render(rows)+'</details></article>';
    }).join('');
    dialog('Історія справи','<p>Хто, коли та які відомості змінив. Найновіші дії — зверху.</p>'+ (articles||'<p>Дій у цій справі ще немає.</p>'));
  }
  function bindHistory(root){root.addEventListener('click',e=>{const id=e.target.closest('[data-ai-history]')?.dataset.aiHistory;if(id)aiHistory(id).catch(e=>alert(e.message))})}
  window.CRMResponsibility={ready,name,date,canDelete:()=>staff.some(s=>s.user_id===user?.id&&s.active&&['owner','lead','recruiter'].includes(s.role)),control,bind,mountCard,latest,documentInfo,bindHistory,aiHistory,history,options,get userId(){return user?.id}};
})();
