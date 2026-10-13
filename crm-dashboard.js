// Operational dashboard and shared planning priorities. No writes.
(function () {
  'use strict';
  const esc=v=>CRMWorkspace.escape(v);
  const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const date=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')?v.split('-').reverse().join('.'):v||'Без дати';
  function due(c) {
    const w=CRMWorkflow.wf(c);
    return [w.next_contact_date,w.additional_exams?w.exams_date:null].filter(v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')).sort()[0]||'';
  }
  function bucket(c,day=today()) {const d=due(c);return !d?'undated':d<day?'overdue':d===day?'today':'upcoming';}
  function next(c) {
    const w=CRMWorkflow.wf(c),p=CRMWorkflow.profile(c);
    if(w.outcome)return 'Завершити перенесення до архіву';
    if(w.additional_exams&&w.exams_details)return w.exams_details;
    if(w.next_action)return w.next_action;
    if(!p.service_type)return 'Уточнити: контракт чи мобілізація';
    if(!c.responsible_recruiter_id)return 'Призначити відповідального рекрутера';
    if(CRMCandidateConditions.isUnit(c))return 'Перевірити РЛ, припис і реєстр';
    return {'Новий кандидат':'Зв’язатися з кандидатом','Дозвон та співбесіда':'Уточнити дані й надати список документів','В роботі':'Перевірити документи та підготувати обов’язкову інформацію','ВЛК':'Проконтролювати ВЛК та додаткові обстеження','Направлений до ВЧ':'Отримати підтвердження зарахування'}[CRMWorkflow.stage(c)]||'Уточнити наступну дію';
  }
  function compare(a,b,day=today()) {
    const order={overdue:0,today:1,upcoming:2,undated:3};
    return order[bucket(a,day)]-order[bucket(b,day)]||due(a).localeCompare(due(b))||String(a.full_name||'').localeCompare(String(b.full_name||''),'uk');
  }
  const active=c=>!CRMWorkflow.isArchived(c)&&!CRMWorkflow.profile(c).merged_into;
  async function load(mode='home') {
    const root=document.querySelector('.content');if(!root)return;
    CRMWorkspace.card=null;CRMWorkspace.setContext(null,'');CRMWorkspace.markMenu(mode==='documents'?'documents':'home');
    root.classList.remove('cc-v3','crm-doc-manager');
    root.innerHTML='<section class="crm-dashboard" data-dashboard><div class="dashboard-top"><div><h1 class="page-title">'+(mode==='documents'?'Документи · контроль':'Дашборд')+'</h1><p class="page-subtitle">Наступні дії, строки та контроль справ.</p></div><div class="quick-actions"><button type="button" data-dashboard-new>＋ Новий кандидат</button><button type="button" data-dashboard-candidates>Кандидати</button></div></div><p role="status" data-dashboard-status>Завантажуємо справи…</p><div data-dashboard-content></div></section>';
    const host=root.querySelector('[data-dashboard]');
    host.querySelector('[data-dashboard-new]').onclick=()=>crmNavigate('new');
    host.querySelector('[data-dashboard-candidates]').onclick=()=>crmNavigate('candidates');
    try {
      const [all,requirements,staff,result]=await Promise.all([getCandidates(),getDocumentRequirements(),CRMResponsibility.ready(),supabaseClient.from('documents').select('id,candidate_id,requirement_id,document_type,storage_path,verification_status,processing_status,version_group_id,version_number,deleted_at')]);
      if(result.error)throw result.error;if(!host.isConnected)return;
      const candidates=all.filter(active),docs=CRMResponsibility.latest(result.data||[]),day=today();
      const totals=new Map(candidates.map(c=>[c.id,CRMDocumentState.summary(c,requirements,docs.filter(d=>d.candidate_id===c.id))]));
      const staffIds=[...new Set([...staff.filter(s=>s.active&&['lead','recruiter'].includes(s.role)).map(s=>s.user_id),...candidates.map(c=>c.responsible_recruiter_id).filter(Boolean)])];
      const current=staff.find(s=>s.user_id===CRMResponsibility.userId);
      let owner=current?.role==='recruiter'?current.user_id:'all',view=mode==='documents'?'review':'all';
      const views=mode==='documents'?[['all','Усі справи'],['review','Перевірити'],['errors','Помилки AI'],['missing','Неповний комплект']]:[['all','Усі справи'],['overdue','Прострочено'],['today','Сьогодні'],['paused','На паузі'],['review','Перевірити'],['errors','Помилки AI']];
      const content=host.querySelector('[data-dashboard-content]');
      content.innerHTML='<div class="crm-dashboard-filters"><label>Рекрутер<select data-dashboard-owner><option value="all">Усі рекрутери</option><option value="unassigned">Не призначено</option>'+staffIds.map(id=>'<option value="'+esc(id)+'">'+esc(CRMResponsibility.name(id))+'</option>').join('')+'</select></label><label>Пошук<input type="search" data-dashboard-search placeholder="ПІБ або телефон"></label><label>Вид оформлення<select data-dashboard-mode><option value="all">Усі</option><option value="contract">Контракт</option><option value="mobilization">Мобілізація</option><option value="unknown">Не уточнено</option></select></label></div><div class="crm-dashboard-metrics" data-dashboard-metrics></div><div class="crm-dashboard-table"><table><thead><tr><th>Кандидат</th><th>Етап</th><th>Наступна дія</th><th>Дата</th><th>Рекрутер</th><th>Комплект</th><th>Відкрити</th></tr></thead><tbody data-dashboard-rows></tbody></table></div><p class="muted" data-dashboard-empty hidden>Справ за цим фільтром немає.</p>';
      const ownerInput=content.querySelector('[data-dashboard-owner]');ownerInput.value=owner;
      const matches=(c,key)=>key==='all'||key==='overdue'&&bucket(c,day)==='overdue'||key==='today'&&bucket(c,day)==='today'||key==='paused'&&CRMWorkflow.wf(c).paused||key==='review'&&totals.get(c.id).review>0||key==='errors'&&totals.get(c.id).errors>0||key==='missing'&&(totals.get(c.id).verified<totals.get(c.id).total||totals.get(c.id).unknown>0);
      function render() {
        const query=content.querySelector('[data-dashboard-search]').value.trim().toLocaleLowerCase('uk'),type=content.querySelector('[data-dashboard-mode]').value;
        const base=candidates.filter(c=>(owner==='all'||(owner==='unassigned'?!c.responsible_recruiter_id:c.responsible_recruiter_id===owner))&&(!query||[c.full_name,c.name_nominative,c.phone].join(' ').toLocaleLowerCase('uk').includes(query))&&(type==='all'||type==='mobilization'&&CRMCandidateConditions.isMobilization(c)||type==='contract'&&CRMWorkflow.profile(c).service_type==='За контрактом'||type==='unknown'&&!CRMWorkflow.profile(c).service_type));
        content.querySelector('[data-dashboard-metrics]').innerHTML=views.map(([key,title])=>'<button type="button" class="crm-dashboard-metric '+(key===view?'active':'')+'" data-dashboard-view="'+key+'" aria-pressed="'+(key===view)+'"><span>'+title+'</span><strong>'+base.filter(c=>matches(c,key)).length+'</strong></button>').join('');
        const selected=base.filter(c=>matches(c,view)).sort((a,b)=>compare(a,b,day));
        content.querySelector('[data-dashboard-rows]').innerHTML=selected.map(c=>{
          const s=totals.get(c.id),w=CRMWorkflow.wf(c),b=bucket(c,day);
          return '<tr><td><button type="button" class="crm-name-link" data-dashboard-card="'+esc(c.id)+'">'+esc(c.name_nominative||c.full_name)+'</button><small>'+esc(CRMWorkflow.profile(c).service_type||'Вид оформлення не уточнено')+'</small></td><td>'+esc(CRMCandidateConditions.isUnit(c)?'Оформлює ВЧ':CRMWorkflow.label(c))+'</td><td>'+esc(next(c))+'</td><td><span class="crm-due-'+b+'">'+esc(date(due(c)))+'</span></td><td>'+esc(CRMResponsibility.name(c.responsible_recruiter_id))+'</td><td>'+s.verified+'/'+s.total+(s.unknown?'<small>Уточнити: '+s.unknown+'</small>':'')+'</td><td><button type="button" data-dashboard-plan="'+esc(c.id)+'">Справа</button><button type="button" data-dashboard-docs="'+esc(c.id)+'">Документи</button></td></tr>';
        }).join('');
        content.querySelector('[data-dashboard-empty]').hidden=selected.length>0;
        host.querySelector('[data-dashboard-status]').textContent='Справ: '+base.length+' · Без відповідального: '+base.filter(c=>!c.responsible_recruiter_id).length+' · '+date(day);
      }
      ownerInput.onchange=()=>{owner=ownerInput.value;render();};
      content.querySelector('[data-dashboard-search]').oninput=render;content.querySelector('[data-dashboard-mode]').onchange=render;
      content.addEventListener('click',event=>{
        const button=event.target.closest('button');if(!button)return;
        if(button.dataset.dashboardView){view=button.dataset.dashboardView;render();}
        if(button.dataset.dashboardCard)crmNavigate('card',button.dataset.dashboardCard);
        if(button.dataset.dashboardPlan)crmNavigate('planning',button.dataset.dashboardPlan);
        if(button.dataset.dashboardDocs)crmNavigate('documents',button.dataset.dashboardDocs);
      });render();
    }catch(error){if(host.isConnected){host.querySelector('[data-dashboard-status]').textContent='Не вдалося завантажити дашборд: '+error.message;const retry=document.createElement('button');retry.type='button';retry.textContent='Повторити';retry.onclick=()=>load(mode);host.append(retry);}}
  }
  window.CRMCaseTasks={today,date,due,bucket,next,compare,active};
  window.CRMDashboard={load};
  CRMWorkspace.loadHome=()=>load();
})();
