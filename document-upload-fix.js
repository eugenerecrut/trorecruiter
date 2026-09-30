// PSK_RECRUTER CRM — document AI + safe field reconciliation bridge v5
(function(){
  const AI_FN='ai-classify-document';
  const originalUpload=window.uploadSelectedDocuments;
  const originalClassify=window.classifyStoredDocument;
  const originalExtractPdfText=window.extractPdfText;
  const originalRunOcr=window.runOcr;
  const norm=v=>String(v??'').trim().toLocaleLowerCase('uk-UA').replace(/\s+/g,' ');

  function flattenAI(ai){
    const e=ai?.extracted||{};
    const p=e.personal||{};
    const s=e.service||{};
    const n=e.name_cases||{};
    return {
      full_name:p.full_name??null,name_nominative:n.nominative??p.full_name??null,name_genitive:n.genitive??null,name_gender:n.gender??null,
      birth_date:p.birth_date??null,birth_place:null,rnokpp:p.rnokpp??null,passport_data:null,phone:p.phone??null,email:null,sex:n.gender??null,
      marital_status:null,has_children:null,children_info:null,education:null,civilian_profession:p.civilian_profession??null,military_rank:p.military_rank??null,
      military_service_history:null,military_unit:s.military_unit??null,desired_unit:s.desired_unit??null,desired_position:s.desired_position??null,
      military_specialty:s.military_specialty??null,shpk:s.shpk??null,tariff_grade:s.tariff_grade??null,service_type:s.service_type??null,
      recommender_unit:s.recommender_unit??null,recruiter_name:s.recruiter_name??null,signatory:s.signatory??null,tcc:p.tcc??null,direction:s.desired_unit??null,
      education_raw:null,meta:e.meta||null
    };
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
    if(Object.keys(updates).length){updates.updated_at=new Date().toISOString();const{error:e}=await supabaseClient.from('candidates').update(updates).eq('id',candidateId);if(e)conflicts.push('Не вдалося зберегти поля кандидата: '+e.message)}
    if(Object.keys(pfUpdates).length){pfUpdates.candidate_id=candidateId;pfUpdates.updated_at=new Date().toISOString();const{error:e}=await supabaseClient.from('personal_files').upsert(pfUpdates,{onConflict:'candidate_id'});if(e)conflicts.push('Не вдалося зберегти поля особової справи: '+e.message)}
    return{filled,same,conflicts};
  }
  window.reconcileAiWithCandidate=reconcile;

  // Ручний тип документа = можна зберегти без AI/OCR.
  // Автоматичне визначення типу = AI потрібен, бо система має визначити тип документа.
  window.classifyStoredDocument=async function(path,fileName,ocrText=''){
    if(window.__PSK_DOC_AI_ENABLED===false){
      return {document_type:window.__PSK_DOC_FORCED_TYPE||'Документ',confidence:1,candidate_name:null,warnings:['AI/OCR вимкнено для цього типу документа. Файл збережено без AI-розпізнавання.'],extracted:{}};
    }
    if(typeof originalClassify==='function')return originalClassify(path,fileName,ocrText);
    throw new Error('Функція AI-класифікації недоступна');
  };

  async function loadAiMode(){
    const modal=document.getElementById('documentModal');
    const reqId=modal?.querySelector('#docRequirement')?.value||'';
    window.__PSK_DOC_AI_ENABLED=true;window.__PSK_DOC_FORCED_TYPE='';
    if(!reqId)return;
    const {data:req,error}=await supabaseClient.from('document_requirements').select('document_type,ai_enabled').eq('id',reqId).maybeSingle();
    if(error){console.warn('AI mode: не вдалося прочитати тип документа',error);return}
    window.__PSK_DOC_AI_ENABLED=req?.ai_enabled!==false;
    window.__PSK_DOC_FORCED_TYPE=req?.document_type||'';
  }

  function applyLocalOcrMode(){
    if(window.__PSK_DOC_AI_ENABLED===false){
      if(typeof window.extractPdfText==='function')window.extractPdfText=async()=>'';
      if(typeof window.runOcr==='function')window.runOcr=async()=>'';
    }
  }
  function restoreLocalOcr(){
    if(typeof originalExtractPdfText==='function')window.extractPdfText=originalExtractPdfText;
    if(typeof originalRunOcr==='function')window.runOcr=originalRunOcr;
  }

  if(typeof originalUpload==='function'){
    window.uploadSelectedDocuments=async function(){
      const started=Date.now();
      await loadAiMode();
      applyLocalOcrMode();
      let result;
      try{result=await originalUpload.apply(this,arguments)}finally{restoreLocalOcr()}

      if(window.__PSK_DOC_AI_ENABLED===false){
        const el=document.getElementById('docUploadStatus');
        if(el)el.innerHTML='<b>Готово.</b> Документ збережено без AI/OCR.';
        window.__PSK_DOC_AI_ENABLED=true;window.__PSK_DOC_FORCED_TYPE='';
        return result;
      }

      // AI уже викликався в documents.js. Другий AI-запит не робимо — використовуємо збережений результат.
      try{
        await new Promise(r=>setTimeout(r,500));
        const since=new Date(started-15000).toISOString();
        const{data:docs,error}=await supabaseClient.from('documents').select('*').gte('created_at',since).order('created_at',{ascending:true});
        if(error||!docs?.length){console.warn('AI bridge: документи не знайдено',error);return result}
        const allFilled=[],allSame=[],allConf=[];
        for(const d of docs){
          if(!d.ai_extracted||d.processing_status!=='AI оброблено')continue;
          try{
            const r=await reconcile(d.candidate_id,flattenAI({extracted:d.ai_extracted}));
            allFilled.push(...r.filled);allSame.push(...r.same);allConf.push(...r.conflicts);
            const{error:ue}=await supabaseClient.from('documents').update({verification_status:r.conflicts.length?'Потребує перевірки':'Не перевірено'}).eq('id',d.id);
            if(ue)allConf.push('Не вдалося зберегти статус AI: '+ue.message);
          }catch(e){allConf.push((d.file_name||'Документ')+': '+e.message)}
        }
        const el=document.getElementById('docUploadStatus');
        if(el){const out=[];if(allFilled.length)out.push('✅ Заповнено: '+[...new Set(allFilled)].join(', '));if(allSame.length)out.push('ℹ️ Ідентичні дані не змінювалися: '+[...new Set(allSame)].length+' полів');if(allConf.length)out.push('⚠️ ВІДМІННОСТІ: '+[...new Set(allConf)].join(' | '));el.innerHTML=out.join('<br>')||'AI: дані без змін';}
        if(typeof showDocuments==='function'&&activeDocumentsCandidateId)await showDocuments(activeDocumentsCandidateId);
      }catch(e){console.error('AI reconciliation error',e);const el=document.getElementById('docUploadStatus');if(el)el.textContent='⚠️ AI: '+e.message}
      finally{window.__PSK_DOC_AI_ENABLED=true;window.__PSK_DOC_FORCED_TYPE='';}
      return result;
    };
  }
})();
