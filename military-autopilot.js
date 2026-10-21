// Bounded, resumable document reader. No data writes or candidate decisions.
(function(root){
'use strict';
function create(pages){const tasks=Array.from({length:Math.min(200,pages)},(_,i)=>({mode:'overview',page:i+1})),errors=[];let stopped=false,running=false;
 return {tasks,errors,stop(){stopped=true;},get running(){return running;},async run({read,show,limit=Infinity}){
  if(running)return;running=true;stopped=false;let calls=0;
  try{while(tasks.length&&!stopped&&calls<limit){const task=tasks[0];show?.({page:task.page,pending:tasks.length,calls,limit});let result;
   try{result=await read(task);if(!result)throw Error('Немає результату читання');calls++;}catch(error){tasks.shift();if(!task.transport_retry)tasks.unshift({...task,transport_retry:true});else errors.push({page:task.page,mode:task.mode,error:error.message});show?.({error:error.message,page:task.page,pending:tasks.length,calls:++calls,limit});continue;}
   tasks.shift();
   if(task.mode==='overview'){
    const zones=(result.zones||[]).filter(z=>z.box&&!/empty|blank|порожн/iu.test([z.label,z.reason].join(' '))).slice(0,6);
    tasks.unshift(...zones.map(z=>({mode:'zone',page:task.page,box:z.box})));
   }else if(!task.retry&&(result.rows||[]).some(r=>(r.fields||[]).some(f=>f.value===null||f.legibility!=='clear'))){
    const b=task.box||{x:0,y:0,w:1,h:1},x=Math.max(0,b.x-b.w*.15),y=Math.max(0,b.y-b.h*.15);
    tasks.unshift({...task,retry:true,box:{x,y,w:Math.min(1-x,b.w*1.3),h:Math.min(1-y,b.h*1.3)}});
   }
  }}finally{running=false;show?.({done:tasks.length===0,stopped,pending:tasks.length,calls,limit,errors:[...errors]});}
 }};
}
const api={create};root.CRMMilitaryAutopilot=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
