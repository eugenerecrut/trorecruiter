// Navigation and printing for the existing CRM.
window.CRMWorkspace = {
  candidateId: null, card: null, busy: false, sequence: 0,
  escape(value) { return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); },
  setContext(id,name='') { this.candidateId=id; this.candidateName=name; window.__PSK_CURRENT_CANDIDATE_ID=id; },
  markMenu(key) { document.querySelectorAll('[data-nav]').forEach(el=>{el.classList.toggle('active',el.dataset.nav===key);el.setAttribute('aria-current',el.dataset.nav===key?'page':'false');});document.querySelector('.sidebar')?.classList.remove('open'); },
  async guard() {
    const card=this.card;
    if(!card?.form?.isConnected||!card.dirty)return true;
    return new Promise(resolve=>{
      const dialog=document.createElement('dialog');dialog.className='crm-dialog';
      dialog.innerHTML='<h2>Є незбережені зміни</h2><p>Зберегти зміни в картці перед переходом?</p><div class="crm-actions"><button data-choice="save">Зберегти</button><button data-choice="discard">Вийти без збереження</button><button data-choice="stay">Залишитися</button></div><p role="status"></p>';
      const finish=value=>{dialog.close();dialog.remove();resolve(value)};
      dialog.addEventListener('cancel',e=>{e.preventDefault();finish(false)});
      dialog.addEventListener('click',async e=>{
        const choice=e.target.closest('[data-choice]')?.dataset.choice;if(!choice)return;
        if(choice==='stay')return finish(false);
        if(choice==='discard'){card.dirty=false;return finish(true)}
        dialog.querySelectorAll('button').forEach(b=>b.disabled=true);
        try{if(await card.save())finish(true);else{dialog.querySelector('[role=status]').textContent='Не вдалося зберегти. Перевірте поля картки.';dialog.querySelectorAll('button').forEach(b=>b.disabled=false)}}
        catch(err){dialog.querySelector('[role=status]').textContent=err.message;dialog.querySelectorAll('button').forEach(b=>b.disabled=false)}
      });
      document.body.append(dialog);dialog.showModal();dialog.querySelector('[data-choice=stay]').focus();
    });
  },
  async navigate(key,id=null) {
    if(this.busy||this.navigating)return false;
    this.navigating=true;
    if(!await this.guard()){this.navigating=false;return false}
    this.card=null; const target=id||this.candidateId;
    try{
      this.markMenu(['card','information'].includes(key)?'candidates':key);
      if(key==='candidates'){this.candidateId=null;this.candidateName='';await showCandidates()}
      else if(key==='new'){this.candidateId=null;this.candidateName='';showNewCandidateForm();this.trackNewForm()}
      else if(key==='card'&&target)await openCandidateCard(target);
      else if(key==='documents'){if(target)await showDocuments(target);else await this.pickCandidate('documents')}
      else if(key==='information'){if(target)await this.showInformation(target);else await this.pickCandidate('information')}
      else if(key==='blanks')this.showBlanks();
      else if(key==='settings')location.href='scanner-settings.html';
      else if(key==='home'){this.candidateId=null;this.candidateName='';document.querySelector('.content').innerHTML=this.homeHTML;await updateDashboard();await this.loadHome()}
      return true;
    }catch(err){console.error(err);alert('Не вдалося відкрити розділ: '+err.message);return false}finally{this.navigating=false}
  },
  async pickCandidate(destination) {
    this.markMenu(destination==='documents'?'documents':'candidates');
    const candidates=await getCandidates(), esc=this.escape;
    const content=document.querySelector('.content');
    content.innerHTML='<div class="dashboard-top"><div><h1 class="page-title">Виберіть кандидата</h1><p class="page-subtitle">Відкрийте потрібну особову справу.</p></div></div><input class="crm-search" id="crmCandidatePickerSearch" placeholder="ПІБ, телефон або РНОКПП" aria-label="Пошук кандидата"><div class="crm-picker" id="crmCandidatePicker"></div>';
    const input=content.querySelector('#crmCandidatePickerSearch');
    const render=()=>{
      const q=input.value.trim().toLocaleLowerCase('uk-UA');
      content.querySelector('#crmCandidatePicker').innerHTML=candidates.filter(c=>[c.full_name,c.name_nominative,c.phone,c.rnokpp].join(' ').toLocaleLowerCase('uk-UA').includes(q)).map(c=>'<button type="button" data-pick-id="'+esc(c.id)+'"><strong>'+esc(c.name_nominative||c.full_name)+'</strong><span>'+esc(c.phone||'')+'</span><small>Відкрити '+(destination==='documents'?'документи':'обов’язкову інформацію')+' →</small></button>').join('')||'<p class="muted">Кандидатів не знайдено.</p>';
    };
    input.addEventListener('input',render);content.querySelector('#crmCandidatePicker').addEventListener('click',e=>{const id=e.target.closest('[data-pick-id]')?.dataset.pickId;if(id)this.navigate(destination,id)});
    render();input.focus();
  },
  showBlanks() {
    this.markMenu('blanks');
    const titles=['Заява на контракт','Згода на обробку даних','Згода для психологічного тестування','Картка соціально-психологічного вивчення','Анкета на контракт','Розписка кандидата'];
    document.querySelector('.content').innerHTML='<div class="dashboard-top"><div><h1 class="page-title">Бланки для друку</h1><p class="page-subtitle">Чисті затверджені бланки для ручного заповнення кандидатом.</p></div></div><div class="crm-template-grid">'+titles.map(t=>'<section class="card"><h2>'+this.escape(t)+'</h2><span class="crm-state">Шаблон ще не додано</span><p class="muted">Після отримання затвердженого бланка тут будуть перегляд, друк і завантаження.</p></section>').join('')+'</div>';
  },
  async photo(documentRecord) {
    if(!documentRecord?.storage_path)return null;
    const {data,error}=await supabaseClient.storage.from('candidate-documents').createSignedUrl(documentRecord.storage_path,600);
    if(error||!data?.signedUrl)return null;
    const r=await fetch(data.signedUrl);if(!r.ok)return null;
    const blob=await r.blob();
    if(/pdf/i.test(documentRecord.mime_type||'')||/\.pdf$/i.test(documentRecord.file_name||'')){
      await loadExternalScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js','pdfjsLib');
      const images=await pdfToImages(new File([blob],'photo.pdf',{type:'application/pdf'}),1);return images[0]||null;
    }
    if(blob.type.startsWith('image/'))return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob)});
    return null;
  },
  async showInformation(id) {
    const sequence=++this.sequence, esc=this.escape;
    const [cr,pr,dr]=await Promise.all([
      supabaseClient.from('candidates').select('*').eq('id',id).single(),
      supabaseClient.from('personal_files').select('*').eq('candidate_id',id).maybeSingle(),
      getCandidateDocuments(id)]);
    if(cr.error)throw cr.error;if(pr.error)throw pr.error;const c=cr.data,pf=pr.data||{};
    let p=c.profile_data||{};if(typeof p==='string'){try{p=JSON.parse(p)}catch(_){p={}}}
    this.setContext(id,c.name_nominative||c.full_name);
    const photoDoc=[...dr].reverse().find(d=>/фото\s*9\s*[×xх\/]\s*12/i.test(d.document_type||d.document_name||''));
    const education=pf.education||p.education||[p.education_institution,p.education_specialty,p.education_qualification,p.education_year].filter(Boolean).join(', ');
    const work=pf.work_history||pf.civilian_experience||p.work_history||'';
    const served=c.served_before===true||c.served_before==='true';
    const noService=c.served_before===false||c.served_before==='false';
    const service=served?(pf.military_service_history||pf.military_experience||p.military_service_history||''):noService?'Військову службу не проходив / не проходила.':'';
    const fields=[
      ['ПІБ',c.name_nominative||c.full_name],['Дата народження',c.birth_date?c.birth_date.split('-').reverse().join('.'):null],['Місце народження',c.birth_place||pf.birth_place||p.birth_place],
      ['Освіта',education],['Трудовий стаж',work||((c.worked_before===false||c.worked_before==='false')?'Не працював / не працювала.':'')],
      ['Військова служба',service],['Військове звання',c.military_rank],['Сімейний стан',c.marital_status||pf.family_status||p.marital_status],
      ['Рідні та близькі',(p.relatives||[]).map(r=>[r.relationship||r.relation,r.full_name,r.birth_date,r.phone,r.address].filter(Boolean).join(', ')).join('\n')],['Відомості про мотивацію',p.motivation],['Додаткові відомості',p.recruitment_notes||pf.additional_notes],
      ['Відомості про судимість',p.criminal_record_info],['Відомості про психіатричний облік',p.psychiatric_record_info],['Організаторські здібності',p.organizational_skills]
    ];
    const content=document.querySelector('.content');
    content.innerHTML='<div class="dashboard-top crm-no-print"><div><h1 class="page-title">Обов’язкова інформація</h1><p class="page-subtitle">'+esc(c.name_nominative||c.full_name)+' · перед психологічним тестом</p></div><div class="quick-actions"><button id="crmInfoBack">Картка кандидата</button><button id="crmInfoPrint" disabled>Друкувати / зберегти PDF</button></div></div><p class="crm-notice crm-no-print" id="crmInfoNotice">Завантажуємо фото 9×12…</p><article class="crm-information" id="crmInformation"><h2>Обов’язкова інформація на контракт</h2><img id="crmInfoPhoto" alt="Фото кандидата 9×12" hidden>'+fields.map(([label,value])=>'<p><strong>'+esc(label)+':</strong> '+esc(value||'Не вказано').replace(/\n/g,'<br>')+'</p>').join('')+'</article>';
    content.querySelector('#crmInfoBack').onclick=()=>this.navigate('card',id);
    content.querySelector('#crmInfoPrint').onclick=()=>window.print();
    let photo=null;try{photo=await this.photo(photoDoc)}catch(e){console.warn('Фото 9×12:',e)}
    if(sequence!==this.sequence||!content.querySelector('#crmInfoPhoto'))return;
    const missing=fields.slice(0,6).filter(([,v])=>!v).map(([k])=>k);
    if(!photo)missing.push('Фото 9×12');
    const notice=content.querySelector('#crmInfoNotice');
    if(photo){const image=content.querySelector('#crmInfoPhoto');image.src=photo;image.hidden=false}
    notice.textContent=missing.length?'Перед друком заповніть: '+missing.join(', ')+'.':'Перевірте відомості перед друком. Незаповнені додаткові поля позначені «Не вказано».';
    content.querySelector('#crmInfoPrint').disabled=missing.length>0;
  }
};
CRMWorkspace.homeHTML=document.querySelector('.content').innerHTML;
window.crmNavigate=(key,id)=>CRMWorkspace.navigate(key,id);
window.addEventListener('beforeunload',event=>{if(CRMWorkspace.card?.dirty||CRMWorkspace.busy){event.preventDefault();event.returnValue=''}});

CRMWorkspace.loadHome=async function(){
  if(!document.querySelector('.cards'))return;
  const candidates=await getCandidates();
  const reqs=await getDocumentRequirements();
  const result=await supabaseClient.from('documents').select('id,candidate_id,requirement_id,document_type,verification_status,processing_status');
  if(result.error)throw result.error;
  if(!document.querySelector('.cards'))return;
  const docs=result.data||[],esc=this.escape;
  const recent=document.querySelector('.dashboard-grid tbody');
  if(recent)recent.innerHTML=candidates.slice(0,6).map(c=>'<tr><td><button class="crm-button" onclick="crmNavigate(\'card\',\''+esc(c.id)+'\')">'+esc(c.name_nominative||c.full_name)+'</button></td><td>'+esc(c.desired_position||'—')+'</td><td>'+esc(c.recruitment_status||'Новий')+'</td><td>'+esc(c.profile_data?.recruiter_name||'—')+'</td></tr>').join('')||'<tr><td colspan="4">Кандидатів поки немає.</td></tr>';
  const tasks=document.querySelector('.lower-grid .card');
  if(tasks){
    const missing=candidates.filter(c=>reqs.some(r=>r.is_required&&requirementCondition(r,c)===true&&!docs.some(d=>d.candidate_id===c.id&&(d.requirement_id===r.id||d.document_type===r.document_type))));
    const review=docs.filter(d=>d.verification_status!=='Підтверджено');
    const errors=docs.filter(d=>d.processing_status==='AI помилка');
    tasks.querySelectorAll('.task').forEach(el=>el.remove());
    const group=(title,items)=>'<section class="crm-home-attention"><h4>'+title+' · '+items.length+'</h4>'+items.slice(0,5).map(c=>'<button class="crm-button" onclick="crmNavigate(\'documents\',\''+esc(c.id)+'\')">'+esc(c.name_nominative||c.full_name)+'</button>').join('')+(items.length>5?'<p>Ще '+(items.length-5)+' справ. Повний список у розділі «Кандидати».</p>':'')+'</section>';
    const owners=files=>candidates.filter(c=>files.some(d=>d.candidate_id===c.id));
    tasks.insertAdjacentHTML('beforeend',group('Неповні комплекти документів',missing)+group('Неперевірені документи',owners(review))+group('Помилки розпізнавання',owners(errors)));
  }
};
supabaseClient.auth.onAuthStateChange((event,session)=>{
  if(!session?.user)return;
  const refresh=()=>setTimeout(()=>{
    if(typeof updateDashboard!=='function'||typeof getDocumentRequirements!=='function')return;
    updateDashboard();CRMWorkspace.loadHome().catch(console.error);
  },0);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',refresh,{once:true});
  else refresh();
});
CRMWorkspace.trackNewForm=function(){
  const form=document.querySelector('#candidateForm');if(!form)return;
  const state={form,dirty:false,save:null,saving:null};this.card=state;
  form.addEventListener('input',()=>state.dirty=true);form.addEventListener('change',()=>state.dirty=true);
  const original=form.onsubmit;
  form.onsubmit=async function(event){
    event.preventDefault();if(state.saving)return state.saving;if(!form.reportValidity())return false;
    CRMWorkspace.busy=true;const button=form.querySelector('[type=submit]');if(button)button.disabled=true;
    state.saving=(async()=>{try{const result=await original.call(form,event);if(form.dataset.savedCandidateId)state.dirty=false;return result}finally{state.saving=null;CRMWorkspace.busy=false;if(button)button.disabled=false}})();
    return state.saving;
  };
  state.save=async()=>{await form.onsubmit({preventDefault(){},target:form});return !!form.dataset.savedCandidateId};
};
