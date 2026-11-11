import {test} from 'node:test';
import assert from 'node:assert/strict';
import {groupReviewIssues,openRouterReviewSuggest} from '../supabase/functions/_shared/case-review-shadow.mjs';

const issues=[
 {key:'full_name',status:'conflict',source_ids:['private-source']},
 {key:'full_name',status:'needs_review',value:'private-name',source_ids:['private-source']},
 {key:'birth_date',status:'conflict'}
];
const groups=[{items:[0,1],action:'check_identity'},{items:[2],action:'check_dates'}];
test('pilot groups related issues without sending evidence or altering originals',async()=>{
 const before=structuredClone(issues);
 const result=await groupReviewIssues(issues,async input=>{
  assert(!JSON.stringify(input).includes('private-'));
  return groups;
 });
 assert.deepEqual(result,{original_count:3,group_count:2,groups});
 assert.deepEqual(issues,before);
});
test('missing, duplicated, invented and unparseable items fall back to original list',async()=>{
 for(const items of [[0,1],[0,1,1],[0,1,2,3]])assert.equal(await groupReviewIssues(issues,async()=>[{items,action:'check_identity'}]),null);
 assert.equal(await groupReviewIssues(issues,async()=>{throw Error('unavailable');}),null);
});
test('provider is opt-in and request only carries the allowed metadata',async()=>{
 const config={SPLAV_REVIEW_SHADOW_MODEL:'test-model',OPENROUTER_API_KEY:'test-key'};
 const env=k=>config[k];
 assert.equal(openRouterReviewSuggest(env),undefined);
 config.SPLAV_REVIEW_SHADOW='1';
 const suggest=openRouterReviewSuggest(env,async(_url,req)=>{
  assert(!req.body.includes('private-'));
  return Response.json({choices:[{message:{content:JSON.stringify({groups})}}]});
 });
 assert.equal((await groupReviewIssues(issues,suggest)).group_count,2);
});
test('model cannot merge questions about different fields',async()=>{
 assert.equal(await groupReviewIssues(issues,async()=>[{items:[0,2],action:'check_identity'},{items:[1],action:'compare_sources'}]),null);
});
test('same field cannot merge issues without one common source across the group',async()=>{
 const separate=[['a'],['a','b'],['b']].map(source_ids=>({key:'full_name',status:'conflict',source_ids}));
 assert.equal(await groupReviewIssues(separate,async()=>[{items:[0,1,2],action:'check_identity'}]),null);
});
