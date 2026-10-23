// The same planners and validators as the browser, without a DOM or a second writer.
import '../../../candidate-phone.js';
import '../../../name-change-document.js';
import '../../../education-document.js';
import '../../../work-document.js';
import '../../../military-document.js';
import '../../../residence-document.js';
import '../../../vlk-document.js';
import './document-data-policy.js';
import './military-facts.js';
import '../../../document-crosscheck.js';
import '../../../document-ai-sync.js';
import { reviewID } from './id-validation.js';

globalThis.CRMIDValidation = { review: reviewID };

export async function reconcileDocument(client, documentId, expectedRevision, queue=null) {
  const options={expectedRevision};
  let scoped=client;
  if(queue){
    const args={job_id:queue.job_id,token:queue.lease_token};
    scoped={from:client.from.bind(client),rpc:(name,params)=>name==='crm_apply_document_fields'
      ?client.rpc('crm_splav_apply_fields',{...args,selections:params.selections}):client.rpc(name,params)};
    options.markReview=async(_doc,warnings)=>{const result=await client.rpc('crm_splav_mark_review',{...args,warnings});if(result.error)throw result.error;};
  }
  const report = await globalThis.CRMDocumentSync.automate(scoped, documentId, options);
  return {
    state: report.superseded ? 'superseded' : report.needsRecruiter ? 'needs_review' : 'completed',
    auto_filled: report.autoFilled || 0,
    conflict_count: report.rows.filter(row => row.action === 'conflict').length,
    reasons: report.reasons || []
  };
}
