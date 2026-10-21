// Military autopilot: reads originals; only explicit human corrections update document learning metadata.
(function(){
'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const full={x:0,y:0,w:1,h:1};
async function open(doc,{autostart=false}={}){
 if(!doc?.storage_path)throw Error('Документ не має файла');
 const dialog=document.createElement('dialog');dialog.className='crm-dialog crm-workflow-dialog';dialog.style.width='min(1100px,96vw)';
 dialog.innerHTML='<h2>Документ · автоматичне опрацювання</h2><p>'+esc(doc.file_name)+'</p><p>Система сама опрацює всі сторінки, повторить складні читання та збереже кінцевий звіт. Дочекайтеся завершення. Ручні інструменти й навчальні виправлення необов’язкові. Дані картки не перезаписуються.</p><div class="crm-actions"><button data-auto>Опрацювати автоматично</button><button data-stop disabled>Зупинити</button></div><p data-auto-progress role="status"></p><details data-manual><summary>Додатково: оригінал і ручне читання</summary><div class="crm-actions"><button data-prev>←</button><span data-page></span><button data-next>→</button><button data-overview>Оглянути сторінку</button></div><div data-quality></div><div data-zones class="crm-actions"></div><div style="max-height:55vh;overflow:auto;border:1px solid #ccd"><canvas data-source style="display:block;max-width:100%;height:auto;touch-action:none" aria-label="Сторінка документа, виділіть зону мишею"></canvas></div><fieldset><legend>Зона читання, % від сторінки</legend><div style="display:flex;gap:10px;flex-wrap:wrap">'+[['x','Ліворуч'],['y','Згори'],['w','Ширина'],['h','Висота']].map(([k,l])=>'<label>'+l+'<input data-box="'+k+'" aria-label="'+l+'" type="number" min="0" max="100" step="0.1" value="'+(k==='w'||k==='h'?100:0)+'" style="width:80px;display:block"></label>').join('')+'</div><button data-read>Перечитати зону</button><button data-full>Уся сторінка</button></fieldset></details><p role="status" data-status></p><section data-result></section><div class="crm-actions"><button data-export disabled>Завантажити звіт JSON</button><button data-close>Закрити</button></div>';
 document.body.append(dialog);dialog.showModal();
 const $=s=>dialog.querySelector(s),canvas=$('[data-source]'),ctx=canvas.getContext('2d'),source=document.createElement('canvas'),reports=[];
 let page=1,total=1,pdf=null,bitmap=null,box={...full},closed=false,busy=false,renderId=0,autopilot=null,autoActive=false,sourceReady=false;
 const status=value=>$('[data-status]').textContent=value;
 function lock(value){busy=value;dialog.querySelectorAll('button,input').forEach(el=>el.disabled=value||autoActive);$('[data-export]').disabled=value||!reports.length;if(autoActive)$('[data-stop]').disabled=false;else $('[data-stop]').disabled=true;if(!value&&!autoActive){$('[data-prev]').disabled=page===1;$('[data-next]').disabled=page===total;}}
 function paint(){canvas.width=source.width;canvas.height=source.height;ctx.drawImage(source,0,0);ctx.lineWidth=Math.max(2,source.width/500);ctx.strokeStyle='#1676ba';ctx.strokeRect(box.x*source.width,box.y*source.height,box.w*source.width,box.h*source.height);}
 function setBox(value){const next=CRMMilitaryZoneContract.box(value);if(!next)return false;box=next;dialog.querySelectorAll('[data-box]').forEach(el=>el.value=+(box[el.dataset.box]*100).toFixed(2));paint();return true;}
 async function render(){sourceReady=false;const token=++renderId;lock(true);status('Відкриваємо оригінал сторінки…');try{
  if(pdf){const p=await pdf.getPage(page),base=p.getViewport({scale:1}),scale=Math.min(3.5,Math.sqrt(8000000/(base.width*base.height))),viewport=p.getViewport({scale});source.width=Math.ceil(viewport.width);source.height=Math.ceil(viewport.height);await p.render({canvasContext:source.getContext('2d'),viewport}).promise;}
  else{const scale=Math.min(1,Math.sqrt(8000000/(bitmap.width*bitmap.height)));source.width=Math.ceil(bitmap.width*scale);source.height=Math.ceil(bitmap.height*scale);source.getContext('2d').drawImage(bitmap,0,0,source.width,source.height);}
  if(closed||token!==renderId)return;sourceReady=true;setBox(full);$('[data-page]').textContent=page+' / '+total;$('[data-zones]').replaceChildren();$('[data-quality]').textContent='';status('Огляньте сторінку або виділіть рядок таблиці.');
 }catch(e){status(e.message);if(autoActive)throw e;}finally{if(!closed&&token===renderId)lock(false)}}
 async function read(mode){if(busy)return;lock(true);const selected=mode==='overview'?full:{...box},atPage=page;try{
  status(mode==='overview'?'AI визначає зони сторінки…':'AI перечитує фрагмент; очікуйте…');
  const crop=document.createElement('canvas'),context=.015,left=Math.max(0,selected.x-context),top=Math.max(0,selected.y-context),right=Math.min(1,selected.x+selected.w+context),bottom=Math.min(1,selected.y+selected.h+context);
  const sourceBox=mode==='overview'?full:{x:left,y:top,w:right-left,h:bottom-top};
  const shrink=mode==='overview'?Math.min(1,1800/source.width):1;
  crop.width=Math.max(1,Math.round(sourceBox.w*source.width*shrink));crop.height=Math.max(1,Math.round(sourceBox.h*source.height*shrink));
  crop.getContext('2d').drawImage(source,sourceBox.x*source.width,sourceBox.y*source.height,sourceBox.w*source.width,sourceBox.h*source.height,0,0,crop.width,crop.height);
  let image_data=crop.toDataURL('image/jpeg',.94);if(image_data.length>5500000)image_data=crop.toDataURL('image/jpeg',.85);if(image_data.length>5500000)throw Error('Зона завелика. Виділіть один рядок або меншу ділянку.');
  const bytes=Uint8Array.from(atob(image_data.split(',')[1]),c=>c.charCodeAt(0)),hash=await crypto.subtle.digest('SHA-256',bytes),render_sha256=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
  const {data,error}=await supabaseClient.functions.invoke('ai-military-zone',{body:{document_id:doc.id,mode,page:atPage,box:sourceBox,image_data,render_sha256}});
  if(error){let message=error.message;try{const detail=await error.context?.json();if(detail?.error)message=detail.error;}catch{}throw Error(message)}
  if(closed)return;if(!data?.review_only||data.error)throw Error(data?.error||'Некоректна відповідь AI');reports.push(data);$('[data-export]').disabled=false;
  if(mode==='overview'){
   $('[data-quality]').textContent=(data.quality_issues||[]).join(' · ');const zones=$('[data-zones]');zones.replaceChildren();
   for(const z of data.zones||[]){const button=document.createElement('button');button.type='button';button.textContent=z.label||z.kind;button.title=z.reason||'';button.onclick=()=>setBox(z.box);zones.append(button);}
   status('Знайдено зон: '+(data.zones?.length||0)+'. Перевірте межі й натисніть «Перечитати зону».');
  }else{
   showReport(data,atPage);
  }
 return data;
 }catch(e){if(!closed)status('Не розпізнано: '+e.message);if(autoActive)throw e;}finally{if(!closed)lock(false)}}
 function showReport(data,atPage){
   const labels={rnokpp:'РНОКПП',desired_position:'Бажана посада',military_unit:'Військова частина',shpk:'ШПК',tariff_grade:'Тарифний розряд',signatory:'Підписант',recruiter_name:'Рекрутер',driver_license_categories:'Категорії водія',award_name:'Нагорода',full_name:'ПІБ',birth_date:'Дата народження',birth_place:'Місце народження',document_number:'Номер документа',document_series:'Серія',document_date:'Дата документа',issuer:'Орган видачі',address:'Адреса',relative_name:'ПІБ родича',relationship:'Ступінь споріднення',institution:'Заклад освіти',specialty:'Спеціальність',qualification:'Кваліфікація',graduation_year:'Рік закінчення',employer:'Роботодавець',vlk_conclusion:'Висновок ВЛК',vlk_category:'Категорія ВЛК',start_date:'Початок',end_date:'Завершення',unit:'Частина / установа',position:'Посада',military_specialty:'ВОС',order_number:'Номер наказу',order_date:'Дата наказу',rank:'Звання',other:'Інше'};
   const report=document.createElement('details');const uncertain=(data.rows||[]).flatMap(r=>r.fields||[]).filter(f=>f.value===null||f.legibility!=='clear'||f.alternatives?.length).length;report.open=false;report.innerHTML='<summary>Сторінка '+atPage+' · '+uncertain+' невизначених значень</summary><h3>Результат · сторінка '+atPage+'</h3><p style="white-space:pre-wrap">'+esc(data.raw_text)+'</p>'+(data.rows||[]).map((row,i)=>'<h4>Рядок '+(i+1)+'</h4><p>'+esc(row.raw_text)+'</p><div style="overflow:auto"><table><thead><tr><th>Поле</th><th>Дослівно</th><th>Прочитане значення</th><th>Альтернативи / питання</th></tr></thead><tbody>'+(row.fields||[]).map(f=>'<tr><td>'+esc(labels[f.key]||f.key)+'</td><td>'+esc(f.raw_text)+'</td><td>'+esc(f.value??'Не визначено')+'</td><td>'+esc([...(f.alternatives||[]),f.reason].filter(Boolean).join(' · '))+'</td></tr>').join('')+'</tbody></table></div>').join('')+'<p>'+esc((data.warnings||[]).join(' · '))+'</p>';
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
 $('[data-stop]').onclick=()=>autopilot?.stop();
 $('[data-auto]').onclick=async()=>{if(busy||autoActive||!sourceReady)return;if(!autopilot||!autopilot.tasks.length)autopilot=CRMMilitaryAutopilot.create(total);autoActive=true;lock(false);try{
  await autopilot.run({read:async task=>{if(page!==task.page){page=task.page;await render()}if(task.box)setBox(task.box);return await read(task.mode);},show:progress=>{
   $('[data-auto-progress]').textContent=progress.done?'Розпізнавання завершене. Зберігаємо кінцевий результат…':progress.error?'Сторінка '+progress.page+': '+progress.error:progress.page?'Автопілот: сторінка '+progress.page+' з '+total+', виконано кроків: '+progress.calls:'Автопілот призупинено. Залишилося кроків: '+progress.pending+'. Натисніть «Продовжити опрацювання».';if(progress.errors?.length)$('[data-auto-progress]').textContent+=' '+progress.errors.map(e=>'Сторінка '+e.page+': '+e.error).join('; ');
  }});
  if(!autopilot.tasks.length)await saveFinal();
 }catch(e){status('Не завершено: '+e.message)}finally{autoActive=false;$('[data-auto]').textContent=autopilot.tasks.length?'Продовжити опрацювання':'Опрацювати автоматично';lock(false)}};
 async function crosscheck(){
  if(!window.CRMDocumentCrosscheck)return;
  const c=await supabaseClient.from('candidates').select('*').eq('id',doc.candidate_id).single();if(c.error)throw c.error;
  const evidence=await CRMDocumentCrosscheck.load(supabaseClient,c.data),section=document.createElement('details');
  section.innerHTML='<summary>Зіставлення з іншими документами</summary>'+evidence.map(e=>'<p><strong>'+esc({rnokpp:'РНОКПП',birth_date:'Дата народження',birth_place:'Місце народження',relatives:'Родич · '+(e.subject||''),education_records:'Освіта',work_records:'Період роботи / служби'}[e.key]||e.key)+'</strong> · '+esc({conflict:'Розбіжність',corroborated:'Збігається в кількох документах',single_source:'Одне джерело',missing:'Немає придатних джерел'}[e.status])+'</p>'+e.sources.map(v=>'<p>'+esc(v.value)+' · <button data-evidence-document="'+esc(v.document_id)+'">'+esc(v.file_name||v.document_type)+'</button></p>').join('')).join('');
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
 function close(){if(busy||autoActive){status('Дочекайтеся завершення операції.');return;}closed=true;pdf?.destroy();bitmap?.close?.();source.width=source.height=canvas.width=canvas.height=1;dialog.close();dialog.remove();}
 $('[data-close]').onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();close()});
 $('[data-overview]').onclick=()=>read('overview');$('[data-read]').onclick=()=>read('zone');$('[data-full]').onclick=()=>setBox(full);
 $('[data-prev]').onclick=()=>{if(page>1){page--;render()}};$('[data-next]').onclick=()=>{if(page<total){page++;render()}};
 dialog.querySelectorAll('[data-box]').forEach(el=>el.onchange=()=>{const next=Object.fromEntries([...dialog.querySelectorAll('[data-box]')].map(x=>[x.dataset.box,Number(x.value)/100]));if(!setBox(next)){status('Зона повинна бути в межах 0–100% і мати ненульову площу.');setBox(box)}});
 let start=null;const point=e=>{const r=canvas.getBoundingClientRect();return{x:Math.min(1,Math.max(0,(e.clientX-r.left)/r.width)),y:Math.min(1,Math.max(0,(e.clientY-r.top)/r.height))}};
 canvas.onpointerdown=e=>{if(busy)return;start=point(e);canvas.setPointerCapture(e.pointerId)};
 canvas.onpointermove=e=>{if(!start)return;const end=point(e);setBox({x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),w:Math.abs(end.x-start.x),h:Math.abs(end.y-start.y)})};canvas.onpointerup=canvas.onpointercancel=()=>start=null;
 $('[data-export]').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({pilot:CRMMilitaryZoneContract.VERSION,document_id:doc.id,reports,autopilot_errors:autopilot?.errors||[]},null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='Зональне_читання_'+doc.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
 lock(true);try{
  if(!doc.ai_extracted||doc.processing_status==='AI помилка'){
   status('Виконуємо основне розпізнавання документа…');
   const initial=await supabaseClient.functions.invoke('process-id-document',{body:{document_id:doc.id}});
   if(initial.error||(!initial.data?.ok&&!initial.data?.extracted))throw Error('Основне розпізнавання не завершено. '+(initial.error?.message||initial.data?.error||''));
   if(window.CRMDocumentSync?.automate)await CRMDocumentSync.automate(supabaseClient,doc.id);
   const fresh=await supabaseClient.from('documents').select('*').eq('id',doc.id).single();if(fresh.error)throw fresh.error;Object.assign(doc,fresh.data);
  }
  const {data,error}=await supabaseClient.storage.from('candidate-documents').createSignedUrl(doc.storage_path,300);if(error||!data?.signedUrl)throw Error('Немає доступу до оригіналу');
  const response=await fetch(data.signedUrl);if(!response.ok)throw Error('Не вдалося відкрити файл');const blob=await response.blob();if(blob.size>30000000)throw Error('Пілот підтримує файли до 30 МБ');
  if(/pdf/i.test(doc.mime_type||'')||/\.pdf$/i.test(doc.file_name||'')){
   await loadExternalScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js','pdfjsLib');pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';pdf=await pdfjsLib.getDocument({data:new Uint8Array(await blob.arrayBuffer())}).promise;total=pdf.numPages;if(total>200)throw Error('Поглиблене читання підтримує до 200 сторінок на файл.');
  }else if(blob.type.startsWith('image/'))bitmap=await createImageBitmap(blob);else throw Error('Потрібен PDF або зображення');
  await render();const saved=doc.ai_extracted?._military_zone_report;if(saved&&Array.isArray(saved.reports)&&['complete','complete_with_gaps'].includes(saved.status)){reports.push(...saved.reports);for(const report of saved.reports)if(report.mode==='zone')showReport(report,report.source.page);$('[data-auto-progress]').textContent='Готовий результат збережено '+(saved.saved_at||'')+'. Повторне розпізнавання не запускалося.';$('[data-auto]').textContent='Опрацювати заново';$('[data-manual]').append($('[data-auto]'));try{await crosscheck()}catch(e){status('Зіставлення не завершено: '+e.message)}}else if(autostart&&sourceReady)$('[data-auto]').onclick();
 }catch(e){status(e.message);lock(false)}
 return dialog;
}
window.CRMMilitaryZoneReview={open};
})();
