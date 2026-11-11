import {groupReviewIssues,openRouterReviewSuggest} from '../supabase/functions/_shared/case-review-shadow.mjs';

// Explicit one-off smoke test; never reads CRM or candidate data.
const local=process.argv.includes('--ollama');
const suggest=local
 ?openRouterReviewSuggest(key=>({SPLAV_REVIEW_SHADOW:'1',SPLAV_REVIEW_SHADOW_MODEL:process.env.SPLAV_REVIEW_SHADOW_MODEL||'qwen2.5:7b',OPENROUTER_API_KEY:'local'})[key],
  (_url,{body})=>fetch('http://127.0.0.1:11434/v1/chat/completions',{method:'POST',redirect:'error',signal:AbortSignal.timeout(90000),headers:{'Content-Type':'application/json'},body}))
 :openRouterReviewSuggest(key=>key==='SPLAV_REVIEW_SHADOW'?'1':process.env[key]);
if(!suggest){
 console.error('Set OPENROUTER_API_KEY and SPLAV_REVIEW_SHADOW_MODEL in the local environment.');
 process.exitCode=2;
}else{
 const related=[
  {key:'full_name',status:'conflict',source_ids:['synthetic-a']},
  {key:'full_name',status:'needs_review',source_ids:['synthetic-a']},
  {key:'education_records',status:'needs_review'}
 ];
 const independent=[
  {key:'birth_place',status:'conflict'},
  {key:'work_records',status:'needs_review'},
  {key:'education_records',status:'conflict'}
 ];
 const cases=process.argv.includes('--independent')?[['independent',independent,result=>result===null||result.group_count===3]]:
  [['related',related,result=>result?.groups.some(g=>g.items.length===2&&g.items.includes(0)&&g.items.includes(1))&&
   result.groups.some(g=>g.items.length===1&&g.items[0]===2)]];
 for(const [name,issues,validate] of cases){
  let modelReplied=false;
  const start=performance.now(),result=await groupReviewIssues(issues,async input=>{
   const answer=await suggest(input);modelReplied=Array.isArray(answer);return answer;
  }),accepted=modelReplied&&!!validate(result);
  console.log(JSON.stringify({name,accepted,model_replied:modelReplied,elapsed_ms:Math.round(performance.now()-start),result}));
  if(!accepted)process.exitCode=1;
 }
}
