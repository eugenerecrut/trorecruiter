// Internal orchestration. No HTTP entrypoint and no fallback to the shared queue.
import {readBoundedPDF} from './pdf-raster.js';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
const MAX_BYTES=20_000_000;
const validPath=path=>typeof path==='string'&&!!path&&!/[\\:?#%\x00-\x1f]/.test(path)&&
 !path.split('/').some(p=>!p||p==='.'||p==='..');
// Use only a trusted server-side database connection. Never expose these
// statements as browser RPCs or accept an executor identity from a request.
export function createIsolatedPermitStore(query){
 if(typeof query!=='function')throw Error('Server database query required');
 const params=s=>[s.rootId,s.jobId,s.documentId,s.sha256,s.executorId];
 const runParams=s=>[s.rootId,s.documentId,s.sha256,s.executorId];
 const value=async(sql,args)=>(await query(sql,args)).rows[0]?.value??null;
 return {
  authorizeSource:s=>value('select crm_splav_dispatch.source($1,$2,$3,$4,$5) as value',params(s)),
  claim:s=>value('select crm_splav_dispatch.claim($1,$2,$3,$4,$5) as value',params(s)),
  check:s=>value('select crm_splav_dispatch.step_deadline($1,$2,$3,$4,$5,$6)::text as value',[...params(s),s.lease]),
  next:s=>value('select crm_splav_dispatch.next($1,$2,$3,$4) as value',runParams(s)),
  closeTerminal:s=>value('select crm_splav_dispatch.close_terminal($1,$2,$3,$4) as value',runParams(s))
 };
}
export function createIsolatedStorageReader({projectURL,publicKey,processorJWT,fetchImpl=fetch}){
 const project=new URL(projectURL);
 if(project.protocol!=='https:'||project.username||project.password||project.pathname!=='/'||project.search||project.hash||
  !publicKey||!processorJWT)throw Error('Invalid isolated Storage configuration');
 return async(path,signal)=>{
  if(!validPath(path)||!signal||signal.aborted)return null;
  const endpoint=project.origin+'/storage/v1/object/authenticated/candidate-documents/'+path.split('/').map(encodeURIComponent).join('/');
  const response=await fetchImpl(endpoint,{redirect:'error',signal,headers:{apikey:publicKey,Authorization:'Bearer '+processorJWT}});
  if(!response.ok){await response.body?.cancel();return null;}
  return readBoundedPDF(response.body,response.headers.get('content-length'));
 };
}
// Dispatch the already leased job directly. This never calls the scheduler or
// a generic claim endpoint. The target must still enforce the permit server-side.
export function createIsolatedStepDispatcher({projectURL,publicKey,processorJWT,fetchImpl=fetch}){
 const project=new URL(projectURL);
 if(project.protocol!=='https:'||project.username||project.password||project.pathname!=='/'||project.search||project.hash||
  !publicKey||!processorJWT)throw Error('Invalid isolated dispatch configuration');
 return async({scope,lease,signal})=>{
  const {rootId,jobId,documentId}=scope||{};
  if(![rootId,jobId,documentId,lease].every(uuid)||!signal||signal.aborted)return {state:'denied'};
  const root=jobId===rootId;
  const response=await fetchImpl(project.origin+'/functions/v1/'+(root?'process-id-document':'splav-zone-worker'),{
   method:'POST',redirect:'error',signal,
   headers:{'Content-Type':'application/json',apikey:publicKey,Authorization:'Bearer '+processorJWT},
   body:JSON.stringify({job_id:jobId,lease_token:lease,...(root?{document_id:documentId}:{})})
  });
  await response.body?.cancel();
  return {state:response.ok?'responded':'rejected',status:response.status};
 };
}
// Configuration comes from the server, never from a request body. Authenticate
// the dedicated processor independently before constructing the Storage client.
export async function runConfiguredIsolatedStep({scope,query,authenticate,projectURL,publicKey,fetchImpl=fetch,now=Date.now}){
 const fixed=Object.freeze({...scope});
 if(![fixed.rootId,fixed.jobId,fixed.documentId,fixed.executorId].every(uuid)||!/^[a-f0-9]{64}$/.test(fixed.sha256||''))return {state:'denied'};
 const session=await authenticate();
 if(session?.userId!==fixed.executorId||typeof session.jwt!=='string'||!session.jwt)return {state:'denied'};
 const config={projectURL,publicKey,processorJWT:session.jwt,fetchImpl};
 return runIsolatedStep({scope:fixed,now,...createIsolatedPermitStore(query),
  readSource:createIsolatedStorageReader(config),execute:createIsolatedStepDispatcher(config)});
}
// Single invocation takes at most one step. A running job is never stolen.
export async function advanceConfiguredIsolatedRun(config){
 const fixed=Object.freeze({...config.scope});
 if(![fixed.rootId,fixed.documentId,fixed.executorId].every(uuid)||!/^[a-f0-9]{64}$/.test(fixed.sha256||''))return {state:'denied'};
 const store=createIsolatedPermitStore(config.query),next=await store.next(fixed);
 if(next?.state!=='queued'){
  const closed=await store.closeTerminal(fixed);
  return {state:closed?'closed':next?.state==='running'?'running':'denied'};
 }
 const result=await runConfiguredIsolatedStep({...config,scope:{...fixed,jobId:next.job_id}});
 return {...result,closed:await store.closeTerminal(fixed)};
}
export async function runIsolatedStep({scope,authorizeSource,readSource,claim,check,execute,now=Date.now}){
 const {rootId,jobId,documentId,executorId,sha256}=scope||{};
 if(![rootId,jobId,documentId,executorId].every(uuid)||!/^[a-f0-9]{64}$/.test(sha256||''))return {state:'denied'};
 const source=await authorizeSource(scope);
 const sourceDeadline=Date.parse(source?.deadline)-now();
 if(!Number.isFinite(sourceDeadline)||sourceDeadline<1)return {state:'denied'};
 if(!validPath(source.path))return {state:'denied'};
 const lease=await claim(scope);
 if(!uuid(lease))return {state:'denied'};
 const readDeadline=Math.min(Date.parse(source.deadline),Date.parse(await check({...scope,lease})))-now();
 if(!Number.isFinite(readDeadline)||readDeadline<1)return {state:'denied'};
 // The adapter returns bounded bytes, never a URL reusable by the caller.
 const sourceSignal=AbortSignal.timeout(Math.max(1,Math.min(60_000,Math.floor(readDeadline))));
 const bytes=await readSource(source.path,sourceSignal);
 if(sourceSignal.aborted)return {state:'denied'};
 if(!(bytes instanceof Uint8Array)||bytes.length===0||bytes.length>MAX_BYTES)return {state:'denied'};
 const digest=hex(await crypto.subtle.digest('SHA-256',bytes));
 if(digest!==sha256)return {state:'denied'};
 const deadline=Date.parse(await check({...scope,lease}));
 const remaining=deadline-now();
 if(!Number.isFinite(remaining)||remaining<1)return {state:'denied'};
 const signal=AbortSignal.timeout(Math.max(1,Math.min(60_000,Math.floor(remaining))));
 return execute({scope,lease,bytes,signal});
}
