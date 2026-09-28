(function(){
  const CASES=['Називний','Родовий','Давальний','Знахідний','Орудний','Місцевий','Кличний'];
  const maleFirst={'Ростислав':{r:'Ростислава',d:'Ростиславу',a:'Ростислава',i:'Ростиславом',l:'Ростиславі',v:'Ростиславе'},'Сергій':{r:'Сергія',d:'Сергію',a:'Сергія',i:'Сергієм',l:'Сергію',v:'Сергію'}};
  const malePat={'Сергійович':{r:'Сергійовича',d:'Сергійовичу',a:'Сергійовича',i:'Сергійовичем',l:'Сергійовичу',v:'Сергійовичу'}};

  function words(v){return String(v||'').trim().replace(/\s+/g,' ').split(' ').filter(Boolean)}
  function upper(v){return String(v||'').trim().toLocaleUpperCase('uk-UA')}

  function normalizeMaleFirst(w){
    if(maleFirst[w])return w;
    if(/(овича|евича|євича|йовича)$/i.test(w))return w.replace(/а$/i,'');
    if(/а$/i.test(w)&&/[бвгґджзклмнпрстфхцчшщ]а$/i.test(w))return w.slice(0,-1);
    return w;
  }

  function normalizeMalePat(w){
    if(malePat[w])return w;
    if(/(овича|евича|євича|йовича)$/i.test(w))return w.slice(0,-1);
    return w;
  }

  function firstDecl(w){
    const base=normalizeMaleFirst(w),m=maleFirst[base];
    if(m)return m;
    if(/ій$/i.test(base))return{r:base.replace(/ій$/i,'ія'),d:base.replace(/ій$/i,'ію'),a:base.replace(/ій$/i,'ія'),i:base.replace(/ій$/i,'ієм'),l:base.replace(/ій$/i,'ію'),v:base.replace(/ій$/i,'ію')};
    if(/[бвгґджзклмнпрстфхцчшщ]$/i.test(base))return{r:base+'а',d:base+'у',a:base+'а',i:base+'ом',l:base+'і',v:base+'е'};
    return{r:base,d:base,a:base,i:base,l:base,v:base};
  }

  function patDecl(w){
    const base=normalizeMalePat(w),m=malePat[base];
    return m||{r:base+'а',d:base+'у',a:base+'а',i:base+'ем',l:base+'у',v:base+'у'};
  }

  function surnameDecl(s,g){
    if(g==='male'){
      if(/енка$/i.test(s))s=s.replace(/енка$/i,'енко');
      if(/енко$/i.test(s))return{n:s,r:s.replace(/енко$/i,'енка'),d:s.replace(/енко$/i,'енку'),a:s.replace(/енко$/i,'енка'),i:s.replace(/енко$/i,'енком'),l:s.replace(/енко$/i,'енку'),v:s};
      if(/[бвгґджзклмнпрстфхцчшщ]$/i.test(s))return{n:s,r:s+'а',d:s+'у',a:s+'а',i:s+'ом',l:s+'і',v:s};
    }
    return{n:s,r:s,a:s,i:s,l:s,d:s,v:s};
  }

  function normalize(parts){
    if(parts.length<2)return null;
    let[s,f,p]=parts;
    const gender=/[аеє]вич$/i.test(p)||/(овича|евича|євича|йовича)$/i.test(p)?'male':(/[івна]$/i.test(p)?'female':'male');
    if(gender==='male'&&/енка$/i.test(s))s=s.replace(/енка$/i,'енко');
    const sd=surnameDecl(s,gender);
    const baseFirst=gender==='male'?normalizeMaleFirst(f):f;
    const basePat=gender==='male'?normalizeMalePat(p):p;
    const fd=gender==='male'?firstDecl(baseFirst):{r:f,d:f,a:f,i:f,l:f,v:f};
    const pd=gender==='male'?patDecl(basePat):{r:p,d:p,a:p,i:p,l:p,v:p};
    return{
      gender,
      cases:{
        'Називний':[sd.n,baseFirst,basePat].join(' '),
        'Родовий':[sd.r,fd.r,pd.r].join(' '),
        'Давальний':[sd.d,fd.d,pd.d].join(' '),
        'Знахідний':[sd.a,fd.a,pd.a].join(' '),
        'Орудний':[sd.i,fd.i,pd.i].join(' '),
        'Місцевий':[sd.l,fd.l,pd.l].join(' '),
        'Кличний':[sd.v,fd.v,pd.v].join(' ')
      }
    };
  }

  function findField(labelText){
    const labels=[...document.querySelectorAll('label')];
    const l=labels.find(x=>x.textContent.trim().toLowerCase()===labelText.toLowerCase());
    if(!l)return null;
    if(l.htmlFor){const el=document.getElementById(l.htmlFor);if(el)return el}
    let n=l.nextElementSibling;
    while(n){if(/INPUT|TEXTAREA|SELECT/.test(n.tagName))return n;n=n.nextElementSibling}
    const p=l.parentElement;
    return p?p.querySelector('input,textarea,select'):null;
  }

  function run(forceNominative=false){
    const full=document.querySelector('input[name="full_name"]');
    if(!full||!full.value.trim())return;
    const data=normalize(words(full.value));
    if(!data)return;

    const nominativeUpper=upper(data.cases['Називний']);
    // У формі підтвердження ПІБ завжди показуємо та зберігаємо саме називний відмінок,
    // усі літери — у верхньому регістрі. Під час набору не перехоплюємо курсор.
    if(forceNominative || document.activeElement!==full){
      if(full.value!==nominativeUpper)full.value=nominativeUpper;
    }

    CASES.forEach(c=>{
      const el=findField(c);
      if(el&&document.activeElement!==el)el.value=(c==='Називний'?nominativeUpper:data.cases[c]);
    });

    const box=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&e.textContent.trim()==='Стать: не визначено');
    if(box)box.textContent='Стать: '+(data.gender==='male'?'чоловіча':'жіноча');

    return {data,nominativeUpper};
  }

  document.addEventListener('input',e=>{
    if(e.target&&e.target.name==='full_name')setTimeout(()=>run(false),0);
  });

  document.addEventListener('blur',e=>{
    if(e.target&&e.target.name==='full_name')setTimeout(()=>run(true),0);
  },true);

  new MutationObserver(()=>setTimeout(()=>run(false),0)).observe(document.body,{childList:true,subtree:true});
  setInterval(()=>run(false),800);

  // Перед самим збереженням примусово нормалізуємо full_name,
  // щоб у таблиці candidates ніколи не зберігався родовий/інший відмінок.
  const originalSave=window.saveCandidateFromRecommendation;
  if(typeof originalSave==='function'){
    window.saveCandidateFromRecommendation=async function(event){
      const result=run(true);
      const form=event?.target;
      const full=form?.elements?.full_name;
      if(result&&full)full.value=result.nominativeUpper;
      return originalSave(event);
    };
  }
})();
