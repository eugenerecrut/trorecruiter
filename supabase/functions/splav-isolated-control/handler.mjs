import {advanceConfiguredIsolatedRun} from '../_shared/splav-isolated-runner.mjs';

const reply=(body,status)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const digest=s=>crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));
async function equal(a,b){
 const [x,y]=await Promise.all([digest(a),digest(b)]);
 let diff=0;const l=new Uint8Array(x),r=new Uint8Array(y);
 for(let i=0;i<l.length;i++)diff|=l[i]^r[i];
 return diff===0;
}
export function createIsolatedControlHandler({env,withQuery,authenticate,advance=advanceConfiguredIsolatedRun}){
 return async req=>{
  if(req.method!=='POST')return reply({state:'denied'},405);
  const secret=env('SPLAV_ISOLATED_DISPATCH'),supplied=req.headers.get('x-splav-isolated-dispatch')||'';
  if(!/^[a-f0-9]{64}$/.test(secret||'')||!/^[a-f0-9]{64}$/.test(supplied)||!await equal(secret,supplied))return reply({state:'denied'},403);
  if(req.body)return reply({state:'denied'},400);
  const scope={rootId:env('SPLAV_ISOLATED_ROOT'),documentId:env('SPLAV_ISOLATED_DOCUMENT'),
   executorId:env('SPLAV_ISOLATED_EXECUTOR'),sha256:env('SPLAV_ISOLATED_SHA256')};
  const projectURL=env('SUPABASE_URL'),publicKey=env('SUPABASE_ANON_KEY')||env('SUPABASE_PUBLISHABLE_KEY');
  if(!projectURL||!publicKey||Object.values(scope).some(v=>!v))return reply({state:'unconfigured'},503);
  try{
   const result=await withQuery(query=>advance({scope,query,projectURL,publicKey,
    authenticate:()=>authenticate({projectURL,publicKey})}));
   return reply(result,200);
  }catch{return reply({state:'interrupted'},503);}
 };
}
