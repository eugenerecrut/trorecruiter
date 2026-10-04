(function(){
  'use strict';
  const clean=v=>typeof v==='string'?v.trim().replace(/\s+/g,' '):'';
  const casing=(original,value)=>original===original.toLocaleUpperCase('uk-UA')?value.toLocaleUpperCase('uk-UA'):value.charAt(0).toLocaleUpperCase('uk-UA')+value.slice(1);
  function first(name,gender){
    const n=name.toLocaleLowerCase('uk-UA');
    const exceptions={ігор:'ігоря',олег:'олега',лев:'лева',павло:'павла',петро:'петра',дмитро:'дмитра',михайло:'михайла',микола:'миколи',ілля:'іллі',любов:'любові',нінель:'нінелі'};
    if(exceptions[n])return casing(name,exceptions[n]);
    let value;
    if(/ія$/.test(n))value=n.slice(0,-1)+'ї';
    else if(/я$/.test(n))value=n.slice(0,-1)+'і';
    else if(/а$/.test(n))value=n.slice(0,-1)+(/[гкхжчшщ]а$/.test(n)?'і':'и');
    else if(gender==='male'&&/[йь]$/.test(n))value=n.slice(0,-1)+'я';
    else if(gender==='male'&&/[бвгґджзклмнпрстфхцчшщ]$/.test(n))value=n+'а';
    else return null;
    return casing(name,value);
  }
  function surname(name,gender){
    if(name.includes('-')){const parts=name.split('-').map(p=>surname(p,gender));return parts.every(Boolean)?parts.join('-'):null;}
    const n=name.toLocaleLowerCase('uk-UA');let value;
    if(gender==='female'&&/([оеє]ва|[иі]на|ська|цька|зька)$/.test(n))value=n.slice(0,-1)+'ої';
    else if(gender==='female'&&!/[ая]$/.test(n))value=n;
    else if(gender==='male'&&/ий$/.test(n))value=n.slice(0,-2)+'ого';
    else if(gender==='male'&&/ій$/.test(n))value=n.slice(0,-2)+'ього';
    else if(gender==='male'&&/о$/.test(n))value=n.slice(0,-1)+'а';
    else if(/[а]$/.test(n))value=n.slice(0,-1)+(/[гкхжчшщ]а$/.test(n)?'і':'и');
    else if(/я$/.test(n))value=n.slice(0,-1)+'і';
    else if(gender==='male'&&/[йь]$/.test(n))value=n.slice(0,-1)+'я';
    else if(gender==='male'&&/[бвгґджзклмнпрстфхцчшщ]$/.test(n))value=({швець:'швеця',кравець:'кравця',заєць:'зайця'})[n]||n+'а';
    else value=n;
    return casing(name,value);
  }
  function genitive(fullName,sex){
    const parts=clean(fullName).split(' ');if(parts.length<2||parts.length>3||parts.some(p=>!/^[-А-Яа-яІіЇїЄєҐґ’'ʼ]+$/u.test(p)))return '';
    const pat=parts[2]||'';
    const gender=/(івна|ївна|овна|евна|євна|ична)$/i.test(pat)?'female':/(ович|евич|євич|йович|ич)$/i.test(pat)?'male':['male','female'].includes(sex)?sex:null;
    if(!gender)return '';
    const f=first(parts[1],gender),s=surname(parts[0],gender);if(!f||!s)return '';
    let p='';if(pat){if(gender==='male'&&/ич$/i.test(pat))p=pat+'а';else if(gender==='female'&&/на$/i.test(pat))p=pat.slice(0,-1)+(pat===pat.toLocaleUpperCase('uk-UA')?'И':'и');else return '';}
    if(pat&&pat===pat.toLocaleUpperCase('uk-UA'))p=p.toLocaleUpperCase('uk-UA');
    return [s,f,p].filter(Boolean).join(' ');
  }
  function stored(candidate,profile={}){
    let legacy={};const m=String(candidate.notes||'').match(/\[\[PSK_NAME_CASES\]\]([\s\S]*?)\[\[\/PSK_NAME_CASES\]\]/);
    if(m){try{legacy=JSON.parse(m[1])}catch(_){}}
    return clean(candidate.name_genitive)||clean(profile.name_genitive)||clean(profile.name_cases?.genitive)||clean(profile.name_cases?.['Родовий'])||clean(legacy.genitive);
  }
  function bind(form){
    const source=form.querySelector('[name=name_nominative]'),target=form.querySelector('[name=name_genitive]'),sex=form.querySelector('[name=sex]');if(!source||!target)return;
    const button=document.createElement('button');button.type='button';button.textContent='Заповнити з ПІБ';button.style.cssText='margin-top:8px;padding:7px 10px;font-size:12px';
    const hint=document.createElement('small');hint.style.cssText='display:block;margin-top:6px;color:#68757d';hint.textContent='Автоматичну форму перевірте перед збереженням.';
    target.after(button,hint);let auto=null;
    const fill=force=>{if(!force&&target.value.trim()&&target.value!==auto)return;const value=genitive(source.value,sex?.value);if(!value){hint.textContent='Уточніть стать і повний ПІБ або заповніть родовий відмінок вручну.';return}target.value=value;auto=value;hint.textContent='Автоматичну форму перевірте перед збереженням.';target.dispatchEvent(new Event('input',{bubbles:true}));};
    target.addEventListener('input',()=>{if(target.value!==auto)auto=null});
    source.addEventListener('input',()=>fill(false));sex?.addEventListener('change',()=>fill(false));button.addEventListener('click',()=>fill(true));fill(false);
  }
  window.CRMCandidateName={genitive,stored,bind};
})();
