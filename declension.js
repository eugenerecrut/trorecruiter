// PSK_RECRUTER CRM — Ukrainian full-name declension helper
(function () {
  'use strict';

  const CASES = ['nom','gen','dat','acc','ins','loc','voc'];

  const malePatronymics = /(?:ович|евич|євич|йович|ич)$/i;
  const femalePatronymics = /(?:івна|ївна|овна|евна|євна|ична)$/i;

  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function lower(s) { return (s || '').toLocaleLowerCase('uk-UA'); }
  function sameCase(original, value) {
    if (!value) return '';
    if (original === original.toLocaleUpperCase('uk-UA')) return value.toLocaleUpperCase('uk-UA');
    if (original && original[0] === original[0].toLocaleUpperCase('uk-UA')) return cap(value);
    return value;
  }

  function detectGender(parts) {
    const patronymic = lower(parts[2] || '');
    if (femalePatronymics.test(patronymic)) return 'female';
    if (malePatronymics.test(patronymic)) return 'male';
    return 'unknown';
  }

  function declSurname(surname, gender) {
    const s = lower(surname), c = s[s.length - 1];
    if (gender === 'male') {
      if (/енко$|ко$|чук$|юк$|ук$|як$|чак$|щук$/.test(s)) return {nom:s,gen:s,dat:s,acc:s,ins:s,loc:s,voc:s};
      if (/(ов|ев|єв|ів|їв|ин|ін|ан|ян)$/.test(s)) return {nom:s,gen:s+'а',dat:s+'у',acc:s+'а',ins:s+'ом',loc:s+'і',voc:s+'е'};
      if (/[бвгджзклмнпрстфхцчшщ]$/.test(s)) return {nom:s,gen:s+'а',dat:s+'у',acc:s+'а',ins:s+'ом',loc:s+'і',voc:s+'е'};
      if (/[й]$/.test(s)) return {nom:s,gen:s.slice(0,-1)+'я',dat:s.slice(0,-1)+'ю',acc:s.slice(0,-1)+'я',ins:s.slice(0,-1)+'єм',loc:s.slice(0,-1)+'ї',voc:s.slice(0,-1)+'ю'};
    }
    if (gender === 'female') {
      if (/(ова|ева|єва|іна|їна)$/.test(s)) return {nom:s,gen:s.slice(0,-1)+'ої',dat:s.slice(0,-1)+'ій',acc:s.slice(0,-1)+'у',ins:s.slice(0,-1)+'ою',loc:s.slice(0,-1)+'ій',voc:s.slice(0,-1)+'а'};
      if (/[ая]$/.test(s)) return {nom:s,gen:s.slice(0,-1)+'ої',dat:s.slice(0,-1)+'ій',acc:s.slice(0,-1)+'у',ins:s.slice(0,-1)+'ою',loc:s.slice(0,-1)+'ій',voc:s.slice(0,-1)+'о'};
      return {nom:s,gen:s,dat:s,acc:s,ins:s,loc:s,voc:s};
    }
    return {nom:s,gen:s,dat:s,acc:s,ins:s,loc:s,voc:s};
  }

  function declFirstName(name, gender) {
    const n = lower(name);
    if (gender === 'male') {
      const map = {
        олександр:['олександр','олександра','олександру','олександра','олександром','олександрі','олександре'],
        микола:['микола','миколи','миколі','миколу','миколою','миколі','миколо'],
        сергій:['сергій','сергія','сергію','сергія','сергієм','сергії','сергію'],
        андрій:['андрій','андрія','андрію','андрія','андрієм','андрію','андрію'],
        ігор:['ігор','ігоря','ігорю','ігоря','ігорем','ігорі','ігорю'],
        дмитро:['дмитро','дмитра','дмитру','дмитра','дмитром','дмитрі','дмитре'],
        ростислав:['ростислав','ростислава','ростиславу','ростислава','ростиславом','ростиславі','ростиславе'],
        євген:['євген','євгена','євгену','євгена','євгеном','євгені','євгене'],
        олексій:['олексій','олексія','олексію','олексія','олексієм','олексії','олексію'],
        юрій:['юрій','юрія','юрію','юрія','юрієм','юрії','юрію'],
        віталій:['віталій','віталія','віталію','віталія','віталієм','віталії','віталію'],
        павло:['павло','павла','павлу','павла','павлом','павлі','павле'],
        іван:['іван','івана','івану','івана','іваном','івані','іване'],
        петро:['петро','петра','петру','петра','петром','петрі','петре'],
        роман:['роман','романа','роману','романа','романом','романі','романе'],
        богдан:['богдан','богдана','богдану','богдана','богданом','богдані','богдане']
      };
      if (map[n]) return Object.fromEntries(CASES.map((k,i)=>[k,map[n][i]]));
      if (/й$/.test(n)) { const b=n.slice(0,-1); return {nom:n,gen:b+'я',dat:b+'ю',acc:b+'я',ins:b+'єм',loc:b+'ї',voc:b+'ю'}; }
      if (/а$/.test(n)) return {nom:n,gen:n.slice(0,-1)+'и',dat:n.slice(0,-1)+'і',acc:n.slice(0,-1)+'у',ins:n.slice(0,-1)+'ою',loc:n.slice(0,-1)+'і',voc:n.slice(0,-1)+'о'};
      return {nom:n,gen:n+'а',dat:n+'у',acc:n+'а',ins:n+'ом',loc:n+'і',voc:n+'е'};
    }
    if (gender === 'female') {
      const map = {
        наталія:['наталія','наталії','наталії','наталію','наталією','наталії','наталіє'],
        олена:['олена','олени','олені','олену','оленою','олені','олено'],
        ірина:['ірина','ірини','ірині','ірину','іриною','ірині','ірино'],
        марія:['марія','марії','марії','марію','марією','марії','маріє'],
        катерина:['катерина','катерини','катерині','катерину','катериною','катерині','катерино'],
        світлана:['світлана','світлани','світлані','світлану','світланою','світлані','світлано'],
        вікторія:['вікторія','вікторії','вікторії','вікторію','вікторією','вікторії','вікторіє']
      };
      if (map[n]) return Object.fromEntries(CASES.map((k,i)=>[k,map[n][i]]));
      if (/ія$/.test(n)) return {nom:n,gen:n.slice(0,-1)+'ї',dat:n.slice(0,-1)+'ї',acc:n,ins:n.slice(0,-1)+'єю',loc:n.slice(0,-1)+'ї',voc:n.slice(0,-1)+'є'};
      if (/а$/.test(n)) return {nom:n,gen:n.slice(0,-1)+'и',dat:n.slice(0,-1)+'і',acc:n.slice(0,-1)+'у',ins:n.slice(0,-1)+'ою',loc:n.slice(0,-1)+'і',voc:n.slice(0,-1)+'о'};
      return {nom:n,gen:n,dat:n,acc:n,ins:n,loc:n,voc:n};
    }
    return {nom:n,gen:n,dat:n,acc:n,ins:n,loc:n,voc:n};
  }

  function declPatronymic(p, gender) {
    const s=lower(p);
    if (gender==='male' && /ович$/.test(s)) { const b=s.slice(0,-4); return {nom:s,gen:b+'овича',dat:b+'овичу',acc:b+'овича',ins:b+'овичем',loc:b+'овичі',voc:b+'овичу'}; }
    if (gender==='male' && /евич$/.test(s)) { const b=s.slice(0,-4); return {nom:s,gen:b+'евича',dat:b+'евичу',acc:b+'евича',ins:b+'евичем',loc:b+'евичі',voc:b+'евичу'}; }
    if (gender==='female' && /івна$/.test(s)) { const b=s.slice(0,-4); return {nom:s,gen:b+'івни',dat:b+'івні',acc:b+'івну',ins:b+'івною',loc:b+'івні',voc:b+'івно'}; }
    if (gender==='female' && /ївна$/.test(s)) { const b=s.slice(0,-4); return {nom:s,gen:b+'ївни',dat:b+'ївні',acc:b+'ївну',ins:b+'ївною',loc:b+'ївні',voc:b+'ївно'}; }
    return {nom:s,gen:s,dat:s,acc:s,ins:s,loc:s,voc:s};
  }

  function decline(fullName) {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length < 2) return null;
    const gender=detectGender(parts);
    const s=declSurname(parts[0],gender), n=declFirstName(parts[1],gender), p=declPatronymic(parts[2]||'',gender);
    const out={};
    CASES.forEach(k=>out[k]=[s[k],n[k],p[k]].filter(Boolean).join(' '));
    return {gender, out};
  }

  function findDeclensionBox() {
    const nodes=[...document.querySelectorAll('h1,h2,h3,h4,div,span,label')];
    const title=nodes.find(x=>x.textContent.trim()==='ПІБ ТА ВІДМІНЮВАННЯ');
    if (!title) return null;
    let box=title.closest('section, .card, div');
    for(let i=0;i<5 && box;i++,box=box.parentElement){
      const inputs=box.querySelectorAll('input');
      if(inputs.length>=7) return box;
    }
    return title.parentElement;
  }

  function init() {
    const box=findDeclensionBox(); if(!box) return false;
    const inputs=[...box.querySelectorAll('input')].slice(-7);
    if(inputs.length<7) return false;
    const labels=[...box.querySelectorAll('label')].map(x=>x.textContent.trim());
    const source=inputs[0];
    if(source.dataset.declensionBound==='1') return true;
    source.dataset.declensionBound='1';
    const status=[...box.querySelectorAll('*')].find(x=>x.textContent.trim().startsWith('Стать:'));
    function fill(){
      const r=decline(source.value);
      if(!r) return;
      inputs.forEach((el,i)=>{ if(i===0) return; el.value=r.out[CASES[i]] || ''; });
      if(status) status.textContent='Стать: '+(r.gender==='female'?'жінка':r.gender==='male'?'чоловік':'не визначено');
    }
    source.addEventListener('input',fill);
    source.addEventListener('change',fill);
    fill();
    return true;
  }

  let tries=0;
  const timer=setInterval(()=>{ if(init() || ++tries>60) clearInterval(timer); },500);
})();
