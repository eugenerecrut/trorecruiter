// PSK_RECRUTER — temporary candidate deletion + PІБ declension fallback
(function () {
  async function deleteCandidateCase(candidateId, candidateName = 'кандидата') {
    if (!candidateId) {
      alert('Не вдалося визначити ID кандидата.');
      return;
    }

    const confirmed = window.confirm(
      `УВАГА! Видалити особову справу «${candidateName}»?\n\n` +
      'Буде видалено кандидата, особову справу та пов’язані записи. Дію поки що не можна скасувати.'
    );
    if (!confirmed) return;

    try {
      const { data: sessionData } = await supabaseClient.auth.getSession();
      if (!sessionData?.session?.user) {
        throw new Error('Сесія користувача не знайдена. Увійдіть до CRM повторно.');
      }

      const { error } = await supabaseClient
        .from('candidates')
        .delete()
        .eq('id', candidateId);

      if (error) throw error;

      alert(`Справу «${candidateName}» видалено.`);
      if (typeof updateDashboard === 'function') await updateDashboard();
      if (typeof showCandidates === 'function') await showCandidates();
    } catch (error) {
      console.error('Помилка видалення кандидата:', error);
      alert(`Не вдалося видалити справу:\n${error?.message || error}`);
    }
  }

  window.deleteCandidateCase = deleteCandidateCase;

  document.addEventListener('click', function (event) {
    const button = event.target.closest('button');
    if (!button || !button.textContent.includes('Видалити справу')) return;
    if (typeof window.deleteCandidateCase !== 'function') return;

    const match = button.getAttribute('onclick')?.match(/deleteCandidateCase\('([^']+)'/);
    if (!match) return;

    event.preventDefault();
    event.stopPropagation();
    const candidateId = match[1];
    const nameMatch = button.getAttribute('onclick')?.match(/,\s*("(?:\\.|[^"\\])*")\)/);
    let candidateName = 'кандидата';
    if (nameMatch) {
      try { candidateName = JSON.parse(nameMatch[1]); } catch (_) {}
    }
    window.deleteCandidateCase(candidateId, candidateName);
  }, true);

  // ---------------- PІБ DECLENSION ----------------
  const CASES = ['Називний', 'Родовий', 'Давальний', 'Знахідний', 'Орудний', 'Місцевий', 'Кличний'];

  function titleCaseLike(value, original) {
    if (!value) return value;
    if (original === original.toUpperCase()) return value.toUpperCase();
    if (original === original.toLowerCase()) return value.toLowerCase();
    return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
  }

  function detectGender(patronymic) {
    const p = (patronymic || '').toLowerCase();
    if (/(івна|ївна|овна|евна|євна)$/.test(p)) return 'female';
    if (/(ович|евич|євич|йович|евич)$/.test(p)) return 'male';
    return 'unknown';
  }

  // The CRM often receives a recommendation letter where the whole PІБ is already in genitive:
  // e.g. "ПАВЛЕНКА Ростислава Сергійовича". Normalize this common form first.
  const COMMON_MALE_GENITIVE = {
    'івана': 'Іван', 'петра': 'Петро', 'миколая': 'Миколай', 'миколи': 'Микола',
    'андрія': 'Андрій', 'олександра': 'Олександр', 'сергія': 'Сергій', 'віталія': 'Віталій',
    'василя': 'Василь', 'юрія': 'Юрій', 'євгена': 'Євген', 'євгенія': 'Євгеній',
    'богдана': 'Богдан', 'романа': 'Роман', 'ростислава': 'Ростислав', 'володимира': 'Володимир',
    'дмитра': 'Дмитро', 'максима': 'Максим', 'дениса': 'Денис', 'павла': 'Павло',
    'артема': 'Артем', 'тимофія': 'Тимофій', 'олега': 'Олег', 'ігоря': 'Ігор',
    'тараса': 'Тарас', 'руслана': 'Руслан', 'станіслава': 'Станіслав', 'ярослава': 'Ярослав',
    'леоніда': 'Леонід', 'григорія': 'Григорій', 'романа': 'Роман', 'захара': 'Захар',
    'пилипа': 'Пилип', 'марка': 'Марк', 'луки': 'Лука', 'матвія': 'Матвій', 'олексія': 'Олексій'
  };

  const COMMON_FEMALE_GENITIVE = {
    'марії': 'Марія', 'олени': 'Олена', 'наталії': 'Наталія', 'ірини': 'Ірина',
    'тетяни': 'Тетяна', 'світлани': 'Світлана', 'людмили': 'Людмила', 'анни': 'Анна',
    'юлії': 'Юлія', 'оксани': 'Оксана', 'катерини': 'Катерина', 'дарії': 'Дарія',
    'соломії': 'Соломія', 'христини': 'Христина', 'вікторії': 'Вікторія', 'алини': 'Аліна',
    'діани': 'Діана', 'валерії': 'Валерія', 'інни': 'Інна', 'лілії': 'Лілія'
  };

  function normalizeFirstName(name, gender) {
    if (!name) return '';
    const key = name.toLowerCase();
    if (gender === 'male' && COMMON_MALE_GENITIVE[key]) return titleCaseLike(COMMON_MALE_GENITIVE[key], name);
    if (gender === 'female' && COMMON_FEMALE_GENITIVE[key]) return titleCaseLike(COMMON_FEMALE_GENITIVE[key], name);

    if (gender === 'male') {
      if (/ий$/.test(key)) return name;
      if (/ій$/.test(key)) return name;
      if (/ій$/.test(key)) return name;
      if (/я$/.test(key)) return name.slice(0, -1) + 'й';
      if (/а$/.test(key)) return name.slice(0, -1);
    }
    if (gender === 'female') {
      if (/ія$/.test(key)) return name;
      if (/я$/.test(key)) return name;
      if (/а$/.test(key)) return name;
      if (/(и|і|ї)$/.test(key)) return name.replace(/и$/, 'а').replace(/і$/, 'я').replace(/ї$/, 'я');
    }
    return name;
  }

  function normalizePatronymic(patronymic, gender) {
    if (!patronymic) return '';
    const p = patronymic.toLowerCase();
    if (gender === 'male') {
      if (p.endsWith('овича') || p.endsWith('евича') || p.endsWith('євича') || p.endsWith('йовича')) return patronymic.replace(/(овича|евича|євича|йовича)$/i, m => m.replace(/а$/i, ''));
      if (p.endsWith('ич')) return patronymic;
    }
    if (gender === 'female') {
      if (p.endsWith('івни') || p.endsWith('ївни') || p.endsWith('овни') || p.endsWith('евни') || p.endsWith('євни')) {
        return patronymic.replace(/(івни|ївни|овни|евни|євни)$/i, m => m.replace(/и$/i, 'а'));
      }
      if (p.endsWith('івна') || p.endsWith('ївна') || p.endsWith('овна') || p.endsWith('евна') || p.endsWith('євна')) return patronymic;
    }
    return patronymic;
  }

  function surnameBase(surname, gender) {
    if (!surname) return '';
    const s = surname;
    const lower = s.toLowerCase();
    // Most Ukrainian -енко/-єнко surnames are indeclinable. Recommendation letters frequently OCR
    // them as genitive -енка/-єнка, so restore the nominative spelling in that specific pattern.
    if (/(енка|єнка)$/.test(lower)) return s.slice(0, -1) + 'о';
    if (/(ко|го)$/.test(lower)) return s;
    if (gender === 'male') {
      if (/(ський|цький|зький)$/.test(lower)) return s;
      if (/(ов|ев|єв|ін|ин|ан|ян|ук|юк|чук|як|ак)$/.test(lower)) return s;
      if (/а$/.test(lower)) return s.slice(0, -1);
    }
    return s;
  }

  function declenseSurname(surname, caseName, gender) {
    const nom = surnameBase(surname, gender);
    const s = nom;
    const l = s.toLowerCase();
    if (/(енко|єнко|ко)$/.test(l)) return s;
    if (caseName === 'Називний') return s;
    if (gender === 'male') {
      if (/(ський|цький|зький)$/.test(l)) {
        const stem = s.slice(0, -2);
        const endings = { 'Родовий':'ого','Давальний':'ому','Знахідний':'ого','Орудний':'им','Місцевий':'ому','Кличний':'ий' };
        return stem + (endings[caseName] || 'ий');
      }
      if (/[бвгґджзклмнпрстфхцчшщ]$/i.test(s)) {
        const e = { 'Родовий':'а','Давальний':'у','Знахідний':'а','Орудний':'ом','Місцевий':'і','Кличний':'е' };
        return s + (e[caseName] || '');
      }
    }
    if (gender === 'female' && /а$/i.test(s)) {
      const stem = s.slice(0, -1);
      const e = { 'Родовий':'и','Давальний':'і','Знахідний':'у','Орудний':'ою','Місцевий':'і','Кличний':'о' };
      return stem + (e[caseName] || 'а');
    }
    return s;
  }

  function declenseFirstName(first, caseName, gender) {
    const nom = normalizeFirstName(first, gender);
    const l = nom.toLowerCase();
    if (caseName === 'Називний') return nom;
    if (gender === 'male') {
      const irregular = {
        'петро': ['Петра','Петрові','Петра','Петром','Петрові','Петре'],
        'дмитро': ['Дмитра','Дмитрові','Дмитра','Дмитром','Дмитрові','Дмитре'],
        'павло': ['Павла','Павлові','Павла','Павлом','Павлові','Павле'],
        'микола': ['Миколи','Миколі','Миколу','Миколою','Миколі','Миколо'],
        'іван': ['Івана','Івану','Івана','Іваном','Івані','Іване'],
        'андрій': ['Андрія','Андрію','Андрія','Андрієм','Андрію','Андрію'],
        'олексій': ['Олексія','Олексію','Олексія','Олексієм','Олексію','Олексію'],
        'сергій': ['Сергія','Сергію','Сергія','Сергієм','Сергію','Сергію'],
        'ростислав': ['Ростислава','Ростиславу','Ростислава','Ростиславом','Ростиславі','Ростиславе'],
        'євген': ['Євгена','Євгену','Євгена','Євгеном','Євгені','Євгене']
      };
      const arr = irregular[l];
      if (arr) return arr[CASES.indexOf(caseName) - 1] || nom;
      if (/й$/.test(l)) {
        const stem = nom.slice(0, -1);
        const e = { 'Родовий':'я','Давальний':'ю','Знахідний':'я','Орудний':'єм','Місцевий':'ю','Кличний':'ю' };
        return stem + (e[caseName] || '');
      }
      if (/ь$/.test(l)) {
        const e = { 'Родовий':'я','Давальний':'ю','Знахідний':'я','Орудний':'ем','Місцевий':'і','Кличний':'ю' };
        return nom.slice(0, -1) + (e[caseName] || '');
      }
      if (/о$/.test(l)) {
        const e = { 'Родовий':'а','Давальний':'у','Знахідний':'а','Орудний':'ом','Місцевий':'і','Кличний':'е' };
        return nom.slice(0, -1) + (e[caseName] || '');
      }
      const e = { 'Родовий':'а','Давальний':'у','Знахідний':'а','Орудний':'ом','Місцевий':'і','Кличний':'е' };
      return nom + (e[caseName] || '');
    }
    if (gender === 'female') {
      if (/ія$/.test(l)) {
        const stem = nom.slice(0, -1);
        const e = { 'Родовий':'ї','Давальний':'ї','Знахідний':'ю','Орудний':'єю','Місцевий':'ї','Кличний':'є' };
        return stem + (e[caseName] || '');
      }
      if (/я$/.test(l)) {
        const stem = nom.slice(0, -1);
        const e = { 'Родовий':'і','Давальний':'і','Знахідний':'ю','Орудний':'ею','Місцевий':'і','Кличний':'є' };
        return stem + (e[caseName] || '');
      }
      if (/а$/.test(l)) {
        const stem = nom.slice(0, -1);
        const e = { 'Родовий':'и','Давальний':'і','Знахідний':'у','Орудний':'ою','Місцевий':'і','Кличний':'о' };
        return stem + (e[caseName] || '');
      }
    }
    return nom;
  }

  function declensePatronymic(patronymic, caseName, gender) {
    const nom = normalizePatronymic(patronymic, gender);
    if (caseName === 'Називний') return nom;
    const l = nom.toLowerCase();
    if (gender === 'male') {
      if (/(ович|евич|євич|йович)$/.test(l)) {
        const e = { 'Родовий':'а','Давальний':'у','Знахідний':'а','Орудний':'ем','Місцевий':'у','Кличний':'у' };
        return nom + (e[caseName] || '');
      }
    }
    if (gender === 'female') {
      if (/(івна|ївна|овна|евна|євна)$/.test(l)) {
        const stem = nom.slice(0, -1);
        const e = { 'Родовий':'и','Давальний':'і','Знахідний':'у','Орудний':'ою','Місцевий':'і','Кличний':'о' };
        return stem + (e[caseName] || '');
      }
    }
    return nom;
  }

  function splitFullName(value) {
    const parts = String(value || '').trim().replace(/\s+/g, ' ').split(' ');
    return { surname: parts[0] || '', first: parts[1] || '', patronymic: parts[2] || '' };
  }

  function findCaseInputs() {
    const section = [...document.querySelectorAll('section, .card, div')].find(el =>
      el.textContent?.includes('ПІБ ТА ВІДМІНЮВАННЯ') && el.querySelectorAll('input').length >= 7
    );
    if (!section) return null;
    const inputs = [...section.querySelectorAll('input')];
    if (inputs.length < 7) return null;
    const result = {};
    CASES.forEach((name, i) => { result[name] = inputs[i]; });
    return result;
  }

  function getFullNameInput() {
    return document.querySelector('input[name="full_name"]');
  }

  function fillNameCases() {
    const full = getFullNameInput();
    const fields = findCaseInputs();
    if (!full || !fields) return;
    const value = full.value.trim();
    if (!value) return;

    const p = splitFullName(value);
    if (!p.first || !p.patronymic) return;
    const gender = detectGender(p.patronymic);
    if (gender === 'unknown') return;

    // If OCR/recommendation gave the PІБ in genitive, normalize the three parts first.
    const nomSurname = surnameBase(p.surname, gender);
    const nomFirst = normalizeFirstName(p.first, gender);
    const nomPatronymic = normalizePatronymic(p.patronymic, gender);
    const originalParts = [p.surname, p.first, p.patronymic];
    const names = CASES.map(caseName => [
      declenseSurname(nomSurname, caseName, gender),
      declenseFirstName(nomFirst, caseName, gender),
      declensePatronymic(nomPatronymic, caseName, gender)
    ].map((x, i) => titleCaseLike(x, originalParts[i])).join(' '));

    CASES.forEach((caseName, i) => {
      if (fields[caseName]) fields[caseName].value = names[i];
    });

    const status = [...document.querySelectorAll('section, .card, div')].find(el => el.textContent?.includes('Стать: не визначено'));
    if (status) {
      const all = [...status.querySelectorAll('*')].find(el => el.children.length === 0 && /Стать:/.test(el.textContent || ''));
      if (all) all.textContent = `Стать: ${gender === 'male' ? 'чоловіча' : 'жіноча'}`;
    }
  }

  let timer = null;
  function scheduleNameFill() {
    clearTimeout(timer);
    timer = setTimeout(fillNameCases, 120);
  }

  document.addEventListener('input', function (event) {
    if (event.target?.matches('input[name="full_name"]')) scheduleNameFill();
  }, true);

  const observer = new MutationObserver(() => scheduleNameFill());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.fillNameCases = fillNameCases;
  setTimeout(fillNameCases, 300);
})();
