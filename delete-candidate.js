// PSK_RECRUTER CRM — candidate deletion + automatic Ukrainian PІБ declension
(function () {
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
      console.error('Помилка видалення:', error);
      alert(`Не вдалося видалити справу:\n${error?.message || error}`);
    }
  }
  window.deleteCandidateCase = deleteCandidateCase;

  const CASES = ['Називний','Родовий','Давальний','Знахідний','Орудний','Місцевий','Кличний'];
  const MALE_GEN = {'івана':'Іван','петра':'Петро','миколи':'Микола','андрія':'Андрій','олександра':'Олександр','сергія':'Сергій','віталія':'Віталій','василя':'Василь','юрія':'Юрій','євгена':'Євген','богдана':'Богдан','романа':'Роман','ростислава':'Ростислав','володимира':'Володимир','дмитра':'Дмитро','максима':'Максим','дениса':'Денис','павла':'Павло','артема':'Артем','олексія':'Олексій'};
  const FEMALE_GEN = {'марії':'Марія','олени':'Олена','наталії':'Наталія','ірини':'Ірина','тетяни':'Тетяна','світлани':'Світлана','людмили':'Людмила','анни':'Анна','юлії':'Юлія','оксани':'Оксана','катерини':'Катерина','дарії':'Дарія','соломії':'Соломія','христини':'Христина','вікторії':'Вікторія','алини':'Аліна','діани':'Діана','валерії':'Валерія','інни':'Інна','лілії':'Лілія'};

  function gender(p) {
    p = String(p || '').toLowerCase();
    if (/(івна|ївна|овна|евна|євна)$/.test(p)) return 'female';
    if (/(ович|евич|євич|йович)$/.test(p)) return 'male';
    return '';
  }
  function nominativeFirst(x,g) {
    const k=x.toLowerCase();
    if (g==='male' && MALE_GEN[k]) return MALE_GEN[k];
    if (g==='female' && FEMALE_GEN[k]) return FEMALE_GEN[k];
    return x;
  }
  function nominativeSurname(x) { return /(енка|єнка)$/i.test(x) ? x.slice(0,-1)+'о' : x; }
  function nominativePatronymic(x,g) {
    if(g==='male' && /(овича|евича|євича|йовича)$/i.test(x)) return x.slice(0,-1);
    if(g==='female' && /(івни|ївни|овни|евни|євни)$/i.test(x)) return x.slice(0,-1)+'а';
    return x;
  }
  function inflectSurname(x,c,g) {
    if(c==='Називний') return x;
    const l=x.toLowerCase();
    if(/(енко|єнко|ко)$/.test(l)) return x;
    if(g==='male' && /[бвгґджзклмнпрстфхцчшщ]$/i.test(x)) return x+({Родовий:'а',Давальний:'у',Знахідний:'а',Орудний:'ом',Місцевий:'у',Кличний:'е'}[c]||'');
    if(g==='female' && /а$/i.test(x)) return x.slice(0,-1)+({Родовий:'и',Давальний:'і',Знахідний:'у',Орудний:'ою',Місцевий:'і',Кличний:'о'}[c]||'а');
    return x;
  }
  function inflectFirst(x,c,g) {
    if(c==='Називний') return x;
    const l=x.toLowerCase();
    const irregular={
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
    if(g==='male' && irregular[l]) return irregular[l][CASES.indexOf(c)-1];
    if(g==='male' && /й$/.test(l)) return x.slice(0,-1)+({Родовий:'я',Давальний:'ю',Знахідний:'я',Орудний:'єм',Місцевий:'ю',Кличний:'ю'}[c]||'');
    if(g==='male' && /о$/.test(l)) return x.slice(0,-1)+({Родовий:'а',Давальний:'у',Знахідний:'а',Орудний:'ом',Місцевий:'і',Кличний:'е'}[c]||'');
    if(g==='male') return x+({Родовий:'а',Давальний:'у',Знахідний:'а',Орудний:'ом',Місцевий:'і',Кличний:'е'}[c]||'');
    if(g==='female' && /ія$/.test(l)) return x.slice(0,-1)+({Родовий:'ї',Давальний:'ї',Знахідний:'ю',Орудний:'єю',Місцевий:'ї',Кличний:'є'}[c]||'');
    if(g==='female' && /я$/.test(l)) return x.slice(0,-1)+({Родовий:'і',Давальний:'і',Знахідний:'ю',Орудний:'ею',Місцевий:'і',Кличний:'є'}[c]||'');
    if(g==='female' && /а$/.test(l)) return x.slice(0,-1)+({Родовий:'и',Давальний:'і',Знахідний:'у',Орудний:'ою',Місцевий:'і',Кличний:'о'}[c]||'');
    return x;
  }
  function inflectPatronymic(x,c,g) {
    if(c==='Називний') return x;
    if(g==='male' && /(ович|евич|євич|йович)$/i.test(x)) return x+({Родовий:'а',Давальний:'у',Знахідний:'а',Орудний:'ем',Місцевий:'у',Кличний:'у'}[c]||'');
    if(g==='female' && /(івна|ївна|овна|евна|євна)$/i.test(x)) return x.slice(0,-1)+({Родовий:'и',Давальний:'і',Знахідний:'у',Орудний:'ою',Місцевий:'і',Кличний:'о'}[c]||'');
    return x;
  }
  function preserveCase(result, original) {
    if(original===original.toUpperCase()) return result.toUpperCase();
    if(original===original.toLowerCase()) return result.toLowerCase();
    return result.charAt(0).toUpperCase()+result.slice(1).toLowerCase();
  }
  function labelInput(labelText) {
    const label=[...document.querySelectorAll('label')].find(l=>l.textContent.replace(/\s+/g,' ').trim().replace(/\s*\*$/,'')===labelText);
    if(!label) return null;
    if(label.htmlFor) return document.getElementById(label.htmlFor);
    let p=label.parentElement;
    return p ? p.querySelector('input,textarea') : null;
  }
  function fillNameCases() {
    const full=document.querySelector('input[name="full_name"]');
    if(!full || !full.value.trim()) return;
    const parts=full.value.trim().replace(/\s+/g,' ').split(' ');
    if(parts.length<3) return;
    const s0=parts[0], f0=parts[1], p0=parts.slice(2).join(' '), g=gender(p0);
    if(!g) return;
    const s=nominativeSurname(s0), f=nominativeFirst(f0,g), p=nominativePatronymic(p0,g);
    CASES.forEach(c=>{
      const i=labelInput(c);
      if(!i) return;
      const vals=[inflectSurname(s,c,g),inflectFirst(f,c,g),inflectPatronymic(p,c,g)];
      i.value=vals.map((v,n)=>preserveCase(v,[s0,f0,p0][n])).join(' ');
    });
    const st=[...document.querySelectorAll('*')].find(e=>e.children.length===0 && e.textContent.trim()==='Стать: не визначено');
    if(st) st.textContent=`Стать: ${g==='male'?'чоловіча':'жіноча'}`;
  }
  window.fillNameCases=fillNameCases;
  document.addEventListener('input',e=>{if(e.target?.name==='full_name') setTimeout(fillNameCases,50);},true);
  setInterval(fillNameCases,500);
  setTimeout(fillNameCases,300);
})();