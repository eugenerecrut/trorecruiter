// PSK_RECRUTER CRM — document AI vision + field reconciliation bridge
(function(){
  const BUCKET='candidate-documents';
  const AI_FN='ai-classify-document';
  const originalUpload=window.uploadSelectedDocuments;

  // The function inside documents.js uses a lexical classifyStoredDocument,
  // so overriding window.classifyStoredDocument alone is not enough.
  // This bridge re-runs AI after the upload with the ORIGINAL FILE and then
  // applies a safe compare: empty fields may be filled; existing identical
  // values are untouched; different values are warnings only.
  async function visionClassify(path,fileName,ocrText=''){
    const {data,error}=await supabaseClient.storage.from(BUCKET).createSignedUrl(path,600);
    if(error||!data?.signedUrl) throw new Error(error?.message||'Не вдалося відкрити документ для AI');
    const body={file_name:fileName||'document',file_url:data.signedUrl};
    if(ocrText&&String(ocrText).trim()) body.text=String(ocrText).trim();
    const {data:ai,error:aiError}=await supabaseClient.functions.invoke(AI_FN,{body});
    if(aiError) throw new Error(aiError.message||'Помилка AI');
    if(!ai?.extracted) throw new Error('AI не повернув структуровані дані');
    return ai;
  }

  function normalize(v){
    return String(v??'').trim().toLocaleLowerCase('uk-UA').replace(/\s+/g,' ');
  }

  async function reconcile(candidateId,extracted){
    if(!candidateId||!extracted) return {filled:[],same:[],conflicts:[]};
    const {data:c,error}=await supabaseClient.from('candidates').select('*').eq('id',candidateId).single();
    if(error||!c) return {filled:[],same:[],conflicts:['Не вдалося відкрити картку кандидата']};
    const {data:pf}=await supabaseClient.from('personal_files').select('*').eq('candidate_id',candidateId).maybeSingle();
    const updates={};
    const pfUpdates={};
    const filled=[]; const same=[]; const conflicts=[];
    const candidateMap={
      full_name: extracted.name_nominative||extracted.full_name,
      name_nominative: extracted.name_nominative||extracted.full_name,
      name_genitive: extracted.name_genitive,
      name_gender: extracted.name_gender,
      birth_date: extracted.birth_date,
      birth_place: extracted.birth_place,
      rnokpp: extracted.rnokpp,
      passport_data: extracted.passport_data,
      phone: extracted.phone,
      email: extracted.email,
      sex: extracted.sex,
      marital_status: extracted.marital_status,
      military_rank: extracted.military_rank,
      civilian_profession: extracted.civilian_profession,
      desired_position: extracted.desired_position,
      direction: extracted.desired_unit,
      tcc: extracted.tcc
    };
    const pfMap={
      address: extracted.address,
      birth_place: extracted.birth_place,
      passport_data: extracted.passport_data,
      education: extracted.education,
      family_status: extracted.marital_status,
      children_info: extracted.children_info,
      military_service_history: extracted.military_service_history
    };

    for(const [key,val] of Object.entries(candidateMap)){
      if(val===null||val===undefined||String(val).trim()==='') continue;
      const old=c[key];
      if(old===null||old===undefined||String(old).trim()===''){
        updates[key]=val; filled.push(key);
      }else if(normalize(old)===normalize(val)){
        same.push(key);
      }else{
        conflicts.push(`${key}: у CRM «${old}», у документі «${val}»`);
      }
    }

    for(const [key,val] of Object.entries(pfMap)){
      if(val===null||val===undefined||String(val).trim()==='') continue;
      const old=pf?.[key];
      if(old===null||old===undefined||String(old).trim()===''){
        pfUpdates[key]=val; filled.push('особова справа: '+key);
      }else if(normalize(old)===normalize(val)){
        same.push('особова справа: '+key);
      }else{
        conflicts.push(`особова справа ${key}: у CRM «${old}», у документі «${val}»`);
      }
    }

    if(extracted.has_children!==null&&extracted.has_children!==undefined){
      const old=c.has_children;
      if(old===null||old===undefined||old==='') {updates.has_children=extracted.has_children;filled.push('has_children');}
      else if(String(old)===String(extracted.has_children)) same.push('has_children');
      else conflicts.push(`has_children: у CRM «${old}», у документі «${extracted.has_children}»`);
    }

    if(Object.keys(updates).length){
      updates.updated_at=new Date().toISOString();
      const {error:e}=await supabaseClient.from('candidates').update(updates).eq('id',candidateId);
      if(e) conflicts.push('Не вдалося зберегти нові поля кандидата: '+e.message);
    }
    if(Object.keys(pfUpdates).length){
      pfUpdates.candidate_id=candidateId;
      pfUpdates.updated_at=new Date().toISOString();
      const {error:e}=await supabaseClient.from('personal_files').upsert(pfUpdates,{onConflict:'candidate_id'});
      if(e) conflicts.push('Не вдалося зберегти нові поля особової справи: '+e.message);
    }
    return {filled,same,conflicts};
  }

  function showReconcile(result){
    const el=document.getElementById('docUploadStatus');
    if(!el) return;
    const parts=[];
    if(result.filled.length) parts.push('Заповнено: '+result.filled.join(', '));
    if(result.same.length) parts.push('Ідентичні дані не змінювалися: '+result.same.length+' полів');
    if(result.conflicts.length) parts.push('⚠️ Відмінності: '+result.conflicts.join(' | '));
    el.innerHTML=parts.join('<br>')||'AI: змін немає';
  }

  window.reconcileAiWithCandidate=async function(candidateId,extracted){return reconcile(candidateId,extracted)};

  // Run only after the existing uploader finishes, so the original upload remains intact.
  if(typeof originalUpload==='function'){
    window.uploadSelectedDocuments=async function(){
      const candidateId=window.activeDocumentsCandidateId;
      const started=Date.now();
      const result=await originalUpload.apply(this,arguments);
      if(!candidateId) return result;
      try{
        const {data:docs,error}=await supabaseClient.from('documents').select('*').eq('candidate_id',candidateId).gte('created_at',new Date(started-15000).toISOString()).order('created_at',{ascending:true});
        if(error||!docs?.length) return result;
        let allFilled=[],allSame=[],allConf=[];
        for(const d of docs){
          if(!d.storage_path) continue;
          try{
            const ai=await visionClassify(d.storage_path,d.file_name||'document',d.extracted_text||'');
            const r=await reconcile(candidateId,ai.extracted||{});
            allFilled.push(...r.filled); allSame.push(...r.same); allConf.push(...r.conflicts);
            await supabaseClient.from('documents').update({
              ai_document_type:ai.document_type||d.ai_document_type||null,
              ai_confidence:Number(ai.confidence||0),
              ai_result:ai,
              processing_status:'AI оброблено',
              verification_status:(r.conflicts.length?'Потребує перевірки':'Не перевірено')
            }).eq('id',d.id);
          }catch(e){allConf.push((d.file_name||'Документ')+': '+e.message)}
        }
        showReconcile({filled:[...new Set(allFilled)],same:[...new Set(allSame)],conflicts:[...new Set(allConf)]});
        if(typeof showDocuments==='function') setTimeout(()=>showDocuments(candidateId),700);
      }catch(e){console.error('AI reconciliation error',e)}
      return result;
    };
  }
})();
