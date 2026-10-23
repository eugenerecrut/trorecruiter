import {readBoundedPDF} from '../_shared/pdf-raster.js';
import {renderPDFZone} from '../_shared/pdf-zone-raster.mjs';
const json=(status,value)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const base64=bytes=>{let out='';for(let i=0;i<bytes.length;i+=8192)out+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(out);};
export function createZoneWorker({createClient,env,getLibrary,planner,fetchImpl=fetch}) {
 let busy=false;
 return async req=>{
  if(req.method!=='POST')return json(405,{error:'Method not allowed'});
  const authorization=req.headers.get('authorization'),url=env('SUPABASE_URL'),key=env('SUPABASE_ANON_KEY')||env('SUPABASE_PUBLISHABLE_KEY');
  if(!authorization?.startsWith('Bearer ')||!url||!key)return json(401,{error:'Processor session required'});
  if(busy)return json(429,{error:'Renderer busy'});
  let body;try{
   if(Number(req.headers.get('content-length'))>2000||!req.body)throw Error();
   const reader=req.body.getReader(),chunks=[];let length=0;
   try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>2000){await reader.cancel();throw Error();}chunks.push(value);}}finally{reader.releaseLock();}
   const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}body=JSON.parse(new TextDecoder().decode(bytes));
  }catch{return json(400,{error:'Invalid job'});}
  if(!body||typeof body!=='object'||Array.isArray(body)||!uuid(body.job_id)||!uuid(body.lease_token))return json(400,{error:'Invalid lease'});
  const client=createClient(url,key,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const rpc=async(op,data={})=>{const result=await client.rpc('crm_splav_zone_step',{p_job:body.job_id,p_token:body.lease_token,p_operation:op,p_data:data});if(result.error)throw Error('Zonal operation rejected');return result.data;};
  let context;try{context=await rpc('load');}catch{return json(403,{error:'Zonal lease denied'});}
  if(busy)return json(429,{error:'Renderer busy'});
  busy=true;let structuralFailure=false;
  try{
   if(context.reports_truncated)throw Error('Saved report budget exceeded');
   const state=planner.restore(context.snapshot,{source:context.source});
   const summary=await state.run({limit:1,
    checkpoint:async snapshot=>{context.version=await rpc('save',{version:context.version,snapshot});},
    resolveInFlight:async()=>{
     const saved=context.in_flight_response;
     if(saved?.state==='completed'&&saved.result?.review_only)return saved;
     if(saved?.state==='failed'&&saved.result?.error)return {state:'failed',error:{message:saved.result.error,code:saved.result.code}};
     return null;
    },
    read:async task=>{let dispatched=false;
     try{
      const signed=await client.storage.from('candidate-documents').createSignedUrl(context.document.storage_path,120);
      if(signed.error||!signed.data?.signedUrl)throw Error('Source unavailable');
      const target=new URL(signed.data.signedUrl),backend=new URL(url);
      if(target.origin!==backend.origin||!target.pathname.startsWith('/storage/v1/object/sign/candidate-documents/'))throw Error('Unexpected source destination');
      const original=await fetchImpl(target.href,{signal:AbortSignal.timeout(30000),redirect:'error'});
      if(!original.ok)throw Error('Source unavailable');
      const bytes=await readBoundedPDF(original.body,original.headers.get('content-length'));
      const rendered=await renderPDFZone({bytes,page:task.page,mode:task.mode,box:task.box,
       expected_sha256:context.source.file_sha256,getLibrary});
      if(rendered.metrics.pages!==state.snapshot().pages){structuralFailure=true;throw Error('Source page count changed');}
      dispatched=true;
      const result=await fetchImpl(url+'/functions/v1/ai-military-zone',{method:'POST',headers:{Authorization:authorization,apikey:key,'Content-Type':'application/json'},
       signal:AbortSignal.timeout(120000),body:JSON.stringify({document_id:context.document.id,coordinator_id:context.id,coordinator_version:context.version,
        job_id:body.job_id,lease_token:body.lease_token,mode:task.mode,page:task.page,box:rendered.metrics.box,
        image_data:'data:image/png;base64,'+base64(rendered.png),render_sha256:rendered.metrics.render_sha256})});
      const data=await result.json();
      if(!result.ok||!data?.review_only||data.error){const error=Error('AI step not completed');error.code=data?.code;throw error;}
      return data;
     }catch(error){error.code ||= 'ZONE_PREP_FAILED';if(!dispatched&&!structuralFailure)error.safe_to_retry=true;throw error;}
    }});
   if(structuralFailure){await rpc('hold');return json(200,{state:'needs_review'});}
   if(summary.blocked){await rpc('block');return json(200,{state:'uncertain'});}
   if(summary.budget_exhausted){await rpc('hold');return json(200,{state:'budget_exhausted'});}
   if(summary.done){await rpc('final');return json(200,{state:'finished'});}
   await rpc('yield');return json(200,{state:'queued'});
  }catch{
   // Retry only the leased orchestration. In-flight receipt recovery decides
   // whether a new AI dispatch is permitted; it never speculates after a loss.
   try{await rpc('retry');}catch{/* An expired lease is recovered by the claimant. */}
   return json(503,{error:'Zonal step interrupted; durable state retained'});
  }finally{busy=false;}
 };
}
