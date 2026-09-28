// PSK_RECRUTER CRM — candidate deletion + automatic Ukrainian PІБ declension
(function () {
  // ---------- CANDIDATE DELETE ----------
  async function deleteCandidateCase(candidateId, candidateName = 'кандидата') {
    if (!candidateId) return alert('Не вдалося визначити ID кандидата.');
    if (!window.confirm(`УВАГА! Видалити особову справу «${candidateName}»?\n\nДію поки що не можна скасувати.`)) return;
    try {
      const { data: sessionData } = await supabaseClient.auth.getSession();
      if (!sessionData?.session?.user) throw new Error('Сесія користувача не знайдена. Увійдіть до CRM повторно.');
      const { error } = await supabaseClient.from('candidates').delete().eq('id', candidateId);
      if (error) throw error;
      alert(`Справу «${candidateName}» видалено.`);
      if (typeof updateDashboard === 'function') await updateDashboard();
      if (typeof showCandidates === 'function') await showCandidates();
    } catch (error) {
      console.error(error);
      alert(`Не вдалося видалити справу:\n${error?.message || error}`);
    }
  }
  window.deleteCandidateCase = deleteCandidateCase;

  // ---------- PІБ DECLENSION ----------
  const CASES = ['Називний','Родовий','Давальний','Знахідний','Орудний','Місцевий','Кличний'];
  const CASE_LABELS = {
    'Називний':'Називний','Родовий':'Родовий','Давальний':'Давальний','Знахідний':'Знахідний',
    'Орудний':'Орудний','Місцевий':'Місцевий','Кличний':'Кличний'
  };

  const MALE_GEN = {
    'івана':'Іван','петра':'Петро','миколи':'Микола','миколая':'Миколай','андрія':'Андрій',
    'олександра':'Олександр','сергія':'Сергій','віталія':'Віталій','василя':'Василь','юрія':'Юрій',
    'євгена':'Євген','богдана':'Богдан','романа':'Роман','ростислава':'Ростислав','володимира':'Володимир',
    'дмитра':'Дмитро','максима':'Максим','дениса':'Денис','павла':'Павло','артема':'Артем',
    'тимофія':'Тимофій','олега':'Олег','ігоря':'Ігор','тараса':'Тарас','руслана':'Руслан',
    'станіслава':'Станіслав','ярослава':'Ярослав','леоніда':'Леонід','григорія':'Григорій',
    'захара':'Захар','пилипа':'Пилип','марка':'Марк','матвія':'Матвій','олексія':'Олексій'
  };
  const FEMALE_GEN = {
    'марії':'Марія','олени':'Олена','наталії':'Наталія','ірини':'Ірина','тетяни':'Тетяна',
    'світлани':'Світлана','людмили':'Людмила','анни':'Анна','юлії':'Юлія','оксани':'Оксана',
    'катерини':'Катерина','дарії':'Дарія','соломії':'Соломія','христини':'Христина',
    'вікторії':'Вікторія','алини':'Аліна','діани':'Діана','валерії':'Валерія','інни':'Інна','лілії':'Лілія'
  };

  function genderFromPatronymic(p) {
    p = String(p || '').toLowerCase();
    if (/(івна|ївна|овна|евна|євна)$/.test(p)) return 'female';
    if (/(ович|евич|євич|йович)$/.test(p)) return 'male';
    return '';
  }
  function restoreFirst(n, g) {
    const k = n.toLowerCase();
    if (g === 'male' && MALE_GEN[k]) return MALE_GEN[k];
    if (g === 'female' && FEMALE_GEN[k]) return FEMALE_GEN[k];
    if (g === 'male' && /а$/.test(k)) return n.slice(0,-1) + 'о';
    return n;
  }
  function restorePatronymic(p, g) {
    if (g === 'male') return p.replace(/(овича|евича|євича|йовича)$/i,'$1').replace(/а$/i,'');
    if (g === 'female' && /(івни|ївни|овни|евни|євни)$/i.test(p)) return p.replace(/и$/i,'а');
    return p;
  }
  function restoreSurname(s) {
    if (/(енка|єнка)$/i.test(s)) return s.slice(0,-1) + 'о';
    return s;
  }
  function caseWord(word, type, g, kind) {
    const w = word, l = w.toLowerCase();
    if (type === 'Називний') return w;
    if (kind === 'surname') {
      if (/(енко|єнко|ко)$/i.test(l)) {
        if (/(енко|єнко)$/i.test(l)) {
          const stem = w.slice(0,-1);
          const e = {Родовий:'а',Давальний:'у',Знахідний:'а',Орудний:'ом',Місцевий:'у',Кличний:'у'};
          return stem + (e[type] || 'о');
        }
        return w;
      }
      if (g === 'male') {
        if (/(ський|цький|зький)$/i.test(l)) {
          const stem = w.slice(0,-2), e={Родовий:'ого',Давальний:'ому',Знахідний:'ого',Орудний:'им',Місцевий:'ому',Кличний:'ий'};
          return stem + (e[type] || 'ий');
        }
        if (/[бвгґджзклмнпрстфхцчшщ]$/i.test(w)) {
          const e={Родовий:'а',Давальний:'у',Знахідний:'а',Орудний:'ом',Місцевий:'у',Кличний:'е'};
          return w + (e[type] || '');
        }
      }
      if (g === 'female' && /а$/i.test(w)) {
        const e={Родовий:'и',Давальний:'і',Знахідний:'у',Орудний:'ою',Місцевий:'і',Кличний:'о'};
        return w.slice(0,-1)+(e[type]||'а');
      }
      return w;
    }
    if (kind === 'first') {
      const irregular = {
        'ростислав':['Ростислава','Ростиславу','Ростислава','Ростиславом','Ростиславі','Ростиславе'],
        'іван':['Івана','Івану','Івана','Іваном','Івані','Іване'],
        'петро':['Петра','Петрові','Петра','Петром','Петрові','Петре'],
        'дмитро':['Дмитра','Дмитрові','Дмитра','Дмитром','Дмитрові','Дмитре'],
        'павло':['Павла','Павлові','Павла','Павлом','Павлові','Павле'],
        'микола':['Миколи','Миколі','Миколу','Миколою','Миколі','Миколо'],
        'андрій':['Андрія','Андрію','Андрія','Андрієм','Андрію','Андрію'],
        'сергій':['Сергія','Сергію','Сергія','Сергієм','Сергію','Сергію'],
        'олексій':['Олексія','Олексію','Олексія','Олексієм','Олексію','Олексію'],
        'євген':['Євгена','Євгену','Євгена','Євгеном','Євгені','Євгене']
      };
      if (g === 'male' && irregular[l]) return irregular[l][CASES.indexOf(type)-1] || w;
      if (g === 'male') {
        if (/й$/.test(l)) return w.slice(0,-1)+({Родовий:'я',Давальний:'ю',Знахідний:'я',Орудний:'єм',Місцевий:'ю',Кличний:'ю'}[type]||'й');
        if (/о$/.test(l)) return w.slice(0,-1)+({Родовий:'а',Давальний:'у',Знахідний:'а',Орудний:'ом',Місцевий:'і',Кличний:'е'}[type]||'о');
        return w+({Родовий:'а',Давальний:'у',Знахідний:'а',Орудний:'ом',Місцевий:'і',Кличний:'е'}[type]||'');
      }
      if (g === 'female') {
        if (/ія$/.test(l)) return w.slice(0,-1)+({Родовий:'ї',Давальний:'ї',Знахідний:'ю',Орудний:'єю',Місцевий:'ї',Кличний:'є'}[type]||'я');
        if (/я$/.test(l)) return w.slice(0,-1)+({Родовий:'і',Давальний:'і',Знахідний:'ю',Орудний:'ею',Місцевий:'і',Кличний:'є'}[type]||'я');
        if (/а$/.test(l)) return w.slice(0,-1)+({Родовий:'и',Давальний:'і',Знахідний:'у',Орудний:'ою',Місцевий:'і',Кличний:'о'}[type]||'а');
      }
      return w;
    }
    if (kind === 'patronymic') {
      if (g === 'male' && /(ович|евич|євич|йович)$/i.test(l)) return w+({Родовий:'а',Давальний:'у',Знахідний:'а',Орудний:'ем',Місцевий:'у',Кличний:'у'}[type]||'');
      if (g === 'female' && /(івна|ївна|овна|евна|євна)$/i.test(l)) return w.slice(0,-1)+({Родовий:'и',Давальний:'і',Знахідний:'у',Орудний:'ою',Місцевий:'і',Кличний:'о'}[type]||'а');
      return w;
    }
    return w;
  }
  function matchInputByLabel(text) {
    const labels = [...document.querySelectorAll('label')];
    const label = labels.find(l => l.textContent.trim() === text);
    if (!label) return null;
    if (label.htmlFor) return document.getElementById(label.htmlFor);
    return label.parentElement?.querySelector('input,textarea') || null;
  }
  function findFullName() {
    return document.querySelector('input[name="full_name"]') || matchInputByLabel('ПІБ *') || matchInputByLabel('ПІБ');
  }
  function fillNameCases() {
    const full = findFullName();
    if (!full) return;
    const parts = String(full.value || '').trim().replace(/\s+/g,' ').split(' ');
    if (parts.length < 3) return;
    const surname0 = parts[0], first0 = parts[1], patr0 = parts.slice(2).join(' ');
    const g = genderFromPatronymic(patr0);
    if (!g) return;
    const surname = restoreSurname(surname0), first = restoreFirst(first0,g), patr = restorePatronymic(patr0,g);
    const out = CASES.map(type => [caseWord(surname,type,g,'surname'),caseWord(first,type,g,'first'),caseWord(patr,type,g,'patronymic')].join(' '));
    CASES.forEach((type,i) => { const input = matchInputByLabel(CASE_LABELS[type]); if (input && document.activeElement !== input) input.value = out[i]; });
    const status = [...document.querySelectorAll('*')].find(el => el.children.length === 0 && el.textContent.trim() === 'Стать: не визначено');
    if (status) status.textContent = `Стать: ${g === 'male' ? 'чоловіча' : 'жіноча'}`;
  }

  let timer;
  function schedule() { clearTimeout(timer); timer=setTimeout(fillNameCases,80); }
  document.addEventListener('input', e => { if (e.target && (e.target.name === 'full_name' || e.target.matches('input[placeholder*="Прізвище"]'))) schedule(); }, true);
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {childList:true,subtree:true});
  window.fillNameCases = fillNameCases;
  setTimeout(fillNameCases, 400);
})();