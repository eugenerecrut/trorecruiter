// Internal orchestration. No HTTP entrypoint and no fallback to the shared queue.
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
const MAX_BYTES=20_000_000;
export async function runIsolatedStep({scope,authorizeSource,readSource,claim,check,execute,now=Date.now}){
 const {rootId,jobId,documentId,executorId,sha256}=scope||{};
 if(![rootId,jobId,documentId,executorId].every(uuid)||!/^[a-f0-9]{64}$/.test(sha256||''))return {state:'denied'};
 const sourceDeadline=Date.parse(await authorizeSource(scope))-now();
 if(!Number.isFinite(sourceDeadline)||sourceDeadline<1)return {state:'denied'};
 // The adapter returns bounded bytes, never a URL reusable by the caller.
 const sourceSignal=AbortSignal.timeout(Math.max(1,Math.min(60_000,Math.floor(sourceDeadline))));
 const bytes=await readSource(scope,sourceSignal);
 if(sourceSignal.aborted)return {state:'denied'};
 if(!(bytes instanceof Uint8Array)||bytes.length===0||bytes.length>MAX_BYTES)return {state:'denied'};
 const digest=hex(await crypto.subtle.digest('SHA-256',bytes));
 if(digest!==sha256)return {state:'denied'};
 const lease=await claim({...scope,sha256:digest});
 if(!uuid(lease))return {state:'denied'};
 const deadline=Date.parse(await check({...scope,lease}));
 const remaining=deadline-now();
 if(!Number.isFinite(remaining)||remaining<1)return {state:'denied'};
 const signal=AbortSignal.timeout(Math.max(1,Math.min(60_000,Math.floor(remaining))));
 return execute({scope,lease,bytes,signal});
}
