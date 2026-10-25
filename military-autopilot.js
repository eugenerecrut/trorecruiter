// Shared browser/server coordinator. Persistence and authorization belong to its adapter.
(function(root){
'use strict';
const VERSION=1,MAX_STEPS=2600,copy=value=>JSON.parse(JSON.stringify(value));
const integer=(n,max)=>Number.isSafeInteger(n)&&n>=0&&n<=max;
function sourceBinding(value){
 if(value==null)return null;
 if(typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['document_id','file_sha256','revision'].includes(k))||
  typeof value.document_id!=='string'||!value.document_id||value.document_id.length>128||
  !/^[a-f0-9]{64}$/.test(value.file_sha256||'')||typeof value.revision!=='string'||!value.revision||value.revision.length>128)throw Error('Некоректне джерело координатора');
 return {document_id:value.document_id,file_sha256:value.file_sha256,revision:value.revision};
}
function validBox(b){return b&&typeof b==='object'&&!Array.isArray(b)&&Object.keys(b).length===4&&
 ['x','y','w','h'].every(k=>typeof b[k]==='number'&&Number.isFinite(b[k])&&b[k]>=0&&b[k]<=1)&&b.w>0&&b.h>0&&b.x+b.w<=1.000001&&b.y+b.h<=1.000001;}
function nativeReadingPlan(zones,{documentType='',nativeOnly=false,singlePageControl=false}={}){
 const originals=copy(Array.isArray(zones)?zones:[]);
 const eligible=singlePageControl&&!nativeOnly&&documentType==='Автобіографія друкована'&&originals.length>=2&&originals.length<=6&&
  originals.every(z=>z?.kind==='text'&&validBox(z.box));
 if(!eligible)return {zones:originals};
 return {zones:[{label:'Автобіографія · уся сторінка',kind:'text',box:{x:0,y:0,w:1,h:1},reason:'Один прохід усієї сторінки зберігає заголовок, текст, дату й підпис у спільному контексті. Початкові рамки збережено окремо.'}],
  reading_plan:{contract:'native-biography-page-1',strategy:'full_page',original_zones:originals,planned_readings:1,scope_notice:'Тільки контроль однієї друкованої автобіографії; зміст та повнота не підтверджені. Жодну ділянку сторінки не виключено.'}};
}
function taskValue(task,pages){
 if(!task||typeof task!=='object'||Array.isArray(task)||Object.keys(task).some(k=>!['mode','page','box','retry','transport_retry'].includes(k))||
  !['overview','zone'].includes(task.mode)||!integer(task.page,pages)||task.page<1||
  ['retry','transport_retry'].some(k=>task[k]!==undefined&&typeof task[k]!=='boolean')||
  (task.mode==='zone'&&!validBox(task.box))||(task.mode==='overview'&&(task.box!==undefined||task.retry)))throw Error('Некоректний крок координатора');
 return copy(task);
}
function errorValue(error,task){return {page:task.page,mode:task.mode,error:String(error?.message||'Крок не завершено').slice(0,500),
 code:/^[A-Z0-9_]{1,64}$/.test(error?.code||'')?error.code:'ZONE_STEP_FAILED',automatic_retry:false};}
function transition(task,result,remaining){
 const tasks=copy(remaining);
 if(task.mode==='overview'){
  const invalid=()=>{const error=Error('Некоректні межі зон огляду; потрібна перевірка.');error.code='ZONE_OVERVIEW_INVALID';return error;};
  if(!Array.isArray(result.zones)||result.zones.some(z=>!validBox(z?.box)))throw invalid();
  const seen=new Set(),zones=result.zones.filter(z=>{const key=JSON.stringify(['x','y','w','h'].map(k=>z.box[k]));if(seen.has(key))return false;seen.add(key);return true;});
  // Never silently truncate supplied content or discard a zone based on its label.
  if(zones.length>6){const error=Error('Огляд містить понад 6 різних зон; потрібне уточнення поділу.');error.code='ZONE_OVERVIEW_TOO_MANY_ZONES';throw error;}
  tasks.unshift(...zones.map(z=>({mode:'zone',page:task.page,box:copy(z.box)})));
 }else{
  const rows=Array.isArray(result.rows)?result.rows:[],fields=rows.flatMap(r=>Array.isArray(r?.fields)?r.fields:[]);
  const uncertain=!fields.length||rows.some(r=>!Array.isArray(r?.fields)||!r.fields.length)||fields.some(f=>f?.value==null||typeof f.value==='string'&&!f.value.trim()||f?.legibility!=='clear'||Array.isArray(f.alternatives)&&f.alternatives.length>0);
  if(uncertain){
   const b=task.box,x=Math.max(0,b.x-b.w*.15),y=Math.max(0,b.y-b.h*.15),expanded={x,y,w:Math.min(1-x,b.w*1.3),h:Math.min(1-y,b.h*1.3)};
   // A second reading must offer genuinely larger context; never reread the same full page.
   if(!task.retry&&['x','y','w','h'].some(k=>Math.abs(expanded[k]-b[k])>1e-9))tasks.unshift({...task,retry:true,box:expanded});
   else{const error=Error(fields.length?'Поля залишилися непевними; потрібна перевірка.':'У фрагменті немає прочитаних полів; потрібна перевірка.');error.code=fields.length?'ZONE_FIELDS_UNCERTAIN':'ZONE_NO_READABLE_FIELDS';throw error;}
  }
 }
 return tasks;
}
function serialized(state){return {version:VERSION,pages:state.pages,source:copy(state.source),budget:state.budget,attempts:state.attempts,
 completed:state.completed,tasks:copy(state.tasks),in_flight:copy(state.in_flight),
 errors:state.errors.map(e=>({page:e.page,mode:e.mode,code:e.code,automatic_retry:false}))};}
function validateSnapshot(value,source){
 if(!value||value.version!==VERSION||Object.keys(value).length!==9||Object.keys(value).some(k=>!['version','pages','source','budget','attempts','completed','tasks','in_flight','errors'].includes(k))||
  !integer(value.pages,200)||value.pages<1||!integer(value.budget,MAX_STEPS)||value.budget<1||
  !integer(value.attempts,value.budget)||!integer(value.completed,value.attempts)||
  !Array.isArray(value.tasks)||value.tasks.length>MAX_STEPS||!Array.isArray(value.errors)||value.errors.length>MAX_STEPS)throw Error('Некоректний знімок координатора');
 const binding=sourceBinding(value.source);
 if(JSON.stringify(binding)!==JSON.stringify(sourceBinding(source)))throw Error('Знімок належить іншому джерелу');
 const tasks=value.tasks.map(t=>taskValue(t,value.pages)),inFlight=value.in_flight===null?null:taskValue(value.in_flight,value.pages);
 if(value.attempts-value.completed!==(inFlight?1:0)||inFlight&&JSON.stringify(inFlight)!==JSON.stringify(tasks[0]))throw Error('Некоректний незавершений крок');
 const errors=value.errors.map(e=>{
  if(!e||Object.keys(e).some(k=>!['page','mode','code','automatic_retry'].includes(k))||!integer(e.page,value.pages)||e.page<1||!['overview','zone'].includes(e.mode)||
   !/^[A-Z0-9_]{1,64}$/.test(e.code||'')||e.automatic_retry!==false)throw Error('Некоректна помилка знімка');
  return {...e,error:'Крок не завершено ('+e.code+')'};
 });
 return {pages:value.pages,source:binding,budget:value.budget,attempts:value.attempts,completed:value.completed,tasks,in_flight:inFlight,errors};
}
function coordinator(initial){
 let state=initial,stopped=false,running=false,pendingCommit=null;
 const snapshot=()=>serialized(state);
 return {
  get tasks(){return copy(state.tasks);},get errors(){return copy(state.errors);},get running(){return running;},
  get budgetExhausted(){return !!state.tasks.length&&!state.in_flight&&state.attempts>=state.budget;},
  stop(){stopped=true;},snapshot,
  async run({read,show,limit=Infinity,checkpoint,resolveInFlight}={}){
   if(running)return;
   if(typeof read!=='function'||limit!==Infinity&&(!Number.isSafeInteger(limit)||limit<0))throw Error('Некоректний адаптер координатора');
   running=true;stopped=false;let calls=0,recovered=0,blocked=false;
   const commit=async(next,phase,task)=>{
    // An unacknowledged post-read checkpoint is retried locally without another read.
    pendingCommit={next,phase,task};
    try{await checkpoint?.(serialized(next),{phase,task:copy(task)});}
    catch(error){if(phase==='before_dispatch')pendingCommit=null;throw error;}
    state=next;pendingCommit=null;
   };
   try{
    if(pendingCommit)await commit(pendingCommit.next,pendingCommit.phase,pendingCommit.task);
    while(state.tasks.length&&!stopped&&(state.in_flight||state.attempts<state.budget)&&calls<limit){
     const task=copy(state.tasks[0]);show?.({page:task.page,pending:state.tasks.length,calls,limit,recovered});
     let result,failure,fromRecovery=false;
     if(state.in_flight){
      // A persisted in-flight step is never sent to AI again on speculation.
      const saved=await resolveInFlight?.(copy(task),snapshot());
      if(saved?.state==='completed'&&saved.result&&typeof saved.result==='object'&&!Array.isArray(saved.result))result=saved.result;
      else if(saved?.state==='failed'&&saved.error&&typeof saved.error.message==='string')failure={message:saved.error.message,code:saved.error.code};
      else{blocked=true;break;}
      fromRecovery=true;recovered++;
     }else{
      const dispatched={...state,attempts:state.attempts+1,in_flight:copy(task)};
      await commit(dispatched,'before_dispatch',task);
      try{result=await read(copy(task));if(!result||typeof result!=='object'||Array.isArray(result))throw Error('Немає результату читання');}
      catch(error){failure=error;}
      calls++;
     }
     const next={...state,tasks:copy(state.tasks.slice(1)),errors:[...state.errors],in_flight:null,completed:state.completed+1};
     if(failure){
      if(!fromRecovery&&failure?.safe_to_retry===true&&!task.transport_retry)next.tasks.unshift({...task,transport_retry:true});
      else next.errors.push(errorValue(failure,task));
     }else{
      try{next.tasks=transition(task,result,next.tasks);}
      catch(error){next.errors.push(errorValue(error,task));}
     }
     await commit(next,'after_step',task);
     if(failure)show?.({error:failure?.message||'Крок не завершено',page:task.page,pending:state.tasks.length,calls,limit,recovered});
    }
   }finally{
    running=false;
    show?.({done:state.tasks.length===0,stopped,blocked,pending:state.tasks.length,calls,limit,recovered,
     budget_exhausted:!!state.tasks.length&&!state.in_flight&&state.attempts>=state.budget,errors:copy(state.errors)});
   }
   return {done:!state.tasks.length,blocked,budget_exhausted:!!state.tasks.length&&!state.in_flight&&state.attempts>=state.budget,calls,recovered};
  }
 };
}
function create(pages,{source=null,budget=MAX_STEPS}={}){
 if(!integer(pages,200)||pages<1||!integer(budget,MAX_STEPS)||budget<1)throw Error('Потрібно від 1 до 200 сторінок і обмежений бюджет кроків');
 return coordinator({pages,source:sourceBinding(source),budget,attempts:0,completed:0,
  tasks:Array.from({length:pages},(_,i)=>({mode:'overview',page:i+1})),in_flight:null,errors:[]});
}
function restore(snapshot,{source=null}={}){return coordinator(validateSnapshot(snapshot,source));}
const api={VERSION,MAX_STEPS,create,restore,nativeReadingPlan};root.CRMMilitaryAutopilot=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
