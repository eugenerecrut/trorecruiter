// CRM document upload compatibility + AI vision fix.
// Storage path is ASCII-safe and AI receives BOTH OCR text and the original document image/PDF.
(function(){
  function safeStorageFileName(name){
    const s=String(name||'document');
    const ext=(s.match(/\.[A-Za-z0-9]{1,8}$/)||[''])[0].toLowerCase();
    return 'document_'+Date.now()+'_'+Math.random().toString(36).slice(2,10)+ext;
  }

  // Critical fix: do not choose between OCR and the file.
  // Send both so the vision model can recover fields that OCR missed (ID cards, stamps, MRZ, etc.).
  if(typeof supabaseClient!=='undefined'){
    window.classifyStoredDocument=async function(path,fileName,extractedText=''){
      const{data,error}=await supabaseClient.storage.from('candidate-documents').createSignedUrl(path,600);
      if(error||!data?.signedUrl)throw new Error(error?.message||'Не вдалося створити тимчасове посилання');
      const body={file_name:fileName||'document',file_url:data.signedUrl};
      if(extractedText&&String(extractedText).trim())body.text=String(extractedText).trim();
      const{data:ai,error:aiError}=await supabaseClient.functions.invoke('ai-classify-document',{body});
      if(aiError)throw new Error(aiError.message||'Помилка AI');
      if(!ai?.extracted)throw new Error('AI не повернув структуровані дані');
      return ai;
    };
  }

  // Keep the existing ASCII storage filename compatibility behavior.
  const original=window.processOneDocument;
  if(typeof original!=='function') return;
  window.processOneDocument=async function(file,requirementId,user,candidates,forcedCandidateId){
    const originalName=file.name;
    const safeName=safeStorageFileName(originalName);
    const safeFile=new File([file],safeName,{type:file.type||'application/octet-stream',lastModified:file.lastModified||Date.now()});
    const result=await original.call(this,safeFile,requirementId,user,candidates,forcedCandidateId);
    if(result){
      try{await supabaseClient.from('documents').update({file_name:originalName}).eq('candidate_id',forcedCandidateId).eq('file_name',safeName)}catch(e){console.warn('Не вдалося повернути оригінальну назву:',e)}
      result.file=originalName;
    }
    return result;
  };
})();
