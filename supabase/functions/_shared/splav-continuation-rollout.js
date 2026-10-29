// Global rollout stays off until live acceptance. No request-body overrides.
export const AUTO_ZONE_ROLLOUT_APPROVED = false;
// Deployment-only, exact job/document allowlist for one approved acceptance run.
// Keep null in baseline releases. Never copy user data or credentials here.
export const CONTROLLED_ZONE_RUN = null;
export function continuationRolloutPolicy({jobId,documentId,globalEnabled=false,control=CONTROLLED_ZONE_RUN,now=Date.now()}) {
  if (AUTO_ZONE_ROLLOUT_APPROVED && globalEnabled) return {enabled:true,maxPages:4};
  const denied={enabled:false,maxPages:0};
  if (!control || typeof jobId!=='string' || typeof documentId!=='string') return denied;
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(jobId)||!uuid.test(documentId)||control.jobId!==jobId||control.documentId!==documentId) return denied;
  const start=Date.parse(control.notBefore),end=Date.parse(control.expiresAt);
  if (!Number.isFinite(now)||!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>86400000||now<start||now>=end) return denied;
  return {enabled:true,maxPages:1};
}
