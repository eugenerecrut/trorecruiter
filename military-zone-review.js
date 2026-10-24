// Military autopilot: reads originals; only explicit human corrections update document learning metadata.
(function(){
'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const full={x:0,y:0,w:1,h:1};
function selectedBox(inputs){
 const values={};for(const el of inputs){if(!['x','y','w','h'].includes(el.dataset.box)||String(el.value).trim()==='')return null;values[el.dataset.box]=Number(el.value)/100;}
 return CRMMilitaryZoneContract.box(values);
}
function backgroundSummary(job){
 const s=job.zone_summary||{},notes=[];
 const states={queued:'Документ у черзі',running:'Документ опрацьовується на сервері',completed:'Опрацювання завершено',needs_review:'Опрацювання зупинено',uncertain:'Відповідь AI не підтверджено',superseded:'Джерело документа змінилося'};
 if(s.source_changed||job.state==='superseded')return {title:'Джерело документа змінилося',notes:['Відкрийте чинну версію документа. Попередній результат не застосовується.']};
 if(['queued','running'].includes(job.state))notes.push('Можна закрити це вікно. СПЛАВ продовжить роботу на сервері.');
 else if(s.code==='ZONE_RESULT_UNCERTAIN'||job.state==='uncertain')notes.push('Сервіс міг прийняти запит, але придатний результат не отримано. Автоматичний повтор заблоковано, щоб уникнути повторних витрат.');
 else if(s.code==='ZONE_PROVIDERS_REJECTED')notes.push('AI-сервіси відхилили запит. Адміністратору потрібно перевірити їх доступність і ліміти.');
 else if(job.state==='needs_review'&&s.error_count>0)notes.push('Один або кілька кроків не дали придатного результату. Адміністратору потрібно перевірити збережені причини; повтор автоматично не запускається.');
 else if(job.state==='needs_review'&&s.attempts>=s.budget&&s.pending_steps>0)notes.push('Досягнуто погодженого ліміту кроків. Решту документа не запускали. Наступна дія: переглянути збережені результати й окремо погодити продовження.');
 else if(job.state==='needs_review')notes.push('Потрібна перевірка збереженого звіту. Нове розпізнавання автоматично не запускається.');
 else if(job.state==='completed')notes.push('Звіт збережено. Результати читання відображаються нижче; повторний AI-запит не потрібен.');
 if(s.code==='ZONE_RESULT_UNCERTAIN'||job.state==='uncertain')notes.push('Наступна дія: адміністратору перевірити ліміти та доступ AI-сервісів. Цей фрагмент не запускати повторно без окремого рішення.');
 if(Array.isArray(job.zone_reports)&&job.zone_reports.length)notes.push('Збережених успішних читань: '+job.zone_reports.length+'. Вони доступні нижче незалежно від стану попереднього доручення.');
 if(job.zone_reports_truncated)notes.push('Збережений звіт перевищує ліміт перегляду. Новий AI-запит не потрібен; зверніться до адміністратора.');
 const labels={insufficient_quota:'вичерпано API-квоту або баланс; адміністратору перевірити білінг',rate_limit_exceeded:'перевищено частоту запитів; адміністратору перевірити ліміти',QUOTA_OR_RATE_LIMIT:'квота або частота запитів; точної причини сервіс не надав',MAX_TOKENS:'відповідь обрізана через обмеження довжини',max_output_tokens:'відповідь обрізана через обмеження довжини',length:'відповідь обрізана через обмеження довжини',SAFETY:'сервіс заблокував відповідь',content_filter:'сервіс заблокував відповідь',invalid_api_key:'адміністратору перевірити ключ доступу',AUTHENTICATION_FAILED:'адміністратору перевірити ключ доступу',UNAUTHENTICATED:'адміністратору перевірити ключ доступу',model_not_found:'адміністратору перевірити доступ до моделі',MODEL_OR_ENDPOINT_UNAVAILABLE:'адміністратору перевірити доступ до моделі',PERMISSION_DENIED:'адміністратору перевірити права сервісу',ACCESS_DENIED:'адміністратору перевірити права сервісу'};
 for(const p of (Array.isArray(s.providers)?s.providers:[]).slice(0,8)){
  if(!['OpenAI','Gemini','OpenRouter'].includes(p.provider))continue;
  notes.push(p.provider+': '+(labels[p.diagnosis]||(p.http_status===429?labels.QUOTA_OR_RATE_LIMIT:p.http_status?'сервіс відхилив запит (HTTP '+Number(p.http_status)+')':'придатної відповіді немає; причина не збережена.')));
 }
 if(Number.isInteger(s.attempts)&&Number.isInteger(s.budget))notes.push('AI-кроків виконано: '+s.attempts+' з '+s.budget+' дозволених. Це кількість спроб, а не підтверджених списань.');
 if(Number.isInteger(s.pages))notes.push('Сторінок у файлі: '+s.pages+'.');
 notes.push('Дані картки та основне розпізнавання не перезаписуються.');
 return {title:states[job.state]||'Перевіряємо стан документа',notes};
}
function backgroundReports(job,saved){
 if(!job._detailed||!job.zone_summary||job.zone_summary.source_changed||!['completed','needs_review'].includes(job.state)||!saved||!['complete','complete_with_gaps'].includes(saved.status)||saved.status!==job.result?.status||!saved.saved_at||saved.saved_at!==job.result?.saved_at||!Array.isArray(saved.reports))return [];
 return saved.reports.filter(r=>r?.review_only===true&&r.source?.document_id===job.document_id);
}
async function open(doc,{autostart=false}={}){
 if(!doc?.storage_path)throw Error('Документ не має файла');
 const dialog=document.createElement('dialog');dialog.className='crm-dialog crm-workflow-dialog';dialog.style.width='min(1100px,96vw)';
 dialog.innerHTML='<h2>Документ · автоматичне опрацювання</h2><p>'+esc(doc.file_name)+'</p><p>Система сама опрацює всі сторінки, повторить складні читання та збереже кінцевий звіт. Дочекайтеся завершення. Ручні інструменти й навчальні виправлення необов’язкові. Дані картки не перезаписуються.</p><div class="crm-actions"><button data-auto>Опрацювати автоматично</button><button data-stop disabled>Зупинити</button></div><p data-auto-progress role="status"></p><details data-manual><summary>Додатково: оригінал і ручне читання</summary><div class="crm-actions"><button data-prev>←</button><span data-page></span><button data-next>→</button><button data-overview>Оглянути сторінку</button></div><div data-quality></div><div data-zones class="crm-actions"></div><div style="max-height:55vh;overflow:auto;border:1px solid #ccd"><canvas data-source style="display:block;max-width:100%;height:auto;touch-action:none" aria-label="Сторінка документа, виділіть зону мишею"></canvas></div><fieldset><legend>Зона читання, % від сторінки</legend><div style="display:flex;gap:10px;flex-wrap:wrap">'+[['x','Ліворуч'],['y','Згори'],['w','Ширина'],['h','Висота']].map(([k,l])=>'<label>'+l+'<input data-box="'+k+'" aria-label="'+l+'" type="number" min="0" max="100" step="0.1" value="'+(k==='w'||k==='h'?100:0)+'" style="width:80px;display:block"></label>').join('')+'</div><button data-read>Перечитати зону</button><button data-full>Уся сторінка</button></fieldset></details><p role="status" data-status></p><section data-result></section><div class="crm-actions"><button data-export disabled>Завантажити звіт JSON</button><button data-close>Закрити</button></div>';
 document.body.append(dialog);dialog.showModal();
 const $=s=>dialog.querySelector(s),canvas=$('[data-source]'),ctx=canvas.getContext('2d'),source=document.createElement('canvas'),reports=[];
 const canary=new URLSearchParams(location.search).get('zoneBudget')==='1';
 let page=1,total=1,pdf=null,bitmap=null,box={...full},closed=false,busy=false,renderId=0,autopilot=null,autoActive=false,sourceReady=false,originalURL=null,originalDigest=null,coordinatorSession=null,stopRequested=false,backgroundPoll=null,backgroundSeen=false,backgroundReportLoaded=false;
 if(!autostart){$('[data-manual]').open=true;dialog.querySelector('h2').textContent='Документ · оригінал і ручне читання';dialog.querySelectorAll('p')[1].textContent='Оригінал відкривається без AI. Огляд сторінки або читання зони починається лише після вашого натискання. Дані картки не перезаписуються.';if(!doc.ai_extracted||doc.processing_status==='AI помилка')$('[data-auto]').hidden=true;}
 if(canary){$('[data-auto]').textContent='Контроль СПЛАВ · один крок';dialog.querySelectorAll('p')[1].textContent='Контроль власника: лише один новий серверний AI-крок. Наступні зони не запускаються; основний OCR і картка не змінюються.';}
 const status=value=>$('[data-status]').textContent=value;
 function lock(value){busy=value;dialog.querySelectorAll('button,input').forEach(el=>el.disabled=value||autoActive);$('[data-export]').disabled=value||!reports.length;if(autoActive)$('[data-stop]').disabled=false;else $('[data-stop]').disabled=true;if(!value&&!autoActive){$('[data-prev]').disabled=page===1;$('[data-next]').disabled=page===total;}}
 function paint(){canvas.width=source.width;canvas.height=source.height;ctx.drawImage(source,0,0);ctx.lineWidth=Math.max(2,source.width/500);ctx.strokeStyle='#1676ba';ctx.strokeRect(box.x*source.width,box.y*source.height,box.w*source.width,box.h*source.height);}
 function setBox(value){const next=CRMMilitaryZoneContract.box(value);if(!next)return false;box=next;dialog.querySelectorAll('[data-box]').forEach(el=>el.value=+(box[el.dataset.box]*100).toFixed(2));paint();return true;}
 async function render(){sourceReady=false;const token=++renderId;lock(true);status('Відкриваємо оригінал сторінки…');try{
  if(pdf){const p=await pdf.getPage(page),base=p.getViewport({scale:1}),scale=Math.min(3.5,Math.sqrt(8000000/(base.width*base.height))),viewport=p.getViewport({scale});source.width=Math.ceil(viewport.width);source.height=Math.ceil(viewport.height);await p.render({canvasContext:source.getContext('2d'),viewport}).promise;}
  else{const scale=Math.min(1,Math.sqrt(8000000/(bitmap.width*bitmap.height)));source.width=Math.ceil(bitmap.width*scale);source.height=Math.ceil(bitmap.height*scale);source.getContext('2d').drawImage(bitmap,0,0,source.width,source.height);}
  if(closed||token!==renderId)return;sourceReady=true;setBox(full);$('[data-page]').textContent=page+' / '+total;$('[data-zones]').replaceChildren();$('[data-quality]').textContent='';status('Огляньте сторінку або виділіть рядок таблиці.');
 }catch(e){status(e.message);if(autoActive)throw e;}finally{if(!closed&&token===renderId)lock(false)}}
 async function read(mode){if(canary){status('Контроль одного кроку виконується лише серверною чергою. Ручний AI не запускався.');return;}if(busy)return;const selected=mode==='overview'?full:selectedBox(dialog.querySelectorAll('[data-box]'));if(!selected||!sourceReady){status('AI не запускався: перевірте межі зони та дочекайтеся відкриття сторінки.');return;}if(mode!=='overview')setBox(selected);lock(true);const atPage=page;let dispatched=false;try{
  status(mode==='overview'?'AI визначає зони сторінки…':'AI перечитує фрагмент; очікуйте…');
  const crop=document.createElement('canvas'),context=.015,left=Math.max(0,selected.x-context),top=Math.max(0,selected.y-context),right=Math.min(1,selected.x+selected.w+context),bottom=Math.min(1,selected.y+selected.h+context);
  const sourceBox=mode==='overview'?full:{x:left,y:top,w:right-left,h:bottom-top};
  const shrink=mode==='overview'?Math.min(1,1800/source.width):1;
  crop.width=Math.max(1,Math.round(sourceBox.w*source.width*shrink));crop.height=Math.max(1,Math.round(sourceBox.h*source.height*shrink));
  crop.getContext('2d').drawImage(source,sourceBox.x*source.width,sourceBox.y*source.height,sourceBox.w*source.width,sourceBox.h*source.height,0,0,crop.width,crop.height);
  let image_data=crop.toDataURL('image/jpeg',.94);if(image_data.length>5500000)image_data=crop.toDataURL('image/jpeg',.85);if(image_data.length>5500000)throw Error('Зона завелика. Виділіть один рядок або меншу ділянку.');
  const bytes=Uint8Array.from(atob(image_data.split(',')[1]),c=>c.charCodeAt(0)),hash=await crypto.subtle.digest('SHA-256',bytes),render_sha256=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
  dispatched=true;
  const {data,error}=await supabaseClient.functions.invoke('ai-military-zone',{body:{document_id:doc.id,mode,page:atPage,box:sourceBox,image_data,render_sha256,
   ...(autoActive&&coordinatorSession?{coordinator_id:coordinatorSession.id,coordinator_version:coordinatorSession.version}:{})}});
  if(error){let message='Немає підтвердженого результату AI. Автоматичний повтор цього фрагмента вимкнено.',code='ZONE_RESULT_UNCERTAIN';try{const detail=await error.context?.json();if(detail?.error)message=detail.error;if(detail?.code)code=detail.code;}catch{}const failure=Error(message);failure.code=code;throw failure}
  if(closed)return;if(!data?.review_only||data.error)throw Error(data?.error||'Некоректна відповідь AI');reports.push(data);$('[data-export]').disabled=false;$('[data-export]').hidden=false;
  if(data.request_replayed)$('[data-auto-progress]').textContent='Відновлено збережений фрагмент. Новий AI-запит не виконувався.';
  if(mode==='overview'){
   $('[data-quality]').textContent=(data.quality_issues||[]).join(' · ');const zones=$('[data-zones]');zones.replaceChildren();
   for(const z of data.zones||[]){const button=document.createElement('button');button.type='button';button.textContent=z.label||z.kind;button.title=z.reason||'';button.onclick=()=>setBox(z.box);zones.append(button);}
   status('Знайдено зон: '+(data.zones?.length||0)+'. Перевірте межі й натисніть «Перечитати зону».');
  }else{
   showReport(data,atPage);
  }
 return data;
 }catch(e){e.safe_to_retry=!dispatched;if(!closed)status('Не розпізнано: '+e.message);if(autoActive)throw e;}finally{if(!closed)lock(false)}}
 function showReport(data,atPage){
   data={...data,rows:(data.rows||[]).map(row=>({...row,fields:(row.fields||[]).map(f=>CRMMilitaryZoneContract.projectField(f))}))};
   const labels={criminal_record_statement:'Кримінальна відповідальність — заява автора',military_registration_statement:'Військовий облік — дослівно',special_rank:'Спеціальне звання',service_statement:'Відомості про службу — дослівно',marital_status:'Сімейний стан',rnokpp:'РНОКПП',desired_position:'Бажана посада',military_unit:'Військова частина',shpk:'ШПК',tariff_grade:'Тарифний розряд',signatory:'Підписант',recruiter_name:'Рекрутер',driver_license_categories:'Категорії водія',award_name:'Нагорода',full_name:'ПІБ',birth_date:'Дата народження',birth_place:'Місце народження',document_number:'Номер документа',document_series:'Серія',document_date:'Дата документа',issuer:'Орган видачі',address:'Адреса',relative_name:'ПІБ родича',relationship:'Ступінь споріднення',institution:'Заклад освіти',specialty:'Спеціальність',qualification:'Кваліфікація',graduation_year:'Рік закінчення',employer:'Роботодавець',vlk_conclusion:'Висновок ВЛК',vlk_category:'Категорія ВЛК',start_date:'Початок',end_date:'Завершення',unit:'Частина / установа',position:'Посада',military_specialty:'ВОС',order_number:'Номер наказу',order_date:'Дата наказу',rank:'Звання',other:'Інше'};
   const report=document.createElement('details');const uncertain=(data.rows||[]).flatMap(r=>r.fields||[]).filter(f=>f.value===null||f.legibility!=='clear'||f.alternatives?.length).length;report.open=false;report.innerHTML='<summary>Сторінка '+atPage+' · '+uncertain+' невизначених значень</summary><h3>Результат · сторінка '+atPage+'</h3><p style="white-space:pre-wrap">'+esc(data.raw_text)+'</p>'+(data.rows||[]).map((row,i)=>'<h4>Рядок '+(i+1)+'</h4><p>'+esc(row.raw_text)+'</p><div style="overflow:auto"><table><thead><tr><th>Поле</th><th>Дослівно</th><th>Прочитане значення</th><th>Альтернативи / питання</th></tr></thead><tbody>'+(row.fields||[]).map(f=>'<tr><td>'+esc(labels[f.key]||f.key)+'</td><td>'+esc(f.raw_text)+'</td><td>'+esc(f.value??(f.partial_value?f.partial_value+' ('+(f.date_precision==='month'?'місяць; день невідомий':'рік; місяць і день невідомі')+')':'Не визначено'))+'</td><td>'+esc([...(f.alternatives||[]),f.reason].filter(Boolean).join(' · '))+'</td></tr>').join('')+'</tbody></table></div>').join('')+'<p>'+esc((data.warnings||[]).join(' · '))+'</p>';
   status('Прочитано через '+data.source.provider+'. Дані картки та початкове AI-розпізнавання не змінено.');
   $('[data-result]').append(report);learning(data,report);
 }
 function learning(data,host){
  const allowed=new Set(['start_date','end_date','order_date','unit','position','military_specialty','order_number','rank','institution','specialty','qualification','graduation_year','employer']);
  const fields=(data.rows||[]).flatMap(r=>r.fields||[]).filter(f=>allowed.has(f.key)&&f.raw_text&&f.raw_text.length<=200).slice(0,30);
  if(!fields.length)return;
  const section=document.createElement('details');section.innerHTML='<summary>Уточнити читання та навчити систему</summary><p>Позначте лише перевірені за оригіналом значення. Це навчальні приклади, а не зміна картки.</p>'+fields.map((f,i)=>'<label style="display:block;margin:8px 0"><input type="checkbox" data-learn="'+i+'"> '+esc(f.key)+' · '+esc(f.raw_text)+'<input data-learn-value="'+i+'" maxlength="200" value="'+esc(f.value||'')+'" aria-label="Виправлення '+i+'"></label>').join('')+'<button data-confirm-learning>Підтвердити виправлення</button><p data-learning-status role="status"></p>';
  host.append(section);
  section.querySelector('[data-confirm-learning]').onclick=async()=>{const output=section.querySelector('[data-learning-status]'),button=section.querySelector('button');button.disabled=true;try{
   const examples=[...section.querySelectorAll('[data-learn]:checked')].map(el=>{const i=Number(el.dataset.learn);return {key:fields[i].key,raw_text:fields[i].raw_text,value:section.querySelector('[data-learn-value="'+i+'"]').value.trim()}});
   if(!examples.length||examples.some(e=>!e.value))throw Error('Позначте перевірені поля й заповніть значення.');
   const {data:count,error}=await supabaseClient.rpc('crm_confirm_military_zone_examples',{p_document_id:doc.id,p_source:data.source,p_examples:examples});if(error)throw error;
   output.textContent='Збережено навчальних прикладів: '+count+'. Картка не змінена.';
  }catch(e){output.textContent=e.message}finally{button.disabled=false}};
 }
 async function loadCoordinator(){
  const response=await supabaseClient.rpc('crm_zone_coordinator_open',{p_document_id:doc.id,p_file_sha256:originalDigest,p_recover:true});
  if(response.error||!response.data?.id)throw Error('Не вдалося відновити контрольну точку. Оновіть документ; AI не запускався.');
  coordinatorSession=response.data;
  if(coordinatorSession.reports_truncated)throw Error('Збережений звіт перевищив обмеження розміру. Автоматичне продовження призупинено.');
  autopilot=coordinatorSession.snapshot?CRMMilitaryAutopilot.restore(coordinatorSession.snapshot,{source:coordinatorSession.source}):CRMMilitaryAutopilot.create(total,{source:coordinatorSession.source});
  if(autopilot.snapshot().pages!==total)throw Error('Кількість сторінок джерела змінилася. Продовження заблоковано.');
  reports.splice(0,reports.length,...(coordinatorSession.reports||[]));$('[data-result]').replaceChildren();
  for(const report of reports)if(report.mode==='zone')showReport(report,report.source.page);
 }
 async function checkpoint(snapshot){
  const response=await supabaseClient.rpc('crm_zone_coordinator_save',{p_id:coordinatorSession.id,p_expected_version:coordinatorSession.version,p_snapshot:snapshot});
  if(response.error||!Number.isSafeInteger(response.data))throw Error('Контрольну точку не підтверджено або чергу змінила інша вкладка. Новий AI-крок не запускається.');
  coordinatorSession.version=response.data;
 }
 async function resolveInFlight(task){
  const saved=coordinatorSession.in_flight_response;
  if(saved?.state==='completed'&&saved.result?.review_only){
   reports.push(saved.result);if(task.mode==='zone')showReport(saved.result,task.page);
   return {state:'completed',result:saved.result};
  }
  if(saved?.state==='failed'&&saved.result?.error)return {state:'failed',error:{message:saved.result.error,code:saved.result.code}};
  return null;
 }
 $('[data-stop]').onclick=()=>{stopRequested=true;autopilot?.stop();};
 function showBackground(job){
  const explanation=backgroundSummary(job),host=$('[data-auto-progress]');host.replaceChildren();const title=document.createElement('strong');title.textContent=explanation.title;host.append(title);for(const note of explanation.notes){const line=document.createElement('span');line.style.display='block';line.textContent=note;host.append(line);}
  $('[data-auto]').hidden=true;$('[data-stop]').hidden=true;$('[data-export]').hidden=!reports.length;status('');
  dialog.querySelector('h2').textContent='Документ · результат СПЛАВ';dialog.querySelectorAll('p')[1].textContent='Показано збережений стан опрацювання. Перегляд не запускає нове розпізнавання.';
  if(!backgroundSeen){$('[data-manual]').open=false;backgroundSeen=true;}
  if(job._detailed&&!backgroundReportLoaded&&Array.isArray(job.zone_reports)&&job.zone_reports.length&&job.zone_summary&&!job.zone_summary.source_changed){
   backgroundReportLoaded=true;reports.splice(0,reports.length,...job.zone_reports.filter(r=>r?.review_only===true&&r.source?.document_id===doc.id));$('[data-result]').replaceChildren();
   for(const report of reports)if(report.mode==='zone')showReport(report,report.source.page);
   $('[data-export]').hidden=!reports.length;$('[data-export]').disabled=!reports.length;status('Відновлено збережені читання. Новий AI-запит не виконувався.');
  }
  if(job._detailed&&!backgroundReportLoaded&&job.zone_summary&&!job.zone_summary.source_changed&&['completed','needs_review'].includes(job.state)&&job.result?.saved_at){
   backgroundReportLoaded=true;
   supabaseClient.from('documents').select('ai_extracted').eq('id',doc.id).single().then(response=>{
    if(closed)return;if(response.error){status('Не вдалося відкрити збережений звіт. Оновіть документ; AI не запускався.');return;}
    const saved=backgroundReports(job,response.data?.ai_extracted?._military_zone_report);
    reports.splice(0,reports.length,...saved);$('[data-result]').replaceChildren();
    for(const report of saved)if(report.mode==='zone')showReport(report,report.source.page);
    $('[data-export]').hidden=!saved.length;$('[data-export]').disabled=!saved.length;status(saved.length?'Збережений звіт відкрито без нового AI.':'Збережений звіт не відповідає цьому дорученню; результат не застосовано.');
   }).catch(()=>{if(!closed)status('Не вдалося відкрити збережений звіт. Оновіть документ; AI не запускався.');});
  }
  if(backgroundPoll)clearInterval(backgroundPoll);
  if(!job._detailed){supabaseClient.rpc('crm_splav_job_status',{job_id:job.id}).then(result=>{if(!closed&&!result.error&&result.data)showBackground({...result.data,_detailed:true});}).catch(()=>{});}
  if(['queued','running'].includes(job.state))backgroundPoll=setInterval(async()=>{
   if(closed){clearInterval(backgroundPoll);return;}
   const result=await supabaseClient.rpc('crm_splav_job_status',{job_id:job.id});
   if(!closed&&!result.error&&result.data)showBackground({...result.data,_detailed:true});
  },5000);
 }
 $('[data-auto]').onclick=async()=>{if(busy||autoActive||!sourceReady)return;autoActive=true;stopRequested=false;lock(false);try{
  const isPDF=/pdf/i.test(doc.mime_type||'')||/\.pdf$/i.test(doc.file_name||'');
  if(canary){
   const actor=await supabaseClient.auth.getUser();if(actor.error||actor.data?.user?.id!=='7c74b122-3940-40a8-a32f-fe2b6776c173'||!isPDF||!doc.ai_extracted)throw Error('Однокроковий контроль доступний лише власнику для PDF з основним OCR. AI не запускався.');
   const jobs=await supabaseClient.rpc('crm_splav_candidate_jobs',{candidate_id:doc.candidate_id});
   if(jobs.error)throw Error('Не вдалося перевірити доручення. AI не запускався.');
   const existing=(jobs.data||[]).find(j=>j.document_id===doc.id&&j.kind==='zone');if(existing){showBackground(existing);return;}
   await loadCoordinator();
   const queued=await supabaseClient.rpc('crm_splav_zone_canary_enqueue',{p_id:coordinatorSession.id,p_pages:total});
   if(queued.error||!queued.data?.id)throw Error('Точковий контроль не дозволено. Загальний фон не вмикався; AI не запускався.');
   showBackground(queued.data);return;
  }
  if(isPDF&&doc.ai_extracted){
   const ready=await supabaseClient.rpc('crm_zone_background_ready');
   if(canary&&(ready.error||ready.data!==true))throw Error('Фоновий контроль вимкнений. Браузерний AI не запускався.');
   if(!ready.error&&ready.data===true){
    const jobs=await supabaseClient.rpc('crm_splav_candidate_jobs',{candidate_id:doc.candidate_id});
    if(jobs.error)throw Error('Не вдалося перевірити фонове доручення. AI не запускався.');
    const existing=(jobs.data||[]).find(j=>j.document_id===doc.id&&j.kind==='zone');
    if(existing){showBackground(existing);return;}
    await loadCoordinator();
    const queued=await supabaseClient.rpc('crm_splav_zone_enqueue',{p_id:coordinatorSession.id,p_pages:total,p_budget:canary?1:2600});
    if(queued.error||!queued.data?.id)throw Error('Не вдалося доручити фонове опрацювання. Перевірте попередні квитанції й актуальність джерела. Новий AI-запит не запускався.');
    showBackground(queued.data);return;
   }
  }
  if(canary)throw Error('Немає придатного основного OCR для контрольного кроку. AI не запускався.');
  await loadCoordinator();if(stopRequested)return;
  await autopilot.run({read:async task=>{if(page!==task.page){page=task.page;await render()}if(task.box)setBox(task.box);return await read(task.mode);},show:progress=>{
   $('[data-auto-progress]').textContent=progress.blocked?'Результат попереднього запиту ще невідомий. Повторний AI-запит заблоковано.':progress.budget_exhausted?'Вичерпано збережений ліміт кроків. Нові AI-запити не запускаються.':progress.done?'Розпізнавання завершене. Зберігаємо кінцевий результат…':progress.error?'Сторінка '+progress.page+': '+progress.error:progress.page?'Автопілот: сторінка '+progress.page+' з '+total+', виконано кроків: '+progress.calls:'Автопілот призупинено. Залишилося кроків: '+progress.pending+'. Натисніть «Продовжити опрацювання».';if(progress.errors?.length)$('[data-auto-progress]').textContent+=' '+progress.errors.map(e=>'Сторінка '+e.page+': '+e.error).join('; ');
  },checkpoint,resolveInFlight});
  if(!autopilot.tasks.length)await saveFinal();
 }catch(e){status('Не завершено: '+e.message)}finally{autoActive=false;$('[data-auto]').textContent=autopilot?.budgetExhausted?'Ліміт кроків вичерпано':autopilot?.tasks.length?'Продовжити опрацювання':'Опрацювати автоматично';lock(false);if(autopilot?.budgetExhausted)$('[data-auto]').disabled=true;}};
 async function crosscheck(){
  if(!window.CRMDocumentCrosscheck)return;
  const c=await supabaseClient.from('candidates').select('*').eq('id',doc.candidate_id).single();if(c.error)throw c.error;
  const evidence=await CRMDocumentCrosscheck.load(supabaseClient,c.data),section=document.createElement('details');
  section.innerHTML='<summary>Зіставлення з іншими документами</summary>'+evidence.map(e=>'<p><strong>'+esc({rnokpp:'РНОКПП',birth_date:'Дата народження',birth_place:'Місце народження',relatives:'Родич · '+(e.subject||''),education_records:'Освіта',work_records:'Період роботи / служби'}[e.key]||e.key)+'</strong> · '+esc({needs_review:'Ймовірний зв’язок — перевірити',conflict:'Розбіжність',corroborated:'Збігається в кількох документах',single_source:'Одне джерело',missing:'Немає придатних джерел'}[e.status])+'</p>'+(e.reason?'<p>'+esc(e.reason)+'</p>':'')+e.sources.map(v=>'<p>'+esc(v.value)+' · <button data-evidence-document="'+esc(v.document_id)+'">'+esc(v.file_name||v.document_type)+'</button></p>').join('')).join('');
  section.onclick=async event=>{const b=event.target.closest('[data-evidence-document]');if(!b)return;try{const r=await supabaseClient.from('documents').select('storage_path').eq('id',b.dataset.evidenceDocument).single();if(r.error)throw r.error;const link=await supabaseClient.storage.from('candidate-documents').createSignedUrl(r.data.storage_path,300);if(link.error)throw link.error;window.open(link.data.signedUrl,'_blank','noopener');}catch(e){status(e.message)}};
  $('[data-result]').append(section);
 }
 async function saveFinal(){
  const errors=autopilot?.errors||[],unclear=reports.filter(r=>r.mode==='zone').flatMap(r=>r.rows||[]).flatMap(r=>r.fields||[]).filter(f=>f.value===null||f.legibility!=='clear').length;
  const qualityGaps=reports.filter(r=>r.mode==='overview'&&r.quality_issues?.length||r.mode==='zone'&&!(r.rows||[]).some(row=>row.fields?.length)).length;
  const report={status:errors.length||unclear||qualityGaps?'complete_with_gaps':'complete',reports,errors};
  let failure;
  for(let attempt=0;attempt<3;attempt++){
   const {data,error}=await supabaseClient.rpc('crm_save_military_zone_report',{p_document_id:doc.id,p_storage_path:doc.storage_path,p_report:report});
   if(!error){doc.ai_extracted={...(doc.ai_extracted||{}),_military_zone_report:{...report,...data}};$('[data-auto-progress]').textContent='Готово. Кінцевий результат збережено. Не визначено значень: '+unclear+'. Помилок обробки: '+errors.length+'.';$('[data-auto]').hidden=true;try{await crosscheck()}catch(e){status('Звіт збережено. Зіставлення не завершено: '+e.message)}return;}
   failure=error;await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));
  }
  throw Error('Результат отримано, але не збережено: '+(failure?.message||'помилка зв’язку'));
 }
 function close(){if(busy||autoActive){status('Дочекайтеся завершення операції.');return;}closed=true;if(backgroundPoll)clearInterval(backgroundPoll);if(originalURL)URL.revokeObjectURL(originalURL);pdf?.destroy();bitmap?.close?.();source.width=source.height=canvas.width=canvas.height=1;dialog.close();dialog.remove();}
 $('[data-close]').onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();close()});
 $('[data-overview]').onclick=()=>read('overview');$('[data-read]').onclick=()=>read('zone');$('[data-full]').onclick=()=>setBox(full);
 $('[data-prev]').onclick=()=>{if(page>1){page--;render()}};$('[data-next]').onclick=()=>{if(page<total){page++;render()}};
 dialog.querySelectorAll('[data-box]').forEach(el=>{el.oninput=el.onchange=()=>{const next=selectedBox(dialog.querySelectorAll('[data-box]'));if(next){box=next;paint();}else status('Зона повинна бути в межах 0–100% і мати ненульову площу. AI не запускався.');};});
 let start=null;const point=e=>{const r=canvas.getBoundingClientRect();return{x:Math.min(1,Math.max(0,(e.clientX-r.left)/r.width)),y:Math.min(1,Math.max(0,(e.clientY-r.top)/r.height))}};
 canvas.onpointerdown=e=>{if(busy)return;start=point(e);canvas.setPointerCapture(e.pointerId)};
 canvas.onpointermove=e=>{if(!start)return;const end=point(e);setBox({x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),w:Math.abs(end.x-start.x),h:Math.abs(end.y-start.y)})};canvas.onpointerup=canvas.onpointercancel=()=>start=null;
 $('[data-export]').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({pilot:CRMMilitaryZoneContract.VERSION,document_id:doc.id,reports,autopilot_errors:autopilot?.errors||[]},null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='Зональне_читання_'+doc.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
 lock(true);try{
  if(autostart&&!canary&&(!doc.ai_extracted||doc.processing_status==='AI помилка')){
   status('Виконуємо основне розпізнавання документа…');
   const initial=await supabaseClient.functions.invoke('process-id-document',{body:{document_id:doc.id}});
   if(initial.error||(!initial.data?.ok&&!initial.data?.extracted))throw Error('Основне розпізнавання не завершено. '+(initial.error?.message||initial.data?.error||''));
   if(window.CRMDocumentSync?.automate)await CRMDocumentSync.automate(supabaseClient,doc.id);
   const fresh=await supabaseClient.from('documents').select('*').eq('id',doc.id).single();if(fresh.error)throw fresh.error;Object.assign(doc,fresh.data);
  }
  const {data,error}=await supabaseClient.storage.from('candidate-documents').createSignedUrl(doc.storage_path,300);if(error||!data?.signedUrl)throw Error('Немає доступу до оригіналу');
  const response=await fetch(data.signedUrl);if(!response.ok)throw Error('Не вдалося відкрити файл');const blob=await response.blob();if(blob.size>30000000)throw Error('Пілот підтримує файли до 30 МБ');
  const originalBytes=await blob.arrayBuffer(),originalHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',originalBytes)),b=>b.toString(16).padStart(2,'0')).join('');
  originalDigest=originalHash;
  originalURL=URL.createObjectURL(blob);const originalLink=document.createElement('a');originalLink.href=originalURL;originalLink.download=doc.file_name||'Оригінал';originalLink.textContent='Завантажити оригінал';
  const provenance=document.createElement('p');provenance.style.overflowWrap='anywhere';provenance.append(originalLink,document.createTextNode(' · SHA-256: '+originalHash));$('[data-manual]').append(provenance);
  if(/pdf/i.test(doc.mime_type||'')||/\.pdf$/i.test(doc.file_name||'')){
   await loadExternalScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js','pdfjsLib');pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';pdf=await pdfjsLib.getDocument({data:new Uint8Array(originalBytes)}).promise;total=pdf.numPages;if(total>200)throw Error('Поглиблене читання підтримує до 200 сторінок на файл.');
  }else if(blob.type.startsWith('image/'))bitmap=await createImageBitmap(blob);else throw Error('Потрібен PDF або зображення');
  await render();let backgroundJob=null;try{const jobs=await supabaseClient.rpc('crm_splav_candidate_jobs',{candidate_id:doc.candidate_id});if(!jobs.error&&Array.isArray(jobs.data))backgroundJob=jobs.data.find(j=>j.document_id===doc.id&&j.kind==='zone');}catch{}
  const saved=doc.ai_extracted?._military_zone_report;if(backgroundJob)showBackground(backgroundJob);else if(saved&&Array.isArray(saved.reports)&&['complete','complete_with_gaps'].includes(saved.status)){reports.push(...saved.reports);for(const report of saved.reports)if(report.mode==='zone')showReport(report,report.source.page);$('[data-auto-progress]').textContent='Готовий результат збережено '+(saved.saved_at||'')+'. Повторне розпізнавання не запускалося.';$('[data-auto]').textContent='Опрацювати заново';$('[data-manual]').append($('[data-auto]'));try{await crosscheck()}catch(e){status('Зіставлення не завершено: '+e.message)}}else if(autostart&&!canary&&sourceReady)$('[data-auto]').onclick();
 }catch(e){status(e.message);lock(false)}
 return dialog;
}
window.CRMMilitaryZoneReview={open,backgroundSummary,backgroundReports,selectedBox};
})();
