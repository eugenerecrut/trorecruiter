import {test} from 'node:test';
import assert from 'node:assert/strict';
import {exercises,exerciseTask,grade} from '../tools/qwen-exercises.mjs';
import {loadKnowledge,makeRequest,KNOWLEDGE_VERSION} from '../tools/qwen-collaborator.mjs';

test('diagnostic grades exact primitive answers, not self-reported success',()=>{
 const correct=Object.fromEntries(exercises.map(e=>[e.id,e.expected]));
 assert.equal(grade(JSON.stringify(correct)).passed,9);
 const wrong={...correct,selection_property:'field',target_conflict:true};
 const score=grade(JSON.stringify(wrong));assert.equal(score.passed,7);assert.deepEqual(score.failures,['selection_property','target_conflict']);
 for(const data of ['Success!','[]','null','{"score":9}'])assert.equal(grade(data).valid,false);
 assert.equal(grade('{}').passed,0);
 assert.equal(grade(JSON.stringify({...correct,repeat_period:'0'})).passed,8);
});
test('exercise prompts do not contain the answer key; actual regex expectations are executable',()=>{
 assert(!exerciseTask().includes('expected'));
 assert.equal(exercises.find(e=>e.id==='passport_regex').expected,/паспорт/iu.test('Копія паспорта/ID Картки'));
 assert.equal(exercises.find(e=>e.id==='marriage_regex').expected,/шлюб/iu.test('Копія свідоцтва про шлюб'));
});
test('both curated memory files fit the diagnostic request and are loaded automatically',async()=>{
 assert.equal(KNOWLEDGE_VERSION,'2');const knowledge=await loadKnowledge();
 assert.match(knowledge,/Verified CRM examples/);assert.match(knowledge,/selection\.key/);
 assert.doesNotThrow(()=>makeRequest(exerciseTask(),knowledge));
});
