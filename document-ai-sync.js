// Document-scoped AI synchronization. No OCR calls and no writes during preview.
(function (root) {
  'use strict';
  const empty = v => v == null || (typeof v === 'string' && !v.trim());
  const norm = v => String(v ?? '').normalize('NFKC').replace(/[’ʼ`]/g,"'").trim().replace(/\s+/g,' ').toLocaleLowerCase('uk');
  const object = v => { if(typeof v==='string'){try{v=JSON.parse(v)}catch(_){return {}}}return v && typeof v==='object' && !Array.isArray(v)?v:{}; };
  const equal = (a,b) => typeof a==='object'||typeof b==='object'?JSON.stringify(a)===JSON.stringify(b):norm(a)===norm(b);
  function flatten(value) {
    const e=object(value), out={...e}, formatConflicts=[];
    for(const section of ['personal','service'])for(const [k,v] of Object.entries(object(e[section]))){if(!empty(out[k])&&!empty(v)&&!equal(out[k],v))formatConflicts.push(k);if(empty(out[k]))out[k]=v;}
    out._sync_format_conflicts=formatConflicts;
    for(const [k,v] of Object.entries(object(e.name_cases))) {
      const key=k==='nominative'?'name_nominative':k==='gender'?'name_gender':'name_'+k;
      if(empty(out[key]))out[key]=v;
    }
    if(!Array.isArray(out.relatives))out.relatives=Array.isArray(e.family?.relatives)?e.family.relatives:[];
    return out;
  }
  function service(v){const n=norm(v);return /мобілізац/.test(n)?'За мобілізацією':/контракт/.test(n)?'За контрактом':null;}
  function date(v,partial=false){
    const text=String(v??'').trim();if(!new RegExp(partial?'^\\d{4}(?:-\\d{2}(?:-\\d{2})?)?$':'^\\d{4}-\\d{2}-\\d{2}$').test(text))return false;
    const [y,m=1,d=1]=text.split('-').map(Number), dt=new Date(Date.UTC(y,m-1,d));
    return y>=1800&&y<=new Date().getUTCFullYear()&&dt.getUTCFullYear()===y&&dt.getUTCMonth()===m-1&&dt.getUTCDate()===d;
  }
  const ranks=new Set(['солдат','старший солдат','матрос','старший матрос','молодший сержант','сержант','старший сержант','головний сержант','штаб-сержант','майстер-сержант','старший майстер-сержант','головний майстер-сержант','старшина','головний старшина','молодший лейтенант','лейтенант','старший лейтенант','капітан','майор','підполковник','полковник','бригадний генерал','генерал-майор','генерал-лейтенант','генерал']);
  function valid(key,v){
    if(empty(v))return true;if(typeof v!=='string'&&typeof v!=='number')return false;
    if(/birth_date|death_date/.test(key))return date(v,key!=='birth_date'||key.startsWith('relative.'));
    if(key==='military_specialty')return /^\d{6}[А-ЯІЇЄҐA-Z]?$/u.test(String(v).trim());
    if(key==='shpk'||key==='military_rank')return ranks.has(norm(v));
    if(key==='tariff_grade')return /^\d{1,2}$/.test(String(v))&&Number(v)>=1&&Number(v)<=99;
    if(key==='service_type')return !!service(v);
    if(key==='rnokpp')return /^\d{10}$/.test(String(v));
    if(/full_name|name_nominative|name_genitive|recruiter_name|signatory/.test(key))return /^[А-ЯІЇЄҐа-яіїєґ\s.'’ʼ-]+$/u.test(String(v))&&String(v).trim().split(/\s+/).length>=2;
    if(key==='desired_position')return !(/[A-Za-z]/.test(String(v))&&/[А-Яа-яІіЇїЄє]/.test(String(v)));
    return String(v).length<=2000;
  }
  const relation=v=>({mother:'мати','мать':'мати',father:'батько','отец':'батько',wife:'дружина','жена':'дружина',husband:'чоловік','муж':'чоловік',son:'син','сын':'син',daughter:'донька','дочка':'донька',brother:'брат',sister:'сестра'})[norm(v)]||norm(v);
  const relativeKey=r=>relation(r.relationship||r.relation)+'|'+norm(r.full_name||r.name);
  function mergeRelatives(current,incoming,add,documentId){
    const merged=structuredClone(Array.isArray(current)?current:[]);
    for(const rawValue of incoming){
      const raw=object(rawValue);
      const r={...object(raw),relationship:relation(raw.relationship||raw.relation),full_name:raw.full_name||raw.name};
      delete r.relation;delete r.name;
      if(raw.requires_review||!r.relationship||!valid('full_name',r.full_name)){add('profile','relatives',raw,'conflict','Некоректні ПІБ або спорідненість');continue;}
      let i=merged.findIndex(x=>relativeKey(x)===relativeKey(r));
      // A differently OCR-spelled parent must never silently become a second parent.
      if(i<0&&['мати','батько','дружина','чоловік'].includes(r.relationship)&&merged.some(x=>relation(x.relationship||x.relation)===r.relationship)){
        add('profile','relatives',raw,'conflict','Інші ПІБ уже записаного родича');continue;
      }
      if(i<0){i=merged.length;merged.push({relationship:r.relationship,full_name:r.full_name,source_document_id:documentId});}
      const dest=merged[i];
      for(const [key,v] of Object.entries(r)){
        if(['source_document_id','relationship','full_name','requires_review'].includes(key)||empty(v))continue;
        if(!['birth_date','death_date','birth_place','citizenship','address','phone','workplace','position','notes','deceased'].includes(key))continue;
        const field='relatives.'+i+'.'+key;
        if(/_date$/.test(key)&&!date(v,true)){add('profile',field,v,'conflict','Некоректна дата',dest[key]);continue;}
        if(empty(dest[key])){add('profile',field,v,'fill','',dest[key]);dest[key]=v;}
        else add('profile',field,v,equal(dest[key],v)?'leave':'conflict','',dest[key]);
      }
      if(!Array.isArray(current)||!current.some(x=>relativeKey(x)===relativeKey(r)))add('profile','relatives.'+i,r,'fill','Новий родич',null);
    }
    return merged;
  }
  function plan(document,candidate){
    const p=object(candidate.profile_data),e=flatten(document.ai_extracted),rows=[],selections=[];
    const type=String(document.ai_document_type||document.document_type||'');
    const recommendation=/рекомендац/i.test(type),birth=/свідоцтво про народження/i.test(type)&&!/дітей/i.test(type);
    if(!recommendation&&!birth)return {document,candidate,rows,selections,supported:false};
    const add=(target,key,incoming,action,reason='',current)=>{
      if(current===undefined)current=target==='candidate'?candidate[key]:p[key];
      rows.push({candidate:candidate.full_name,document:document.file_name||document.id,target,key,current:current??null,incoming:incoming??null,action,reason});
    };
    let ownerIssue='';
    if(!empty(e.rnokpp)&&!empty(candidate.rnokpp)&&String(e.rnokpp)!==String(candidate.rnokpp))ownerIssue='РНОКПП іншої особи';
    if(!empty(e.birth_date)&&!empty(candidate.birth_date)&&String(e.birth_date)!==String(candidate.birth_date))ownerIssue='Дата народження іншої особи';
    const strongMatch=valid('rnokpp',e.rnokpp)&&!empty(e.rnokpp)&&String(e.rnokpp)===String(candidate.rnokpp);
    if(!ownerIssue&&!empty(e.full_name)&&!equal(e.full_name,candidate.full_name)&&!strongMatch)ownerIssue='ПІБ не збігається: звірте власника документа';
    if(!strongMatch&&empty(e.full_name))ownerIssue='Не визначено власника документа';
    const warnings=[...(Array.isArray(document.ai_warnings)?document.ai_warnings:[]),...(Array.isArray(e.meta?.warnings)?e.meta.warnings:[])].filter(w=>!String(w).startsWith('[CRM AI sync]')).join(' ');
    if(/інш(?:а|ої|у|ого|ий|е).{0,60}(особ|кандидат|ПІБ)|згаду.{0,80}(особ|ПІБ)|different (?:person|candidate|name)|another (?:person|candidate)/i.test(warnings))ownerIssue='У документі згадано іншу особу: потрібна ручна перевірка';
    if(document.deleted_at)ownerIssue='Документ видалено';
    const propose=(target,key,value)=>{
      const current=target==='candidate'?candidate[key]:p[key];
      const legacy=p.form_data?.[key]??(key==='military_specialty'?p[key]:null);
      const protectedValue=!empty(current)?current:legacy;
      let action='leave',reason='';
      if(!empty(value)){
        if(e._sync_format_conflicts.includes(key)){action='conflict';reason='Плоске і вкладене значення AI не збігаються';}
        else if(!valid(key,value)){action='conflict';reason='Некоректне OCR-значення'+(ownerIssue?'; '+ownerIssue:'');}
        else if(ownerIssue){action='conflict';reason=ownerIssue;}
        else if(!empty(protectedValue)){action=equal(key==='service_type'?service(protectedValue):protectedValue,value)?'leave':'conflict';reason=action==='conflict'?'Збережене значення має пріоритет':'';}
        else action='fill';
      }
      add(target,key,value,action,reason,protectedValue);
      if(action==='fill')selections.push({target,key,incoming:value,expected_current:current??null,fill_only:true,expected_ai:document.ai_extracted});
    };
    for(const key of ['full_name','name_nominative','name_genitive','birth_date','birth_place','rnokpp','phone','sex','military_rank','civilian_profession','desired_position','tcc','military_specialty']){
      if(birth&&!['full_name','birth_date','birth_place'].includes(key))continue;
      let v=e[key];if(key==='phone'&&!empty(v)&&root.CRMPhone)v=root.CRMPhone.normalize(v);
      propose('candidate',key,v);
    }
    if(recommendation){
      for(const key of ['shpk','tariff_grade','recruiter_name','military_unit','desired_unit','recommender_unit','signatory','service_type'])propose('profile',key,key==='service_type'&&!empty(e[key])?service(e[key])||e[key]:e[key]);
    }
    if(birth)propose('profile','birth_certificate',e.document_number||e.birth_certificate);
    if(e.relatives.length){
      if(ownerIssue)add('profile','relatives',e.relatives,'conflict',ownerIssue);
      else{
        const merged=mergeRelatives(p.relatives,e.relatives,add,document.id);
        if(!equal(p.relatives||[],merged))selections.push({target:'profile',key:'relatives',incoming:merged,expected_current:p.relatives??null,fill_only:true,merge_relatives:true,expected_ai:document.ai_extracted});
      }
    }
    return {document,candidate,rows,selections,supported:true};
  }
  async function preview(client,id){
    const dr=await client.from('documents').select('*').eq('id',id).single();if(dr.error)throw dr.error;
    const cr=await client.from('candidates').select('*').eq('id',dr.data.candidate_id).single();if(cr.error)throw cr.error;
    return plan(dr.data,cr.data);
  }
  async function apply(client,report){
    const conflicts=report.rows.filter(r=>r.action==='conflict').map(r=>({target:'sync_conflict',key:r.key,incoming:JSON.stringify({field:r.key,current:r.current,ai:r.incoming,reason:r.reason}),expected_ai:report.document.ai_extracted}));
    const selections=[...report.selections,...conflicts];if(!selections.length)return report;
    // An old RPC must reject the request before it can ignore compare-and-set metadata.
    selections.unshift({target:'sync_guard',key:'version',incoming:'1',expected_ai:report.document.ai_extracted});
    const result=await client.rpc('crm_apply_document_fields',{document_id:report.document.id,selections});if(result.error)throw result.error;
    const after=await preview(client,report.document.id);
    for(const row of report.rows.filter(r=>r.action==='fill'&&!r.key.startsWith('relatives.'))){
      if(after.rows.some(r=>r.key===row.key&&r.target===row.target&&r.action==='fill'))throw new Error('Сервер не зберіг поле '+row.key);
    }
    return after;
  }
  async function sync(client,id){return apply(client,await preview(client,id));}
  async function showPreview(client,id){
    const report=await preview(client,id),dialog=document.createElement('dialog');dialog.className='crm-ai-container';
    const esc=v=>String(typeof v==='object'?JSON.stringify(v):v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const labels={fill:'Заповнити',leave:'Залишити',conflict:'Конфлікт'};
    dialog.innerHTML='<h3>Перевірка синхронізації</h3><p>'+esc(report.candidate.full_name)+' · '+esc(report.document.file_name)+'</p><div style="overflow:auto;max-height:60vh"><table><thead><tr><th>Поле</th><th>У CRM</th><th>AI</th><th>Дія</th></tr></thead><tbody>'+report.rows.map(r=>'<tr><td>'+esc(r.target+'.'+r.key)+'</td><td>'+esc(r.current)+'</td><td>'+esc(r.incoming)+'</td><td>'+labels[r.action]+'<br>'+esc(r.reason)+'</td></tr>').join('')+'</tbody></table></div><p role="status">Конфлікти залишаються без змін.</p><button type="button" data-apply>Заповнити лише порожні поля ('+report.selections.length+')</button> <button type="button" data-close>Закрити</button>';
    document.body.append(dialog);dialog.showModal();const close=()=>{dialog.close();dialog.remove();};dialog.querySelector('[data-close]').onclick=close;dialog.addEventListener('cancel',ev=>{ev.preventDefault();if(!dialog.dataset.busy)close();});
    dialog.querySelector('[data-apply]').disabled=!report.selections.length;
    dialog.querySelector('[data-apply]').onclick=async()=>{
      dialog.dataset.busy='1';dialog.querySelectorAll('button').forEach(b=>b.disabled=true);
      try{await apply(client,report);dialog.querySelector('[role=status]').textContent='Поля збережено. Конфлікти записано у попередження документа.';}
      catch(err){dialog.querySelector('[role=status]').textContent='Зміни не застосовано: '+err.message+' Оновіть перегляд.';}
      finally{delete dialog.dataset.busy;dialog.querySelector('[data-close]').disabled=false;}
    };
    return report;
  }
  const api={flatten,plan,preview,apply,sync,showPreview,mergeRelatives,valid,relation};
  root.CRMDocumentSync=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
