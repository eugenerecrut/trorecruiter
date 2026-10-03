// Append a release and increase build for each published CRM update.
(function () {
  'use strict';
  const releases = [{version: '1.0.0.342', build: 342, date: '2026-10-03', changes: [
    'Додано фото поруч із ПІБ у списку кандидатів, результатах пошуку та мобільних картках.',
    'Фото береться з актуального документа Фото 9×12; підтримуються зображення та перша сторінка PDF.',
    'Мініатюри завантажуються при перегляді через захищений доступ; за відсутності фото показуються ініціали.'
  ]}, {version: '1.0.0.340', build: 340, date: '2026-10-03', changes: [
    'Налаштування розділено на окремі підгрупи: Інтерфейс, Сканер, Користувачі та Про програму.',
    'Інформацію про розробника, версію, час та історію змін об’єднано в підгрупі Про програму.',
    'Додано створення користувачів, редагування даних і встановлення нового пароля; серверний доступ має лише власник CRM.'
  ]}, {version: '1.0.0.338', build: 338, date: '2026-10-03', changes: [
    'Перемикач автоматичного, мобільного та звичайного режимів перенесено з верхньої панелі й меню CRM у Налаштування → Інтерфейс. Збережено поточний вибір браузера.',
    'Додано інформацію про розробника, виконавця OpenAI Codex та календарний час від першого коміту CRM.',
    'Запроваджено номер версії, лічильник редакцій та журнал змін.'
  ]}];

  const projectStartedAt = Date.parse('2026-09-26T12:04:23+03:00');
  function updateProjectAge() {
    const minutes = Math.max(0, Math.floor((Date.now() - projectStartedAt) / 60000));
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor(minutes % 1440 / 60);
    document.querySelectorAll('[data-project-age]').forEach(el => {
      el.textContent = days + ' дн. ' + hours + ' год. ' + (minutes % 60) + ' хв.';
    });
  }
  updateProjectAge();
  setInterval(updateProjectAge, 60000);
  const current = releases[0];
  window.CRMRelease = Object.freeze({version: current.version, build: current.build});
  document.querySelectorAll('[data-release-version]').forEach(el => {el.textContent = current.version;});
  document.querySelectorAll('[data-release-build]').forEach(el => {el.textContent = String(current.build);});
  document.querySelectorAll('[data-release-fixes]').forEach(el => {el.textContent = String(current.changes.length);});
  const history = document.getElementById('release-history');
  if (!history) return;
  releases.forEach(release => {
    const heading = document.createElement('h4');
    heading.textContent = release.version + ' · ' + release.date;
    const list = document.createElement('ul');
    release.changes.forEach(change => {const item = document.createElement('li'); item.textContent = change; list.append(item);});
    history.append(heading, list);
  });
})();
