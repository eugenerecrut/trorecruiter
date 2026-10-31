// Candidate stages, pauses and completion. Data stays in profile_data.workflow.
(function(){
'use strict';
const stages=['Новий кандидат','Дозвон та співбесіда','В роботі','ВЛК','Направлений до ВЧ'];
const outcomes=['Відмова кандидата','Відмова ВЧ','Переданий до іншої РМГ','Зарахований до ВЧ'];
const esc=v=>CRMWorkspace.escape(v);
const profile=c=>{if(typeof c.profile_data==='string'){try{return JSON.parse(c.profile_data)||{}}catch{return {}}}return c.profile_data||{}};
const wf=c=>profile(c).workflow||{};
const isArchived=c=>!!wf(c).archived_at;
const readOnly=c=>isArchived(c)||!!wf(c).archive_lock||!!profile(c).merged_into;
function protectWorkflow(host,c){if(readOnly(c))host.querySelectorAll('[data-card13],[data-service],[data-inventory],[data-title],[data-registry],[data-anketa]').forEach(el=>el.disabled=true);}
function protectCard(form,c){
 if(!readOnly(c))return false;
 form.dataset.archiveReadOnly='true';
 form.querySelectorAll('input[name],select[name],textarea[name],[data-education-field],[data-relative-field],[type=submit],#ccAddRelative,#pskAddRelative,[data-remove-relative],[data-add-work],[data-remove-work]').forEach(el=>el.disabled=true);
 if(!form.querySelector('[data-archive-notice]')){const note=document.createElement('p');note.dataset.archiveNotice='';note.className='crm-notice';note.textContent='Архівна або заблокована справа: перегляд без змін. Для редагування поверніть справу в роботу через розділ «Архів».';form.prepend(note);}
 return true;
}
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function completionPatch(c,values,reqs,docs,now=new Date().toISOString()){
 const w=wf(c),v=values,clean=k=>String(v[k]||'').trim(),enrolled=v.outcome==='Зарахований до ВЧ';
 if(profile(c).merged_into||w.archive_lock||isArchived(c))throw Error('Ця справа об’єднана, вже в архіві або заблокована старим архівуванням.');
 if(!outcomes.includes(v.outcome))throw Error('Виберіть результат справи.');
 const date=clean('completion_date'),parsed=new Date(date+'T00:00:00Z');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==date||date>today())throw Error('Укажіть коректну дату завершення, не пізніше сьогодні.');
 if(!clean('reason'))throw Error('Коротко вкажіть причину або пояснення.');
 if((enrolled||v.outcome==='Переданий до іншої РМГ')&&!clean('destination'))throw Error('Вкажіть ВЧ або РМГ, яка приймає кандидата.');
 const absent=enrolled?missing(c,reqs,docs):[];
 if(enrolled){
  const orderDate=clean('order_date'),parsedOrder=new Date(orderDate+'T00:00:00Z');
  if(!clean('order_number')||!/^\d{4}-\d{2}-\d{2}$/.test(orderDate)||!Number.isFinite(parsedOrder.getTime())||parsedOrder.toISOString().slice(0,10)!==orderDate||orderDate>date)throw Error('Вкажіть номер і коректну дату наказу, не пізніше дати завершення.');
  if(!verifiedType('Припис про направлення',docs,c))throw Error('Завантажте та перевірте припис або позначте його наявність.');
  if(absent.length&&!v.incomplete)throw Error('Комплект неповний: перевірте документи або позначте неповний комплект.');
  if(v.incomplete&&!clean('incomplete_reason'))throw Error('Вкажіть причину неповного комплекту.');
 }
 return {outcome:v.outcome,stage:enrolled?'Зарахований до ВЧ':stage(c),paused:false,pause_reason:null,
  completion_date:date,reason:clean('reason'),destination:enrolled||v.outcome==='Переданий до іншої РМГ'?clean('destination'):null,
  order_number:enrolled?clean('order_number'):null,order_date:enrolled?clean('order_date'):null,
  incomplete:enrolled&&!!v.incomplete,incomplete_reason:enrolled&&v.incomplete?clean('incomplete_reason'):null,
  missing_documents:enrolled&&v.incomplete?absent.join('\n'):null,archive_error:null,
  archive_mode:'retained',archived_at:now,archive_previous_stage:stage(c)};
}
function restorePatch(c,now=new Date().toISOString()){
 const w=wf(c);
 if(!isArchived(c)||w.archive_mode!=='retained'||w.archive_lock||profile(c).merged_into)throw Error('Відновлення доступне лише для справ зі збереженими оригіналами.');
 return {last_archive:{outcome:w.outcome,completion_date:w.completion_date,reason:w.reason,destination:w.destination,order_number:w.order_number,order_date:w.order_date,incomplete:w.incomplete,incomplete_reason:w.incomplete_reason,missing_documents:w.missing_documents,archived_at:w.archived_at,archived_by:w.archived_by},
  archived_at:null,archive_mode:null,outcome:null,stage:stages.includes(w.archive_previous_stage)?w.archive_previous_stage:'В роботі',
  completion_date:null,reason:null,destination:null,order_number:null,order_date:null,incomplete:false,incomplete_reason:null,missing_documents:null,archive_error:null,restored_at:now};
}
const stage=c=>wf(c).stage||({'Новий':'Новий кандидат','Первинний контакт':'Дозвон та співбесіда','Співбесіда':'Дозвон та співбесіда','Перевірка документів':'В роботі','Рішення':'В роботі','Призначений':'Направлений до ВЧ','Відкладено':'В роботі','Втрачено контакт':'Дозвон та співбесіда'}[c.recruitment_status]|| (stages.includes(c.recruitment_status)?c.recruitment_status:'Новий кандидат'));
const label=c=>{const w=wf(c);if(!w.stage&&!w.outcome&&['Відмова','Втрачено контакт','Відкладено'].includes(c.recruitment_status))return c.recruitment_status+' · попередній статус, потребує уточнення';return [w.outcome||(CRMCandidateConditions.isUnit(c)?'Оформлює ВЧ':stage(c)),w.paused?'На паузі: '+(w.pause_reason||'причина не вказана'):'',w.outcome==='Зарахований до ВЧ'?(w.incomplete?'Неповний комплект':'Повний комплект'):'',w.outcome&&!w.archived_at?'Архівування не завершено':'',isArchived(c)?'Архів':''].filter(Boolean).join(' · ')};
const finalType=t=>['Припис про направлення','Реєстр кандидата','Наказ про зарахування до ВЧ'].includes(t);
const latest=docs=>CRMResponsibility.latest(docs);
const verifiedType=(type,docs,c)=>window.CRMDocumentPresence?.verifiedType(type,docs,c)??docs.some(d=>d.document_type===type&&d.verification_status==='Підтверджено');
const match=(r,d)=>r.id===d.requirement_id||r.document_type===d.document_type;
const missing=(c,reqs,docs,excludeFinal=false)=>CRMDocumentState.rows(c,reqs,docs).filter(row=>row.r.is_required&&(!excludeFinal||!finalType(row.r.document_type))&&(row.condition===null||!row.verified)).map(row=>(row.condition===null?'Уточніть умову: ':'')+(row.group==='military-alternative'?'Військовий квиток або приписне / Резерв+':row.r.document_type)+(row.childIndex?' · дитина '+row.childIndex:'')).filter((t,i,a)=>a.indexOf(t)===i);
function modal(title,html){const d=document.createElement('dialog');d.className='crm-dialog crm-workflow-dialog';d.innerHTML='<h2>'+esc(title)+'</h2>'+html+'<div class="crm-actions"><button type="button" data-close>Закрити</button></div>';document.body.append(d);d.showModal();d.querySelector('[data-close]').onclick=()=>{if(CRMWorkspace.busy)return;d.close();d.remove()};d.addEventListener('cancel',e=>{if(CRMWorkspace.busy)e.preventDefault();else d.remove()});return d}
async function persist(c,patch){
 const r=await supabaseClient.from('candidates').select('*').eq('id',c.id).single();if(r.error)throw r.error;
 const p=profile(r.data),old=wf(r.data);
 if(p.merged_into||old.archive_lock)throw Error('Справа об’єднана або заблокована архівуванням. Оновіть список.');
 if(JSON.stringify(old)!==JSON.stringify(wf(c)))throw Error('Етап справи вже змінив інший працівник. Оновіть картку.');
 const user=await getCurrentUser();if(!user)throw Error('Увійдіть повторно.');
 const next={...old,...patch,...(patch.archived_at?{archived_by:user.id}:{}),...(patch.restored_at?{restored_by:user.id}:{}),changed_at:new Date().toISOString(),changed_by:user.id};
 let q=supabaseClient.from('candidates').update({profile_data:{...p,workflow:next},recruitment_status:next.outcome||next.stage||r.data.recruitment_status,updated_at:next.changed_at}).eq('id',c.id);
 q=r.data.updated_at?q.eq('updated_at',r.data.updated_at):q.is('updated_at',null);
 const saved=await q.select('*').single();if(saved.error)throw saved.error;
 const card=CRMWorkspace.card;if(card?.candidateId===c.id&&card.expectedUpdatedAt===r.data.updated_at)card.expectedUpdatedAt=saved.data.updated_at;
 Object.assign(c,saved.data);return next;
}
let pdfPromise;
function pdfLibrary(){if(window.PDFLib)return Promise.resolve(window.PDFLib);if(!pdfPromise)pdfPromise=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';s.onload=()=>resolve(window.PDFLib);s.onerror=()=>{pdfPromise=null;s.remove();reject(Error('Не вдалося завантажити модуль PDF. Спробуйте знову.'))};document.head.append(s)});return pdfPromise}
async function textPDF(title,lines){return CRMInformationPDF.create(title,lines.map(line=>['',String(line??'')]),null);}
function fileName(title,c){return title+'_'+String(typeof c==='string'?c:c.name_nominative||c.full_name||'Кандидат').replace(/[<>:\x22/\\|?*\x00-\x1f]/g,'_').trim().replace(/[. ]+$/g,'')+'.pdf';}
async function mergedPDF(docs,progress,cover=null,snapshot=null,options={}){
 const {PDFDocument}=await pdfLibrary(),out=await PDFDocument.create();
 if(cover){const first=await PDFDocument.load(await cover.arrayBuffer());(await out.copyPages(first,first.getPageIndices())).forEach(p=>out.addPage(p))}
 for(let i=0;i<docs.length;i++){
  const d=docs[i];progress('Додаємо '+(i+1)+'/'+docs.length+': '+d.file_name);
  const r=await supabaseClient.storage.from(DOC_BUCKET).download(d.storage_path);if(r.error)throw Error(d.file_name+': '+r.error.message);
  const bytes=new Uint8Array(await r.data.arrayBuffer());
  try{
   if(/pdf/i.test(d.mime_type||'')||/\.pdf$/i.test(d.file_name||'')||new TextDecoder('ascii').decode(bytes.subarray(0,1024)).includes('%PDF-')){const source=await PDFDocument.load(bytes);if(!source.getPageCount())throw Error('порожній PDF');if(options.full&&/^(?:Послужний список|Перелік документів|Титульний аркуш|Реєстр кандидата|Додаток 13.*)$/.test(d.document_type||'')){(await out.copyPages(source,source.getPageIndices())).forEach(page=>out.addPage(page));continue;}for(const sourcePage of source.getPages()){const original=sourcePage.node.Contents()?await out.embedPage(sourcePage):{width:sourcePage.getWidth(),height:sourcePage.getHeight(),blank:true};const landscape=original.width>original.height,W=landscape?841.89:595.28,H=landscape?595.28:841.89,left=35*72/25.4,right=15*72/25.4,pad=15*72/25.4,scale=Math.min((W-left-right)/original.width,(H-2*pad)/original.height);const page=out.addPage([W,H]);if(!original.blank)page.drawPage(original,{x:left,y:(H-original.height*scale)/2,width:original.width*scale,height:original.height*scale});}}
   else if((bytes[0]===255&&bytes[1]===216)||(bytes[0]===137&&bytes[1]===80)){const image=bytes[0]===255?await out.embedJpg(bytes):await out.embedPng(bytes);const landscape=image.width>image.height, width=landscape?841.89:595.28,height=landscape?595.28:841.89,left=35*72/25.4,right=15*72/25.4,s=Math.min((width-left-right)/image.width,(height-30*72/25.4)/image.height);out.addPage([width,height]).drawImage(image,{x:left,y:(height-image.height*s)/2,width:image.width*s,height:image.height*s})}
   else if(!options.full&&/\.docx?$/i.test(d.file_name||'')){await out.attach(bytes,d.file_name,{mimeType:d.mime_type||'application/octet-stream'});const notice=await textPDF('Вкладений документ',[d.document_type,d.file_name,'Оригінал Word збережений усередині цього PDF як вкладення. Відкрийте панель вкладень у PDF-програмі.']);const pageDoc=await PDFDocument.load(await notice.arrayBuffer());(await out.copyPages(pageDoc,pageDoc.getPageIndices())).forEach(p=>out.addPage(p))}
   else throw Error('потрібна PDF-копія цього файла');
  }catch(e){throw Error(d.file_name+': '+e.message)}
 }
 if(snapshot)await out.attach(new TextEncoder().encode(JSON.stringify(snapshot,null,2)),'дані-особової-справи.json',{mimeType:'application/json',description:'Повні збережені дані картки та розпізнавання документів'});
 if(!out.getPageCount())throw Error('У пакеті немає сторінок.');return new Blob([await out.save()],{type:'application/pdf'});
}
async function storePackage(c,kind,blob,docs){
 if(readOnly(c))throw Error('Спочатку поверніть справу в роботу.');
 if(kind==='anketa')CRMAnketaPDF.assertSize(blob);
 const path=c.id+'/packages/'+kind+'-'+crypto.randomUUID()+'.pdf';const r=await supabaseClient.storage.from(DOC_BUCKET).upload(path,blob,{contentType:'application/pdf',upsert:false});if(r.error)throw r.error;
 return {path,size:blob.size,source_document_ids:docs.map(d=>d.id),created_at:new Date().toISOString()};
}
async function download(path,name){const r=await supabaseClient.storage.from(DOC_BUCKET).download(path);if(r.error)throw r.error;const url=URL.createObjectURL(r.data),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)}
async function generated(c,title,lines,reqs){if(readOnly(c))throw Error('Спочатку поверніть справу в роботу.');const blob=lines instanceof Blob?lines:await textPDF(title,lines),path=c.id+'/generated/'+crypto.randomUUID()+'.pdf',user=await getCurrentUser();if(!user)throw Error('Увійдіть повторно.');const req=reqs.find(r=>r.document_type===title),previous=['Перелік документів','Послужний список'].includes(title)?latest(await getCandidateDocuments(c.id)).filter(d=>d.document_type===title).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0]:null;const r=await supabaseClient.storage.from(DOC_BUCKET).upload(path,blob,{contentType:'application/pdf'});if(r.error)throw r.error;const d=await supabaseClient.from('documents').insert({candidate_id:c.id,requirement_id:req?.id||null,document_type:title,document_name:title,file_name:fileName(title,c),file_size:blob.size,mime_type:'application/pdf',storage_path:path,replaces_document_id:previous?.id||null,uploaded_by:user.id,status:'Завантажено',processing_status:'Завантажено',verification_status:'Не перевірено'});if(d.error)throw d.error;await download(path,fileName(title,c))}
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
function candidateHandoutCondition(r,c){
 const type=String(r.document_type||''),p=profile(c);
 const key=/трудов|трудову діяльність/iu.test(type)?'worked_before':/військового квитка|посвідчення офіцера|проходження.*служб|витягу? з наказу|нагород|УБД/iu.test(type)?'served_before':null;
 if(!key)return requirementCondition(r,c);
 const value=c[key]??p[key];
 if(value===false||value==='false')return false;
 if(value===true||value==='true')return requirementCondition(r,c);
 return null;
}
function candidateDocumentLines(c,reqs,docs=[]){
 const excluded=/^(?:Заява на контракт|Згода на обробку даних(?: для психологічного тестування)?|Картка соціально-психологічного вивчення|Анкета на контракт|Розписка кандидата на військову службу за контрактом|Характеристика|Додаток 13\b|Сертифікат психологічного тестування)/iu;
 return reqs.map(r=>CRMCandidateConditions.forCandidate(r,c)).filter(r=>candidateHandoutCondition(r,c)!==false&&!finalType(r.document_type)&&!['Титульний аркуш','Послужний список','Перелік документів'].includes(r.document_type)&&!/рекомендац/iu.test(r.document_type||'')&&!excluded.test(String(r.document_type||'').trim())).sort((a,b)=>Number(/автобіографія.*друкован/iu.test(b.document_type||''))-Number(/автобіографія.*друкован/iu.test(a.document_type||''))).map(r=>{
  const note=String(r.condition_note||'').trim(),internal=/AI|OCR|розпізнаван|розпізнає|збереження файла|контейнер|лише завантаження|підтвердження|картк[ау] кандидата/iu.test(note);
  const rawTitle=String(r.document_type||'').trim(),title=/^свідоцтво про народження$/iu.test(rawTitle)?'Свідоцтво про народження / витяг (ДІЯ)':/^довідка з МВС(?:\s|$)/iu.test(rawTitle)?'Довідка з МВС — ПОВНА (про несудимість) / ПОВНИЙ витяг (ДІЯ)':/документи про трудову діяльність/iu.test(rawTitle)?'Документи про трудову діяльність':/^довідка ВЛК$/iu.test(rawTitle)?'Довідка ВЛК та форма 13 — якщо ВЛК пройдена протягом поточного року':/^копія ідентифікаційного коду$/iu.test(rawTitle)?'Копія ідентифікаційного коду — бажано; якщо немає — витяг (ДІЯ)':/^копія диплома та атестата з додатками\.?$/iu.test(rawTitle)?'Копія диплома та атестата з додатками — бажано; якщо немає — витяг (ДІЯ)':/^довідка з визначенням групи крові та резус-фактору$/iu.test(rawTitle)?'Довідка з визначенням групи крові та резус-фактору або відмітка у свідоцтві про народження, паспорті, водійському посвідченні':/^автобіографія рукописна$/iu.test(rawTitle)?'Автобіографія рукописна — після опрацювання з рекрутером кандидат пише власноруч':rawTitle,copyTitle=/^(?:копі[яї](?:\s|$)|фото(?:\s|\d|$))/iu.test(title)?title:'Копія: '+title;
  const collected=docs.some(d=>!d.deleted_at&&d.storage_path&&match(r,d))||!!window.CRMDocumentPresence?.byType(r.document_type,c);
  return (collected?'☑ ':'□ ')+(r.is_required?'':'За наявності: ')+copyTitle+(/автобіографія.*друкован/iu.test(title)?' — бажано у форматі Word (.doc/.docx); потребує подальшого доопрацювання рекрутером.':!/документи про трудову діяльність|групи крові|автобіографія рукописна/iu.test(title)&&!internal&&note?' — '+note:'')+(/документи про трудову діяльність/iu.test(title)?' — уточніть у рекрутера / витяг (ПФУ)':candidateHandoutCondition(r,c)===null?' — уточніть у рекрутера':'');
 });
}
function completionDialog(c,reqs,docs,onSave){
 const existing=document.querySelector('dialog[data-crm-completion]');if(existing)return existing;
 const w=wf(c),d=modal('Відправити справу в архів','<p>Картка, оригінали, версії та результати AI збережуться. Справу можна повернути в роботу. PDF формується окремо, коли потрібен.</p><form data-completion class="crm-workflow-grid"><label>Результат<select name="outcome" required><option value="">Виберіть результат</option>'+outcomes.map(o=>'<option '+(o===w.outcome?'selected':'')+'>'+esc(o)+'</option>').join('')+'</select></label><label>Дата завершення<input name="completion_date" type="date" required max="'+today()+'" value="'+esc(w.completion_date||today())+'"></label><label>Причина / пояснення<textarea name="reason" required>'+esc(w.reason||'')+'</textarea></label><label data-destination hidden>ВЧ або РМГ<input name="destination" value="'+esc(w.destination||'')+'"></label><label data-enrolled hidden>Номер наказу<input name="order_number" value="'+esc(w.order_number||'')+'"></label><label data-enrolled hidden>Дата наказу<input type="date" name="order_date" value="'+esc(w.order_date||'')+'"></label><label data-enrolled hidden><input type="checkbox" name="incomplete" '+(w.incomplete?'checked':'')+'> Зараховано з неповним комплектом</label><label data-incomplete hidden>Причина неповного комплекту<textarea name="incomplete_reason">'+esc(w.incomplete_reason||'')+'</textarea></label><details data-enrolled hidden><summary>Комплектність за поточними даними CRM</summary><ul>'+missing(c,reqs,docs).map(t=>'<li>'+esc(t)+'</li>').join('')+'</ul></details><button type="submit">Відправити в архів</button><p data-error role="alert"></p></form>');
 d.dataset.crmCompletion=c.id;
 const f=d.querySelector('form'),sync=()=>{const enrolled=f.elements.outcome.value==='Зарахований до ВЧ',transfer=f.elements.outcome.value==='Переданий до іншої РМГ';d.querySelectorAll('[data-enrolled]').forEach(el=>el.hidden=!enrolled);d.querySelector('[data-destination]').hidden=!enrolled&&!transfer;f.elements.destination.required=enrolled||transfer;f.elements.order_number.required=enrolled;f.elements.order_date.required=enrolled;d.querySelector('[data-incomplete]').hidden=!enrolled||!f.elements.incomplete.checked;f.elements.incomplete_reason.required=enrolled&&f.elements.incomplete.checked;};
 f.addEventListener('change',sync);sync();
 f.onsubmit=async e=>{e.preventDefault();if(CRMWorkspace.busy)return;const values=Object.fromEntries(new FormData(f));values.incomplete=f.elements.incomplete.checked;await onSave(values,d);};return d;
}
async function mount(c,root){
 const host=root.querySelector('[data-workflow]');if(!host)return;
 let reqs=await getDocumentRequirements(),docs=latest(await getCandidateDocuments(c.id));
 const unit=CRMCandidateConditions.isUnit(c),w=wf(c),archived=isArchived(c),closed=!!w.outcome||archived,miss=missing(c,reqs,docs,true);
 host.innerHTML='<details class="wf-panel" '+(document.documentElement.dataset.crmLayout==='mobile'?'':'open')+'><summary class="wf-panel-summary"><strong>Етап і завершення справи</strong><span class="wf-stage-badge">'+esc(label(c))+'</span></summary><div class="wf-panel-body">'+(c.recruitment_status==='Призначений'&&!w.stage?'<p class="crm-notice">Попередній статус «Призначений»: уточніть зарахування наказом.</p>':'')+
 '<form data-progress-form class="crm-workflow-grid wf-progress">'+(!unit?'<label class="wf-stage-field">Етап оформлення<select name="stage">'+stages.map(s=>'<option '+(s===stage(c)?'selected':'')+'>'+esc(s)+'</option>').join('')+'</select></label>':'<p class="wf-stage-field">Оформлення проводить ВЧ. Наші етапи не застосовуються.</p>')+
 '<label class="wf-switch"><input type="checkbox" name="paused" '+(w.paused?'checked':'')+'> На паузі</label><div class="wf-save"><button type="submit" '+(closed?'disabled':'')+'>Зберегти етап</button></div>'+
 '<label data-pause-details>Причина паузи<select name="pause_reason">'+['','Не відповідає','Неактуальний номер','Труднощі з телефоном / Дією / Армія+','Очікуємо документ або відповідь','Особисті обставини','Інше'].map(s=>'<option '+(s===w.pause_reason?'selected':'')+'>'+esc(s)+'</option>').join('')+'</select></label><label hidden>Наступна дія<textarea name="next_action" rows="2">'+esc(w.next_action||'')+'</textarea></label><label hidden>Контрольна дата<input name="next_contact_date" type="date" value="'+esc(w.next_contact_date||'')+'"></label>'+
 (!unit?'<label class="wf-switch" data-forward-toggle><input type="checkbox" name="forward_incomplete" '+(w.forward_incomplete?'checked':'')+'> Направлення з неповним комплектом</label><label data-forward-reason>Причина неповного комплекту<textarea name="forward_incomplete_reason" rows="2">'+esc(w.forward_incomplete_reason||'')+'</textarea></label>':'')+
 (!unit?'<label class="wf-switch wf-exams" data-exams-toggle><input type="checkbox" name="additional_exams" '+(w.additional_exams?'checked':'')+'> Додаткові обстеження ВЛК</label><label data-exams-details>Обстеження / наступна дія<textarea name="exams_details" rows="2">'+esc(w.exams_details||'')+'</textarea></label><label data-exams-details>Контрольна дата обстежень<input name="exams_date" type="date" value="'+esc(w.exams_date||'')+'"></label>':'')+'</form>'+
 (!unit&&!closed?'<details class="wf-readiness"><summary>'+esc(miss.length?'До направлення бракує документів: '+miss.length:'Комплект документів перевірений')+'</summary>'+(miss.length?'<ul>'+miss.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':'')+'<p>'+ (CRMCandidateConditions.isMobilization(c)?'Мобілізація: психологічний тест — контрольний пункт. Для нього сформуйте Обов’язкову інформацію з освітою та трудовим стажем. Перша сторінка сертифіката психологічного тестування обов’язкова. Припис і реєстр обов’язкові.':'Психологічний тест — контрольний пункт. Додайте сертифікат або позначте його наявність. Довідку ВЛК завантажте та перевірте.')+'</p></details>':'')+
 (!closed?'<div class="wf-main-actions">'+(!unit?'<div class="crm-actions"><button type="button" data-list>Надати список документів</button></div>':'<span>РЛ · припис · реєстр кандидата</span>')+'<button type="button" class="wf-finish" data-finish>Відправити в архів</button></div>':'')+
 '<details class="wf-tools"><summary>Друк та пакети документів</summary><div class="wf-tool-grid"><button type="button" '+(unit?'hidden':'')+' data-service>Послужний список</button><button type="button" '+(unit?'hidden':'')+' data-card13>Картка 13 <small>Дані з CRM · PDF</small></button><button type="button" '+(unit?'hidden':'')+' data-info>Обов’язкова інформація</button><button type="button" '+(unit?'hidden':'')+' data-inventory>Перелік документів</button><button type="button" '+(unit?'hidden':'')+' data-title>Титул</button><button type="button" data-full-package>Створити повний PDF-пакет</button><button type="button" data-registry>Реєстр кандидата</button><button type="button" '+(unit?'hidden':'')+' data-anketa>PDF «Анкета»</button></div></details>'+
 (closed?'<p>Результат: '+esc(w.outcome)+' · '+esc(w.completion_date||'')+'</p>'+(w.archive_error?'<p class="crm-notice">Архівний пакет не сформовано: '+esc(w.archive_error)+'</p>':'')+(!archived?'<div class="crm-actions"><button type="button" data-retry>Завершити відправлення в архів</button>'+(!w.archive_lock?'<button type="button" data-reopen>Скасувати завершення справи</button>':'')+'</div>':'<p>Справа в архіві. Оригінали збережені.</p>'+ (w.archive_mode==='retained'&&!w.archive_lock?'<button type="button" data-restore>Повернути в роботу</button>':'')):'')+
 (w.archive_package?'<button type="button" data-download-archive>Завантажити архівний PDF</button>':'')+(w.anketa_package?'<button type="button" data-download-anketa>Завантажити PDF «Анкета»</button>':'')+'<p data-workflow-status role="status"></p></div></details>';
 const workflowState={form:host.querySelector('[data-progress-form]'),dirty:false};CRMWorkspace.workflow=workflowState;
 const status=host.querySelector('[data-workflow-status]');
 const progressForm=host.querySelector('[data-progress-form]'),syncFields=()=>{const paused=progressForm.elements.paused.checked,vlk=progressForm.elements.stage?.value==='ВЛК',extra=progressForm.elements.additional_exams;host.querySelectorAll('[data-pause-details]').forEach(e=>e.hidden=!paused);const forwarding=progressForm.elements.stage?.value==='Направлений до ВЧ';host.querySelectorAll('[data-forward-toggle]').forEach(e=>e.hidden=!forwarding);host.querySelectorAll('[data-forward-reason]').forEach(e=>e.hidden=!forwarding||!progressForm.elements.forward_incomplete?.checked);if(extra){if(!vlk)extra.checked=false;host.querySelector('[data-exams-toggle]').hidden=!vlk;host.querySelectorAll('[data-exams-details]').forEach(e=>e.hidden=!vlk||!extra.checked)}};progressForm.addEventListener('input',()=>workflowState.dirty=true);progressForm.addEventListener('change',()=>{workflowState.dirty=true;syncFields();if(status)status.textContent='Є незбережені зміни етапу. Натисніть «Зберегти етап».'});syncFields();
 const run=async (fn,saveProgress=false,onError=null)=>{if(CRMWorkspace.busy)return;if(workflowState.dirty&&!saveProgress){if(status)status.textContent='Спочатку збережіть зміни етапу.';return;}if(!await CRMWorkspace.guard()||CRMWorkspace.busy)return;CRMWorkspace.busy=true;host.querySelectorAll('button').forEach(b=>b.disabled=true);try{const refreshed=await supabaseClient.from('candidates').select('*').eq('id',c.id).single();if(refreshed.error)throw refreshed.error;if(JSON.stringify(wf(refreshed.data))!==JSON.stringify(wf(c)))throw Error('Справа змінилася. Оновіть картку.');Object.assign(c,refreshed.data);await fn();if(status)status.textContent='Готово.';}catch(e){if(status)status.textContent=e.message;onError?.(e);}finally{CRMWorkspace.busy=false;if(c.__archived)await CRMWorkspace.navigate('archive');else{host.querySelectorAll('button').forEach(b=>b.disabled=!!wf(c).outcome&&b.type==='submit');protectWorkflow(host,c);}}};
 const refresh=async()=>{const r=await supabaseClient.from('candidates').select('*').eq('id',c.id).single();if(!r.error)Object.assign(c,r.data);await mount(c,root)};
 host.querySelector('[data-progress-form]').onsubmit=e=>{e.preventDefault();run(async()=>{if(wf(c).outcome)throw Error('Роботу зі справою вже завершено.');const f=new FormData(e.target),paused=f.has('paused'),additional=f.has('additional_exams'),s=unit?null:String(f.get('stage'));if(paused&&!f.get('pause_reason'))throw Error('Вкажіть причину паузи.');if(additional&&(!String(f.get('exams_details')||'').trim()||!f.get('exams_date')))throw Error('Вкажіть додаткові обстеження та контрольну дату.');if(additional&&s!=='ВЛК')throw Error('Додаткові обстеження позначаються на етапі ВЛК.');if(s==='Направлений до ВЧ'){docs=latest(await getCandidateDocuments(c.id));const needed=missing(c,reqs,docs,true);if(needed.length&&!f.has('forward_incomplete'))throw Error('Спочатку перевірте документи або позначте направлення з неповним комплектом: '+needed.join(', '));if(needed.length&&f.has('forward_incomplete')&&!String(f.get('forward_incomplete_reason')||'').trim())throw Error('Вкажіть причину направлення з неповним комплектом.');if(!verifiedType('Припис про направлення',docs,c)||!verifiedType('Реєстр кандидата',docs,c))throw Error('Завантажте та перевірте припис і реєстр або позначте їхню наявність.')}await persist(c,{stage:s,paused,forward_incomplete:s==='Направлений до ВЧ'&&f.has('forward_incomplete'),forward_incomplete_reason:s==='Направлений до ВЧ'?String(f.get('forward_incomplete_reason')||'').trim()||null:null,pause_reason:paused?String(f.get('pause_reason')):null,next_action:String(f.get('next_action')||'').trim()||null,next_contact_date:f.get('next_contact_date')||null,additional_exams:additional,exams_details:additional?String(f.get('exams_details')).trim():null,exams_date:additional?f.get('exams_date'):null});workflowState.dirty=false;await refresh()},true)};
 host.querySelector('[data-info]')?.addEventListener('click',()=>crmNavigate('information',c.id));
 host.querySelector('[data-card13]')?.addEventListener('click',()=>CRMCard13.open(c));
 host.querySelector('[data-list]')?.addEventListener('click',async()=>{if(!await CRMWorkspace.guard())return;docs=latest(await getCandidateDocuments(c.id));const lines=candidateDocumentLines(c,reqs,docs),candidateName=c.name_nominative||c.full_name;const d=preview('Список документів — '+candidateName,lines,{pdfFileName:'Список документів — '+String(candidateName||'Кандидат').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_')+'.pdf'});const b=document.createElement('button');b.textContent='Список надано — кандидат в роботі';d.querySelector('.crm-actions').prepend(b);b.onclick=()=>{d.close();d.remove();run(async()=>{await persist(c,{stage:'В роботі',documents_list_given_at:new Date().toISOString()});if(!c.__archived)await refresh()})}});
 const generate=(selector,title,lines)=>host.querySelector(selector)?.addEventListener('click',()=>run(async()=>{await generated(c,title,lines,reqs);docs=latest(await getCandidateDocuments(c.id))}));
 const name=c.name_nominative||c.full_name,p=profile(c);
 const anketaFileName='Анкета_'+String(name||'Кандидат').replace(/[<>:\x22\/\\|?*\x00-\x1f]/g,'_').trim().replace(/[. ]+$/g,'')+'.pdf';
 generate('[data-title]','Титульний аркуш',['Особова справа',name,'Військова частина: '+(p.military_unit||'Не вказано'),'Посада: '+(c.desired_position||'Не вказано')]);
 generate('[data-registry]','Реєстр кандидата',[name]);
 host.querySelector('[data-inventory]').onclick=()=>run(()=>CRMInventory.open(c,reqs,{save:async blob=>{await generated(c,'Перелік документів',blob,reqs);docs=latest(await getCandidateDocuments(c.id));}}));
 host.querySelector('[data-service]').onclick=()=>run(async()=>{const pf=await supabaseClient.from('personal_files').select('*').eq('candidate_id',c.id).maybeSingle();if(pf.error)throw pf.error;await CRMServiceRecord.open(c,pf.data||{},{save:async blob=>{await generated(c,'Послужний список',blob,reqs);docs=latest(await getCandidateDocuments(c.id));}})});

 host.querySelector('[data-full-package]')?.addEventListener('click',()=>run(async()=>{
  const all=latest(await getCandidateDocuments(c.id)),files=all.filter(d=>d.storage_path);
  const order=['Титульний аркуш','Перелік документів','Послужний список','Автобіографія рукописна','Автобіографія друкована'];
  const priority=d=>{const n=order.indexOf(d.document_type);return n<0?order.length:n};
  files.sort((a,b)=>priority(a)-priority(b)||String(a.document_type||'').localeCompare(String(b.document_type||''),'uk')||String(a.file_name||'').localeCompare(String(b.file_name||''),'uk'));
  const paper=window.CRMDocumentPresence?.withoutCopies(c,all)||[];
  const supported=d=>/pdf|image\/(?:jpeg|png)/i.test(d.mime_type||'')||/\.(?:pdf|jpe?g|png)$/i.test(d.file_name||'');
  const stamp=rows=>JSON.stringify(rows.map(d=>[d.id,d.storage_path,d.version_number,d.verification_status]).sort());
  const snapshot=stamp(files);
  const d=modal('Повний PDF-пакет кандидата','<p>'+esc(name)+'</p><p>Об’єднаємо вибрані актуальні файли. Неперевірені документи позначені нижче. PDF-бланки CRM зберігають свої поля; інші копії отримують відступ для підшивання 35 мм.</p><div data-full-files>'+files.map((f,i)=>'<label style="display:block;margin:8px 0"><input type="checkbox" data-full-file="'+i+'" checked> '+esc(f.document_type)+' — '+esc(f.file_name)+' <small>'+esc(f.verification_status||'Не перевірено')+(!supported(f)?' · Потрібна PDF-копія':'')+'</small></label>').join('')+'</div>'+(paper.length?'<p><strong>Є без файла — сторінки не ввійдуть до PDF:</strong></p><ul>'+paper.map(e=>'<li>'+esc(e.document_type)+'</li>').join('')+'</ul>':'')+'<p>Word та інші непідтримувані файли спочатку потрібно завантажити у PDF або зняти їхню позначку.</p><button type="button" data-full-build '+(!files.length?'disabled':'')+'>Створити та завантажити PDF</button><p data-full-status role="status"></p>');
  const feedback=d.querySelector('[data-full-status]'),build=d.querySelector('[data-full-build]');
  build.onclick=async()=>{
   const chosen=[...d.querySelectorAll('[data-full-file]:checked')].map(el=>files[Number(el.dataset.fullFile)]);
   if(!chosen.length){feedback.textContent='Виберіть хоча б один файл.';return;}
   const unsupported=chosen.filter(f=>!supported(f));if(unsupported.length){feedback.textContent='Потрібна PDF-копія або зняття позначки: '+unsupported.map(f=>f.file_name).join(', ');return;}
   await run(async()=>{
    d.querySelectorAll('button,input').forEach(el=>el.disabled=true);let url;
    try{
     const current=latest(await getCandidateDocuments(c.id)).filter(f=>f.storage_path);
     if(stamp(current)!==snapshot)throw Error('Документи змінилися. Закрийте вікно та відкрийте пакет повторно.');
     const blob=await mergedPDF(chosen,t=>feedback.textContent=t,null,null,{full:true});
     url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=fileName('Повний пакет документів',c);document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
     feedback.textContent='PDF сформовано та завантажено. Файлів у пакеті: '+chosen.length+'.'+(paper.length?' Документи без файла не включені.':'');
    }catch(error){feedback.textContent='Не сформовано: '+error.message;throw error;}
    finally{d.querySelectorAll('button,input').forEach(el=>el.disabled=false);}
   });
  };
 }));
 host.querySelector('[data-anketa]').onclick=()=>run(async()=>{
  docs=latest(await getCandidateDocuments(c.id));
  const packet=CRMDocumentState.packageState(c,docs),packageDocs=packet.files,packageRows=packet.rows;
  const blocked=packageRows.some(row=>row.blocked);
  const d=modal('Пакет PDF «Анкета»','<p>'+esc(name)+' · '+esc(anketaFileName)+'</p><p class="muted">Максимальний розмір PDF — 10 МБ. Обов’язкові документи мають бути завантажені та підтверджені. УБД і посвідчення водія додаються за наявності.</p><ol class="wf-package-list">'+packageRows.map(row=>'<li class="'+(row.blocked?'wf-package-blocked':'')+'"><div><strong>'+esc(row.title)+'</strong><span>'+esc(row.state)+'</span></div>'+row.files.map(file=>'<small>'+esc(file.file_name)+'</small>').join('')+'</li>').join('')+'</ol>'+(blocked?'<p role="status">Спочатку додайте або перевірте позначені документи.</p><button data-open-documents>Відкрити документи кандидата</button>':'')+'<button data-build '+(blocked?'disabled':'')+'>Сформувати цей пакет</button>');
  d.querySelector('[data-open-documents]')?.addEventListener('click',()=>{d.close();d.remove();CRMWorkspace.navigate('documents',c.id)});
  d.querySelector('[data-build]').onclick=()=>{d.close();d.remove();run(async()=>{const merged=await mergedPDF(packageDocs,t=>status.textContent=t),blob=await CRMAnketaPDF.ensure(merged,t=>status.textContent=t),pkg=await storePackage(c,'anketa',blob,packageDocs);await persist(c,{anketa_package:pkg});await download(pkg.path,anketaFileName);await refresh()})};
 });
 const openCompletion=async()=>{if(workflowState.dirty){if (status) status.textContent='Спочатку збережіть зміни етапу.';return;}if(!await CRMWorkspace.guard())return;docs=latest(await getCandidateDocuments(c.id));completionDialog(c,reqs,docs,async(values,d)=>run(async()=>{try{const freshDocs=latest(await getCandidateDocuments(c.id));await persist(c,completionPatch(c,values,reqs,freshDocs));d.close();d.remove();c.__archived=true;CRMWorkspace.card=null;}catch(error){const de = d.querySelector('[data-error]'); if (de) de.textContent=error.message;throw error;}},false,error=>{const de = d.querySelector('[data-error]'); if (de) de.textContent=error.message;}));};
 host.querySelector('[data-finish]')?.addEventListener('click',()=>openCompletion().catch(e=>{if (status) status.textContent=e.message;}));
 host.querySelector('[data-retry]')?.addEventListener('click',()=>openCompletion().catch(e=>{if (status) status.textContent=e.message;}));
 host.querySelector('[data-restore]')?.addEventListener('click',async()=>{if(!confirm('Повернути справу в роботу? Дані та документи збережуться.'))return;await run(async()=>{await persist(c,restorePatch(c));});if(!isArchived(c)){CRMWorkspace.card=null;await crmNavigate('card',c.id);}});
 host.querySelector('[data-reopen]')?.addEventListener('click',()=>run(async()=>{await persist(c,{outcome:null,stage:stages.includes(stage(c))?stage(c):'В роботі',completion_date:null,archive_error:null,order_number:null,order_date:null,incomplete:false,missing_documents:null,incomplete_reason:null});await refresh();}));
 host.querySelector('[data-download-archive]')?.addEventListener('click',()=>run(()=>download(wf(c).archive_package.path,fileName('Особова_справа',c))));
 host.querySelector('[data-download-anketa]')?.addEventListener('click',()=>run(async()=>{const r=await supabaseClient.storage.from(DOC_BUCKET).download(wf(c).anketa_package.path);if(r.error)throw r.error;const blob=await CRMAnketaPDF.ensure(r.data,t=>status.textContent=t),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=anketaFileName;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)}));
 if(closed)host.querySelectorAll('form input,form select,form textarea').forEach(el=>el.disabled=true);
 protectWorkflow(host,c);
}
async function showArchive(){
 CRMWorkspace.card=null;CRMWorkspace.setContext(null,'');CRMWorkspace.markMenu('archive');const content=document.querySelector('.content');content.innerHTML='<h1 class="page-title">Архів</h1><p>Картки й документи збережені. Справу можна відкрити або повернути в роботу.</p><input class="crm-search" data-archive-search placeholder="Пошук за ПІБ, ВЧ / РМГ" aria-label="Пошук в архіві"><p data-archive-status role="status"></p><section class="card"><div data-archive-rows>Завантажуємо…</div></section>';
 const [legacy,candidates]=await Promise.all([supabaseClient.from('crm_archive').select('id,candidate_id,full_name,outcome,completion_date,destination,incomplete,pdf_path,state,error,archived_at').order('archived_at',{ascending:false}),supabaseClient.from('candidates').select('*').order('created_at',{ascending:false})]);
 if(!content.querySelector('[data-archive-rows]'))return;
 if(legacy.error||candidates.error){const arEl = content.querySelector('[data-archive-rows]'); if (arEl) arEl.textContent=(legacy.error||candidates.error).message;return;}
 const retained=(candidates.data||[]).filter(c=>isArchived(c)&&!profile(c).merged_into),legacyIds=new Set((legacy.data||[]).map(a=>a.candidate_id));
 const rows=[...(legacy.data||[]),...retained.filter(c=>!legacyIds.has(c.id)).map(c=>({id:c.id,candidate_id:c.id,full_name:c.name_nominative||c.full_name,outcome:wf(c).outcome,completion_date:wf(c).completion_date,destination:wf(c).destination,incomplete:wf(c).incomplete,archived_at:wf(c).archived_at,retained:c}))].sort((a,b)=>String(b.archived_at||'').localeCompare(String(a.archived_at||'')));
 const render=()=>{const q=content.querySelector('[data-archive-search]').value.trim().toLocaleLowerCase('uk-UA');content.querySelector('[data-archive-rows]').innerHTML=rows.filter(a=>[a.full_name,a.destination,a.outcome].join(' ').toLocaleLowerCase('uk-UA').includes(q)).map(a=>'<article class="crm-archive-row"><strong>'+esc(a.full_name)+'</strong><p>'+esc([a.outcome,a.incomplete?'Неповний комплект':'',a.completion_date,a.destination].filter(Boolean).join(' · '))+'</p>'+(a.retained?'<p>Картка й усі оригінали збережені.</p><div class="crm-actions"><button data-archive-open="'+esc(a.id)+'">Відкрити справу</button>'+(wf(a.retained).archive_mode==='retained'&&!wf(a.retained).archive_lock?'<button data-archive-restore="'+esc(a.id)+'">Повернути в роботу</button>':'')+'</div>':'<p>'+esc(a.state==='Готово'?'Архів попередньої версії: збережено PDF. Відновлення картки недоступне.':'Перенесення за старою схемою не завершене: '+(a.error||'потрібна перевірка'))+'</p><button data-archive-download="'+esc(a.id)+'">Завантажити PDF</button>')+'</article>').join('')||'<p>Архівних справ за цим пошуком немає.</p>';};render();content.querySelector('[data-archive-search]').oninput=render;
 content.querySelector('[data-archive-rows]').onclick=async e=>{const b=e.target.closest('button');if(!b||CRMWorkspace.busy)return;const id=b.dataset.archiveDownload||b.dataset.archiveOpen||b.dataset.archiveRestore,a=rows.find(x=>x.id===id);if(!a)return;if(b.dataset.archiveOpen){await crmNavigate('card',a.candidate_id);return;}if(b.dataset.archiveRestore&&!confirm('Повернути справу «'+a.full_name+'» в роботу? Документи та дані збережуться.'))return;CRMWorkspace.busy=true;b.disabled=true;try{if(b.dataset.archiveDownload)await download(a.pdf_path,fileName('Особова_справа',a.full_name));else{await persist(a.retained,restorePatch(a.retained));await showArchive();}}catch(err){const asEl = content.querySelector('[data-archive-status]'); if (asEl) asEl.textContent=err.message;}finally{CRMWorkspace.busy=false;if(b.isConnected)b.disabled=false;}};
}
let planningRecruiter=null,planningView='all';
async function showPlanning(id=null){
 const content=document.querySelector('.content');CRMWorkspace.markMenu('planning');
 const result=await supabaseClient.from('candidates').select('*').order('created_at',{ascending:false});if(result.error)throw result.error;
 const candidates=(result.data||[]).filter(c=>!isArchived(c)&&!profile(c).merged_into);
 content.innerHTML='<div class="dashboard-top"><div><h1 class="page-title">Рух справи</h1><p class="page-subtitle">Наступні дії та контрольні дати</p></div></div>';
 if(id){
  const c=candidates.find(c=>c.id===id);if(!c)throw Error('Кандидат відсутній у поточному списку.');CRMWorkspace.setContext(c.id,c.name_nominative||c.full_name);
  const header=document.createElement('div');header.className='crm-actions';header.innerHTML='<button type="button" data-back>← До списку</button><strong>'+esc(c.name_nominative||c.full_name)+'</strong><button type="button" data-card>Картка кандидата</button>';content.append(header);
  header.querySelector('[data-back]').onclick=()=>crmNavigate('planning');header.querySelector('[data-card]').onclick=()=>crmNavigate('card',c.id);
  const host=document.createElement('section');host.dataset.workflow='';content.append(host);await mount(c,content);return;
 }
 const staff=await CRMResponsibility.ready();
 if(planningRecruiter===null)planningRecruiter=staff.find(s=>s.user_id===CRMResponsibility.userId)?.role==='recruiter'?CRMResponsibility.userId:'all';
 const recruiterIds=[...new Set([...staff.filter(s=>s.active&&['lead','recruiter'].includes(s.role)).map(s=>s.user_id),...candidates.map(c=>c.responsible_recruiter_id).filter(Boolean)])];
 const recruiterOptions='<option value="all">Усі рекрутери</option><option value="unassigned">Не призначено</option>'+recruiterIds.map(id=>'<option value="'+esc(id)+'">'+esc(CRMResponsibility.name(id))+'</option>').join('');
 CRMWorkspace.setContext(null,'');content.insertAdjacentHTML('beforeend','<div class="crm-planning-filters"><label>Рекрутер<select class="crm-search" data-planning-recruiter>'+recruiterOptions+'</select></label><label>Завдання<select class="crm-search" data-planning-view>'+[['all','Усі'],['overdue','Прострочено'],['today','Сьогодні'],['upcoming','Майбутні'],['undated','Без дати'],['paused','На паузі']].map(([k,t])=>'<option value="'+k+'">'+t+'</option>').join('')+'</select></label><label>Вид оформлення<select class="crm-search" data-planning-type><option value="all">Усі</option><option value="contract">Контракт</option><option value="mobilization">Мобілізація</option><option value="unknown">Не уточнено</option></select></label><label>Хто оформлює<select class="crm-search" data-planning-mode><option value="all">Усі</option><option value="full">Ми</option><option value="unit">ВЧ</option></select></label><input class="crm-search" data-planning-search type="search" placeholder="Пошук кандидата" aria-label="Пошук кандидата"></div><p data-planning-count role="status"></p><div class="crm-planning-list" data-planning-list></div>');
 const filter=content.querySelector('[data-planning-recruiter]');filter.value=planningRecruiter;if(!filter.value){filter.value='all';planningRecruiter='all';}
 const view=content.querySelector('[data-planning-view]');view.value=planningView;
 const render=()=>{
  const q=content.querySelector('[data-planning-search]').value.trim().toLocaleLowerCase('uk-UA'),type=content.querySelector('[data-planning-type]').value,mode=content.querySelector('[data-planning-mode]').value,day=CRMCaseTasks.today();
  const rows=candidates.filter(c=>(planningRecruiter==='all'||(planningRecruiter==='unassigned'?!c.responsible_recruiter_id:c.responsible_recruiter_id===planningRecruiter))&&String(c.name_nominative||c.full_name).toLocaleLowerCase('uk-UA').includes(q)&&(planningView==='all'||planningView==='paused'&&wf(c).paused||CRMCaseTasks.bucket(c,day)===planningView)&&(mode==='all'||(CRMCandidateConditions.isUnit(c)?'unit':'full')===mode)&&(type==='all'||type==='contract'&&profile(c).service_type==='За контрактом'||type==='mobilization'&&CRMCandidateConditions.isMobilization(c)||type==='unknown'&&!profile(c).service_type)).sort((a,b)=>CRMCaseTasks.compare(a,b,day));
  const pcEl = content.querySelector('[data-planning-count]'); if (pcEl) pcEl.textContent='Справ: '+rows.length+' · Спочатку прострочені, потім сьогоднішні та майбутні';
  content.querySelector('[data-planning-list]').innerHTML=rows.map(c=>{
   const w=wf(c);return '<button type="button" class="crm-planning-row" data-planning-id="'+esc(c.id)+'"><strong>'+esc(c.name_nominative||c.full_name)+'</strong><span>'+esc(w.outcome?(w.outcome+' · Архівування не завершено'):(CRMCandidateConditions.isUnit(c)?'Оформлює ВЧ':stage(c)))+(w.paused?' · На паузі':'')+'</span><span>'+esc(CRMCaseTasks.next(c))+'</span><small class="crm-due-'+CRMCaseTasks.bucket(c,day)+'">'+esc(CRMCaseTasks.date(CRMCaseTasks.due(c)))+'</small><small>'+esc(CRMResponsibility.name(c.responsible_recruiter_id))+'</small></button>';
  }).join('')||'<p class="muted">Кандидатів не знайдено.</p>';
 };render();content.querySelector('[data-planning-search]').oninput=render;filter.onchange=()=>{planningRecruiter=filter.value;render()};view.onchange=()=>{planningView=view.value;render()};content.querySelector('[data-planning-type]').onchange=render;content.querySelector('[data-planning-mode]').onchange=render;
 content.querySelector('[data-planning-list]').onclick=e=>{const id=e.target.closest('[data-planning-id]')?.dataset.planningId;if(id)crmNavigate('planning',id)};
}
window.CRMWorkflow={showPlanning,showArchive,stages,outcomes,profile,wf,stage,label,isArchived,readOnly,protectCard,protectWorkflow,mount,completionPatch,restorePatch,completionDialog};
})();
