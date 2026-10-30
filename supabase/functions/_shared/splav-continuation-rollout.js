// Unscoped rollout remains disabled. No request-body overrides.
export const AUTO_ZONE_ROLLOUT_APPROVED = false;
// Deployment-only, exact job/document allowlist for one approved acceptance run.
// Keep null in baseline releases. Never copy user data or credentials here.
export const CONTROLLED_ZONE_RUN = null;
// Only a human queue delegation can opt a new root into this bounded path.
// Authorization is read from the validated lease, never from a request body.
export const AUTHORIZED_ZONE_JOBS_ENABLED = true;
export function continuationRolloutPolicy({jobId,documentId,authorization,globalEnabled=false,control=CONTROLLED_ZONE_RUN,now=Date.now()}) {
  if (AUTO_ZONE_ROLLOUT_APPROVED && globalEnabled) return {enabled:true,maxPages:4};
  const denied={enabled:false,maxPages:0};
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if(AUTHORIZED_ZONE_JOBS_ENABLED&&authorization){
    const a=authorization,start=typeof a.granted_at==='string'?Date.parse(a.granted_at):NaN,end=typeof a.expires_at==='string'?Date.parse(a.expires_at):NaN;
    if(a.contract==='splav-zone-authorization-1'&&typeof jobId==='string'&&typeof documentId==='string'&&uuid.test(jobId)&&uuid.test(documentId)
     &&a.job_id===jobId&&a.document_id===documentId&&a.max_pages===1&&a.budget===13
     &&Number.isFinite(now)&&Number.isFinite(start)&&Number.isFinite(end)&&end>start&&end-start<=86400000&&now>=start&&now<end)return {enabled:true,maxPages:1};
    return {...denied,reason:'zone_authorization_unavailable_or_expired'};
  }
  if (!control || typeof jobId!=='string' || typeof documentId!=='string') return denied;
  if (!uuid.test(jobId)||!uuid.test(documentId)||control.jobId!==jobId||control.documentId!==documentId) return denied;
  const start=Date.parse(control.notBefore),end=Date.parse(control.expiresAt);
  if (!Number.isFinite(now)||!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>86400000||now<start||now>=end) return denied;
  return {enabled:true,maxPages:1};
}
