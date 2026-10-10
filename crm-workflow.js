// Candidate stages, pauses and completion. Data stays in profile_data.workflow.
(function(){
'use strict';
const stages=['Новий кандидат','Дозвон та співбесіда','В роботі','ВЛК','Направлений до ВЧ'];
const outcomes=['Відмова кандидата','Відмова ВЧ','Переданий до іншої РМГ','Зарахований до ВЧ'];
const esc=v=>CRMWorkspace.escape(v);
const profile=c=>{if(typeof c.profile_data==='string'){try{return JSON.parse(c.profile_data)||{}}catch{return {}}}return c.profile_data||{}};
const wf=c=>profile(c).workflow||{};
const isArchived=c=>!!wf(c).archived_at;
const stage=c=>wf(c).stage||({'Новий':'Новий кандидат','Первинний контакт':'Дозвон та співбесіда','Співбесіда':'Дозвон та співбесіда','Перевірка документів':'В роботі','Рішення':'В роботі','Призначений':'Направлений до ВЧ','Відкладено':'В роботі','Втрачено контакт':'Дозвон та співбесіда'}[c.recruitment_status]|| (stages.includes(c.recruitment_status)?c.recruitment_status:'Новий кандидат'));
const label=c=>{const w=wf(c);if(!w.stage&&!w.outcome&&['Відмова','Втрачено контакт','Відкладено'].includes(c.recruitment_status))return c.recruitment_status+' · попередній статус, потребує уточнення';return [w.outcome||(CRMCandidateConditions.isUnit(c)?'Оформлює ВЧ':stage(c)),w.paused?'На паузі: '+(w.pause_reason||'причина не вказана'):'',w.outcome==='Зарахований до ВЧ'?(w.incomplete?'Неповний комплект':'Повний комплект'):'',w.outcome&&!w.archived_at?'Архівування не завершено':'',isArchived(c)?'Архів':''].filter(Boolean).join(' · ')};
const finalType=t=>['Припис про направлення','Реєстр кандидата','Наказ про зарахування до ВЧ'].includes(t);
const latest=docs=>CRMResponsibility.latest(docs);
const match=(r,d)=>r.id===d.requirement_id||r.document_type===d.document_type;
const missing=(c,reqs,docs,excludeFinal=false)=>reqs.filter(r=>r.is_required&&requirementCondition(r,c)!==false&&(!excludeFinal||!finalType(r.document_type))).filter(r=>{if(requirementCondition(r,c)===null)return true;if(CRMCandidateConditions.isMobilization(c)&&CRMCandidateConditions.militaryDocument(r.document_type))return !CRMCandidateConditions.covered(r,docs,c);const needed=r.condition_field==='has_children'?Math.max(1,Number(c.children_count)||((profile(c).relatives||[]).filter(r=>/син|доньк|дитин/i.test(r.relationship||r.relation||'')).length)):1;return docs.filter(d=>match(r,d)&&d.verification_status==='Підтверджено').length<needed}).map(r=>(requirementCondition(r,c)===null?'Уточніть умову: ':'')+(CRMCandidateConditions.isMobilization(c)&&CRMCandidateConditions.militaryDocument(r.document_type)?'Військовий квиток або приписне / Резерв+':r.document_type)).filter((t,i,a)=>a.indexOf(t)===i);
function modal(title,html){const d=document.createElement('dialog');d.className='crm-dialog crm-workflow-dialog';d.innerHTML='<h2>'+esc(title)+'</h2>'+html+'<div class="crm-actions"><button type="button" data-close>Закрити</button></div>';document.body.append(d);d.showModal();d.querySelector('[data-close]').onclick=()=>{if(CRMWorkspace.busy)return;d.close();d.remove()};d.addEventListener('cancel',e=>{if(CRMWorkspace.busy)e.preventDefault();else d.remove()});return d}
async function persist(c,patch){
 const r=await supabaseClient.from('candidates').select('*').eq('id',c.id).single();if(r.error)throw r.error;
 const p=profile(r.data),old=wf(r.data);
 if(JSON.stringify(old)!==JSON.stringify(wf(c)))throw Error('Етап справи вже змінив інший працівник. Оновіть картку.');
 const user=await getCurrentUser();if(!user)throw Error('Увійдіть повторно.');
 const next={...old,...patch,changed_at:new Date().toISOString(),changed_by:user.id};
 let q=supabaseClient.from('candidates').update({profile_data:{...p,workflow:next},recruitment_status:next.outcome||next.stage||r.data.recruitment_status,updated_at:next.changed_at}).eq('id',c.id);
 q=r.data.updated_at?q.eq('updated_at',r.data.updated_at):q.is('updated_at',null);
 const saved=await q.select('*').single();if(saved.error)throw saved.error;
 const card=CRMWorkspace.card;if(card?.candidateId===c.id&&card.expectedUpdatedAt===r.data.updated_at)card.expectedUpdatedAt=saved.data.updated_at;
 Object.assign(c,saved.data);return next;
}
let pdfPromise;
function pdfLibrary(){if(window.PDFLib)return Promise.resolve(window.PDFLib);if(!pdfPromise)pdfPromise=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';s.onload=()=>resolve(window.PDFLib);s.onerror=()=>{pdfPromise=null;s.remove();reject(Error('Не вдалося завантажити модуль PDF. Спробуйте знову.'))};document.head.append(s)});return pdfPromise}
async function textPDF(title,lines){
 const {PDFDocument}=await pdfLibrary(),pdf=await PDFDocument.create();pdf.setTitle(title);
 let canvas,ctx,y;
 const fresh=()=>{canvas=document.createElement('canvas');canvas.width=1240;canvas.height=1754;ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1240,1754);ctx.fillStyle='#18232d';ctx.font='24px Arial';y=90};
 const flush=async()=>{const blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',.85));if(!blob)throw Error('Не вдалося сформувати сторінку PDF');const img=await pdf.embedJpg(await blob.arrayBuffer());pdf.addPage([595.28,841.89]).drawImage(img,{x:0,y:0,width:595.28,height:841.89});canvas.width=canvas.height=0};
 fresh();
 for(const line of [title,'',...lines]){for(const paragraph of String(line??'').split('\n')){let row='';for(const word of paragraph.split(/\s+/)){if(ctx.measureText(row+' '+word).width>1060&&row){if(y>1640){await flush();fresh()}ctx.fillText(row,80,y);y+=36;row=word}else row+=(row?' ':'')+word}if(y>1640){await flush();fresh()}ctx.fillText(row,80,y);y+=36}}
 await flush();return new Blob([await pdf.save()],{type:'application/pdf'});
}
async function mergedPDF(docs,progress,cover=null,snapshot=null){
 const {PDFDocument}=await pdfLibrary(),out=await PDFDocument.create();
 if(cover){const first=await PDFDocument.load(await cover.arrayBuffer());(await out.copyPages(first,first.getPageIndices())).forEach(p=>out.addPage(p))}
 for(let i=0;i<docs.length;i++){
  const d=docs[i];progress('Додаємо '+(i+1)+'/'+docs.length+': '+d.file_name);
  const r=await supabaseClient.storage.from(DOC_BUCKET).download(d.storage_path);if(r.error)throw Error(d.file_name+': '+r.error.message);
  const bytes=new Uint8Array(await r.data.arrayBuffer());
  try{
   if(bytes[0]===37&&bytes[1]===80&&bytes[2]===68&&bytes[3]===70){const source=await PDFDocument.load(bytes);if(!source.getPageCount())throw Error('порожній PDF');const pages=await out.copyPages(source,source.getPageIndices());pages.forEach(p=>out.addPage(p))}
   else if((bytes[0]===255&&bytes[1]===216)||(bytes[0]===137&&bytes[1]===80)){const image=bytes[0]===255?await out.embedJpg(bytes):await out.embedPng(bytes);const landscape=image.width>image.height, width=landscape?841.89:595.28,height=landscape?595.28:841.89,s=Math.min((width-36)/image.width,(height-36)/image.height);out.addPage([width,height]).drawImage(image,{x:(width-image.width*s)/2,y:(height-image.height*s)/2,width:image.width*s,height:image.height*s})}
   else if(/\.docx?$/i.test(d.file_name||'')){await out.attach(bytes,d.file_name,{mimeType:d.mime_type||'application/octet-stream'});const notice=await textPDF('Вкладений документ',[d.document_type,d.file_name,'Оригінал Word збережений усередині цього PDF як вкладення. Відкрийте панель вкладень у PDF-програмі.']);const pageDoc=await PDFDocument.load(await notice.arrayBuffer());(await out.copyPages(pageDoc,pageDoc.getPageIndices())).forEach(p=>out.addPage(p))}
   else throw Error('потрібна PDF-копія цього файла');
  }catch(e){throw Error(d.file_name+': '+e.message)}
 }
 if(snapshot)await out.attach(new TextEncoder().encode(JSON.stringify(snapshot,null,2)),'дані-особової-справи.json',{mimeType:'application/json',description:'Повні збережені дані картки та розпізнавання документів'});
 if(!out.getPageCount())throw Error('У пакеті немає сторінок.');return new Blob([await out.save()],{type:'application/pdf'});
}
async function storePackage(c,kind,blob,docs){
 const path=c.id+'/packages/'+kind+'-'+crypto.randomUUID()+'.pdf';const r=await supabaseClient.storage.from(DOC_BUCKET).upload(path,blob,{contentType:'application/pdf',upsert:false});if(r.error)throw r.error;
 return {path,size:blob.size,source_document_ids:docs.map(d=>d.id),created_at:new Date().toISOString()};
}
async function download(path,name){const r=await supabaseClient.storage.from(DOC_BUCKET).download(path);if(r.error)throw r.error;const url=URL.createObjectURL(r.data),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)}
async function generated(c,title,lines,reqs){const blob=await textPDF(title,lines),path=c.id+'/generated/'+crypto.randomUUID()+'.pdf',user=await getCurrentUser();if(!user)throw Error('Увійдіть повторно.');const r=await supabaseClient.storage.from(DOC_BUCKET).upload(path,blob,{contentType:'application/pdf'});if(r.error)throw r.error;const req=reqs.find(r=>r.document_type===title);const d=await supabaseClient.from('documents').insert({candidate_id:c.id,requirement_id:req?.id||null,document_type:title,file_name:title+'.pdf',file_size:blob.size,mime_type:'application/pdf',storage_path:path,uploaded_by:user.id,status:'Завантажено',processing_status:'Завантажено',verification_status:'Не перевірено'});if(d.error)throw d.error;await download(path,title+'.pdf')}
async function archive(c,progress){
 const pending=await supabaseClient.from('crm_archive').select('pdf_path,pdf_sha256,state').eq('candidate_id',c.id).maybeSingle();if(pending.error)throw pending.error;
 let path=pending.data?.pdf_path,sha=pending.data?.pdf_sha256,manifest=[],personal=null;
 if(!path){
  const result=await supabaseClient.from('documents').select('*').eq('candidate_id',c.id);if(result.error)throw result.error;
  const pf=await supabaseClient.from('personal_files').select('*').eq('candidate_id',c.id).maybeSingle();if(pf.error)throw pf.error;personal=pf.data;
  const all=result.data||[],w=wf(c),docs=latest(all).filter(d=>w.outcome==='Зарахований до ВЧ'||!finalType(d.document_type));
  const cardLines=CRMHistoryFormat.changes(Object.fromEntries(Object.entries({...c,...personal,profile_data:profile(c)}).filter(([k])=>!k.startsWith('__')).map(([k,v])=>[k,{before:null,after:v}]))).map(r=>r.label+': '+r.after);
  manifest=all.map(d=>({id:d.id,path:d.storage_path,version:d.version_number,deleted_at:d.deleted_at,size:d.file_size})).sort((a,b)=>a.id.localeCompare(b.id));
  const cover=await textPDF('Архів особової справи',[c.name_nominative||c.full_name,'Телефон: '+(c.phone||'Не вказано'),'Дата народження: '+(c.birth_date||'Не вказано'),'Результат: '+w.outcome,'Дата: '+w.completion_date,'ВЧ / РМГ: '+w.destination,'Причина: '+w.reason,'Наказ: '+(w.order_number||'—')+' від '+(w.order_date||'—'),'Неповний комплект: '+(w.incomplete?'Так':'Ні'),'Відсутні документи: '+(w.missing_documents||'—'),'Примітки: '+(c.notes||'—'),'Дані картки:',...cardLines,'Включені документи:',...docs.map((d,i)=>(i+1)+'. '+d.document_type+' — '+d.file_name)]);
  const blob=await mergedPDF(docs,progress,cover,{candidate:c,personal_file:personal,document_data:docs.map(d=>({document_type:d.document_type,file_name:d.file_name,ai_extracted:d.ai_extracted,ai_raw_response:d.ai_raw_response}))}),pkg=await storePackage(c,'archive',blob,docs);path=pkg.path;
  sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))).map(b=>b.toString(16).padStart(2,'0')).join('');
 }
 if(!pending.data){
  const signed=await supabaseClient.storage.from(DOC_BUCKET).createSignedUrl(path,600);if(signed.error)throw signed.error;
  await new Promise((resolve,reject)=>{const review=document.createElement('dialog');review.className='crm-dialog crm-workflow-dialog';review.innerHTML='<h2>Перевірте архівний PDF</h2><p>Після підтвердження картка, окремі файли, їхні версії та результати AI будуть видалені незворотно. Залишиться цей PDF і запис у журналі.</p><iframe title="Архівний PDF" style="width:100%;height:50vh;border:1px solid #ddd"></iframe><div class="crm-actions"><button data-download>Завантажити для перевірки</button><button data-approve>PDF перевірено — архівувати та видалити оригінали</button><button data-cancel>Скасувати</button></div>';document.body.append(review);review.querySelector('iframe').src=signed.data.signedUrl;review.showModal();const end=ok=>{review.close();review.remove();ok?resolve():reject(Error('Перенесення скасовано. Оригінали не видалені.'))};review.querySelector('[data-approve]').onclick=()=>end(true);review.querySelector('[data-cancel]').onclick=()=>end(false);review.querySelector('[data-download]').onclick=()=>download(path,'Особова_справа.pdf').catch(e=>alert(e.message));review.addEventListener('cancel',e=>{e.preventDefault();end(false)})});
 }
 progress('PDF збережено. Переносимо в журнал «Архів» і видаляємо оригінали…');
 const result=await supabaseClient.functions.invoke('archive-candidate',{body:{candidate_id:c.id,pdf_path:path,pdf_sha256:sha,manifest,personal_file:personal,candidate_updated_at:c.updated_at,confirm_delete_originals:true}});
 if(result.error){let message=result.error.message;try{message=(await result.error.context.json()).error||message}catch{}throw Error(message)}
 if(result.data?.state!=='Готово')throw Error(result.data?.error||'Архівування не завершено');
 c.__archived=true;CRMWorkspace.card=null;
}
function preview(title,lines,options={}){
 const d=modal(title,'<article class="crm-workflow-print"><h2>'+esc(title)+'</h2>'+lines.map(l=>'<p>'+esc(l).replace(/\n/g,'<br>')+'</p>').join('')+'</article>'+(options.pdfFileName?'<button type="button" data-pdf>Завантажити PDF</button> ':'')+'<button type="button" data-print>Друкувати</button>');
 d.setAttribute('aria-label',title);d.querySelector(':scope > h2')?.remove();d.querySelector('[data-print]').onclick=()=>window.print();
 const pdfButton=d.querySelector('[data-pdf]');
 if(pdfButton)pdfButton.onclick=async()=>{
  pdfButton.disabled=true;
  try{const blob=await textPDF(title,lines),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=options.pdfFileName;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
  catch(error){alert('Не вдалося сформувати PDF: '+error.message)}finally{pdfButton.disabled=false;}
 };
 return d;
}
// Candidate handout only: internal CRM requirements and collected files remain unchanged.
function candidateDocumentLines(c,reqs){
 const excluded=/^(?:Заява на контракт|Згода на обробку даних(?: для психологічного тестування)?|Картка соціально-психологічного вивчення|Анкета на контракт|Розписка кандидата на військову службу за контрактом|Характеристика|Додаток 13\b|Сертифікат психологічного тестування)/iu;
 return reqs.map(r=>CRMCandidateConditions.forCandidate(r,c)).filter(r=>requirementCondition(r,c)!==false&&!finalType(r.document_type)&&!['Титульний аркуш','Послужний список','Перелік документів'].includes(r.document_type)&&!/рекомендац/iu.test(r.document_type||'')&&!excluded.test(String(r.document_type||'').trim())).map(r=>{
  const note=String(r.condition_note||'').trim(),internal=/AI|OCR|розпізнаван|розпізнає|збереження файла|контейнер|лише завантаження|підтвердження|картк[ау] кандидата/iu.test(note);
  const title=String(r.document_type||'').trim(),copyTitle=/^(?:копі[яї](?:\s|$)|фото(?:\s|\d|$))/iu.test(title)?title:'Копія: '+title;
  return (r.is_required?'□ ':'□ За наявності: ')+copyTitle+(!internal&&note?' — '+note:'')+(requirementCondition(r,c)===null?' — уточніть у рекрутера':'');
 });
}
async function mount(c,root){
 const host=root.querySelector('[data-workflow]');if(!host)return;
 let reqs=await getDocumentRequirements(),docs=latest(await getCandidateDocuments(c.id));
 const unit=CRMCandidateConditions.isUnit(c),w=wf(c),archived=isArchived(c),closed=!!w.outcome,miss=missing(c,reqs,docs,true);
 host.innerHTML='<details class="wf-panel" '+(document.documentElement.dataset.crmLayout==='mobile'?'':'open')+'><summary class="wf-panel-summary"><strong>Рух справи</strong><span class="wf-stage-badge">'+esc(label(c))+'</span></summary><div class="wf-panel-body">'+(c.recruitment_status==='Призначений'&&!w.stage?'<p class="crm-notice">Попередній статус «Призначений»: уточніть зарахування наказом.</p>':'')+
 '<form data-progress-form class="crm-workflow-grid wf-progress">'+(!unit?'<label class="wf-stage-field">Етап оформлення<select name="stage">'+stages.map(s=>'<option '+(s===stage(c)?'selected':'')+'>'+esc(s)+'</option>').join('')+'</select></label>':'<p class="wf-stage-field">Оформлення проводить ВЧ. Наші етапи не застосовуються.</p>')+
 '<label class="wf-switch"><input type="checkbox" name="paused" '+(w.paused?'checked':'')+'> На паузі</label><div class="wf-save"><button type="submit" '+(closed?'disabled':'')+'>Зберегти етап</button></div>'+
 '<label data-pause-details>Причина паузи<select name="pause_reason">'+['','Не відповідає','Неактуальний номер','Труднощі з телефоном / Дією / Армія+','Очікуємо документ або відповідь','Особисті обставини','Інше'].map(s=>'<option '+(s===w.pause_reason?'selected':'')+'>'+esc(s)+'</option>').join('')+'</select></label><label data-pause-details>Наступна дія<textarea name="next_action" rows="2">'+esc(w.next_action||'')+'</textarea></label><label data-pause-details>Контрольна дата<input name="next_contact_date" type="date" value="'+esc(w.next_contact_date||'')+'"></label>'+
 (!unit?'<label class="wf-switch wf-exams" data-exams-toggle><input type="checkbox" name="additional_exams" '+(w.additional_exams?'checked':'')+'> Додаткові обстеження ВЛК</label><label data-exams-details>Обстеження / наступна дія<textarea name="exams_details" rows="2">'+esc(w.exams_details||'')+'</textarea></label><label data-exams-details>Контрольна дата обстежень<input name="exams_date" type="date" value="'+esc(w.exams_date||'')+'"></label>':'')+'</form>'+
 (!unit&&!closed?'<details class="wf-readiness"><summary>'+esc(miss.length?'До направлення бракує документів: '+miss.length:'Комплект документів перевірений')+'</summary>'+(miss.length?'<ul>'+miss.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':'')+'<p>'+ (CRMCandidateConditions.isMobilization(c)?'Мобілізація: психологічний тест — контрольний пункт. Для нього сформуйте Обов’язкову інформацію з освітою та трудовим стажем. Перша сторінка сертифіката психологічного тестування обов’язкова. Припис і реєстр обов’язкові.':'Психологічний тест — контрольний пункт. Завантажте першу сторінку сертифіката та висновок ВЛК у документи.')+'</p></details>':'')+
 (!closed?'<div class="wf-main-actions">'+(!unit?'<div class="crm-actions"><button type="button" data-list>Надати список документів</button><button type="button" data-info>Обов’язкова інформація</button></div>':'<span>РЛ · припис · реєстр кандидата</span>')+'<button type="button" class="wf-finish" data-finish>Завершити справу →</button></div>':'')+
 '<details class="wf-tools"><summary>Друк та пакети документів</summary><div class="wf-tool-grid"><button type="button" '+(unit?'hidden':'')+' data-card13>Картка 13 <small>Дані з CRM · PDF</small></button><button type="button" '+(unit?'hidden':'')+' data-service>Послужний список</button><button type="button" '+(unit?'hidden':'')+' data-inventory>Перелік документів</button><button type="button" '+(unit?'hidden':'')+' data-title>Титул</button><button type="button" data-registry>Реєстр кандидата</button><button type="button" '+(unit?'hidden':'')+' data-anketa>PDF «Анкета»</button></div></details>'+
 (closed?'<p>Результат: '+esc(w.outcome)+' · '+esc(w.completion_date||'')+'</p>'+(w.archive_error?'<p class="crm-notice">Архівний пакет не сформовано: '+esc(w.archive_error)+'</p>':'')+(!archived?'<div class="crm-actions"><button type="button" data-retry>Повторити формування архіву</button>'+(!w.archive_lock?'<button type="button" data-reopen>Скасувати завершення справи</button>':'')+'</div>':'<p>Справа в окремому журналі «Архів».</p>'):'')+
 (w.archive_package?'<button type="button" data-download-archive>Завантажити архівний PDF</button>':'')+(w.anketa_package?'<button type="button" data-download-anketa>Завантажити PDF «Анкета»</button>':'')+'<p data-workflow-status role="status"></p></div></details>';
 const workflowState={form:host.querySelector('[data-progress-form]'),dirty:false};CRMWorkspace.workflow=workflowState;
 const status=host.querySelector('[data-workflow-status]');
 const progressForm=host.querySelector('[data-progress-form]'),syncFields=()=>{const paused=progressForm.elements.paused.checked,vlk=progressForm.elements.stage?.value==='ВЛК',extra=progressForm.elements.additional_exams;host.querySelectorAll('[data-pause-details]').forEach(e=>e.hidden=!paused);if(extra){if(!vlk)extra.checked=false;host.querySelector('[data-exams-toggle]').hidden=!vlk;host.querySelectorAll('[data-exams-details]').forEach(e=>e.hidden=!vlk||!extra.checked)}};progressForm.addEventListener('input',()=>workflowState.dirty=true);progressForm.addEventListener('change',()=>{workflowState.dirty=true;syncFields();status.textContent='Є незбережені зміни етапу. Натисніть «Зберегти етап».'});syncFields();
 const run=async (fn,saveProgress=false)=>{if(CRMWorkspace.busy)return;if(workflowState.dirty&&!saveProgress){status.textContent='Спочатку збережіть зміни етапу. Після цього можна формувати документи.';return;} if(!await CRMWorkspace.guard())return;const refreshed=await supabaseClient.from('candidates').select('*').eq('id',c.id).single();if(refreshed.error){status.textContent=refreshed.error.message;return}if(JSON.stringify(wf(refreshed.data))!==JSON.stringify(wf(c))){status.textContent='Справа змінилася. Оновіть картку.';return}Object.assign(c,refreshed.data);CRMWorkspace.busy=true;host.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();status.textContent='Готово.'}catch(e){status.textContent=e.message}finally{CRMWorkspace.busy=false;if(c.__archived)await CRMWorkspace.navigate('archive');else host.querySelectorAll('button').forEach(b=>b.disabled=!!wf(c).outcome&&b.type==='submit')}};
 const refresh=async()=>{const r=await supabaseClient.from('candidates').select('*').eq('id',c.id).single();if(!r.error)Object.assign(c,r.data);await mount(c,root)};
 host.querySelector('[data-progress-form]').onsubmit=e=>{e.preventDefault();run(async()=>{if(wf(c).outcome)throw Error('Роботу зі справою вже завершено.');const f=new FormData(e.target),paused=f.has('paused'),additional=f.has('additional_exams'),s=unit?null:String(f.get('stage'));if(paused&&(!f.get('pause_reason')||!String(f.get('next_action')||'').trim()))throw Error('Вкажіть причину паузи та наступну дію.');if(additional&&(!String(f.get('exams_details')||'').trim()||!f.get('exams_date')))throw Error('Вкажіть додаткові обстеження та контрольну дату.');if(additional&&s!=='ВЛК')throw Error('Додаткові обстеження позначаються на етапі ВЛК.');if(s==='Направлений до ВЧ'){docs=latest(await getCandidateDocuments(c.id));const needed=missing(c,reqs,docs,true);if(needed.length)throw Error('Спочатку перевірте документи: '+needed.join(', '));if(!docs.some(d=>d.document_type==='Припис про направлення'&&d.verification_status==='Підтверджено')||!docs.some(d=>d.document_type==='Реєстр кандидата'&&d.verification_status==='Підтверджено'))throw Error('Додайте та перевірте припис і реєстр кандидата.')}await persist(c,{stage:s,paused,pause_reason:paused?String(f.get('pause_reason')):null,next_action:paused?String(f.get('next_action')).trim():null,next_contact_date:paused?f.get('next_contact_date')||null:null,additional_exams:additional,exams_details:additional?String(f.get('exams_details')).trim():null,exams_date:additional?f.get('exams_date'):null});workflowState.dirty=false;await refresh()},true)};
 host.querySelector('[data-info]')?.addEventListener('click',()=>crmNavigate('information',c.id));
 host.querySelector('[data-card13]')?.addEventListener('click',()=>CRMCard13.open(c));
 host.querySelector('[data-list]')?.addEventListener('click',async()=>{if(!await CRMWorkspace.guard())return;const lines=candidateDocumentLines(c,reqs),candidateName=c.name_nominative||c.full_name;const d=preview('Список документів — '+candidateName,lines,{pdfFileName:'Список документів — '+String(candidateName||'Кандидат').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_')+'.pdf'});const b=document.createElement('button');b.textContent='Список надано — кандидат в роботі';d.querySelector('.crm-actions').prepend(b);b.onclick=()=>{d.close();d.remove();run(async()=>{await persist(c,{stage:'В роботі',documents_list_given_at:new Date().toISOString()});if(!c.__archived)await refresh()})}});
 const generate=(selector,title,lines)=>host.querySelector(selector)?.addEventListener('click',()=>run(async()=>{await generated(c,title,lines,reqs);docs=latest(await getCandidateDocuments(c.id))}));
 const name=c.name_nominative||c.full_name,p=profile(c);
 const anketaFileName='Анкета_'+String(name||'Кандидат').replace(/[<>:\x22\/\\|?*\x00-\x1f]/g,'_').trim().replace(/[. ]+$/g,'')+'.pdf';
 generate('[data-title]','Титульний аркуш',['Особова справа',name,'Військова частина: '+(p.military_unit||'Не вказано'),'Посада: '+(c.desired_position||'Не вказано')]);
 generate('[data-registry]','Реєстр кандидата',[name]);
 generate('[data-inventory]','Перелік документів',[name,...docs.map((d,i)=>(i+1)+'. '+d.document_type+' — '+d.file_name)]);
 host.querySelector('[data-service]').onclick=()=>run(async()=>{const pf=await supabaseClient.from('personal_files').select('*').eq('candidate_id',c.id).maybeSingle();if(pf.error)throw pf.error;await generated(c,'Послужний список',[name,'Дата народження: '+(c.birth_date||'Не вказано'),'Звання: '+(c.military_rank||'Не вказано'),'ВОС: '+(c.military_specialty||p.military_specialty||'Не вказано'),'Військова служба: '+(pf.data?.military_service_history||pf.data?.military_experience||'Не вказано'),'Освіта: '+(pf.data?.education||'Не вказано'),'Трудова діяльність: '+(pf.data?.work_history||'Не вказано'),...CRMHistoryFormat.changes({profile_data:{before:null,after:Object.fromEntries(Object.entries(profile(c)).filter(([k])=>/education|military|service|work|award|combat/.test(k)))}}).map(r=>r.label+': '+r.after)],reqs)});
 host.querySelector('[data-anketa]').onclick=()=>run(async()=>{
  const groups=[
   ['Анкета',/анкета на контракт/iu],
   ['Паспорт або ID-картка',/паспорт|(?:^|[\s/])ID[\s‑–—-]*карт|^ID$/iu],
   ['ІПН / РНОКПП',/ідентифікаційн.*код|РНОКПП|платника податк/iu],
   ['Довідка ВЛК',/^Довідка ВЛК$/iu],
   ['Форма 13',/(?:додаток|картка|форма)\s*13|картка обстеження та медичного огляду/iu],
   ['Військово-обліковий документ',/військов.*квит|припис[нк]|резерв\s*\+/iu],
   ['Повна довідка про несудимість',/несудимість/iu],
   ['УБД',/УБД/iu,true],
   ['Посвідчення водія',/посвідчення водія/iu,true]
  ];
  docs=latest(await getCandidateDocuments(c.id));const packageDocs=[],packageRows=[];
  for(const [title,re,optional] of groups){
   let found=docs.filter(d=>re.test(d.document_type));
   if(title==='Військово-обліковий документ'){
    const tickets=found.filter(d=>/військов.*квит/iu.test(d.document_type));
    if(tickets.length)found=tickets;
    else{
     const prescriptions=found.filter(d=>/припис[нк]/iu.test(d.document_type));
     found=prescriptions.length?prescriptions:found.filter(d=>/резерв\s*\+/iu.test(d.document_type));
    }
   }
   const state=!found.length?(optional?'За наявності — не додано':'Не завантажено'):found.some(d=>d.verification_status!=='Підтверджено')?'Потрібно підтвердити':'Готово';
   packageRows.push({title,optional,files:found,state,blocked:(!optional&&!found.length)||found.some(d=>d.verification_status!=='Підтверджено')});
   packageDocs.push(...found);
  }
  const blocked=packageRows.some(row=>row.blocked);
  const d=modal('Пакет PDF «Анкета»','<p>'+esc(name)+' · '+esc(anketaFileName)+'</p><p class="muted">Обов’язкові документи мають бути завантажені та підтверджені. УБД і посвідчення водія додаються за наявності.</p><ol class="wf-package-list">'+packageRows.map(row=>'<li class="'+(row.blocked?'wf-package-blocked':'')+'"><div><strong>'+esc(row.title)+'</strong><span>'+esc(row.state)+'</span></div>'+row.files.map(file=>'<small>'+esc(file.file_name)+'</small>').join('')+'</li>').join('')+'</ol>'+(blocked?'<p role="status">Спочатку додайте або перевірте позначені документи.</p><button data-open-documents>Відкрити документи кандидата</button>':'')+'<button data-build '+(blocked?'disabled':'')+'>Сформувати цей пакет</button>');
  d.querySelector('[data-open-documents]')?.addEventListener('click',()=>{d.close();d.remove();CRMWorkspace.navigate('documents',c.id)});
  d.querySelector('[data-build]').onclick=()=>{d.close();d.remove();run(async()=>{const pkg=await storePackage(c,'anketa',await mergedPDF(packageDocs,t=>status.textContent=t),packageDocs);await persist(c,{anketa_package:pkg});await download(pkg.path,anketaFileName);await refresh()})};
 });
 host.querySelector('[data-finish]')?.addEventListener('click',async()=>{if(!await CRMWorkspace.guard())return;docs=latest(await getCandidateDocuments(c.id));const d=modal('Завершення справи','<form data-completion class="crm-workflow-grid"><label>Результат<select name="outcome">'+outcomes.map(o=>'<option>'+esc(o)+'</option>').join('')+'</select></label><label>Дата<input name="completion_date" type="date" required></label><label>Причина / пояснення<textarea name="reason" required></textarea></label><label>ВЧ або РМГ, яка приймає кандидата<input name="destination"></label><label>Номер наказу про зарахування<input name="order_number"></label><label>Дата наказу<input type="date" name="order_date"></label><label><input type="checkbox" name="incomplete"> Неповний комплект</label><label>Причина неповного комплекту<textarea name="incomplete_reason"></textarea></label><label>Відсутні документи<textarea name="missing_documents">'+esc(missing(c,reqs,docs).join('\n'))+'</textarea></label><p><strong>Після перевірки збереженого PDF картка та всі окремі файли, версії й результати AI будуть видалені. У журналі «Архів» залишиться тільки один PDF і короткий запис. Видалення оригіналів незворотне.</strong></p><p>Для відмови / передачі до РМГ наказ, припис і реєстр не входять у пакет. Для зарахування — входять, якщо завантажені. Припис обов’язковий.</p><details><summary>Наявні документи</summary><ul>'+docs.map(x=>'<li>'+esc(x.document_type)+' · '+esc(x.file_name)+'</li>').join('')+'</ul></details><button type="submit">Підготувати архівний PDF для перевірки</button><p data-error role="status"></p></form>');const f=d.querySelector('form');f.onsubmit=async e=>{e.preventDefault();docs=latest(await getCandidateDocuments(c.id));const fd=new FormData(f),outcome=String(fd.get('outcome')),enrolled=outcome==='Зарахований до ВЧ';if((enrolled||outcome==='Переданий до іншої РМГ')&&!String(fd.get('destination')||'').trim()){d.querySelector('[data-error]').textContent='Вкажіть ВЧ або РМГ, яка приймає кандидата.';return}if(enrolled&&(!fd.get('order_number')||!fd.get('order_date'))){d.querySelector('[data-error]').textContent='Вкажіть номер і дату наказу.';return}if(enrolled&&!docs.some(x=>x.document_type==='Припис про направлення'&&x.verification_status==='Підтверджено')){d.querySelector('[data-error]').textContent='Завантажте та перевірте припис.';return}if(enrolled&&fd.has('incomplete')&&(!String(fd.get('incomplete_reason')||'').trim()||!String(fd.get('missing_documents')||'').trim())){d.querySelector('[data-error]').textContent='Вкажіть причину неповного комплекту та відсутні документи.';return}if(enrolled&&!fd.has('incomplete')&&missing(c,reqs,docs).length){d.querySelector('[data-error]').textContent='Комплект неповний: перевірте документи або позначте неповний комплект.';return}d.close();d.remove();run(async()=>{await persist(c,{outcome,stage:enrolled?'Зарахований до ВЧ':stage(c),paused:false,pause_reason:null,completion_date:fd.get('completion_date'),reason:String(fd.get('reason')).trim(),destination:String(fd.get('destination')).trim(),order_number:enrolled?String(fd.get('order_number')).trim():null,order_date:enrolled?fd.get('order_date'):null,incomplete:enrolled&&fd.has('incomplete'),incomplete_reason:enrolled?String(fd.get('incomplete_reason')||'').trim():null,missing_documents:enrolled?String(fd.get('missing_documents')||'').trim():null,archive_error:null});try{await archive(c,t=>status.textContent=t)}catch(e){try{await persist(c,{archive_error:e.message})}catch{}await refresh();throw e}if(!c.__archived)await refresh()})}});
 host.querySelector('[data-reopen]')?.addEventListener('click',()=>run(async()=>{await persist(c,{outcome:null,stage:stages.includes(stage(c))?stage(c):'В роботі',completion_date:null,archive_error:null,order_number:null,order_date:null,incomplete:false,missing_documents:null,incomplete_reason:null});await refresh()}));
 host.querySelector('[data-retry]')?.addEventListener('click',()=>run(async()=>{try{await archive(c,t=>status.textContent=t)}catch(e){try{await persist(c,{archive_error:e.message})}catch{}await refresh();throw e}if(!c.__archived)await refresh()}));
 host.querySelector('[data-download-archive]')?.addEventListener('click',()=>run(()=>download(wf(c).archive_package.path,'Особова_справа.pdf')));
 host.querySelector('[data-download-anketa]')?.addEventListener('click',()=>run(()=>download(wf(c).anketa_package.path,anketaFileName)));
 if(closed)host.querySelectorAll('form input,form select,form textarea').forEach(el=>el.disabled=true);
}
async function showArchive(){
 CRMWorkspace.card=null;CRMWorkspace.markMenu('archive');const content=document.querySelector('.content');content.innerHTML='<h1 class="page-title">Архів</h1><p>Завершені справи. Один PDF на кандидата.</p><input class="crm-search" data-archive-search placeholder="Пошук за ПІБ, ВЧ / РМГ"><section class="card"><div data-archive-rows>Завантажуємо…</div></section>';
 const r=await supabaseClient.from('crm_archive').select('id,candidate_id,full_name,phone,outcome,completion_date,destination,incomplete,pdf_path,state,error,archived_at').order('archived_at',{ascending:false});if(r.error){content.querySelector('[data-archive-rows]').textContent=r.error.message;return}
 const render=()=>{const q=content.querySelector('[data-archive-search]').value.trim().toLocaleLowerCase('uk-UA');content.querySelector('[data-archive-rows]').innerHTML=(r.data||[]).filter(a=>[a.full_name,a.destination,a.outcome].join(' ').toLocaleLowerCase('uk-UA').includes(q)).map(a=>'<article class="crm-archive-row"><strong>'+esc(a.full_name)+'</strong><p>'+esc([a.outcome,a.incomplete?'Неповний комплект':'',a.completion_date,a.destination].filter(Boolean).join(' · '))+'</p><p>'+esc(a.state==='Готово'?'Архівовано':'Очищення не завершено: '+(a.error||'триває перенесення'))+'</p><button data-archive-download="'+esc(a.id)+'">Завантажити PDF</button>'+(a.state!=='Готово'?'<button data-archive-resume="'+esc(a.candidate_id)+'">Продовжити очищення</button>':'')+'</article>').join('')||'<p>Архівних справ за цим пошуком немає.</p>'};render();content.querySelector('[data-archive-search]').oninput=render;
 content.querySelector('[data-archive-rows]').onclick=async e=>{const b=e.target.closest('button');if(!b||CRMWorkspace.busy)return;try{if(b.dataset.archiveDownload){const a=r.data.find(x=>x.id===b.dataset.archiveDownload);await download(a.pdf_path,'Особова_справа.pdf')}else if(b.dataset.archiveResume){if(!confirm('Продовжити видалення окремих оригіналів? У журналі залишиться один PDF.'))return;CRMWorkspace.busy=true;const a=r.data.find(x=>x.candidate_id===b.dataset.archiveResume),response=await supabaseClient.functions.invoke('archive-candidate',{body:{candidate_id:a.candidate_id,confirm_delete_originals:true}});if(response.error||response.data?.state!=='Готово')throw Error(response.data?.error||response.error?.message||'Очищення не завершено');CRMWorkspace.busy=false;await showArchive()}}catch(err){alert(err.message)}finally{CRMWorkspace.busy=false}};
}
let planningRecruiter='all';
async function showPlanning(id=null){
 const content=document.querySelector('.content');CRMWorkspace.markMenu('planning');
 const result=await supabaseClient.from('candidates').select('*').order('created_at',{ascending:false});if(result.error)throw result.error;
 const candidates=(result.data||[]).filter(c=>!isArchived(c));
 content.innerHTML='<div class="dashboard-top"><div><h1 class="page-title">Рух справи</h1><p class="page-subtitle">Планування</p></div></div>';
 if(id){
  const c=candidates.find(c=>c.id===id);if(!c)throw Error('Кандидат відсутній у поточному списку.');CRMWorkspace.setContext(c.id,c.name_nominative||c.full_name);
  const header=document.createElement('div');header.className='crm-actions';header.innerHTML='<button type="button" data-back>← До списку</button><strong>'+esc(c.name_nominative||c.full_name)+'</strong><button type="button" data-card>Картка кандидата</button>';content.append(header);
  header.querySelector('[data-back]').onclick=()=>crmNavigate('planning');header.querySelector('[data-card]').onclick=()=>crmNavigate('card',c.id);
  const host=document.createElement('section');host.dataset.workflow='';content.append(host);await mount(c,content);return;
 }
 const staff=await CRMResponsibility.ready();
 const recruiterIds=[...new Set([...staff.filter(s=>s.active&&['lead','recruiter'].includes(s.role)).map(s=>s.user_id),...candidates.map(c=>c.responsible_recruiter_id).filter(Boolean)])];
 const recruiterOptions='<option value="all">Усі рекрутери</option><option value="unassigned">Не призначено</option>'+recruiterIds.map(id=>'<option value="'+esc(id)+'">'+esc(CRMResponsibility.name(id))+'</option>').join('');
 CRMWorkspace.setContext(null,'');content.insertAdjacentHTML('beforeend','<div class="crm-planning-filters"><label>Рекрутер<select class="crm-search" data-planning-recruiter>'+recruiterOptions+'</select></label><input class="crm-search" data-planning-search type="search" placeholder="Пошук кандидата" aria-label="Пошук кандидата"></div><div class="crm-planning-list" data-planning-list></div>');
 const filter=content.querySelector('[data-planning-recruiter]');filter.value=planningRecruiter;if(!filter.value){filter.value='all';planningRecruiter='all';}
 const render=()=>{
  const q=content.querySelector('[data-planning-search]').value.trim().toLocaleLowerCase('uk-UA');
  content.querySelector('[data-planning-list]').innerHTML=candidates.filter(c=>(planningRecruiter==='all'||(planningRecruiter==='unassigned'?!c.responsible_recruiter_id:c.responsible_recruiter_id===planningRecruiter))&&String(c.name_nominative||c.full_name).toLocaleLowerCase('uk-UA').includes(q)).map(c=>{
   const w=wf(c);return '<button type="button" class="crm-planning-row" data-planning-id="'+esc(c.id)+'"><strong>'+esc(c.name_nominative||c.full_name)+'</strong><span>'+esc(w.outcome?(w.outcome+' · Архівування не завершено'):(CRMCandidateConditions.isUnit(c)?'Оформлює ВЧ':stage(c)))+(w.paused?' · На паузі':'')+'</span><small>'+esc([w.next_action,w.next_contact_date||w.exams_date].filter(Boolean).join(' · '))+'</small></button>';
  }).join('')||'<p class="muted">Кандидатів не знайдено.</p>';
 };render();content.querySelector('[data-planning-search]').oninput=render;filter.onchange=()=>{planningRecruiter=filter.value;render()};
 content.querySelector('[data-planning-list]').onclick=e=>{const id=e.target.closest('[data-planning-id]')?.dataset.planningId;if(id)crmNavigate('planning',id)};
}
window.CRMWorkflow={showPlanning,showArchive,stages,outcomes,profile,wf,stage,label,isArchived,mount};
})();
