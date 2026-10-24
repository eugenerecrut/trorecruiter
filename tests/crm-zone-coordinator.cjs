const {test}=require('node:test'),assert=require('node:assert/strict'),pilot=require('../military-autopilot.js');
const source={document_id:'synthetic-document',file_sha256:'a'.repeat(64),revision:'synthetic-revision'};
const read=async task=>task.mode==='overview'?{zones:[{label:'Запис',box:{x:.1,y:.1,w:.5,h:.2}}]}:{rows:[{fields:[{value:'synthetic',legibility:'clear'}]}]};
test('empty or uncertain fields get one larger context then a durable gap; full-page read is never repeated',async()=>{
 for(const result of [{rows:[],raw_text:'PRIVATE raw transcript'},{rows:[{fields:[{value:' ',legibility:'clear'}]}]},{rows:[{fields:[{value:'x',legibility:'clear',alternatives:['y']}]}]}]){
  const state=pilot.create(1,{source}),calls=[];
  await state.run({read:async task=>{calls.push(task);return task.mode==='overview'?{zones:[{box:{x:.2,y:.2,w:.2,h:.2}}]}:result;}});
  assert.equal(calls.length,3);assert.equal(calls[2].retry,true);assert(calls[2].box.w>calls[1].box.w);assert.equal(state.errors.length,1);
  assert.equal(state.errors[0].code,result.rows.length?'ZONE_FIELDS_UNCERTAIN':'ZONE_NO_READABLE_FIELDS');
  assert(!JSON.stringify(state.snapshot()).includes('PRIVATE'));
  const resumed=pilot.restore(state.snapshot(),{source});await resumed.run({read:async()=>{throw Error('no new reading');}});assert.equal(resumed.errors.length,1);
 }
 const full=pilot.create(1,{source});let calls=0;
 await full.run({read:async task=>{calls++;return task.mode==='overview'?{zones:[{box:{x:0,y:0,w:1,h:1}}]}:{rows:[]};}});
 assert.equal(calls,2);assert.equal(full.errors[0].code,'ZONE_NO_READABLE_FIELDS');
 for(const value of [0,false,'clear text']){
  const state=pilot.create(1,{source});await state.run({read:async task=>task.mode==='overview'?{zones:[{box:{x:0,y:0,w:1,h:1}}]}:{rows:[{fields:[{value,legibility:'clear'}]}]}});assert.equal(state.errors.length,0);
 }
});
test('all distinct valid text and graphic zones survive labels; duplicate geometry is read once',async()=>{
 const state=pilot.create(1,{source}),calls=[],b={x:.1,y:.1,w:.2,h:.2};
 await state.run({read:async task=>{calls.push(task);return task.mode==='overview'?{zones:[{label:'Не порожній запис',box:b},{label:'Same bounds graphic',kind:'other',box:{h:.2,w:.2,y:.1,x:.1}},{kind:'other',box:{x:.5,y:.5,w:.2,h:.2}}]}:{rows:[{fields:[{value:'ok',legibility:'clear'}]}]};}});
 assert.equal(calls.length,3);assert.equal(state.errors.length,0);assert.equal(state.tasks.length,0);
});
test('oversized or invalid overview is explicit and checkpointed without silently losing zones or retrying AI',async()=>{
 for(const [result,code] of [[{zones:Array.from({length:7},(_,i)=>({box:{x:0,y:i/10,w:.1,h:.05}}))},'ZONE_OVERVIEW_TOO_MANY_ZONES'],[{zones:[{box:{x:0,y:0,w:2,h:1}}]},'ZONE_OVERVIEW_INVALID'],[{},'ZONE_OVERVIEW_INVALID']]){
  const state=pilot.create(1,{source});let calls=0;
  await state.run({read:async()=>{calls++;return result;}});
  assert.equal(calls,1);assert.equal(state.snapshot().errors[0].code,code);assert.equal(state.tasks.length,0);
  const resumed=pilot.restore(state.snapshot(),{source});await resumed.run({read:async()=>{calls++;return result;}});assert.equal(calls,1);assert.equal(resumed.errors[0].code,code);
 }
});
test('cold restoration continues exactly the same planner and preserves total budget',async()=>{
 const whole=pilot.create(3,{source}),full=[];await whole.run({read:async t=>{full.push(t);return read(t);}});
 const first=pilot.create(3,{source}),split=[],saved=[];
 await first.run({read:async t=>{split.push(t);return read(t);},limit:2,checkpoint:async s=>saved.push(s)});
 const resumed=pilot.restore(saved.at(-1),{source});
 await resumed.run({read:async t=>{split.push(t);return read(t);}});
 assert.deepEqual(split,full);assert.deepEqual(resumed.snapshot(),whole.snapshot());
 assert.equal(resumed.snapshot().attempts,6);assert.equal(resumed.tasks.length,0);
});
test('a failed pre-dispatch checkpoint makes no reader call',async()=>{
 const state=pilot.create(1,{source});let calls=0;
 await assert.rejects(state.run({read:async()=>{calls++;return{};},checkpoint:async()=>{throw Error('storage offline');}}),/storage offline/);
 assert.equal(calls,0);assert.equal(state.snapshot().attempts,0);assert.equal(state.running,false);
});
test('a failed post-read checkpoint is flushed in memory without repeating the reader',async()=>{
 const state=pilot.create(1,{source});let calls=0,fail=true;
 const checkpoint=async(s,event)=>{if(event.phase==='after_step'&&fail)throw Error('lost acknowledgement');};
 await assert.rejects(state.run({read:async()=>{calls++;return {zones:[]};},checkpoint}),/lost acknowledgement/);
 assert.equal(calls,1);assert(state.snapshot().in_flight);
 fail=false;await state.run({read:async()=>{throw Error('must not read again');},checkpoint,limit:0});
 assert.equal(state.tasks.length,0);assert.equal(state.snapshot().completed,1);assert.equal(calls,1);
});
test('a persisted in-flight step blocks speculative AI after a process restart',async()=>{
 const state=pilot.create(1,{source});let persisted;
 await assert.rejects(state.run({read:async()=>({zones:[]}),checkpoint:async(s,event)=>{
  if(event.phase==='before_dispatch')persisted=s;else throw Error('process terminated');
 }}));
 const resumed=pilot.restore(persisted,{source});let calls=0;
 const result=await resumed.run({read:async()=>{calls++;return{};}});
 assert.equal(result.blocked,true);assert.equal(calls,0);assert.deepEqual(resumed.snapshot(),persisted);
});
test('a saved successful response resolves in-flight work with zero new reader calls',async()=>{
 const state=pilot.create(1,{source});let persisted;
 await assert.rejects(state.run({read:async()=>({zones:[]}),checkpoint:async(s,event)=>{
  if(event.phase==='before_dispatch')persisted=s;else throw Error('process terminated');
 }}));
 const resumed=pilot.restore(persisted,{source});let calls=0;
 const result=await resumed.run({read:async()=>{calls++;return{};},resolveInFlight:async()=>({state:'completed',result:{zones:[]}})});
 assert.equal(result.done,true);assert.equal(result.recovered,1);assert.equal(calls,0);
 assert.equal(resumed.snapshot().attempts,1);assert.equal(resumed.snapshot().completed,1);
});
test('a recovered failure cannot claim a safe paid retry',async()=>{
 const s=pilot.create(1,{source});let persisted;
 await assert.rejects(s.run({read:async()=>({zones:[]}),checkpoint:async(v,e)=>{if(e.phase==='before_dispatch')persisted=v;else throw Error('stop');}}));
 const resumed=pilot.restore(persisted,{source});
 await resumed.run({read:async()=>{throw Error('must not dispatch');},resolveInFlight:async()=>({state:'failed',error:{message:'uncertain',code:'ZONE_RESULT_UNCERTAIN',safe_to_retry:true}})});
 assert.equal(resumed.tasks.length,0);assert.equal(resumed.errors.length,1);assert.equal(resumed.errors[0].automatic_retry,false);
});
test('restored budgets cannot be reset by starting another invocation',async()=>{
 const state=pilot.create(3,{source,budget:1});let calls=0;
 await state.run({read:async()=>{calls++;return{zones:[]};}});
 const resumed=pilot.restore(state.snapshot(),{source});
 const result=await resumed.run({read:async()=>{calls++;return{zones:[]};}});
 assert.equal(calls,1);assert.equal(result.budget_exhausted,true);assert.equal(resumed.tasks.length,2);
});
test('source mismatch, invalid tasks, malformed budgets and extra sensitive fields are rejected',()=>{
 const snapshot=pilot.create(1,{source}).snapshot();
 assert.throws(()=>pilot.restore(snapshot,{source:{...source,file_sha256:'b'.repeat(64)}}),/іншому джерелу/);
 for(const mutate of [s=>s.budget=Infinity,s=>s.pages=201,s=>s.tasks[0].page=2,s=>s.in_flight={mode:'overview',page:1},s=>s.secret='must not store',s=>s.source.token='must not store']){
  const copy=structuredClone(snapshot);mutate(copy);assert.throws(()=>pilot.restore(copy,{source}));
 }
 for(const pages of [0,-1,201,1.5,NaN])assert.throws(()=>pilot.create(pages));
});
test('snapshots contain workflow metadata and codes, never OCR results or raw error messages',async()=>{
 const state=pilot.create(1,{source});await state.run({read:async()=>{throw Error('private synthetic content');}});
 assert(!JSON.stringify(state.snapshot()).includes('private synthetic content'));
 assert.equal(state.snapshot().errors[0].code,'ZONE_STEP_FAILED');
 const snapshot=state.snapshot();snapshot.tasks.push({mode:'overview',page:1});assert.equal(state.tasks.length,0);
});
