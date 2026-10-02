// PSK_RECRUTER CRM — document AI + safe field reconciliation bridge v6
(function(){
  const originalUpload=window.uploadSelectedDocuments;
  const originalClassify=window.classifyStoredDocument;
  const originalExtractPdfText=window.extractPdfText;
  const originalRunOcr=window.runOcr;
  const norm=v=>String(v??'').trim().toLocaleLowerCase('uk-UA').replace(/\s+/g,' ');

  // ai-classify-document currently returns a FLAT extracted object.
  // Accept both the current flat format and the older nested format so the
  // browser bridge cannot silently turn every field into null.
  function flattenAI(ai){
    const e=ai?.extracted||{};
    const p=e.personal||{};
    const s=e.service||{};
    const n=e.name_cases||{};
    const pick=(flat,nested)=>flat!==undefined&&flat!==null&&String(flat).trim()!==''?flat:nested??null;
    const relatives=Array.isArray(e.relatives)?e.relatives:(Array.isArray(e.family?.relatives)?e.family.relatives:[]);
    return {
      full_name:pick(e.full_name,p.full_name),
      name_nominative:pick(e.name_nominative,n.nominative,p.full_name),
      name_genitive:pick(e.name_genitive,n.genitive),
      name_gender:pick(e.name_gender,n.gender),
      birth_date:pick(e.birth_date,p.birth_date),
      birth_place:pick(e.birth_place,p.birth_place),
      rnokpp:pick(e.rnokpp,p.rnokpp),
      passport_data:pick(e.passport_data,p.passport_data),
      phone:pick(e.phone,p.phone),
      email:pick(e.email,p.email),
      address:pick(e.address,p.address),
      sex:pick(e.sex,n.gender),
      marital_status:pick(e.marital_status,p.marital_status),
      has_children:e.has_children!==undefined?e.has_children:(p.has_children??null),
      children_info:pick(e.children_info,p.children_info),
      education:pick(e.education,p.education),
      civilian_profession:pick(e.civilian_profession,p.civilian_profession),
      military_rank:pick(e.military_rank,p.military_rank),
      military_service_history:pick(e.military_service_history,s.military_service_history),
      military_unit:pick(e.military_unit,s.military_unit),
      desired_unit:pick(e.desired_unit,s.desired_unit),
      desired_position:pick(e.desired_position,s.desired_position),
      military_specialty:pick(e.military_specialty,s.military_specialty),
      shpk:pick(e.shpk,s.shpk),
      tariff_grade:pick(e.tariff_grade,s.tariff_grade),
      service_type:pick(e.service_type,s.service_type),
      recommender_unit:pick(e.recommender_unit,s.recommender_unit),
      recruiter_name:pick(e.recruiter_name,s.recruiter_name),
      signatory:pick(e.signatory,s.signatory),
      tcc:pick(e.tcc,p.tcc),
      direction:pick(e.direction,s.desired_unit),
      relatives,
      meta:e.meta||null
    };
  }

  function cleanRelative(r){
    if(!r||typeof r!=='object')return null;
    const x={relationship:r.relationship||r.relation||'',full_name:r.full_name||r.name||'',birth_date:r.birth_date||'',birth_place:r.birth_place||'',citizenship:r.citizenship||'',address:r.address||'',phone:r.phone||'',workplace:r.workplace||'',position:r.position||'',notes:r.notes||''};
    return Object.values(x).some(Boolean)?x:null;
  }

  async function reconcile(candidateId,extracted){
    if(!candidateId||!extracted)return{filled:[],same:[],conflicts:[]};
    const {data:c,error}=await supabaseClient.from('candidates').select('*').eq('id',candidateId).single();
    if(error||!c)return{filled:[],same:[],conflicts:['Не вдалося відкрити картку кандидата']};
    const {data:pf}=await supabaseClient.from('personal_files').select('*').eq('candidate_id',candidateId).maybeSingle();
    const updates={},pfUpdates={},filled=[],same=[],conflicts=[];
    const cm={full_name:extracted.name_nominative||extracted.full_name,name_nominative:extracted.name_nominative||extracted.full_name,name_genitive:extracted.name_genitive,name_gender:extracted.name_gender,birth_date:extracted.birth_date,birth_place:extracted.birth_place,rnokpp:extracted.rnokpp,passport_data:extracted.passport_data,phone:extracted.phone,email:extracted.email,sex:extracted.sex,marital_status:extracted.marital_status,military_rank:extracted.military_rank,civilian_profession:extracted.civilian_profession,desired_position:extracted.desired_position,direction:extracted.desired_unit,tcc:extracted.tcc};
    const pm={address:extracted.address,birth_place:extracted.birth_place,passport_data:extracted.passport_data,education:extracted.education,family_status:extracted.marital_status,children_info:extracted.children_info,military_service_history:extracted.military_service_history};
    for(const[k,v]of Object.entries(cm)){if(v===null||v===undefined||String(v).trim()==='')continue;const old=c[k];if(old===null||old===undefined||String(old).trim()===''){updates[k]=v;filled.push(k)}else if(norm(old)===norm(v))same.push(k);else conflicts.push(`${k}: у CRM «${old}», у документі «${v}»`)}
    for(const[k,v]of Object.entries(pm)){if(v===null||v===undefined||String(v).trim()==='')continue;const old=pf?.[k];if(old===null||old===undefined||String(old).trim()===''){pfUpdates[k]=v;filled.push('особова справа: '+k)}else if(norm(old)===norm(v))same.push('особова справа: '+k);else conflicts.push(`особова справа ${k}: у CRM «${old}», у документі «${v}»`)}
    if(extracted.has_children!==null&&extracted.has_children!==undefined){const old=c.has_children;if(old===null||old===undefined||old===''){updates.has_children=extracted.has_children;filled.push('has_children')}else if(String(old)===String(extracted.has_children))same.push('has_children');else conflicts.push(`has_children: у CRM «${old}», у документі «${extracted.has_children}»`)}
    // Merge AI relatives into profile_data without deleting manually entered relatives.
    if(Array.isArray(extracted.relatives)&&extracted.relatives.length){
      const oldRel=Array.isArray(c.profile_data?.relatives)?c.profile_data.relatives:[];
      const incoming=extracted.relatives.map(cleanRelative).filter(Boolean);
      const merged=[...oldRel];
      for(const r of incoming){
        const idx=merged.findIndex(x=>norm(x.relationship)===norm(r.relationship)&&norm(x.full_name)===norm(r.full_name));
        if(idx<0){merged.push(r);filled.push('родич: '+(r.relationship||r.full_name));}
        else { const m={...merged[idx]}; for(const[k,v] of Object.entries(r)) if(v&&(!m[k]||String(m[k]).trim()===''))m[k]=v; merged[idx]=m; }
      }
      updates.profile_data={...(c.profile_data||{}),relatives:merged};
    }
    if(Object.keys(updates).length){updates.updated_at=new Date().toISOString();const{error:e}=await supabaseClient.from('candidates').update(updates).eq('id',candidateId);if(e)conflicts.push('Не вдалося зберегти поля кандидата: '+e.message)}
    if(Object.keys(pfUpdates).length){pfUpdates.candidate_id=candidateId;pfUpdates.updated_at=new Date().toISOString();const{error:e}=await supabaseClient.from('personal_files').upsert(pfUpdates,{onConflict:'candidate_id'});if(e)conflicts.push('Не вдалося зберегти поля особової справи: '+e.message)}
    return{filled,same,conflicts};
  }
  window.reconcileAiWithCandidate=reconcile;

  window.classifyStoredDocument=async function(...args){
    if(window.__PSK_DOC_AI_ENABLED===false)return{document_type:window.__PSK_DOC_FORCED_TYPE||'Документ',confidence:1,candidate_name:null,warnings:['AI/OCR вимкнено для цього типу документа. Файл збережено без AI-розпізнавання.'],extracted:{}};
    if(typeof originalClassify==='function')return originalClassify.apply(this,args);
    throw new Error('Функція AI-класифікації недоступна');
  };

  async function loadAiMode(){
    const modal=document.getElementById('documentModal');
    const reqId=modal?.querySelector('#docRequirement')?.value||'';
    window.__PSK_DOC_AI_ENABLED=true;window.__PSK_DOC_FORCED_TYPE='';
    if(!reqId)return;
    const {data:req,error}=await supabaseClient.from('document_requirements').select('document_type,ai_enabled').eq('id',reqId).maybeSingle();
    if(error){console.warn('AI mode: не вдалося прочитати тип документа',error);return}
    window.__PSK_DOC_AI_ENABLED=req?.ai_enabled!==false;window.__PSK_DOC_FORCED_TYPE=req?.document_type||'';
  }
  function applyLocalOcrMode(){if(window.__PSK_DOC_AI_ENABLED===false){if(typeof window.extractPdfText==='function')window.extractPdfText=async()=>'';if(typeof window.runOcr==='function')window.runOcr=async()=>'';}}
  function restoreLocalOcr(){if(typeof originalExtractPdfText==='function')window.extractPdfText=originalExtractPdfText;if(typeof originalRunOcr==='function')window.runOcr=originalRunOcr;}

  if(typeof originalUpload==='function')window.uploadSelectedDocuments=async function(){
    if(document.querySelector('#docFilePlan'))return originalUpload.apply(this,arguments);
    const started=Date.now();await loadAiMode();applyLocalOcrMode();let result;
    try{result=await originalUpload.apply(this,arguments)}finally{restoreLocalOcr()}
    if(window.__PSK_DOC_AI_ENABLED===false){const el=document.getElementById('docUploadStatus');if(el)el.innerHTML='<b>Готово.</b> Документ збережено без AI/OCR.';window.__PSK_DOC_AI_ENABLED=true;window.__PSK_DOC_FORCED_TYPE='';return result;}
    try{
      await new Promise(r=>setTimeout(r,500));
      const since=new Date(started-15000).toISOString();
      const{data:docs,error}=await supabaseClient.from('documents').select('*').gte('created_at',since).order('created_at',{ascending:true});
      if(error||!docs?.length){console.warn('AI bridge: документи не знайдено',error);return result}
      const allFilled=[],allSame=[],allConf=[];
      for(const d of docs){
        if(!d.ai_extracted||d.processing_status!=='AI оброблено')continue;
        try{const r=await reconcile(d.candidate_id,flattenAI({extracted:d.ai_extracted}));allFilled.push(...r.filled);allSame.push(...r.same);allConf.push(...r.conflicts);const{error:ue}=await supabaseClient.from('documents').update({verification_status:r.conflicts.length?'Потребує перевірки':'Не перевірено'}).eq('id',d.id);if(ue)allConf.push('Не вдалося зберегти статус AI: '+ue.message)}catch(e){allConf.push((d.file_name||'Документ')+': '+e.message)}
      }
      const el=document.getElementById('docUploadStatus');
      if(el){const out=[];if(allFilled.length)out.push('✅ Заповнено: '+[...new Set(allFilled)].join(', '));if(allSame.length)out.push('ℹ️ Ідентичні дані не змінювалися: '+[...new Set(allSame)].length+' полів');if(allConf.length)out.push('⚠️ ВІДМІННОСТІ: '+[...new Set(allConf)].join(' | '));el.innerHTML=out.join('<br>')||'AI: дані без змін';}
      if(typeof showDocuments==='function'&&activeDocumentsCandidateId)await showDocuments(activeDocumentsCandidateId);
    }catch(e){console.error('AI reconciliation error',e);const el=document.getElementById('docUploadStatus');if(el)el.textContent='⚠️ AI: '+e.message}
    finally{window.__PSK_DOC_AI_ENABLED=true;window.__PSK_DOC_FORCED_TYPE='';}
    return result;
  };

  function installDocumentListFallback(){
    if(window.__PSK_DOC_LIST_FALLBACK_INSTALLED)return true;const originalShow=window.showDocuments;if(typeof originalShow!=='function')return false;
    window.showDocuments=async function(id){
      await originalShow(id);const rows=document.getElementById('documentRows');if(!rows||rows.dataset.requirementsManaged||rows.children.length)return;
      const {data:reqs,error:reqError}=await supabaseClient.from('document_requirements').select('*').eq('active',true).order('sort_order',{ascending:true});if(reqError){console.error('Document list fallback:',reqError);return}
      const {data:docs}=await supabaseClient.from('documents').select('*').eq('candidate_id',id).order('created_at',{ascending:true});
      rows.innerHTML=(reqs||[]).map(r=>{const m=(docs||[]).filter(d=>d.requirement_id===r.id||d.document_type===r.document_type),latest=m[m.length-1];const status=!m.length?(r.is_required?'Не завантажено':'Не додано'):(m.some(d=>d.verification_status==='Підтверджено')?'Підтверджено':m.some(d=>d.processing_status==='AI оброблено')?'AI розпізнано · перевірити':'Завантажено · перевірити');return `<tr><td><b>${docEscape(r.document_type)}</b>${r.condition_note?`<div class="muted" style="font-size:10px;margin-top:3px">${docEscape(r.condition_note)}</div>`:''}</td><td>${r.is_required?'<b>Обов’язковий</b>':'За наявності'}</td><td><span class="status status-work">${status}</span></td><td>${latest?`<span style="font-size:11px">${docEscape(latest.file_name||'PDF')} · ${formatDocSize(latest.file_size)}</span>`:'—'}</td><td>${latest?.ai_document_type?`<span style="font-size:10px"><b>${docEscape(latest.ai_document_type)}</b><br>${Math.round(Number(latest.ai_confidence||0)*100)}%</span>`:'—'}</td><td><button style="border:1px solid #d8e0e3;background:#fff;border-radius:7px;padding:7px 9px;font-weight:700" onclick="openAddDocumentModal('${id}','${r.id}')">＋ Додати</button>${latest?` <button style="border:1px solid #d8e0e3;background:#fff;border-radius:7px;padding:7px 9px;font-weight:700" onclick="openDocument('${latest.id}')">Відкрити</button>`:''}</td></tr>`}).join('');
      const required=(reqs||[]).filter(r=>r.is_required),complete=required.filter(r=>(docs||[]).some(d=>(d.requirement_id===r.id||d.document_type===r.document_type)&&d.verification_status==='Підтверджено')).length,pct=required.length?Math.round(complete/required.length*100):0;const progress=document.getElementById('docProgressText');const bar=document.querySelector('#docProgress > div');if(progress)progress.textContent=`Підтверджено ${complete} із ${required.length} обов’язкових документів · ${pct}%`;if(bar)bar.style.width=pct+'%';
    };
    window.__PSK_DOC_LIST_FALLBACK_INSTALLED=true;return true;
  }
  if(!installDocumentListFallback()){let tries=0;const timer=setInterval(()=>{tries++;if(installDocumentListFallback()||tries>100)clearInterval(timer)},100)}
})();