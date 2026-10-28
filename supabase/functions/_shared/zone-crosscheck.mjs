import '../../../name-change-document.js';
import '../../../parent-names.js';
import '../../../document-crosscheck.js';

// Existing read-only comparator; do not turn zonal assertions into accepted facts.
export async function crosscheckZoneContinuation({client,context,comparator=globalThis.CRMDocumentCrosscheck}) {
 const binding=context.crosscheck_binding;
 if(!binding||!context.document?.id||binding.document_id!==context.document.id||!binding.candidate_id||!comparator?.load)throw Error('Crosscheck binding unavailable');
 const result=await client.from('candidates').select('*').eq('id',binding.candidate_id).single();
 if(result.error||!result.data||result.data.id!==binding.candidate_id)throw Error('Crosscheck candidate unavailable');
 if(context.reports_truncated||!Array.isArray(context.reports))throw Error('Crosscheck evidence unavailable');
 const evidence=await comparator.load(client,result.data,{reports:context.reports,binding:context.source,
  context:{document_id:context.document.id,file_sha256:context.source.file_sha256,pages:context.snapshot.pages,revision:context.source.revision}});
 if(!Array.isArray(evidence)||evidence.length>200)throw Error('Crosscheck evidence budget exceeded');
 const issues=evidence.filter(e=>['conflict','needs_review'].includes(e.status)).map(e=>({
  key:String(e.key||'unknown').slice(0,80),status:e.status,source_ids:[...new Set((e.sources||[]).map(s=>s.document_id).filter(id=>typeof id==='string'))].slice(0,32)
 }));
 if(!evidence.some(e=>Array.isArray(e.sources)&&e.sources.length))issues.push({key:'document',status:'needs_review',source_ids:[context.document.id]});
 return {contract:'splav-post-zone-1',binding,status:issues.length?'needs_review':'matched',checked:evidence.length,issues};
}
