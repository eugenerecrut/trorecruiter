(function () {
  'use strict';
  const OWNER = '7c74b122-3940-40a8-a32f-fe2b6776c173';
  const client = supabase.createClient('https://vhfysipxorlhuiaatxqi.supabase.co', 'sb_publishable_o8ZTKE4Ek0m58zq1q0QpFQ_domIX0Yz');
  const byId = id => document.getElementById(id);
  let allowed = false, busy = false, page = 1, currentUsers = [], hasMore = false, scannerChecked = false, authGeneration = 0;
  const notice = text => {byId('users-status').textContent = text;};
  function route() {
    const group = ['general', 'scanner', 'users', 'about'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'general';
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
      detail.textContent = [login, user.department, user.position, user.owner ? 'Власник CRM' : 'Користувач'].filter(Boolean).join(' · ');
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
      await loadUsers();
    } catch (error) {if (generation === authGeneration) notice(error.message);}
  }
  window.addEventListener('hashchange', route); route();
  client.auth.onAuthStateChange(() => {setTimeout(checkAccess, 0);});
})();
