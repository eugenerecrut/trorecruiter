// Internal orchestration. No HTTP entrypoint and no fallback to the shared queue.
import {readBoundedPDF} from './pdf-raster.js';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
const MAX_BYTES=20_000_000;
const validPath=path=>typeof path==='string'&&!!path&&!/[\\:?#%\x00-\x1f]/.test(path)&&
 !path.split('/').some(p=>!p||p==='.'||p==='..');
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
