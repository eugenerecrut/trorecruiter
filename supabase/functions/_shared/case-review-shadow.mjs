// Send only enumerated issue metadata. No document text, values or source IDs.
const fields=new Set(['full_name','birth_date','birth_place','rnokpp','education_records','work_records','military_service','relatives','document']);
const actions=new Set(['check_identity','compare_sources','check_dates','review_document']);
export async function groupReviewIssues(issues, suggest) {
 if(!Array.isArray(issues)||issues.length<2||issues.length>24||typeof suggest!=='function')return null;
 const input=issues.map((issue,i)=>({i,field:fields.has(issue.key)?issue.key:'other',kind:issue.status==='conflict'?'conflict':'needs_review'}));
 try{
  const groups=await suggest(input);
  if(!Array.isArray(groups)||groups.length<1||groups.length>issues.length)return null;
  const seen=new Set();
  for(const group of groups){
   if(!group||Object.keys(group).length!==2||!actions.has(group.action)||!Array.isArray(group.items)||!group.items.length)return null;
   for(const i of group.items){
    if(!Number.isInteger(i)||i<0||i>=issues.length||seen.has(i))return null;
    seen.add(i);
   }
   // Require a known field and at least one source common to the entire group.
   // Source IDs stay in the worker; the model receives only issue metadata.
   if(group.items.length>1){
    const [first,...rest]=group.items,field=input[first].field;
    const sources=i=>Array.isArray(issues[i].source_ids)?issues[i].source_ids:[];
    if(field==='other'||rest.some(i=>input[i].field!==field)||
     !sources(first).some(id=>typeof id==='string'&&id&&rest.every(i=>sources(i).includes(id))))return null;
   }
  }
  if(seen.size!==issues.length)return null;
  return {original_count:issues.length,group_count:groups.length,groups};
 }catch{return null;}
}

export function openRouterReviewSuggest(env, fetchImpl=fetch) {
 const model=env('SPLAV_REVIEW_SHADOW_MODEL'),key=env('OPENROUTER_API_KEY');
 if(env('SPLAV_REVIEW_SHADOW')!=='1'||!model||!key)return undefined;
 return async items=>{
  const response=await fetchImpl('https://openrouter.ai/api/v1/chat/completions',{
   method:'POST',redirect:'error',signal:AbortSignal.timeout(4000),
   headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
   body:JSON.stringify({model,max_tokens:450,temperature:0,response_format:{type:'json_object'},messages:[
    {role:'system',content:'Group only clearly related review issues. Keep unrelated issues separate. Return JSON object with groups array of {items: integer index array, action: check_identity | compare_sources | check_dates | review_document}. Include every index exactly once.'},
    {role:'user',content:JSON.stringify(items)}
   ]})
  });
  if(!response.ok)throw Error('Review model unavailable');
  return JSON.parse((await response.json()).choices[0].message.content).groups;
 };
}
