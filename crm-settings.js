(function () {
  'use strict';
  const OWNER = '7c74b122-3940-40a8-a32f-fe2b6776c173';
  const client = supabase.createClient('https://vhfysipxorlhuiaatxqi.supabase.co', 'sb_publishable_o8ZTKE4Ek0m58zq1q0QpFQ_domIX0Yz');
  const byId = id => document.getElementById(id);
  let allowed = false, busy = false, page = 1, currentUsers = [], hasMore = false, scannerChecked = false, authGeneration = 0;
  const notice = text => {byId('users-status').textContent = text;};
  let workerState=null;
  function renderWorkerState(){
    if(!byId('splav-worker-status'))return;
    byId('splav-worker-status').textContent=workerState?.active&&workerState?.enabled
      ?'СПЛАВ працює. У черзі: '+workerState.queued+' · Опрацьовується: '+workerState.running+' · Історичних результатів для звірки: '+workerState.needs_review
      :workerState?.created?'Службовий запис створено. Фонове опрацювання вимкнено.':'Службовий запис ще не створено.';
    byId('splav-create').disabled=busy||!workerState||workerState.created;
    byId('splav-activate').disabled=busy||!workerState?.created||!!workerState?.active;
    byId('splav-disable').disabled=busy||!workerState?.active;
    byId('splav-probe').disabled=busy||!workerState?.active;
  }
  async function loadWorkerState(){const data=await api({action:'status_splav'});workerState=data.worker;renderWorkerState();}
  function installWorkerPanel(){
    if(byId('splav-worker-panel'))return;
    const panel=document.createElement('section');panel.id='splav-worker-panel';panel.className='card';
    const title=document.createElement('h3');title.textContent='СПЛАВ · Фонове опрацювання';
    const description=document.createElement('p');description.textContent='Нові завантаження опрацьовуються без відкритої вкладки. Наявні документи автоматично повторно не запускаються. Ручні значення зберігаються.';
    const status=document.createElement('p');status.id='splav-worker-status';status.textContent='Перевіряю стан…';
    panel.append(title,description,status);
    for(const [id,label,action] of [['splav-create','Створити службовий запис','provision_splav'],['splav-activate','Увімкнути СПЛАВ','activate_splav'],['splav-disable','Призупинити','disable_splav']]){
      const button=document.createElement('button');button.type='button';button.id=id;button.textContent=label;button.disabled=true;
      button.addEventListener('click',()=>task(async()=>{await api({action});await loadWorkerState();await loadUsers();}));panel.append(button);
    }
    byId('users-content').prepend(panel);
    const probe=document.createElement('button');probe.type='button';probe.id='splav-probe';probe.textContent='Перевірити доступ';probe.disabled=true;
    probe.addEventListener('click',()=>task(async()=>{const result=await api({action:'probe_splav'});notice(result.probe?.idle_isolation===true?'СПЛАВ: вхід працює; доступ поза дорученнями й адміністрування заборонені.':'СПЛАВ: службовий вхід і заборона адміністрування перевірені. Перевірку порожньої черги пропущено, оскільки є активне доручення.');}));panel.append(probe);
    const diagnostic=document.createElement('details'),summary=document.createElement('summary');
    summary.textContent='Діагностика рендеру · без AI';diagnostic.append(summary);
    const explanation=document.createElement('p');explanation.textContent='Пілотна перевірка першої сторінки PDF до 20 МіБ. Файл не зберігається і не додається до справи. Для перевірки використовуйте штучний зразок.';
    const file=document.createElement('input');file.type='file';file.accept='application/pdf,.pdf';file.setAttribute('aria-label','PDF для діагностики рендеру');
    const run=document.createElement('button');run.type='button';run.textContent='Підготувати першу сторінку';
    const result=document.createElement('p');result.setAttribute('role','status');
    const preview=document.createElement('img');preview.alt='Перша сторінка діагностичного PDF';preview.hidden=true;preview.style.maxWidth='100%';
    let imageURL=null;
    run.addEventListener('click',async()=>{
      if(run.disabled)return;
      const selected=file.files?.[0];
      if(!selected||selected.size>20*1024*1024){result.textContent='Виберіть PDF до 20 МіБ.';return;}
      run.disabled=true;preview.hidden=true;result.textContent='Готую сторінку без AI…';
      if(imageURL){URL.revokeObjectURL(imageURL);imageURL=null;}
      try{
        const {data:{session},error}=await client.auth.getSession();
        if(error||!session||session.user.id!==OWNER||!allowed)throw Error('Потрібна чинна сесія власника CRM');
        const response=await fetch('https://vhfysipxorlhuiaatxqi.supabase.co/functions/v1/splav-render-probe',{
          method:'POST',headers:{'Content-Type':'application/pdf',apikey:'sb_publishable_o8ZTKE4Ek0m58zq1q0QpFQ_domIX0Yz',Authorization:'Bearer '+session.access_token},
          body:selected,signal:AbortSignal.timeout(60000)});
        if(!response.ok){const detail=await response.json().catch(()=>({}));throw Error(detail.error||'Рендер недоступний ('+response.status+')');}
        const metrics=JSON.parse(response.headers.get('x-splav-render-metrics')||'{}');
        const blob=await response.blob();
        if(!allowed||session.user.id!==OWNER)return;
        imageURL=URL.createObjectURL(blob);preview.src=imageURL;preview.hidden=false;
        result.textContent='Готово: '+metrics.width+' × '+metrics.height+'; сторінок у PDF: '+metrics.pages+'; '+metrics.total_ms+' мс; AI-запитів: 0. Файл не збережено.';
      }catch(error){result.textContent=error.message||'Не вдалося підготувати сторінку.';}
      finally{run.disabled=false;}
    });
    window.addEventListener('pagehide',()=>{if(imageURL)URL.revokeObjectURL(imageURL);});
    diagnostic.append(explanation,file,run,result,preview);panel.append(diagnostic);
  }
  function route() {
    const requested = location.hash.slice(1);
    const groups = window.CRMInterface?.mode === 'mobile' ? ['general', 'users', 'about'] : ['general', 'scanner', 'users', 'about'];
    const group = groups.includes(requested) ? requested : 'general';
    document.querySelectorAll('[data-settings-panel]').forEach(panel => {panel.hidden = panel.id !== group;});
    document.querySelectorAll('[data-settings-link]').forEach(link => {
      link.classList.toggle('active', link.hash === '#' + group);
      if (link.hash === '#' + group) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    });
    if (group === 'scanner' && !scannerChecked) {scannerChecked = true; checkAgent();}
  }
  async function api(body) {
    const {data: {session}, error} = await client.auth.getSession();
    if (error || !session) throw new Error('Увійдіть до CRM під своїм обліковим записом');
    const response = await fetch('https://vhfysipxorlhuiaatxqi.supabase.co/functions/v1/crm-user-admin', {
      method: 'POST', headers: {'Content-Type': 'application/json', apikey: 'sb_publishable_o8ZTKE4Ek0m58zq1q0QpFQ_domIX0Yz', Authorization: 'Bearer ' + session.access_token}, body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Сервіс користувачів недоступний');
    return data;
  }
  function resetForm() {
    byId('user-form').reset();
    byId('user-id').value = '';
    byId('user-login').disabled = false;
    byId('user-password').required = true;
    byId('password-field').hidden = false;
    byId('user-form-title').textContent = 'Новий користувач';
    byId('user-save').textContent = 'Створити користувача';
  }
  async function loadUsers() {
    const generation = authGeneration;
    notice('Завантажую користувачів…');
    const data = await api({action: 'list', page});
    if (!allowed || generation !== authGeneration) return;
    currentUsers = data.users; hasMore = data.hasMore;
    const list = byId('users-list'); list.replaceChildren();
    currentUsers.forEach(user => {
      const card = document.createElement('article'); card.className = 'user-card';
      const heading = document.createElement('h3'); heading.textContent = user.full_name || user.email;
      const detail = document.createElement('p'); detail.className = 'muted';
      const login = user.email.endsWith('@trorecruiter.invalid') ? user.email.split('@')[0] : user.email;
      detail.textContent = [login, user.department, user.position, user.technical?'Службовий запис СПЛАВ':user.owner ? 'Власник CRM' : 'Користувач'].filter(Boolean).join(' · ');
      if(user.technical){card.append(heading,detail);list.append(card);return;}
      const edit = document.createElement('button'); edit.className = 'btn secondary'; edit.textContent = 'Редагувати';
      edit.addEventListener('click', () => {
        if (busy) return;
        byId('user-id').value = user.id; byId('user-login').value = login; byId('user-login').disabled = true;
        ['full_name', 'department', 'position'].forEach(key => {byId('user-' + key).value = user[key];});
        byId('user-password').value = ''; byId('user-password').required = false; byId('password-field').hidden = true;
        byId('user-form-title').textContent = 'Редагування користувача'; byId('user-save').textContent = 'Зберегти зміни';
        byId('user-form').scrollIntoView({behavior: 'smooth', block: 'start'});
      });
      card.append(heading, detail, edit);
      if (!user.owner) {
        const password = document.createElement('button'); password.className = 'btn secondary'; password.textContent = 'Новий пароль';
        password.addEventListener('click', () => {
          if (busy) return;
          byId('password-user-id').value = user.id; byId('password-user-label').textContent = 'Користувач: ' + login;
          byId('password-new').value = ''; byId('password-error').textContent = ''; byId('password-dialog').showModal();
        }); card.append(password);
      }
      list.append(card);
    });
    byId('users-prev').disabled = page === 1; byId('users-next').disabled = !data.hasMore;
    byId('users-page').textContent = 'Сторінка ' + page;
    notice('Користувачів на сторінці: ' + currentUsers.length);
  }
  async function task(action) {
    if (busy || !allowed) return;
    busy = true; document.querySelectorAll('#users button').forEach(button => {button.disabled = true;});
    try {await action();} catch (error) {notice(error.message);} finally {
      busy = false; document.querySelectorAll('#users button').forEach(button => {button.disabled = false;});
      byId('users-prev').disabled = page === 1;
      byId('users-next').disabled = !hasMore;
      renderWorkerState();
    }
  }
  byId('user-form').addEventListener('submit', event => {
    event.preventDefault();
    task(async () => {
      const id = byId('user-id').value;
      const body = {action: id ? 'update' : 'create', id};
      ['full_name', 'department', 'position'].forEach(key => {body[key] = byId('user-' + key).value;});
      if (!id) {body.login = byId('user-login').value; body.password = byId('user-password').value;}
      await api(body); resetForm(); await loadUsers(); notice(id ? 'Зміни збережено' : 'Користувача створено. Він може увійти до CRM');
    });
  });
  byId('password-form').addEventListener('submit', async event => {
    event.preventDefault(); if (busy || !allowed) return;
    busy = true; byId('password-submit').disabled = true;
    try {
      await api({action: 'password', id: byId('password-user-id').value, password: byId('password-new').value});
      byId('password-new').value = ''; byId('password-dialog').close(); notice('Новий пароль встановлено');
    } catch (error) {byId('password-error').textContent = error.message;}
    finally {busy = false; byId('password-submit').disabled = false;}
  });
  byId('password-cancel').addEventListener('click', () => {if (!busy) byId('password-dialog').close();});
  byId('password-dialog').addEventListener('close', () => {byId('password-new').value = '';});
  byId('password-dialog').addEventListener('cancel', event => {if (busy) event.preventDefault();});
  byId('user-cancel').addEventListener('click', resetForm);
  byId('users-refresh').addEventListener('click', () => task(loadUsers));
  byId('users-prev').addEventListener('click', () => task(async () => {page = Math.max(1, page - 1); await loadUsers();}));
  byId('users-next').addEventListener('click', () => task(async () => {page += 1; await loadUsers();}));
  async function checkAccess() {
    const generation = ++authGeneration;
    allowed = false; byId('users-link').hidden = true; byId('users-content').hidden = true;
    byId('users-list').replaceChildren(); byId('password-dialog').close(); resetForm();
    notice('Керування користувачами доступне лише власнику. Увійдіть до CRM');
    try {
      const {data: {user}, error} = await client.auth.getUser();
      if (error || user?.id !== OWNER) return;
      const access = await api({action: 'access'});
      if (!access.allowed || generation !== authGeneration) return;
      allowed = true; byId('users-link').hidden = false; byId('users-content').hidden = false;
      installWorkerPanel();
      await loadUsers();
      try{await loadWorkerState();}catch{byId('splav-worker-status').textContent='Сервер черги ще не підключено.';}
    } catch (error) {if (generation === authGeneration) notice(error.message);}
  }
  window.addEventListener('hashchange', route);
  new MutationObserver(route).observe(document.documentElement,{attributes:true,attributeFilter:['data-crm-layout']});
  route();
  client.auth.onAuthStateChange(() => {setTimeout(checkAccess, 0);});
})();
