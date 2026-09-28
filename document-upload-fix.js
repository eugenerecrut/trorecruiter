// CRM document upload compatibility fix: Supabase Storage keys are ASCII-only.
(function(){
  function safeStorageFileName(name){
    const s=String(name||'document');
    const ext=(s.match(/\.[A-Za-z0-9]{1,8}$/)||[''])[0].toLowerCase();
    return 'document_'+Date.now()+'_'+Math.random().toString(36).slice(2,9)+ext;
  }
  const original=window.processOneDocument;
  if(typeof original!=='function') return;
  window.processOneDocument=async function(file,requirementId,user,candidates,forcedCandidateId){
    const originalName=file.name;
    const safeName=safeStorageFileName(originalName);
    const safeFile=new File([file],safeName,{type:file.type||'application/octet-stream',lastModified:file.lastModified||Date.now()});
    try{
      const result=await original.call(this,safeFile,requirementId,user,candidates,forcedCandidateId);
      try{
        await supabaseClient.from('documents').update({file_name:originalName}).eq('candidate_id',forcedCandidateId).eq('file_name',safeName);
      }catch(e){console.warn('Не вдалося повернути оригінальну назву файлу:',e)}
      if(result) result.file=originalName;
      return result;
    }catch(error){
      try{
        await supabaseClient.from('documents').update({file_name:originalName}).eq('candidate_id',forcedCandidateId).eq('file_name',safeName);
      }catch(e){console.warn('Не вдалося оновити назву файлу після помилки:',e)}
      throw error;
    }
  };
})();
