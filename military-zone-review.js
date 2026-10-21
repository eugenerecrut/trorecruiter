// Optional military-book pilot. Reads originals; exports a review report; never updates candidate facts.
(function(){
'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const full={x:0,y:0,w:1,h:1};
async function open(doc){
 if(!doc?.storage_path)throw Error('Документ не має файла');
 const dialog=document.createElement('dialog');dialog.className='crm-dialog crm-workflow-dialog';dialog.style.width='min(1100px,96vw)';
 dialog.innerHTML='<h2>Військовий квиток · читання зон · пілот</h2><p>'+esc(doc.file_name)+'</p><p>Оберіть сторінку. AI запропонує зони; їх можна змінити мишею або числовими полями. Результат потребує перевірки й не записується в картку.</p><div class="crm-actions"><button data-prev>←</button><span data-page></span><button data-next>→</button><button data-overview>Оглянути сторінку</button><button data-close>Закрити</button></div><div data-quality></div><div data-zones class="crm-actions"></div><div style="max-height:55vh;overflow:auto;border:1px solid #ccd"><canvas data-source style="display:block;max-width:100%;height:auto;touch-action:none" aria-label="Сторінка документа, виділіть зону мишею"></canvas></div><fieldset><legend>Зона читання, % від сторінки</legend><div style="display:flex;gap:10px;flex-wrap:wrap">'+[['x','Ліворуч'],['y','Згори'],['w','Ширина'],['h','Висота']].map(([k,l])=>'<label>'+l+'<input data-box="'+k+'" aria-label="'+l+'" type="number" min="0" max="100" step="0.1" value="'+(k==='w'||k==='h'?100:0)+'" style="width:80px;display:block"></label>').join('')+'</div><button data-read>Перечитати зону</button><button data-full>Уся сторінка</button></fieldset><p role="status" data-status></p><section data-result></section><div class="crm-actions"><button data-export disabled>Завантажити звіт JSON</button></div>';
 document.body.append(dialog);dialog.showModal();
 const $=s=>dialog.querySelector(s),canvas=$('[data-source]'),ctx=canvas.getContext('2d'),source=document.createElement('canvas'),reports=[];
 let page=1,total=1,pdf=null,bitmap=null,box={...full},closed=false,busy=false,renderId=0;
 const status=value=>$('[data-status]').textContent=value;
 function lock(value){busy=value;dialog.querySelectorAll('button,input').forEach(el=>el.disabled=value);$('[data-export]').disabled=value||!reports.length;if(!value){$('[data-prev]').disabled=page===1;$('[data-next]').disabled=page===total;}}
 function paint(){canvas.width=source.width;canvas.height=source.height;ctx.drawImage(source,0,0);ctx.lineWidth=Math.max(2,source.width/500);ctx.strokeStyle='#1676ba';ctx.strokeRect(box.x*source.width,box.y*source.height,box.w*source.width,box.h*source.height);}
 function setBox(value){const next=CRMMilitaryZoneContract.box(value);if(!next)return false;box=next;dialog.querySelectorAll('[data-box]').forEach(el=>el.value=+(box[el.dataset.box]*100).toFixed(2));paint();return true;}
 async function render(){const token=++renderId;lock(true);status('Відкриваємо оригінал сторінки…');try{
  if(pdf){const p=await pdf.getPage(page),base=p.getViewport({scale:1}),scale=Math.min(3.5,Math.sqrt(8000000/(base.width*base.height))),viewport=p.getViewport({scale});source.width=Math.ceil(viewport.width);source.height=Math.ceil(viewport.height);await p.render({canvasContext:source.getContext('2d'),viewport}).promise;}
  else{const scale=Math.min(1,Math.sqrt(8000000/(bitmap.width*bitmap.height)));source.width=Math.ceil(bitmap.width*scale);source.height=Math.ceil(bitmap.height*scale);source.getContext('2d').drawImage(bitmap,0,0,source.width,source.height);}
  if(closed||token!==renderId)return;setBox(full);$('[data-page]').textContent=page+' / '+total;$('[data-zones]').replaceChildren();$('[data-quality]').textContent='';$('[data-result]').replaceChildren();status('Огляньте сторінку або виділіть рядок таблиці.');
 }catch(e){status(e.message)}finally{if(!closed&&token===renderId)lock(false)}}
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
   const labels={start_date:'Початок',end_date:'Завершення',unit:'Частина / установа',position:'Посада',military_specialty:'ВОС',order_number:'Номер наказу',order_date:'Дата наказу',rank:'Звання',other:'Інше'};
   $('[data-result]').innerHTML='<h3>Результат · сторінка '+atPage+' · потребує перевірки</h3><p style="white-space:pre-wrap">'+esc(data.raw_text)+'</p>'+(data.rows||[]).map((row,i)=>'<h4>Рядок '+(i+1)+'</h4><p>'+esc(row.raw_text)+'</p><div style="overflow:auto"><table><thead><tr><th>Поле</th><th>Дослівно</th><th>Прочитане значення</th><th>Альтернативи / питання</th></tr></thead><tbody>'+(row.fields||[]).map(f=>'<tr><td>'+esc(labels[f.key]||f.key)+'</td><td>'+esc(f.raw_text)+'</td><td>'+esc(f.value??'Не визначено')+'</td><td>'+esc([...(f.alternatives||[]),f.reason].filter(Boolean).join(' · '))+'</td></tr>').join('')+'</tbody></table></div>').join('')+'<p>'+esc((data.warnings||[]).join(' · '))+'</p>';
   status('Прочитано через '+data.source.provider+'. Дані картки та початкове AI-розпізнавання не змінено.');
  }
 }catch(e){if(!closed)status('Не розпізнано: '+e.message)}finally{if(!closed)lock(false)}}
 function close(){if(busy){status('Дочекайтеся завершення операції.');return;}closed=true;pdf?.destroy();bitmap?.close?.();source.width=source.height=canvas.width=canvas.height=1;dialog.close();dialog.remove();}
 $('[data-close]').onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();close()});
 $('[data-overview]').onclick=()=>read('overview');$('[data-read]').onclick=()=>read('zone');$('[data-full]').onclick=()=>setBox(full);
 $('[data-prev]').onclick=()=>{if(page>1){page--;render()}};$('[data-next]').onclick=()=>{if(page<total){page++;render()}};
 dialog.querySelectorAll('[data-box]').forEach(el=>el.onchange=()=>{const next=Object.fromEntries([...dialog.querySelectorAll('[data-box]')].map(x=>[x.dataset.box,Number(x.value)/100]));if(!setBox(next)){status('Зона повинна бути в межах 0–100% і мати ненульову площу.');setBox(box)}});
 let start=null;const point=e=>{const r=canvas.getBoundingClientRect();return{x:Math.min(1,Math.max(0,(e.clientX-r.left)/r.width)),y:Math.min(1,Math.max(0,(e.clientY-r.top)/r.height))}};
 canvas.onpointerdown=e=>{if(busy)return;start=point(e);canvas.setPointerCapture(e.pointerId)};
 canvas.onpointermove=e=>{if(!start)return;const end=point(e);setBox({x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),w:Math.abs(end.x-start.x),h:Math.abs(end.y-start.y)})};canvas.onpointerup=canvas.onpointercancel=()=>start=null;
 $('[data-export]').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({pilot:CRMMilitaryZoneContract.VERSION,document_id:doc.id,reports},null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='Зональне_читання_'+doc.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
 lock(true);try{
  const {data,error}=await supabaseClient.storage.from('candidate-documents').createSignedUrl(doc.storage_path,300);if(error||!data?.signedUrl)throw Error('Немає доступу до оригіналу');
  const response=await fetch(data.signedUrl);if(!response.ok)throw Error('Не вдалося відкрити файл');const blob=await response.blob();if(blob.size>30000000)throw Error('Пілот підтримує файли до 30 МБ');
  if(/pdf/i.test(doc.mime_type||'')||/\.pdf$/i.test(doc.file_name||'')){
   await loadExternalScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js','pdfjsLib');pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';pdf=await pdfjsLib.getDocument({data:new Uint8Array(await blob.arrayBuffer())}).promise;total=pdf.numPages;
  }else if(blob.type.startsWith('image/'))bitmap=await createImageBitmap(blob);else throw Error('Потрібен PDF або зображення');
  await render();
 }catch(e){status(e.message);lock(false)}
 return dialog;
}
window.CRMMilitaryZoneReview={open};
})();
