const form = document.getElementById('applicationForm');
const status = document.getElementById('formStatus');

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());

  // Поки що форма працює локально. Після розгортання підключимо
  // безпечний серверний endpoint/CRM, щоб не світити секретний webhook у браузері.
  console.log('Заявка:', data);

  status.textContent = 'Заявку підготовлено. Підключення до CRM буде додано на наступному кроці.';
  status.style.color = '#45610d';
  form.reset();
});
