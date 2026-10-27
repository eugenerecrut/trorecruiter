import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MODEL,ENDPOINT,validateRelative,checkSecrets,makeRequest,requestProposal} from '../tools/qwen-collaborator.mjs';

test('context paths exclude data, credentials, traversal and unsupported files',()=>{
 for(const name of ['../outside.js','D:\\outside.js','/outside.js','tmp/a.js','backups/a.md','reports/a.md','.env','.env.local','.git/config.js','.aider.chat.history.md','supabase/.temp/a.js','candidate.pdf'])assert.throws(()=>validateRelative(name),name);
 assert.equal(validateRelative('supabase\\functions\\_shared\\sync-runtime.js'),'supabase/functions/_shared/sync-runtime.js');
});
test('known credentials and oversized context stop before a request can be made',()=>{
 assert.throws(()=>checkSecrets('-----BEGIN PRIVATE KEY-----'));
 assert.throws(()=>checkSecrets('sk-proj-'+'x'.repeat(30)));
 assert.throws(()=>makeRequest('x'.repeat(16001),'rules'));
 assert.throws(()=>makeRequest('','rules'));
});
test('curated knowledge is a system message, source is data, model receives no tools',()=>{
 const request=makeRequest('Write a regression test','Use selection.key',[{name:'work-document.js',content:'const x=1;'}]);
 assert.equal(request.model,MODEL);assert.equal(request.messages[0].role,'system');assert.equal(request.messages[0].content,'Use selection.key');
 assert.equal(request.messages[1].role,'user');assert.match(request.messages[1].content,/SOURCE work-document.js/);
 assert.equal(request.tools,undefined);assert.equal(request.options.temperature,0);
});
test('one fixed local request returns an unexecuted proposal and usage',async()=>{
 let calls=0;
 const result=await requestProposal(makeRequest('task','rules'),{fetchImpl:async(url,options)=>{
  calls++;assert.equal(url,ENDPOINT);assert.equal(url,'http://127.0.0.1:11434/api/chat');assert.equal(options.method,'POST');
  assert(options.signal);return {ok:true,json:async()=>({done:true,model:MODEL,message:{content:'proposal'},eval_count:5})};
 }});
 assert.equal(calls,1);assert.equal(result.proposal,'proposal');assert.equal(result.outputTokens,5);
});
test('errors and incomplete responses do not retry or become successful results',async()=>{
 for(const response of [{ok:false,status:503},{ok:true,json:async()=>({done:false,message:{content:'partial'}})},{ok:true,json:async()=>({done:true,message:{content:''}})}]){
  let calls=0;await assert.rejects(requestProposal(makeRequest('task','rules'),{fetchImpl:async()=>{calls++;return response}}));assert.equal(calls,1);
 }
});

test('token-limit termination is rejected even when done and the text looks complete',async()=>{
 for(const content of ['A complete sentence.','const answer = 42;','{"answer":true}','unfinished']){
  let calls=0;
  await assert.rejects(requestProposal(makeRequest('task','rules'),{fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({done:true,done_reason:'length',message:{content}})}}}),/token limit/i);
  assert.equal(calls,1);
 }
});

test('normal and legacy completions do not depend on punctuation',async()=>{
 for(const done_reason of ['stop',undefined])for(const content of ['Complete.','const answer = 42;','{"answer":true}','yes']){
  const result=await requestProposal(makeRequest('task','rules'),{fetchImpl:async()=>({ok:true,json:async()=>({done:true,done_reason,message:{content}})})});
  assert.equal(result.proposal,content);
 }
});
