import {readBoundedPDF} from './pdf-raster.js';

// Preflight reads only the original assigned to the current root lease. No AI.
export async function continuationPDFMetadata({client,document,backend,getLibrary,fetchImpl=fetch}) {
 const signed=await client.storage.from('candidate-documents').createSignedUrl(document.storage_path,120);
 if(signed.error||!signed.data?.signedUrl)throw Error('Continuation source unavailable');
 const target=new URL(signed.data.signedUrl),origin=new URL(backend);
 if(target.origin!==origin.origin||!target.pathname.startsWith('/storage/v1/object/sign/candidate-documents/'))throw Error('Unexpected continuation source');
 const response=await fetchImpl(target.href,{signal:AbortSignal.timeout(30000),redirect:'error'});
 if(!response.ok||!response.body)throw Error('Continuation source unavailable');
 const bytes=await readBoundedPDF(response.body,response.headers.get('content-length'));
 const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
 if(document.file_hash&&String(document.file_hash).toLowerCase()!==digest)throw Error('Continuation original changed');
 let pdf;try{pdf=await (await getLibrary()).loadDocument(bytes);return {digest,pages:pdf.getPageCount()};}finally{pdf?.destroy();}
}

// Only the server's bounded rollout/delegation decision can opt in.
// The existing finish remains the default for legacy jobs without delegation.
// SQL atomically commits parent completion and child creation; transport failures
// retain ocr_saved so the existing lease recovery resumes without another root OCR.
export async function finishQueueWithContinuation({client,queue,outcome,enabled,metadata}) {
 const args={job_id:queue.job_id,token:queue.lease_token};
 if(enabled===true&&outcome.state==='needs_review'&&outcome.zone_eligible===true){
  const source=await metadata();
  if(source&&Number.isInteger(source.pages)&&source.pages>=1&&source.pages<=4&&/^[a-f0-9]{64}$/.test(source.digest||'')){
   const saved=await client.rpc('crm_splav_continue_zone',{...args,outcome,p_digest:source.digest,p_pages:source.pages});
   if(saved.error)throw saved.error;
   if(!saved.data||!['queued','needs_review'].includes(saved.data.state))throw Error('Continuation not acknowledged');
   return {...outcome,continuation:saved.data};
  }
  outcome={...outcome,continuation:{state:'needs_review',reason:'unsupported_source_or_page_limit'}};
 }
 const saved=await client.rpc('crm_splav_finish',{...args,outcome});if(saved.error)throw saved.error;
 return outcome;
}
