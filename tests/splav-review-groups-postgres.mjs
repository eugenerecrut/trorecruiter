import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {groupReviewIssues,openRouterReviewSuggest} from '../supabase/functions/_shared/case-review-shadow.mjs';

test('PostgreSQL persists only complete review groups with shared evidence',async()=>{
 const require=createRequire(new URL('./sql-runtime/package.json',import.meta.url));
 const modulePath=process.env.SPLAV_PGLITE_MODULE;
 const {PGlite}=modulePath?await import(pathToFileURL(modulePath).href):require('@electric-sql/pglite');
 const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create schema crm_private;
   create table crm_private.splav_jobs(id uuid primary key,result jsonb);
   create function public.crm_splav_zone_step(p_job uuid,p_token uuid,p_operation text,p_data jsonb) returns jsonb
   language plpgsql security definer set search_path='' as $$
   declare j crm_private.splav_jobs;comparison jsonb;
   begin
    select * into j from crm_private.splav_jobs where id=p_job;
    comparison:=p_data->'crosscheck';
    update crm_private.splav_jobs set result=coalesce(result,'{}'::jsonb)||jsonb_build_object('crosscheck',comparison) where id=j.id;
    return comparison;
   end $$;`);
  const migration=await readFile(new URL('../supabase/migrations/20261111142236_splav_persist_review_groups.sql',import.meta.url),'utf8');
  await db.exec(migration);
  const id='00000000-0000-0000-0000-000000000001';
  const issues=[{key:'full_name',status:'conflict',source_ids:['a']},{key:'full_name',status:'needs_review',source_ids:['a','b']},{key:'education_records',status:'needs_review',source_ids:['a']}];
  const stub=[{items:[0,1],action:'check_identity'},{items:[2],action:'compare_sources'}];
  const live=process.env.SPLAV_PGLITE_USE_OLLAMA==='1';
  const suggest=live?openRouterReviewSuggest(k=>({SPLAV_REVIEW_SHADOW:'1',SPLAV_REVIEW_SHADOW_MODEL:'qwen2.5:7b',OPENROUTER_API_KEY:'local'})[k],
   (_url,{body})=>fetch('http://127.0.0.1:11434/v1/chat/completions',{method:'POST',redirect:'error',signal:AbortSignal.timeout(90000),headers:{'Content-Type':'application/json'},body}))
   :async()=>stub;
  const proposed=await groupReviewIssues(issues,suggest);
  assert.equal(proposed?.group_count,2);
  const valid=proposed.groups;
  const context=vm.createContext({window:{}});
  vm.runInContext(await readFile(new URL('../military-zone-review.js',import.meta.url),'utf8'),context);
  const readGroups=context.window.CRMMilitaryZoneReview.savedReviewGroups;
  for(const [rows,groups,accepted] of [[issues,valid,true],[issues,[{items:[0,2],action:'check_identity'},{items:[1],action:'check_identity'}],false],
   [issues,[{items:[0,0],action:'check_identity'},{items:[2],action:'compare_sources'}],false],[issues,undefined,false],
   [issues.map((r,i)=>i===0?{...r,source_ids:['different']}:r),valid,false]]){
   await db.query("insert into crm_private.splav_jobs values ($1,'{}') on conflict(id) do update set result='{}'",[id]);
   const crosscheck={status:'needs_review',issues:rows};
   await db.query("select public.crm_splav_zone_step($1,$1,'final',$2::jsonb)",[id,JSON.stringify({crosscheck,review_groups:groups})]);
   const [{result}]=(await db.query('select result from crm_private.splav_jobs where id=$1',[id])).rows;
   assert.deepEqual(result.crosscheck,crosscheck);
   assert.deepEqual(result.review_shadow,accepted?{original_count:3,group_count:2,groups}:undefined);
   const saved={saved_at:'synthetic',status:'complete_with_gaps'};
   const displayed=readGroups({_detailed:true,state:'needs_review',zone_summary:{},result:{...saved,...result}},saved);
   if(accepted)assert.equal(Array.from(displayed).flat().map(row=>row.number).sort().join(','),'1,2,3');
   else assert.equal(displayed,null);
  }
 }finally{await db.close();}
});
