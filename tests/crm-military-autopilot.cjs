const {test}=require('node:test'),assert=require('node:assert/strict'),pilot=require('../military-autopilot.js');
test('autopilot visits pages, skips empty zones, retries an uncertain region once and resumes budget',async()=>{
 const state=pilot.create(2),calls=[],statuses=[];
 const read=async task=>{calls.push(task);return task.mode==='overview'?{zones:[{label:'Рядок',box:{x:.1,y:.1,w:.3,h:.1}},{label:'Порожня таблиця',box:{x:0,y:0,w:1,h:1}}]}:{rows:[{fields:[{value:null,legibility:'uncertain'}]}]}};
 await state.run({read,limit:2,show:p=>statuses.push(p)});assert.equal(calls.length,2);assert.equal(state.tasks[0].retry,true);assert.equal(state.tasks[0].page,1);
 await state.run({read,limit:10});assert.equal(state.tasks.length,0);assert.equal(calls.length,6);assert.equal(calls.filter(c=>c.retry).length,2);assert(calls[2].box.w>.3);assert.equal(statuses.at(-1).done,false);
});
test('stop pauses after current call; failures remain visible and no infinite retry occurs',async()=>{
 const p=pilot.create(2);let count=0;await p.run({read:async()=>{count++;p.stop();return{zones:[]}}});assert.equal(count,1);assert.equal(p.tasks.length,1);
 let last;await p.run({read:async()=>{throw Error('offline')},show:s=>last=s});assert.equal(p.errors.length,1);assert.equal(last.errors[0].error,'offline');assert.equal(last.done,true);
});
