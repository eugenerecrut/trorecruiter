const {test}=require('node:test'),assert=require('node:assert/strict'),pilot=require('../military-autopilot.js');
test('autopilot visits pages, skips empty zones, retries an uncertain region once and resumes budget',async()=>{
 const state=pilot.create(2),calls=[],statuses=[];
 const read=async task=>{calls.push(task);return task.mode==='overview'?{zones:[{label:'Рядок',box:{x:.1,y:.1,w:.3,h:.1}},{label:'Порожня таблиця',box:{x:0,y:0,w:1,h:1}}]}:{rows:[{fields:[{value:null,legibility:'uncertain'}]}]}};
 await state.run({read,limit:2,show:p=>statuses.push(p)});assert.equal(calls.length,2);assert.equal(state.tasks[0].retry,true);assert.equal(state.tasks[0].page,1);
 await state.run({read,limit:10});assert.equal(state.tasks.length,0);assert.equal(calls.length,6);assert.equal(calls.filter(c=>c.retry).length,2);assert(calls[2].box.w>.3);assert.equal(statuses.at(-1).done,false);
});
test('stop pauses after current call; failures remain visible and no infinite retry occurs',async()=>{
 const p=pilot.create(2);let count=0;await p.run({read:async()=>{count++;p.stop();return{zones:[]}}});assert.equal(count,1);assert.equal(p.tasks.length,1);
 let last;await p.run({read:async()=>{throw Object.assign(Error('offline'),{safe_to_retry:true})},show:s=>last=s});assert.equal(p.errors.length,1);assert.equal(last.errors[0].error,'offline');assert.equal(last.done,true);
});

 test('one default run crosses the old 12-step boundary and finishes all pages without confirmation',async()=>{
  const p=pilot.create(16);let calls=0;await p.run({read:async task=>{calls++;return task.mode==='overview'?{zones:[{label:'Текст',box:{x:0,y:0,w:1,h:1}}]}:{rows:[{fields:[{value:'читабельно',legibility:'clear'}]}]}}});assert.equal(calls,32);assert.equal(p.tasks.length,0);
 });

test('uncertain paid requests and malformed results are never automatically repeated',async()=>{
 for(const error of [Error('network lost'),Object.assign(Error('unknown result'),{code:'ZONE_RESULT_UNCERTAIN'}),null]){
  const state=pilot.create(1);let calls=0;
  await state.run({read:async()=>{calls++;if(error)throw error;return null;}});
  assert.equal(calls,1);assert.equal(state.tasks.length,0);assert.equal(state.errors.length,1);
  assert.equal(state.errors[0].automatic_retry,false);
 }
});

test('explicit pre-dispatch failure retries once; successful pages continue after an uncertain step',async()=>{
 const state=pilot.create(2);let calls=0;
 await state.run({read:async task=>{calls++;if(task.page===1)throw Object.assign(Error('local render failed'),{safe_to_retry:true});return {zones:[]};}});
 assert.equal(calls,3);assert.equal(state.errors.length,1);assert.equal(state.errors[0].page,1);
});
