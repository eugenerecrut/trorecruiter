const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const equalSecret=async(a,b)=>{
 const digest=value=>crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
 const [left,right]=await Promise.all([digest(a),digest(b)]);let difference=0;
 const x=new Uint8Array(left),y=new Uint8Array(right);for(let i=0;i<x.length;i++)difference|=x[i]^y[i];return difference===0;
};
export function createWorkerHandler({createClient,env,waitUntil,fetchImpl=fetch,log=()=>{}}){
 return async req=>{
  if(req.method!=='POST')return json(405,{error:'Method not allowed'});
  const supplied=req.headers.get('x-splav-dispatch')||'';
  if(!/^[0-9a-f]{96}$/.test(supplied))return json(403,{error:'Dispatch denied'});
  const url=env('SUPABASE_URL'),publicKey=env('SUPABASE_ANON_KEY')||env('SUPABASE_PUBLISHABLE_KEY'),serviceKey=env('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!publicKey||!serviceKey)return json(503,{error:'Worker unavailable'});
  try{
   // The service client can only retrieve the fixed bootstrap record here.
   // Candidate/document/Storage operations always use the processor's own JWT.
   const bootstrapClient=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
   const bootstrap=await bootstrapClient.rpc('crm_splav_worker_bootstrap');
   if(bootstrap.error||!bootstrap.data||!await equalSecret(supplied,String(bootstrap.data.dispatch_secret||'')))return json(403,{error:'Dispatch denied'});
   if(!bootstrap.data.enabled||!bootstrap.data.has_work)return json(200,{state:'idle'});
   const client=createClient(url,publicKey,{auth:{persistSession:false,autoRefreshToken:false}});
   const signed=await client.auth.signInWithPassword({email:bootstrap.data.email,password:bootstrap.data.password});
   if(signed.error||!signed.data?.session?.access_token)return json(503,{error:'Processor sign-in failed'});
   let claimed=await client.rpc('crm_splav_claim');
   if(claimed.error)return json(503,{error:'Claim failed'});
   if(!claimed.data){claimed=await client.rpc('crm_splav_zone_claim');if(claimed.error)return json(503,{error:'Zonal claim failed'});}
   if(!claimed.data){await client.auth.signOut({scope:'local'});return json(200,{state:'busy_or_idle'});}
   const job=claimed.data;
   const task=(async()=>{
    try{
     const response=await fetchImpl(url+'/functions/v1/'+(job.kind==='zone'?'splav-zone-worker':'process-id-document'),{method:'POST',headers:{Authorization:'Bearer '+signed.data.session.access_token,apikey:publicKey,'Content-Type':'application/json'},
       body:JSON.stringify({...(job.kind==='zone'?{}:{document_id:job.document_id}),job_id:job.id,lease_token:job.lease_token})});
     await response.body?.cancel();
     log({event:'job_response',status:response.status});
     // A completed HTTP response ends this session. Transport ambiguity leaves the
     // lease to recover; it must not revoke a possibly still-running inner worker.
     await client.auth.signOut({scope:'local'});
    }catch{log({event:'job_transport_uncertain'});}
   })();
   waitUntil(task);
   return json(202,{state:'accepted'});
  }catch{return json(503,{error:'Worker temporarily unavailable'});}
 };
}
