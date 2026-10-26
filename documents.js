// PSK_RECRUTER CRM — document manager v2
const DOC_BUCKET='candidate-documents';
const DOC_MAX_SIZE=20*1024*1024;
const AI_DOC_FUNCTION='process-id-document';
let activeDocumentsCandidateId=null;
let activeDocumentsOptions=null;
let activeDocumentsReadOnly=false;
let documentViewSequence=0;
const archiveDocumentMutations='#docAddFiles,#docCameraFiles,#docScanFiles,[data-doc-add],[data-doc-replace],[data-doc-delete],[data-doc-retry],[data-doc-confirm],[data-doc-recheck],[data-doc-sync],[data-doc-edit-ai],[data-doc-zone],[data-doc-zone-manual],[data-doc-presence],[data-excluded-edit-ai],[data-excluded-retry]';
function protectArchivedDocuments(content,c){
 const locked=CRMWorkflow.readOnly(c);content.dataset.archiveReadOnly=String(locked);content.__archiveDocumentRows=content.querySelector('#documentRows');
 if(!content.dataset.archiveProtectionBound){
  content.dataset.archiveProtectionBound='true';
  const block=e=>{if(content.__archiveDocumentRows&&content.querySelector('#documentRows')===content.__archiveDocumentRows&&content.dataset.archiveReadOnly==='true'&&e.target.closest?.(archiveDocumentMutations)){e.preventDefault();e.stopImmediatePropagation();}};
  content.addEventListener('click',block,true);content.addEventListener('change',block,true);
 }
 if(locked){content.querySelectorAll(archiveDocumentMutations).forEach(el=>el.disabled=true);const note=document.createElement('p');note.className='crm-notice';note.textContent='Архівна справа: відкриття оригіналів, пошук та історія доступні. Для змін поверніть справу в роботу.';content.prepend(note);}
 return locked;
}
async function reloadDocumentView(id){
  const options=activeDocumentsCandidateId===id?activeDocumentsOptions:null;
  if(options?.host?.isConnected&&options.reload)return options.reload();
  return showDocuments(id);
}

function docEscape(v){return typeof escapeHtml==='function'?escapeHtml(v):String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[c]));}
function formatDocSize(b){const n=Number(b||0);if(!n)return'—';if(n<1024*1024)return Math.round(n/1024)+' КБ';return(n/1024/1024).toFixed(1)+' МБ';}
async function getDocumentRequirements(candidateId=null){
if(candidateId){
  const{data,error}=await supabaseClient.from('candidate_document_requirements').select('requirement_id,child_index,status,document_requirements(*)').eq('candidate_id',candidateId).order('requirement_id',{ascending:true}).order('child_index',{ascending:true});
  if(error)throw error;
  const seen=new Set(),result=[];
  for(const row of (data||[])){
    const r=row.document_requirements;
    if(!r||r.active===false||seen.has(r.id))continue;
    seen.add(r.id);result.push(r);
  }
  return result.map(CRMCandidateConditions.normalizeRequirement);
}
const{data,error}=await supabaseClient.from('document_requirements').select('*').eq('active',true).order('sort_order',{ascending:true});
if(error)throw error;
return (data||[]).map(CRMCandidateConditions.normalizeRequirement)
}
async function getCandidateDocuments(id){const{data,error}=await supabaseClient.from('documents').select('*').eq('candidate_id',id).order('created_at',{ascending:true});if(error)throw error;return data||[]}
function documentStatusHtml(r,docs){const m=docs.filter(d=>d.requirement_id===r.id||d.document_type===r.document_type);if(!m.length)return`<span class="status status-doc">${r.is_required?'Не завантажено':'Не додано'}</span>`;if(m.some(d=>d.verification_status==='Підтверджено'))return'<span class="status status-done">Підтверджено</span>';if(m.some(d=>d.processing_status==='AI оброблено'))return'<span class="status status-work">AI розпізнано · перевірити</span>';return'<span class="status status-work">Завантажено · перевірити</span>'}

function requirementCondition(r,c){return CRMCandidateConditions.requirement(r,c);}
function documentsForRequirement(r,docs){return docs.filter(d=>d.requirement_id===r.id||d.document_type===r.document_type)}
function documentDisplayState(d,aiEnabled=true){return CRMDocumentState.fileState(d,aiEnabled);}
function documentProcessingMetricsHtml(d,esc=docEscape){
  const m=d.ai_raw_response?.processing_metrics,valid=n=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0&&n<=1000000;
  if(m?.version!==1||!valid(m.http_requests)||!valid(m.provider_attempts)||!valid(m.duration_ms)||!Array.isArray(m.attempts)||m.attempts.length>24)return '';
  const rows=m.attempts.map(a=>'<li>'+esc(a.provider)+' · '+esc(a.model)+' · '+(Number.isInteger(a.http_status)?'HTTP '+esc(a.http_status):'відповідь не отримано')+' · '+(a.response_parsed?'результат прочитано':'без прочитаного результату')+'</li>').join('');
  return '<details class="crm-document-metrics"><summary>Журнал AI · HTTP-спроб: '+m.http_requests+'</summary><p>Спроб сервісів: '+m.provider_attempts+' · Час обробки: '+Math.round(m.duration_ms/1000)+' с. Суми витрат тут не обліковуються; спроба не є підтвердженням списання.</p><ol>'+rows+'</ol></details>';
}
function documentFileHtml(d,r,allDocs,esc=docEscape,compact=false){
  const verified=d.verification_status==='Підтверджено';
  const info='<small>'+esc(d.file_name||'Файл')+' · '+formatDocSize(d.file_size)+'<br><span class="status '+(verified?'status-done':'status-work')+'">'+esc(documentDisplayState(d,r.ai_enabled!==false))+'</span></small>';
  const zoneAction=r.ai_enabled!==false&&window.CRMMilitaryZoneReview&&window.CRMMilitaryZoneContract?.family(d.document_type,d.ai_document_type)?'<button type="button" class="crm-button" data-doc-zone="'+esc(d.id)+'" data-doc-zone-view="'+(d.ai_extracted?._military_zone_report?'1':'0')+'">' +(d.ai_extracted?._military_zone_report?'Результат AI':'Опрацювати AI · автопілот')+'</button>':'';
  const actions=CRMResponsibility.documentInfo(d)+documentProcessingMetricsHtml(d,esc)+'<button class="crm-button" data-doc-open="'+esc(d.id)+'">Відкрити</button>'+'<button class="crm-button" data-doc-replace="'+esc(d.id)+'">Нова версія</button>'+(CRMResponsibility.canDelete()?'<button class="crm-button crm-doc-delete" data-doc-delete="'+esc(d.id)+'">Видалити</button>':'')+versionHistory(d,allDocs)+savedReviewButtonHtml(d,esc)+(r.ai_enabled!==false&&d.ai_extracted?'<button class="crm-button" data-doc-data="'+esc(d.id)+'">Дані AI / перенесення</button><button class="crm-button" data-doc-sync="'+esc(d.id)+'">Перевірити синхронізацію</button>':'')+(d.ai_extracted?'<button class="crm-button" data-doc-edit-ai="'+esc(d.id)+'">Уточнити реквізити</button>':'')+(r.ai_enabled!==false?'<button class="crm-button" data-doc-retry="'+esc(d.id)+'">Повторити AI</button>':'')+(!verified?'<button class="crm-button" data-doc-confirm="'+esc(d.id)+'">Підтвердити</button>':'');
  if(zoneAction)return '<div class="crm-document-file">'+info+zoneAction+'<details class="crm-document-more"><summary>Додатково</summary><div class="crm-document-details">'+manualZoneButtonHtml(d,r,esc)+actions+'</div></details></div>';
  if(compact){
    const failed=d.processing_status==='AI помилка',attention=d.verification_status==='Потребує перевірки';
    const primary='<button type="button" class="crm-button" data-doc-open="'+esc(d.id)+'">Відкрити</button>'+(failed&&r.ai_enabled!==false?'<button type="button" class="crm-button" data-doc-retry="'+esc(d.id)+'">Повторити розпізнавання</button>':attention&&d.ai_extracted?'<button type="button" class="crm-button" data-doc-data="'+esc(d.id)+'">Вирішити питання</button>':'');
    const extra=actions.replace(/<button\b[^>]*\bdata-doc-open="[^"]*"[^>]*>[\s\S]*?<\/button>/g,'');
    return '<div class="crm-document-file crm-document-compact">'+info+'<div class="crm-document-primary">'+primary+'</div><details class="crm-document-more"><summary>Додатково</summary><div class="crm-document-details">'+extra+'</div></details></div>';
  }
  if(!verified)return '<div class="crm-document-file">'+info+actions+'</div>';
  const detailId='doc-details-'+d.id;
  return '<details class="crm-document-file crm-document-verified"><summary class="crm-document-summary">'+info+'</summary><div class="crm-document-details" id="'+esc(detailId)+'">'+actions+'<button class="crm-button" data-doc-add="'+esc(r.id)+'">＋ Додати</button></div></details>';
}
function manualZoneButtonHtml(d,r={},esc=docEscape){
  return d.storage_path&&!d.deleted_at&&r.ai_enabled!==false&&window.CRMMilitaryZoneReview&&window.CRMMilitaryZoneContract?.family(d.document_type,d.ai_document_type)
    ?'<button type="button" class="crm-button" data-doc-zone-manual="'+esc(d.id)+'">Оригінал і ручне читання · без автозапуску</button>':'';
}
async function openManualZoneDocument(id,docs,ensureSaved){
  if(CRMWorkspace.busy||!await ensureSaved())return;
  const doc=docs.find(d=>d.id===id);if(!doc||doc.deleted_at)return;
  return CRMMilitaryZoneReview.open(doc,{autostart:false});
}
function savedReviewButtonHtml(d,esc=docEscape){
  return d.processing_status==='AI оброблено'&&d.verification_status!=='Підтверджено'&&/резерв\+/iu.test(d.ai_raw_response?.document_type||'')?'<button type="button" data-doc-recheck="'+esc(d.id)+'">Звірити без AI</button>':'';
}
async function recheckSavedDocument(id){
  const {data:d,error}=await supabaseClient.from('documents').select('id,candidate_id,ai_processed_at').eq('id',id).single();if(error)throw error;
  const result=await supabaseClient.functions.invoke(AI_DOC_FUNCTION,{body:{document_id:id,action:'recheck_saved',expected_revision:d.ai_processed_at}});
  if(result.error)throw new Error(await documentAIError(result.error));if(!result.data?.rechecked)throw new Error(result.data?.error||'Звірку не завершено');
  alert('Звірку завершено без нового AI. Збігів: '+result.data.matched_fields+'. Ручні дані не змінено; документ не підтверджено автоматично.');
  if(activeDocumentsCandidateId===d.candidate_id)await reloadDocumentView(d.candidate_id);
}
function excludedDocumentRetryHtml(d,reqs,esc=docEscape){
  const r=reqs.find(r=>r.id===d.requirement_id||r.document_type===d.document_type);
  return d.verification_status!=='Підтверджено'&&r?.ai_enabled!==false?'<button type="button" data-excluded-retry="'+esc(d.id)+'">Повторити розпізнавання</button>':'';
}
async function retryExcludedDocument(button,ensureSaved){
  if(CRMWorkspace.busy||!await ensureSaved())return;
  button.disabled=true;CRMWorkspace.busy=true;
  try{if(button.dataset.docRecheck)await recheckSavedDocument(button.dataset.docRecheck);else await retryDocumentAI(button.dataset.excludedRetry);}
  catch(error){alert(error.message);}
  finally{CRMWorkspace.busy=false;if(button.isConnected)button.disabled=false;}
}
async function showDocuments(id,options={}){
  const viewSequence=++documentViewSequence;
  const content=options.host||document.querySelector('.content');if(!content)return;
  const embedded=!!options.host;activeDocumentsOptions=embedded?options:null;
  const ensureSaved=async()=>!embedded||await CRMWorkspace.guard();
  activeDocumentsCandidateId=id;
  const [docs,reqs,cr]=await Promise.all([getCandidateDocuments(id),getDocumentRequirements(),supabaseClient.from('candidates').select('*').eq('id',id).single()]);
  if(viewSequence!==documentViewSequence||embedded&&!content.isConnected)return;if(cr.error)throw cr.error;await CRMResponsibility.ready();if(viewSequence!==documentViewSequence||embedded&&!content.isConnected)return;content.classList.add('crm-doc-manager');const allDocs=docs.slice();docs.splice(0,docs.length,...CRMResponsibility.latest(docs));const c=cr.data,esc=docEscape;
  activeDocumentsReadOnly=CRMWorkflow.readOnly(c);
  CRMWorkspace.setContext(id,c.name_nominative||c.full_name);if(!embedded)CRMWorkspace.markMenu('documents');
  let profile=c.profile_data||{};if(typeof profile==='string'){try{profile=JSON.parse(profile)}catch(_){profile={}}}
  const children=Number(c.children_count)||((profile.relatives||[]).filter(r=>/син|доньк|дитин/i.test(r.relationship||r.relation||'')).length);
  const documentScope=CRMDocumentState.scope(c,reqs,docs),excludedDocs=documentScope.excluded;
  const rows=CRMDocumentState.rows(c,reqs,docs);
  const knownIds=new Set(reqs.map(r=>r.id)),knownTypes=new Set(reqs.map(r=>r.document_type));
  documentScope.current.filter(d=>!knownIds.has(d.requirement_id)&&!knownTypes.has(d.document_type)).forEach(d=>rows.push({r:{id:'',document_type:d.document_name||d.document_type||'Інший документ',is_required:false,ai_enabled:!!d.ai_extracted},files:[d],condition:true}));
  content.innerHTML='<div class="dashboard-top"><div><h1 class="page-title">Документи особової справи</h1><p class="page-subtitle">'+esc(c.name_nominative||c.full_name)+'</p></div><div class="quick-actions"><button id="docBackCard">Картка кандидата</button><button id="docAddFiles" class="primary">＋ Додати документи</button><button id="docCameraFiles">📷 Сканувати камерою</button><details class="crm-extra-actions"><summary>Інші дії</summary><div><button id="docDeletedFiles">Видалені ('+allDocs.filter(d=>d.deleted_at).length+')</button><button id="docCaseHistory">Історія дій</button><button id="docScanFiles" class="crm-desktop-scanner">PDF зі сканера</button></div></details></div></div><section class="card" style="margin-bottom:18px"><strong>Контроль комплекту</strong><p id="docProgressText"></p><div id="docProgress" style="height:9px;background:#edf0f1;border-radius:8px"><div style="height:100%;background:#b7d957;border-radius:8px"></div></div><p class="muted" id="docBatchStatus"></p></section><input type="search" id="docSearch" class="crm-search" placeholder="Знайти документ або файл" aria-label="Пошук документів"><div class="crm-filter-bar" id="docFilters">'+[['all','Усі'],['missing','Не вистачає'],['review','Потребують перевірки'],['errors','Помилки'],['additional','Додаткові']].map(([key,title])=>'<button type="button" data-doc-filter="'+key+'">'+title+'</button>').join('')+'</div><section class="card" style="padding:0;overflow:auto"><table><thead><tr><th>Документ</th><th>Обов’язковість</th><th>Файли та статус</th><th>Дії</th></tr></thead><tbody id="documentRows" data-requirements-managed="1"></tbody></table><p id="docEmpty" class="muted" style="padding:18px" hidden>Документів за цим фільтром немає.</p></section>';
  content.querySelector('#documentRows').dataset.splavCandidate=id;
  if(!activeDocumentsReadOnly)resumeSplavJobs(id).catch(()=>{});
  content.querySelector('#docBackCard').onclick=()=>crmNavigate('card',id);
  content.querySelector('#docDeletedFiles').onclick=()=>showDeletedDocuments(id,allDocs,CRMWorkflow.readOnly(c));
  content.querySelector('#docCaseHistory').onclick=()=>CRMResponsibility.history(id).catch(e=>alert(e.message));
  content.querySelector('#docAddFiles').onclick=async()=>{if(await ensureSaved())openAddDocumentModal(id)};
  content.querySelector('#docScanFiles').onclick=async()=>{if(await ensureSaved())openScannerImport(id)};
  content.querySelector('#docCameraFiles').onclick=async()=>{if(await ensureSaved())openCameraDocument(id)};
  if(embedded){content.querySelector('#docBackCard').hidden=true;content.querySelector('.page-subtitle').hidden=true;}
  content.querySelectorAll('button').forEach(b=>b.type='button');
  const totals=CRMDocumentState.summary(c,reqs,docs);
  content.querySelector('#docProgressText').textContent='Комплект: '+totals.verified+' із '+totals.total+' перевірено · '+totals.copies+' електронних копій · '+totals.paper+' без файла'+(totals.unknown?' · Уточнити умов: '+totals.unknown:'');
  content.querySelector('#docProgress > div').style.width=(totals.total?Math.round(totals.verified/totals.total*100):0)+'%';
  const packageState=CRMDocumentState.packageState(c,docs);
  const packageInfo=document.createElement('details');packageInfo.className='crm-package-readiness';
  packageInfo.innerHTML='<summary>PDF «Анкета»: '+(packageState.ready?'готовий до формування':'потрібно уточнити '+packageState.missing.length+' пунктів')+'</summary>'+packageState.rows.map(r=>'<p><b>'+esc(r.title)+'</b> · '+esc(r.state)+'</p>').join('');
  content.querySelector('#docProgress').after(packageInfo);
  content.querySelector('#docBatchStatus').textContent='Комплектність враховує обов’язкові файли та позначки «Є в наявності». Для PDF-пакета потрібні електронні копії.';
  if(excludedDocs.length&&!CRMCandidateConditions.isUnit(c)){
    const details=document.createElement('details');details.className='card';details.style.marginBottom='18px';
    details.innerHTML='<summary>Раніше завантажені документи, які зараз не потрібні ('+excludedDocs.length+')</summary>'+excludedDocs.map(d=>'<p>'+esc(d.document_type)+' · '+esc(d.file_name)+' <button type="button" data-excluded-open="'+esc(d.id)+'">Відкрити</button>'+(d.ai_extracted?' <button type="button" data-excluded-edit-ai="'+esc(d.id)+'">Уточнити реквізити</button><button type="button" data-excluded-data="'+esc(d.id)+'">Дані AI / перенесення</button>':'')+manualZoneButtonHtml(d,reqs.find(r=>r.id===d.requirement_id||r.document_type===d.document_type),esc)+excludedDocumentRetryHtml(d,reqs,esc)+savedReviewButtonHtml(d,esc)+'</p>'+documentProcessingMetricsHtml(d,esc)).join('');
    details.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.docZoneManual){openManualZoneDocument(b.dataset.docZoneManual,allDocs,ensureSaved).catch(error=>alert(error.message));return;}if(b.dataset.docRecheck){retryExcludedDocument(b,ensureSaved);return;}if(b.dataset.excludedRetry){retryExcludedDocument(b,ensureSaved);return;}if(b.dataset.excludedOpen)openDocument(b.dataset.excludedOpen);if(b.dataset.excludedEditAi)editDocumentExtraction(b.dataset.excludedEditAi).catch(err=>alert(err.message));if(b.dataset.excludedData)reviewDocumentData(b.dataset.excludedData).catch(err=>alert(err.message))});content.querySelector('#docFilters').before(details);
  }
  const body=content.querySelector('#documentRows');
  body.innerHTML=rows.map(row=>{
    const {r,files,condition,childIndex}=row;
    const mark=window.CRMDocumentPresence?.entry(r,c);
    const required=r.is_required&&condition===true,missing=required&&!row.received,errors=files.some(d=>r.ai_enabled!==false&&d.processing_status==='AI помилка'),review=files.some(d=>d.verification_status!=='Підтверджено');
    const label=condition===null?'Уточніть у картці':condition===false?'Додатковий':required?'Обов’язковий':'За наявності';
    return '<tr data-missing="'+missing+'" data-errors="'+errors+'" data-review="'+review+'" data-additional="'+(!required)+'"><td><b>'+esc(r.document_type)+(childIndex?' · дитина '+childIndex:'')+'</b>'+(r.condition_note?'<span class="crm-field-tip"><button type="button" aria-label="'+esc(r.condition_note)+'" title="'+esc(r.condition_note)+'">ⓘ</button><span role="tooltip">'+esc(r.condition_note)+'</span></span>':'')+'</td><td>'+label+'</td><td>'+(mark?CRMDocumentPresence.summary(mark,esc,files.length>0):'')+(files.length?files.map(d=>documentFileHtml(d,r,allDocs,esc,embedded)).join(''):mark?'':row.group==='military-alternative'&&row.received?(row.verified?'Виконано іншим обліковим документом':'Інший обліковий документ — перевірте'):required?'Не завантажено':'Не додано')+'</td><td>'+(window.CRMDocumentPresence?.control(r,c,files,esc)||'')+(files.length&&files.every(d=>d.verification_status==='Підтверджено')?'':'<button class="crm-button" data-doc-add="'+esc(r.id)+'">＋ Додати'+(mark?' файл':'')+'</button>')+'</td></tr>';
  }).join('');
  body.addEventListener('change',async e=>{
    const box=e.target.closest('[data-doc-presence]');if(!box)return;e.stopPropagation();
    const r=reqs.find(r=>r.id===box.dataset.docPresence),before=!!window.CRMDocumentPresence?.entry(r,c);
    if(CRMWorkspace.busy||!await ensureSaved()){box.checked=before;return;}
    let saved=false;
    CRMWorkspace.busy=true;body.querySelectorAll('[data-doc-presence]').forEach(el=>el.disabled=true);
    try{
      await CRMDocumentPresence.set(supabaseClient,c,r,box.checked);
      saved=true;
      await reloadDocumentView(id);
      document.querySelector('#docBatchStatus').textContent=box.checked?'Документ є в наявності та перевірений. Електронну копію можна додати пізніше.':'Позначку знято. Завантажені файли залишилися без змін.';
    }catch(error){if(!saved&&box.isConnected)box.checked=before;content.querySelector('#docBatchStatus').textContent=(saved?'Позначку збережено, але список не оновився. Оновіть сторінку: ':'Не збережено: ')+error.message;}
    finally{CRMWorkspace.busy=false;content.querySelectorAll('[data-doc-presence]').forEach(el=>el.disabled=false);}
  });
  body.addEventListener('click',async e=>{
    const b=e.target.closest('button');
    if(!b){const td=e.target.closest('td'),row=td?.closest('tr');if(td&&[0,2].includes(td.cellIndex)&&!e.target.closest('summary,details,input,label')){const folds=[...row.querySelectorAll('.crm-document-verified,.crm-presence-summary')];const open=!folds.every(d=>d.open);folds.forEach(d=>d.open=open);}return;}
    const tip=b.closest('.crm-field-tip');if(tip){const open=tip.classList.toggle('is-open');b.setAttribute('aria-expanded',String(open));return;}
    if(!await ensureSaved())return;
    if(b.dataset.aiHistory)return CRMResponsibility.aiHistory(b.dataset.aiHistory).catch(error=>alert(error.message));
    if(b.dataset.docReplace){const d=allDocs.find(d=>d.id===b.dataset.docReplace);return makeDocumentInput(id,d.requirement_id||'',d.id)}
    if(b.hasAttribute('data-doc-add'))return openAddDocumentModal(id,b.dataset.docAdd);
    if(b.dataset.docOpen)return openDocument(b.dataset.docOpen);
    if(b.dataset.docZoneManual)return openManualZoneDocument(b.dataset.docZoneManual,allDocs,async()=>true).catch(error=>alert(error.message));
    if(b.dataset.docZone)return CRMMilitaryZoneReview.open(allDocs.find(d=>d.id===b.dataset.docZone),{autostart:b.dataset.docZoneView!=='1',viewOnly:b.dataset.docZoneView==='1'}).catch(error=>alert(error.message));
    if(b.dataset.docSync)return CRMDocumentSync.showPreview(supabaseClient,b.dataset.docSync).catch(error=>alert(error.message));
    if(b.dataset.docData)return reviewDocumentData(b.dataset.docData).catch(error=>alert(error.message));
    if(b.dataset.docEditAi)return editDocumentExtraction(b.dataset.docEditAi).catch(error=>alert(error.message));
    b.disabled=true;CRMWorkspace.busy=true;
    try{
      if(b.dataset.docDelete)await setDocumentDeleted(allDocs.find(d=>d.id===b.dataset.docDelete),true);
      if(b.dataset.docRecheck)await recheckSavedDocument(b.dataset.docRecheck);
      if(b.dataset.docRetry)await retryDocumentAI(b.dataset.docRetry);
      if(b.dataset.docConfirm)await confirmDocument(b.dataset.docConfirm);
    }catch(error){alert(error.message)}finally{CRMWorkspace.busy=false;if(b.isConnected)b.disabled=false}
  });
  let activeFilter='all';
  const filter=key=>{
    activeFilter=key;
    const query=content.querySelector('#docSearch').value.trim().toLocaleLowerCase('uk');
    body.querySelectorAll('tr').forEach(tr=>{
      const title=tr.cells[0]?.textContent||'';
      const files=[...tr.querySelectorAll('.crm-document-file small,.crm-document-verified summary')].map(el=>el.textContent).join(' ');
      tr.hidden=(key!=='all'&&tr.dataset[key]!=='true')||!!query&&!((title+' '+files).toLocaleLowerCase('uk').includes(query));
    });
    content.querySelectorAll('[data-doc-filter]').forEach(b=>{b.classList.toggle('active',b.dataset.docFilter===key);b.setAttribute('aria-pressed',String(b.dataset.docFilter===key))});
    content.querySelector('#docEmpty').hidden=[...body.querySelectorAll('tr')].some(tr=>!tr.hidden);
  };
  content.querySelector('#docSearch').addEventListener('input',()=>filter(activeFilter));
  content.querySelector('#docFilters').addEventListener('click',e=>{const key=e.target.closest('[data-doc-filter]')?.dataset.docFilter;if(key)filter(key)});filter('all');
  protectArchivedDocuments(content,c);
}
async function confirmDocument(id){
  const user=await getCurrentUser();if(!user)throw new Error('Увійдіть повторно.');
  const {data,error}=await supabaseClient.from('documents').update({verification_status:'Підтверджено',verified_by:user.id,verified_at:new Date().toISOString()}).eq('id',id).select('id,candidate_id,ai_extracted');
  if(error)throw error;if(!data?.length)throw new Error('Документ не підтверджено. Перевірте права доступу до цього файла.');
  await reloadDocumentView(data[0].candidate_id);
  document.querySelector('#docBatchStatus').textContent='Документ перевірений. Натисніть на поле документа, щоб розгорнути деталі та кнопки.';
}
async function makeDocumentInput(id,reqId='',replacementId=''){
  const old=document.getElementById('documentModal');if(old)old.remove();
  const modal=document.createElement('dialog');modal.id='documentModal';modal.className='crm-dialog';modal.dataset.candidateId=id;modal.dataset.replacementId=replacementId;
  document.body.append(modal);
  return Promise.all([getDocumentRequirements(),supabaseClient.from('candidates').select('*').eq('id',id).single()]).then(([allReqs,cr])=>{
    if(!modal.isConnected)return;
    if(cr.error)throw cr.error;
    const reqs=allReqs.filter(r=>requirementCondition(r,cr.data)!==false);
    const options='<option value="">AI визначить тип автоматично</option>'+reqs.map(r=>'<option value="'+docEscape(r.id)+'" '+(r.id===reqId&&r.ai_enabled===false?'selected':'')+'>'+docEscape(r.document_type)+'</option>').join('');
    modal.innerHTML='<h2>'+ (replacementId?'Нова версія документа':'Додати документи') +'</h2><p class="muted">'+docEscape(CRMWorkspace.candidateName||'Кандидат')+' · СПЛАВ визначить типи документів, розпізнає та зіставить дані. Дочекайтеся підтвердження прийняття файлів. У фоновому режимі після цього вкладку можна закрити. Для документів без AI виберіть тип вручну.</p><details><summary>Додатково: указати тип вручну</summary><label>Тип документа <select id="docRequirement" class="crm-search">'+options+'</select></label></details><div class="crm-actions"><button type="button" id="docModalCamera">📷 Сканувати документ</button></div><label>Вибрати готові файли<input id="docFileInput" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"></label><small class="muted">JPG/JPEG автоматично перетворюються на PDF перед завантаженням. Один знімок — один PDF, зі збереженням пропорцій.</small><div id="docFilePlan"></div><div id="docUploadStatus" role="status" style="margin-top:14px;white-space:pre-line"></div><div class="crm-actions"><button id="docUploadButton" disabled>Завантажити документи</button><button id="closeDocModal">Закрити</button></div>';
    if(replacementId)modal.querySelector('#docFileInput').removeAttribute('multiple');
    const input=modal.querySelector('#docFileInput'),rootType=modal.querySelector('#docRequirement'),plan=modal.querySelector('#docFilePlan'),upload=modal.querySelector('#docUploadButton');
    const render=()=>{
      const files=Array.from(input.files||[]);
      plan.innerHTML=files.map((file,i)=>'<div class="crm-review-field"><strong>'+docEscape(file.name)+'</strong><small style="display:block;margin:6px 0">'+formatDocSize(file.size)+'</small><details><summary>Змінити тип вручну</summary><select aria-label="Тип документа" data-file-type="'+i+'" class="crm-search">'+options+'</select></details><small data-file-mode="'+i+'"></small></div>').join('');
      plan.querySelectorAll('select').forEach(select=>select.value=rootType.value);updateMode();
    };
    const updateMode=()=>{
      const selections=[...plan.querySelectorAll('[data-file-type]')];
      selections.forEach(select=>{const r=reqs.find(x=>x.id===select.value);plan.querySelector('[data-file-mode="'+select.dataset.fileType+'"]').textContent=r?(r.ai_enabled===false?'Збереження без AI/OCR':'Збереження та AI/OCR-розпізнавання'):'AI визначить тип і розпізнає дані'});
      upload.disabled=!selections.length;
    };
    input.addEventListener('change',render);
    rootType.addEventListener('change',()=>{plan.querySelectorAll('select').forEach(s=>s.value=rootType.value);updateMode()});
    plan.addEventListener('change',updateMode);
    modal.querySelector('#closeDocModal').onclick=async()=>{if(CRMWorkspace.busy)return;if(modal.querySelector('#docFileInput')?.files?.length&&modal.dataset.uploadComplete!=='true'&&!confirm('Файли ще не завантажені. Закрити вікно та відкинути вибір?'))return;modal.close();modal.remove();await reloadDocumentView(id)};
    modal.addEventListener('cancel',e=>{e.preventDefault();if(!CRMWorkspace.busy)modal.querySelector('#closeDocModal').click()});
    upload.onclick=uploadSelectedDocuments;
    modal.querySelector('#docModalCamera').onclick=()=>scanIntoDocumentModal(modal);
    if(modal.isConnected&&!modal.open)modal.showModal();
  }).catch(e=>{if(!modal.isConnected)return;modal.remove();alert(e.message)});
}
function openAddDocumentModal(id,reqId=''){activeDocumentsCandidateId=id;makeDocumentInput(id,reqId)}
function scanIntoDocumentModal(modal){
  if(!window.DocumentCamera||CRMWorkspace.busy||!modal?.isConnected)return;
  const type=modal.querySelector('#docRequirement');
  const title=type.value?type.options[type.selectedIndex].text:'Документ';
  DocumentCamera.open({title,onComplete:async file=>{
    if(!modal.isConnected)throw new Error('Вікно завантаження закрите. Відкрийте його знову.');
    const input=modal.querySelector('#docFileInput');
    const selectedTypes=[...modal.querySelectorAll('[data-file-type]')].map(select=>select.value);
    const transfer=new DataTransfer();
    [...input.files,file].forEach(item=>transfer.items.add(item));input.files=transfer.files;
    input.dispatchEvent(new Event('change',{bubbles:true}));
    modal.querySelectorAll('[data-file-type]').forEach((select,index)=>{if(index<selectedTypes.length)select.value=selectedTypes[index]});
    modal.querySelector('#docFilePlan').dispatchEvent(new Event('change',{bubbles:true}));
    modal.querySelector('#docUploadStatus').textContent='PDF підготовлено. Перевірте тип і натисніть «Завантажити документи».';
  }});
}
async function openCameraDocument(id,reqId=''){
  if(CRMWorkspace.busy)return;
  await makeDocumentInput(id,reqId);
  const modal=document.getElementById('documentModal');
  if(modal?.dataset.candidateId===id)scanIntoDocumentModal(modal);
}

async function documentAIError(error){
let payload=null;
try{const response=error?.context;if(response&&typeof response.json==='function')payload=await (typeof response.clone==='function'?response.clone():response).json()}catch(_){}
const base=String(payload?.error||payload?.message||error?.message||'Помилка AI');
const providers=Array.isArray(payload?.provider_errors)?payload.provider_errors:[];
if(!providers.length)return base;
return base+'\n'+providers.map(p=>{
const provider=String(p.provider||'AI'),detail=String(p.detail||'');
let reason=detail.slice(0,350)||'Помилка сервісу';
if(/credit_balance_exhausted|no credits remaining|insufficient credits/i.test(detail))reason='Закінчилися кредити API. Поповніть баланс сервісу.';
else if(/quota exceeded|exceeded.*quota/i.test(detail))reason='Досягнуто ліміту запитів. Спробуйте після поновлення ліміту.';
else if(/не вдалося розібрати JSON|прочитати JSON|некоректний JSON/i.test(detail))reason='Сервіс повернув некоректну структуровану відповідь. Спробуйте повторне AI.';
return provider+': '+reason;
}).join('\n');
}
async function classifyStoredDocument(documentId,path,fileName,extractedText=''){
if(!documentId)throw new Error('Не передано ID документа для AI');
const doc={id:documentId};
const{data:ai,error:aiError}=await supabaseClient.functions.invoke(AI_DOC_FUNCTION,{body:{document_id:doc.id}});
if(aiError)throw new Error(await documentAIError(aiError));
if(!ai?.ok&&!ai?.extracted)throw new Error(ai?.error||'AI не повернув структуровані дані');
if(ai.persistence_version!==1||ai.documentId!==documentId)throw new Error('Потрібно оновити сервер СПЛАВ. Файл збережено; результат не перезаписувався браузером.');
return ai
}
const splavTrackedJobs=new Set();
async function enqueueSplavDocument(documentId,candidateId){
 const result=await supabaseClient.rpc('crm_splav_enqueue',{document_id:documentId});
 if(result.error){
  if(result.error.code==='PGRST202'||result.error.code==='42883'||result.error.message?.includes('SPLAV_QUEUE_DISABLED'))return null;
  throw new Error('Файл збережено, але черга СПЛАВ не прийняла завдання. '+(result.error.code==='40001'?'Документ підтверджено, замінено або його джерело змінилося. Потрібна звірка.':result.error.message||'Спробуйте пізніше.'));
 }
 if(!result.data?.id)throw new Error('Черга не підтвердила прийняття документа. Файл збережено.');
 trackSplavJob(result.data.id,candidateId);
 return result.data;
}
function trackSplavJob(jobId,candidateId,attempt=0){
 if(typeof setTimeout!=='function')return;
 if(attempt>=180){splavTrackedJobs.delete(jobId);return;}
 if(attempt===0&&splavTrackedJobs.has(jobId))return;
 splavTrackedJobs.add(jobId);
 setTimeout(async()=>{
  if(activeDocumentsCandidateId!==candidateId||activeDocumentsReadOnly){splavTrackedJobs.delete(jobId);return;}
  try{
   const result=await supabaseClient.rpc('crm_splav_job_status',{job_id:jobId});
   if(!result.error&&result.data&&['completed','needs_review','uncertain','superseded'].includes(result.data.state)&&!CRMWorkspace.busy){
    const visible=document.getElementById('documentRows');
    if(visible?.dataset.splavCandidate===candidateId)await reloadDocumentView(candidateId);
    const status=document.getElementById('docUploadStatus');
    if(status)status.textContent+='\nСПЛАВ: '+(result.data.state==='completed'?'розпізнавання та узгодження завершено.':result.data.state==='superseded'?'документ уже змінено; показано чинні дані.':'потрібна звірка. Збережені значення залишено без змін.');
    splavTrackedJobs.delete(jobId);return;
   }
  }catch(_){}
  trackSplavJob(jobId,candidateId,attempt+1);
 },10000);
}
async function resumeSplavJobs(candidateId){
 if(activeDocumentsReadOnly)return;
 const result=await supabaseClient.rpc('crm_splav_candidate_jobs',{candidate_id:candidateId});
 if(result.error||!Array.isArray(result.data)||activeDocumentsCandidateId!==candidateId)return;
 for(const job of result.data)if(['queued','running'].includes(job.state))trackSplavJob(job.id,candidateId);
 const status=document.getElementById('docBatchStatus'),rows=document.getElementById('documentRows');
 if(status&&rows?.dataset.splavCandidate===candidateId){
  const pending=result.data.filter(j=>['queued','running'].includes(j.state)).length;
  const review=result.data.filter(j=>['needs_review','uncertain'].includes(j.state)).length;
  status.textContent=pending||review?'СПЛАВ · У фоновій черзі: '+pending+' · Потребують звірки: '+review:'';
 }
}
function acceptedServerReconciliation(ai,documentId){const r=ai?.sync_result;return r?.version===1&&r.document_id===documentId&&ai.document_revision&&r.source_revision===ai.document_revision&&['completed','needs_review','superseded','failed'].includes(r.state)?r:null;}
function normName(s){return String(s||'').toLowerCase().replace(/[^a-zа-яіїєґ0-9]/gi,'')}
function findCandidateByName(name,candidates){const n=normName(name);if(!n)return null;return candidates.find(c=>{const cn=normName(c.full_name);return cn===n||cn.includes(n)||n.includes(cn)})||null}
function identityDocumentTypeValue(documentType=''){
const type=String(documentType||'').toLocaleLowerCase('uk-UA').replace(/\s+/g,' ').trim();
if(type.includes('свідоцтво про народження'))return'birth';
if(/\bid\b|id[\s-]*карт/.test(type))return'ID';
if(type.includes('паспорт'))return'passport';
return null;
}
async function processOneDocument(file,requirementId,user,candidates,forcedCandidateId,replacementId=null){
if(CRMUploadPDF.isJPEG(file)){const status=document.getElementById('docUploadStatus');if(status)status.textContent='Перетворення JPEG у PDF: '+file.name;}
file=await CRMUploadPDF.prepare(file);
const name=String(file.name||'').toLowerCase(),mime=String(file.type||'').toLowerCase();
const ok=mime==='application/pdf'||mime==='image/jpeg'||mime==='image/png'||mime==='application/msword'||mime==='application/vnd.openxmlformats-officedocument.wordprocessingml.document'||/\.(pdf|jpe?g|png|docx?)$/i.test(name);if(!ok)throw new Error('Підтримуються PDF, JPG, JPEG, PNG, DOC та DOCX');if(file.size>DOC_MAX_SIZE)throw new Error('Файл більший за 20 МБ');
const reqs=await getDocumentRequirements(),forced=reqs.find(r=>r.id===requirementId),tempType=forced?.document_type||'Обробка AI';
const aiEnabled=forced?.ai_enabled!==false;
const ext=(name.match(/\.[a-z0-9]+$/i)||[''])[0].toLowerCase();
const safeName=Date.now()+'_'+Math.random().toString(36).slice(2,10)+ext;
const path=forcedCandidateId+'/incoming/'+safeName;
const upload=await supabaseClient.storage.from(DOC_BUCKET).upload(path,file,{upsert:false,contentType:mime||'application/octet-stream'});if(upload.error)throw new Error('Завантаження: '+upload.error.message);
const baseDocument={replaces_document_id:replacementId||null,candidate_id:forcedCandidateId,requirement_id:forced?.id||null,document_type:tempType,document_name:tempType,storage_path:path,file_name:file.name,file_size:file.size,mime_type:mime||null,uploaded_by:user.id,status:'Завантажено',verification_status:'Не перевірено',processing_status:aiEnabled?'AI обробка':'Завантажено',ai_warnings:[]};
const{data:storedDocument,error:documentError}=await supabaseClient.from('documents').insert(baseDocument).select('id').single();
if(documentError||!storedDocument?.id){await supabaseClient.storage.from(DOC_BUCKET).remove([path]);throw new Error('Реєстрація документа: '+(documentError?.message||'не створено запис'))}
if(!aiEnabled)return{file:file.name,type:tempType,confidence:0,warnings:[],skipped:true};
const queued=await enqueueSplavDocument(storedDocument.id,forcedCandidateId);
if(queued)return{file:file.name,type:tempType,confidence:0,warnings:['Файл прийнято. СПЛАВ опрацює його у фоні; вкладку можна закрити.'],queued:true,jobId:queued.id};
// The authenticated server reads the original file. Browser OCR was unused and duplicated the work.
const documentText='';
let ai=null;
try{ai=await classifyStoredDocument(storedDocument.id,path,file.name,documentText)}catch(e){throw new Error('Файл збережено. Розпізнавання не завершено: '+e.message)}
const aiType=ai?.document_type||tempType,matchedCandidate=findCandidateByName(ai?.candidate_name,candidates),warnings=Array.isArray(ai?.warnings)?ai.warnings.slice():[];if(forced&&aiType!==tempType)warnings.push('AI визначив інший тип: '+aiType+'. Звірте тип документа.');if(matchedCandidate&&matchedCandidate.id!==forcedCandidateId)warnings.push('AI визначив кандидата: '+matchedCandidate.full_name+'. Документ завантажено до відкритої справи.');
// The server persists classification and OCR together under the source revision guard.
// Browser transfer uses the existing fresh preview/CAS, never an AI patch from a stale response.
const reconciliation=acceptedServerReconciliation(ai,storedDocument.id);
if(reconciliation){
 warnings.push(...(Array.isArray(reconciliation.reasons)?reconciliation.reasons:[]));
 if(reconciliation.state==='superseded')warnings.push('Документ уже змінився; показано чинні дані справи.');
}else try{const report=await CRMDocumentSync.automate(supabaseClient,storedDocument.id);warnings.push(...report.reasons);const conflicts=report.rows.filter(r=>r.action==='conflict');if(conflicts.length)warnings.push('Синхронізація: '+conflicts.length+' конфлікт(ів); збережені значення залишено.')}catch(err){warnings.push('AI розпізнано, але перенесення не виконано: '+err.message)}
return{file:file.name,type:aiType,confidence:Number(ai?.confidence||0),candidate:ai?.candidate_name||'',syncState:reconciliation?.state||null,warnings};
}
async function uploadSelectedDocuments(){
  const modal=document.getElementById('documentModal');if(!modal||CRMWorkspace.busy)return;
  const files=Array.from(modal.querySelector('#docFileInput').files||[]),id=modal.dataset.candidateId;
  const types=[...modal.querySelectorAll('[data-file-type]')].map(s=>s.value);
  if(!files.length)return;
  if(modal.dataset.replacementId&&files.length!==1)return alert("Для нової версії виберіть один файл.");
  const user=await getCurrentUser();if(!user)return alert('Увійдіть повторно.');
  const candidates=await getCandidates(),status=modal.querySelector('#docUploadStatus');
  CRMWorkspace.busy=true;window.__PSK_DOC_AI_ENABLED=true;
  modal.querySelectorAll('button,input,select').forEach(b=>b.disabled=true);
  const results=[],hashes=new Set();
  try{
    for(let i=0;i<files.length;i++){
      status.textContent='СПЛАВ · Документ '+(i+1)+' із '+files.length+': '+files[i].name;
      try{
        const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await files[i].arrayBuffer()))).map(x=>x.toString(16).padStart(2,'0')).join('');
        if(hashes.has(digest)){results.push('↪ '+files[i].name+' — точний дублікат у цьому пакеті, пропущено.');continue;}
        hashes.add(digest);
        const result=await processOneDocument(files[i],types[i],user,candidates,id,modal.dataset.replacementId||null);
        results.push('✓ '+files[i].name+' — '+result.type+(result.skipped?' · без AI/OCR':result.queued?' · прийнято до фонової черги':result.syncState==='completed'?' · розпізнано й узгоджено':result.syncState==='needs_review'?' · розпізнано, потрібна звірка':result.syncState==='failed'?' · розпізнано, узгодження не завершено':result.syncState==='superseded'?' · стан документа вже оновлено':' · розпізнано')+(result.warnings.length?'\n  '+result.warnings.join('; '):''));
      }catch(e){results.push('✕ '+files[i].name+' — '+e.message)}
    }
  }finally{
    CRMWorkspace.busy=false;
    status.textContent=results.join('\n');
    modal.querySelector('#closeDocModal').disabled=false;
    modal.querySelector('#docUploadButton').textContent='Обробку завершено';
    modal.dataset.uploadComplete='true';
  }
}

let scannerBatchFiles=[];function openScannerImport(id){activeDocumentsCandidateId=id;scannerBatchFiles=[];let modal=document.getElementById('scannerModal');if(!modal){modal=document.createElement('div');modal.id='scannerModal';modal.style.cssText='position:fixed;inset:0;background:rgba(10,18,24,.55);z-index:100;display:grid;place-items:center;padding:20px';document.body.appendChild(modal)}renderScannerBatchModal()}function renderScannerBatchModal(){const modal=document.getElementById('scannerModal');if(!modal)return;const count=scannerBatchFiles.length;modal.innerHTML=`<div style="width:min(720px,100%);max-height:90vh;overflow:auto;background:#fff;border-radius:14px;padding:24px;box-shadow:0 20px 70px rgba(0,0,0,.25)"><div style="display:flex;justify-content:space-between;gap:12px"><div><h3 style="margin:0">🖨 Сканування пакета</h3><div class="muted" style="font-size:11px;margin-top:6px">Відскануй документ через Canon, збережи його як PDF і додай його до поточного пакета.</div></div><button class="logout" onclick="cancelScannerBatch()">Скасувати</button></div><div style="margin-top:18px;padding:14px;border:1px solid #e1e7ea;border-radius:10px;background:#f8fafb"><b>У пакеті: ${count} документ${count===1?'':'ів'}</b><div style="margin-top:8px;font-size:11px;color:#68757d">${count?scannerBatchFiles.map((f,i)=>`${i+1}. ${docEscape(f.name)} · ${formatDocSize(f.size)}`).join('<br>'):'Ще немає відсканованих документів.'}</div></div><input id="nextScannerPdf" type="file" accept="application/pdf,.pdf" style="display:none"><div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:18px"><button class="login-button" style="width:auto" onclick="scanNextDocument()">🖨 Сканувати наступний документ</button><button style="border:1px solid #d8e0e3;background:#fff;border-radius:8px;padding:11px 15px;font-weight:800" onclick="removeLastScannerDocument()" ${count?'':'disabled'}>🗑 Видалити останній</button><button style="border:1px solid #2e3b42;background:#2e3b42;color:#fff;border-radius:8px;padding:11px 15px;font-weight:800" onclick="finishScannerBatch()" ${count?'':'disabled'}>✓ Завершити пакет</button></div><div id="scannerBatchStatus" class="muted" style="margin-top:12px;font-size:11px"></div></div>`}function scanNextDocument(){const input=document.getElementById('nextScannerPdf');if(!input)return;input.value='';input.onchange=()=>{const f=input.files?.[0];if(!f)return;if(f.type!=='application/pdf'&&!f.name.toLowerCase().endsWith('.pdf')){document.getElementById('scannerBatchStatus').textContent='Потрібен PDF-файл.';return}if(f.size>DOC_MAX_SIZE){document.getElementById('scannerBatchStatus').textContent='PDF більший за 20 МБ.';return}scannerBatchFiles.push(f);renderScannerBatchModal()};input.click()}function removeLastScannerDocument(){if(scannerBatchFiles.length)scannerBatchFiles.pop();renderScannerBatchModal()}function cancelScannerBatch(){scannerBatchFiles=[];document.getElementById('scannerModal')?.remove()}async function finishScannerBatch(){const files=[...scannerBatchFiles],id=activeDocumentsCandidateId;if(!files.length)return;cancelScannerBatch();await makeDocumentInput(id);const input=document.querySelector('#documentModal #docFileInput');if(!input)return;const transfer=new DataTransfer();files.forEach(file=>transfer.items.add(file));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));}
async function retryDocumentAI(id){
const{data:doc,error:documentError}=await supabaseClient.from('documents').select('candidate_id,document_type,requirement_id').eq('id',id).single();
if(documentError||!doc?.candidate_id){alert('Не вдалося визначити кандидата для документа.');return}
const reqs=await getDocumentRequirements(),req=reqs.find(r=>r.id===doc.requirement_id||r.document_type===doc.document_type);
if(req?.ai_enabled===false)return alert('Для цього документа розпізнавання не передбачене.');
try{const queued=await enqueueSplavDocument(id,doc.candidate_id);if(queued){alert('СПЛАВ прийняв завдання. Опрацювання продовжиться у фоні; вкладку можна закрити.');if(activeDocumentsCandidateId===doc.candidate_id)await reloadDocumentView(doc.candidate_id);return;}}
catch(error){alert(error.message);return;}
const{data,error}=await supabaseClient.functions.invoke(AI_DOC_FUNCTION,{body:{document_id:id}});
if(error){alert('Не вдалося повторити AI: '+await documentAIError(error));if(activeDocumentsCandidateId===doc.candidate_id)await reloadDocumentView(doc.candidate_id);return}
if(!data?.ok&&!data?.extracted){alert(data?.error||'AI не повернув структуровані дані');return}
let needsReview=false;
const reconciliation=acceptedServerReconciliation(data,id);
if(reconciliation){needsReview=['needs_review','failed'].includes(reconciliation.state);alert(reconciliation.state==='completed'?'СПЛАВ завершив розпізнавання та узгодження. Заповнено полів: '+reconciliation.auto_filled:[...(reconciliation.reasons||[]),...(reconciliation.state==='superseded'?['Документ уже змінився. Оновлюємо справу.']:[])].join('\n'));}
else try{const report=await CRMDocumentSync.automate(supabaseClient,id);needsReview=report.needsRecruiter;alert(report.supported?'Повторне AI завершено. Порожні поля перенесено; конфліктів: '+report.rows.filter(r=>r.action==='conflict').length:'AI завершено. Відкриваю звірку та вибір даних для перенесення.')}catch(err){alert('AI завершено, але синхронізація не виконана: '+err.message)}
if(activeDocumentsCandidateId===doc.candidate_id)await reloadDocumentView(doc.candidate_id)
if(needsReview)await reviewDocumentData(id);
}
async function openDocument(id){const{data,error}=await supabaseClient.from('documents').select('*').eq('id',id).single();if(error||data?.deleted_at||!data?.storage_path){alert('Документ не знайдено.');return}const{data:signed,error:se}=await supabaseClient.storage.from(DOC_BUCKET).createSignedUrl(data.storage_path,300);if(se||!signed?.signedUrl){alert('Не вдалося відкрити документ: '+(se?.message||'невідома помилка'));return}window.open(signed.signedUrl,'_blank','noopener,noreferrer')}
function installDocumentControls(){
  document.querySelectorAll('.menu-item:not([data-nav])').forEach(item=>{
    if(!String(item.textContent||'').includes('Документи')||item.dataset.docBound)return;
    item.dataset.docBound='1';item.addEventListener('click',e=>{e.preventDefault();crmNavigate('documents')});
  });
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installDocumentControls);else installDocumentControls();
// Review the existing document container; never infer values that AI did not return.
async function reviewDocumentData(id){
  const {data:d,error}=await supabaseClient.from('documents').select('*').eq('id',id).single();
  if(error)throw error;
  if(['AI обробка','AI помилка'].includes(d.processing_status))throw new Error('Розпізнавання не завершено; попередні дані AI не переносяться. Дочекайтеся завершення або перевірте причину помилки розпізнавання.');
  if(CRMDocumentSync.plan(d,{profile_data:{}}).supported)return CRMDocumentSync.showPreview(supabaseClient,id);if(d.deleted_at)throw new Error('Документ видалено. Спочатку відновіть його.');
  const [cr,pr]=await Promise.all([supabaseClient.from('candidates').select('*').eq('id',d.candidate_id).single(),supabaseClient.from('personal_files').select('*').eq('candidate_id',d.candidate_id).maybeSingle()]);
  if(cr.error)throw cr.error;if(pr.error)throw pr.error;
  await CRMResponsibility.ready();
  const c=cr.data,pf=pr.data||{},esc=docEscape,e=d.ai_extracted||{};
  let p=c.profile_data||{};if(typeof p==='string'){try{p=JSON.parse(p)}catch(_){p={}}}
  const labels={military_service_records:'Призначення та періоди служби',military_rank_records:'Історія військових звань',military_training_records:'Підготовка та навчання',military_oath:'Військова присяга',unit:'Військова частина',disposition:'Перебування у розпорядженні',crossed_out:'Перекреслений запис',rank:'Звання',training_type:'Вид підготовки',work_records:'Періоди трудової діяльності',work_events:'Усі записи трудової діяльності',work_details:'Реквізити трудового документа',employer:'Роботодавець / організація',employer_code:'Код роботодавця',event_date:'Дата події',kind:'Тип запису',position_changes:'Зміни посади',start_date:'Початок',end_date:'Завершення',termination_reason:'Причина завершення',order_number:'Номер наказу',order_date:'Дата наказу',source_pages:'Сторінки джерела',vlk_commission:'Комісія / установа ВЛК',vlk_details:'Медичні відомості та підписи',education_records:"Усі дипломи",education_level:"Рівень освіти",education_institution:"Заклад освіти",education_specialty_code:"Код спеціальності",education_specialty:"Спеціальність",education_qualification:"Кваліфікація",education_year:"Рік закінчення",education_start_date:"Початок навчання",education_end_date:"Завершення навчання",education_diploma_series:"Серія диплома",education_diploma_number:"Номер диплома",education_diploma_issue_date:"Дата видачі диплома",education_supplement_number:"Номер додатка",education_supplement_issue_date:"Дата видачі додатка",education_prior_references:"Попередня освіта — згадки",education_details:"Дисципліни та додаткові відомості",military_record_entries:'Записи військового обліку',field_evidence:'Джерела й впевненість полів',raw_text:'Текст запису',legibility:'Читабельність',section:'Розділ',page:'Сторінка',requires_review:'Потрібна ручна перевірка',registration_records:'Історія реєстрацій',residence_registration_status:'Стан реєстрації',registered_at:'Дата реєстрації',deregistered_at:'Дата зняття / скасування',status:'Стан',military_registry_number:'Номер у реєстрі Оберіг',military_document_expiry_date:'Витяг Резерв+ дійсний до',military_data_updated_at:'Дата уточнення даних',military_deferment_type:'Тип відстрочки',military_deferment_until:'Відстрочка до',military_registration_removal_reason:'Підстава зняття / виключення',military_training_status:'Військова підготовка',military_document_number:'Номер військово-облікового документа',military_document_type:'Тип військового документа',military_registration_date:'Дата взяття на облік',military_registration_category:'Категорія військового обліку',military_registration_status:'Стан військового обліку',vlk_certificate_number:'Номер довідки ВЛК',vlk_date:'Дата ВЛК',vlk_conclusion:'Висновок ВЛК',vlk_category:'Категорія придатності',vlk_next_date:'Дата наступного огляду',full_name:'ПІБ',name_nominative:'ПІБ у називному відмінку',name_genitive:'ПІБ у родовому відмінку',name_gender:'Стать за ПІБ',name_cases:'Відмінки ПІБ',birth_date:'Дата народження',birth_place:'Місце народження',rnokpp:'РНОКПП',passport_data:'Дані паспорта',phone:'Телефон',email:'Email',sex:'Стать',marital_status:'Сімейний стан',has_children:'Є діти',children_info:'Відомості про дітей',relatives:'Рідні та близькі',education:'Освіта',civilian_profession:'Цивільна професія',worked_before:'Працював / працювала',work_history:'Трудовий стаж',served_before:'Служив / служила',military_rank:'Військове звання',military_unit:'Військова частина',military_specialty:'ВОС',military_service_history:'Військовий стаж',desired_position:'Бажана посада',desired_unit:'Бажаний напрям',tcc:'ТЦК та СП',address:'Адреса з документа',registered_address:'Адреса реєстрації',citizenship:'Громадянство',unzr:'УНЗР',document_type:'Тип документа',document_number:'Номер документа',document_series:'Серія документа',document_date:'Дата видачі',document_issuer:'Ким виданий',passport_number:'Номер паспорта',passport_series:'Серія паспорта',passport_issuer:'Ким виданий паспорт',passport_issue_date:'Дата видачі паспорта',passport_expiry_date:'Дійсний до',birth_certificate:'Номер свідоцтва про народження',confidence:'Впевненість AI',warnings:'Попередження',meta:'Додаткові відомості',relationship:'Спорідненість',workplace:'Місце роботи',position:'Посада',notes:'Примітки',signatory:'Підписант',recommender_unit:'Організація рекомендації',recruiter_name:'Рекрутер'};
  const display=v=>v===true?'Так':v===false?'Ні':v==null||v===''?'Не вказано':typeof v==='object'?JSON.stringify(v,null,2):String(v);
  const renderValue=v=>Array.isArray(v)?v.map(renderValue).join('<hr>'):v&&typeof v==='object'?Object.entries(v).map(([k,value])=>'<div><b>'+esc(labels[k]||k)+':</b> '+renderValue(value)+'</div>').join(''):esc(display(v));
  const biography=CRMBiography.isDocument(d.document_type)||CRMBiography.isDocument(d.ai_document_type),biographyCheck=biography?CRMBiography.review(e,c,p,pf,d.id):null;
  const vlk=CRMVLK.isDocument(d.document_type)||CRMVLK.isDocument(d.ai_document_type),vlkCheck=vlk?CRMVLK.review(e,c):null;
  const work=CRMWork.isDocument(d.document_type)||CRMWork.isDocument(d.ai_document_type),workCheck=work?CRMWork.review(e,c,p,d.id):null;
  const education=CRMEducation.isDocument(d.document_type)||CRMEducation.isDocument(d.ai_document_type),educationCheck=education?CRMEducation.review({...e,source_verified:d.verification_status==='Підтверджено',education_records:Array.isArray(e.education_records)?e.education_records.map(r=>({...r,source_document_id:d.id})):[]},c,p):null;
  const residence=CRMResidence.isDocument(d.document_type)||CRMResidence.isDocument(d.ai_document_type),residenceCheck=residence?CRMResidence.review(e,c,p):null;
  const military=CRMMilitary.isDocument(d.document_type)||CRMMilitary.isDocument(d.ai_document_type),militaryCheck=military?CRMMilitary.review({...e,meta:d.ai_meta||e.meta},c,p,d.id):null;
  const nameChange=CRMNameHistory.isDocument(d.document_type)||CRMNameHistory.isDocument(d.ai_document_type),nameChangeCheck=nameChange?CRMNameHistory.review(e,c,d):null;
  const type=identityDocumentTypeValue(d.ai_document_type||d.document_type),changes=[];
  const idCheck=type==='ID'?(window.CRMIDValidation?.review({document_type:'ID',extracted:e,candidate_name:d.ai_candidate_name,confidence:d.ai_confidence},c)||{blocked:true,issues:['Перевірка ID-картки ще не завантажилась. Оновіть сторінку.']}):null;
  // Restrict editable mapping to candidate identity documents and the established
  // recommendation/autobiography flow. Other people's certificates stay in their container.
  const ownIdentity=!idCheck?.blocked&&!biography&&!residence&&(type==='ID'||type==='passport'||type==='birth')&&!/дітей/i.test(d.document_type||'');
  const personalSource=!biography&&!residence&&(ownIdentity||/рекомендац|ідентифікаційн/i.test(d.document_type||''));
  const add=(target,key,incoming,label)=>{
    if(key==='phone'||key==='phone_secondary')incoming=window.CRMPhone.normalize(incoming);
    if(incoming===null||incoming===undefined||incoming==='')return;
    const current=target==='candidate'?c[key]:target==='file'?pf[key]:p[key];
    if(JSON.stringify(current)===JSON.stringify(incoming)||String(current??'').trim()===String(incoming).trim())return;
    changes.push({target,key,incoming,current,label:label||labels[key]||key});
  };

  if(militaryCheck&&!militaryCheck.blocked){
    for(const [key,value] of Object.entries(militaryCheck.fields))if(p[key]==null||p[key]==='')add('profile',key,value);
    for(const key of ['military_rank','military_specialty','tcc'])if((c[key]==null||c[key]==='')&&!e.field_evidence?.[key]?.requires_review&&!e.meta?.field_evidence?.[key]?.requires_review)add('candidate',key,e[key]);
    if(militaryCheck.accepted){add('profile','work_records',militaryCheck.records,'Періоди військової служби');if(c.served_before==null&&p.served_before==null)add('candidate','served_before',true);}
  }
  if(militaryCheck&&!militaryCheck.blocked&&militaryCheck.history&&!pf.military_service_history)add('file','military_service_history',militaryCheck.history);
  if(nameChangeCheck&&!nameChangeCheck.blocked)add('profile','name_history',nameChangeCheck.history,'Попередні ПІБ та документ про зміну');
  if(biographyCheck)changes.push(...biographyCheck.proposals);
  if(!biography&&workCheck?.accepted){add('profile','work_records',workCheck.records,'Періоди трудової діяльності');add('profile','work_events',workCheck.events,'Історія подій: робота, служба, безробіття');if(workCheck.events.some(r=>r.kind==='hire'))add('candidate','worked_before',true,'Працював / Працювала');}
  if(!biography&&vlkCheck)for(const [key,value] of Object.entries(vlkCheck.fields))add('profile',key,value);
  if(!biography&&educationCheck?.accepted){
    add('profile','education_records',educationCheck.records,'Усі дипломи та освіти');
    const h=educationCheck.highest;
    if(h&&(CRMEducation.ranks[h.degree]||0)>=(CRMEducation.ranks[p.education_level]||0)){
      for(const [key,value] of Object.entries({education_level:h.degree,education_institution:h.institution,education_specialty_code:h.specialty_code,education_specialty:h.specialty,education_qualification:h.qualification,education_year:h.graduation_year,education_start_date:h.study_start_date,education_end_date:h.study_end_date,education_diploma_series:h.diploma_series,education_diploma_number:h.diploma_number,education_diploma_issue_date:h.diploma_issue_date,education_supplement_number:h.supplement_number,education_supplement_issue_date:h.supplement_issue_date}))add('profile',key,value);
    }
  }
  if(!biography&&residenceCheck?.unzr)add('profile','unzr',residenceCheck.unzr,'УНЗР');
  if(residenceCheck?.address)add('profile','registered_address',residenceCheck.address,'Зареєстроване місце проживання');
  if(/рекомендац/iu.test(d.document_type||''))add('profile','service_type',CRMCard13.service({}, {service_type:e.service_type||e.service?.service_type}, {}),'Вид оформлення');
  if(/несудим|судим|кримінальн/iu.test(d.document_type||'')){
    const details=typeof e.criminal_record_details==='string'?e.criminal_record_details:'';
    const statuses=[...details.matchAll(/(?:незнятої\s+чи\s+непогашеної\s+судимості|наявність\s+судимості|відомості\s+про\s+судимість)\s*[:—-]\s*(ВІДСУТНІ|ПРИСУТНІ)/giu)].map(m=>m[1].toLocaleUpperCase('uk-UA'));
    const unique=[...new Set(statuses)];
    const fromDetails=unique.length===1?(unique[0]==='ВІДСУТНІ'?'Відсутні':'Присутні'):null;
    const rawRecord=String(e.criminal_record_info||'').trim().toLocaleUpperCase('uk-UA');
    const normalizedRecord=rawRecord==='ВІДСУТНІ'?'Відсутні':rawRecord==='ПРИСУТНІ'?'Присутні':null;
    const record=unique.length>1?null:normalizedRecord||fromDetails;

    if(record==='Відсутні'||record==='Присутні'){
      const owner=String(e.full_name||e.name_nominative||d.ai_candidate_name||'').trim().replace(/\s+/g,' ').toLocaleLowerCase('uk-UA');
      const candidate=String(c.name_nominative||c.full_name||'').trim().replace(/\s+/g,' ').toLocaleLowerCase('uk-UA');
      if(owner&&owner===candidate&&(!e.birth_date||!c.birth_date||e.birth_date===c.birth_date))add('profile','criminal_record_info',record,'Відомості про судимість');
    }
  }
  if(personalSource){
    for(const key of ['birth_date','birth_place','rnokpp','phone','email','sex','marital_status','has_children','worked_before','served_before','military_rank','civilian_profession','desired_position','tcc'])add('candidate',key,e[key]);
    add('candidate','full_name',e.name_nominative||e.full_name);
    add('candidate','name_nominative',e.name_nominative||e.full_name);
    add('candidate','name_genitive',e.name_genitive||e.name_cases?.genitive||e.name_cases?.['Родовий']);
    for(const key of ['education','work_history','military_service_history','children_info'])add('file',key,e[key]);
    add('profile','relatives',e.relatives);
  }
  if(!biography&&/резерв\s*\+|припис|призовної дільниці|військовий облік|військово[-\s]?обліков/iu.test(d.document_type||d.ai_document_type||'')){
    for(const key of ['full_name','rnokpp','tcc','military_rank','military_specialty'])add('candidate',key,e[key]);
    for(const key of ['military_registry_number','military_document_expiry_date','military_data_updated_at','military_deferment_type','military_deferment_until','military_registration_removal_reason','military_training_status','military_document_number','military_document_type','military_registration_date','military_registration_category','military_registration_status','vlk_certificate_number','vlk_date','vlk_conclusion','vlk_category','vlk_next_date'])add('profile',key,e[key]);
  }
  if(ownIdentity){
    add('profile','identity_document_type',type,'Тип документа у картці');
    if(type==='birth')add('profile','birth_certificate',e.document_number||e.birth_certificate);
    else{
      add('profile','passport_number',e.document_number||e.passport_number);
      add('profile','passport_issuer',e.document_issuer||e.passport_issuer);
      add('profile','passport_issue_date',e.document_date||e.passport_issue_date);
      add('profile','passport_expiry_date',e.passport_expiry_date||e.meta?.passport_expiry_date);
      if(type==='passport')add('profile','passport_series',e.document_series||e.passport_series);
      for(const key of ['citizenship','unzr','registered_address'])add('profile',key,e[key]||e.meta?.[key]);
    }
  }
  if(nameChangeCheck?.blocked)changes.splice(0);
  if(idCheck?.blocked)changes.splice(0);
  if(militaryCheck?.blocked)changes.splice(0);
  const currentVersion=await supabaseClient.from('documents').select('id').eq('version_group_id',d.version_group_id).gt('version_number',d.version_number).limit(1);if(currentVersion.error)throw currentVersion.error;const archived=!!currentVersion.data?.length||CRMWorkflow.readOnly(c);if(archived)changes.splice(0);
  const dialog=document.createElement('dialog');dialog.className='crm-dialog';
  dialog.innerHTML='<h2>Розпізнані дані документа</h2><p>'+esc(c.name_nominative||c.full_name)+' · '+esc(d.file_name)+'</p><div class="crm-actions"><button data-original>Відкрити оригінал</button><button data-close>Закрити</button></div>'+(changes.length?'<h3>Перенесення даних у картку</h3><p>Підтвердження документа фіксує перевірку файла. Щоб зберегти його дані в картці, позначте поля та натисніть «Перенести позначені поля». Непозначені значення залишаться без змін.</p><button type="button" data-select-empty>Позначити порожні поля картки</button><div class="crm-review-grid">'+changes.map((change,i)=>'<label class="crm-review-field"><input type="checkbox" data-change="'+i+'"> <strong>'+esc(change.label)+'</strong><div class="crm-review-values"><span>У картці:<br>'+esc(display(change.current))+'</span><span>З документа:<br>'+esc(display(change.incoming))+'</span></div></label>').join('')+'</div><div class="crm-actions"><button data-apply disabled>Перенести позначені поля (0)</button></div>':'<p>'+(archived?'Це архівна справа або попередня версія: дані доступні лише для перегляду.':Object.values(e).some(v=>v!==null&&v!==undefined&&v!=='')?'Доступні для перенесення дані вже збігаються з карткою або цей тип документа не підтримує перенесення.':'AI не повернув даних для перенесення. Повторіть розпізнавання або заповніть картку вручну.')+'</p>')+'<p role="status"></p><h3>Контейнер документа</h3><div class="crm-review-grid">'+Object.entries(e).map(([key,value])=>'<section class="crm-review-field"><strong>'+esc(labels[key]||key)+'</strong><div>'+renderValue(value)+'</div></section>').join('')+'</div>'+(d.ai_warnings?.length?'<h3>Попередження</h3><p>'+renderValue(d.ai_warnings)+'</p>':'');
  if(militaryCheck){const notice=document.createElement('p');notice.className='cc-hint';notice.textContent=militaryCheck.issues.join(' ')||'Власника звірено. Порожня дата завершення не означає поточну службу. Звання, підготовка та сумнівні записи доступні в контейнері документа.';dialog.prepend(notice);}
  if(nameChangeCheck){const n=document.createElement('p');n.textContent=nameChangeCheck.issues.join(' ')||'Чинне ПІБ не змінюється. Після перенесення попереднє ПІБ враховуватиметься для звірки документів.';dialog.prepend(n);}
  if(workCheck){const notice=document.createElement('p');notice.className='cc-hint';notice.textContent=(workCheck.issues.length?workCheck.issues.join(' '):'Власника документа звірено.')+' Події служби й безробіття зберігаються окремо. Особисті реквізити не переносяться. Період без звільнення не підтверджує поточну роботу.';dialog.prepend(notice);}
  if(vlkCheck){const notice=document.createElement('p');notice.className='cc-hint';notice.textContent=vlkCheck.issues.length?vlkCheck.issues.join(' '):'Власника довідки звірено. Переносяться лише поля ВЛК; дані військового обліку й особисті реквізити не змінюються.';dialog.prepend(notice);}
  if(educationCheck){const notice=document.createElement('p');notice.className='cc-hint';notice.textContent=educationCheck.issues.length?educationCheck.issues.join(' '):'Власника диплома звірено. Оберіть записи освіти й поля для перенесення; особисті дані не змінюються.';dialog.prepend(notice);}
  if(biographyCheck){
    const notice=document.createElement('div');notice.className='cc-hint';notice.innerHTML='<p>Відомості зі слів кандидата. Підтверджені дипломи й записи роботи не замінюються. Оберіть поля для перенесення.</p>'+[...biographyCheck.issues,...biographyCheck.conflicts].map(x=>'<p>'+esc(x)+'</p>').join('');dialog.prepend(notice);
  }
  if(residenceCheck){
    const notice=document.createElement('p');notice.className='cc-hint';notice.textContent=residenceCheck.issues.length?residenceCheck.issues.join(' '):'Власника документа звірено. Переноситься лише зареєстрована адреса; фактичне місце проживання залишається без змін.';dialog.prepend(notice);
  }
  dialog.innerHTML+=CRMResponsibility.documentInfo(d);CRMResponsibility.bindHistory(dialog);
  if(idCheck?.blocked){const notice=document.createElement('div');notice.className='cc-hint';notice.setAttribute('role','alert');notice.textContent='Перенесення даних ID-картки заблоковано: '+idCheck.issues.join(' ')+' Звірте оригінал; повторіть AI або виправте дані вручну в картці кандидата.';dialog.prepend(notice);}
  document.body.append(dialog);dialog.showModal();
  const close=()=>{dialog.close();dialog.remove()};
  dialog.querySelector('[data-close]').onclick=close;
  dialog.addEventListener('cancel',ev=>{ev.preventDefault();if(!CRMWorkspace.busy)close()});
  dialog.querySelector('[data-original]').onclick=()=>openDocument(id);
  const apply=dialog.querySelector('[data-apply]');
  const updateSelection=()=>{if(!apply)return;const count=dialog.querySelectorAll('[data-change]:checked').length;apply.disabled=count===0;apply.textContent='Перенести позначені поля ('+count+')';};
  dialog.querySelectorAll('[data-change]').forEach(el=>el.addEventListener('change',updateSelection));
  const selectEmpty=dialog.querySelector('[data-select-empty]');
  if(selectEmpty)selectEmpty.onclick=()=>{dialog.querySelectorAll('[data-change]').forEach(el=>{if(el.disabled)return;const current=changes[Number(el.dataset.change)].current;if(current===null||current===undefined||current==='')el.checked=true});updateSelection()};
  if(apply)apply.onclick=async()=>{
    const selected=[...dialog.querySelectorAll('[data-change]:checked')].map(el=>changes[Number(el.dataset.change)]);
    if(!selected.length){dialog.querySelector('[role=status]').textContent='Позначте поля для перенесення.';return}
    apply.disabled=true;dialog.querySelectorAll('[data-close],[data-select-empty],input').forEach(el=>el.disabled=true);CRMWorkspace.busy=true;
    try{
      const result=await supabaseClient.rpc('crm_apply_document_fields',{document_id:d.id,selections:nameChangeCheck?selected.map(item=>({...item,expected_current:item.current??null,expected_ai:e})):biographyCheck?CRMBiography.selections(selected,p):militaryCheck?selected.map(item=>({...item,expected_current:item.current??null,expected_ai:e,fill_only:item.key!=='work_records'})):selected});if(result.error)throw result.error;
      dialog.querySelector('[role=status]').textContent='Позначені дані збережено в картці.';apply.textContent='Дані збережено';dialog.querySelector('[role=status]').insertAdjacentHTML('afterend','<button type="button" data-open-candidate>Відкрити картку кандидата</button>');dialog.querySelector('[data-open-candidate]').onclick=()=>{close();crmNavigate('card',d.candidate_id)};
      if(nameChangeCheck&&selected.some(x=>x.key==='name_history')){const b=document.createElement('button');b.type='button';b.textContent='Звірити свідоцтво про народження за історією ПІБ';b.onclick=()=>{close();CRMNameHistory.birthLinks(d.candidate_id).catch(e=>alert(e.message));};dialog.querySelector('[role=status]').after(b);}
      dialog.querySelectorAll('[data-change]:checked').forEach(el=>{el.checked=false;el.disabled=true});
    }catch(err){dialog.querySelector('[role=status]').textContent='Помилка збереження: '+err.message;apply.disabled=false;dialog.querySelectorAll('input').forEach(el=>el.disabled=false)}
    finally{CRMWorkspace.busy=false;dialog.querySelector('[data-close]').disabled=false;if(selectEmpty)selectEmpty.disabled=false;}
  };
}

function versionHistory(d,docs){const older=docs.filter(v=>v.version_group_id===d.version_group_id&&v.version_number<d.version_number).sort((a,b)=>b.version_number-a.version_number);return older.length?'<details class="crm-ai-container"><summary>Попередні версії ('+older.length+')</summary>'+older.map(v=>'<article><b>Версія '+docEscape(v.version_number)+' · '+docEscape(v.file_name)+'</b>'+CRMResponsibility.documentInfo(v)+'<button type="button" data-doc-open="'+docEscape(v.id)+'">Оригінал</button>'+(v.ai_extracted?'<button type="button" data-doc-data="'+docEscape(v.id)+'">Дані AI</button>':'')+'</article>').join('')+'</details>':''}

async function setDocumentDeleted(doc,deleted){
  if(!doc)throw new Error('Документ не знайдено. Оновіть список.');
  await CRMResponsibility.ready();
  if(!CRMResponsibility.canDelete())throw new Error('Недостатньо прав.');
  const actor=CRMResponsibility.name(CRMResponsibility.userId);
  if(!confirm((deleted?'Видалити зі справи':'Відновити у справі')+' документ «'+(doc.file_name||doc.document_name)+'»?\nВідповідальний: '+actor+(deleted?'\nФайл і дані AI збережуться в історії.':'')))return false;
  const r=await supabaseClient.rpc('crm_set_document_deleted',{document_id:doc.id,deleted});
  if(r.error)throw r.error;if(!r.data)throw new Error('Дію не виконано. Оновіть список.');
  window.CandidatePhotos?.clear();await reloadDocumentView(doc.candidate_id);return true;
}
function showDeletedDocuments(candidateId,docs,readOnly=false){
  const esc=docEscape,removed=docs.filter(d=>d.deleted_at).sort((a,b)=>new Date(b.deleted_at)-new Date(a.deleted_at));
  const dialog=document.createElement('dialog');dialog.className='crm-dialog crm-history';
  dialog.innerHTML='<h2>Видалені документи</h2><p class="muted">Файли й результати AI збережено для історії. Після відновлення документ знову враховується у комплекті.</p><button type="button" data-close>Закрити</button>'+ (removed.map(d=>'<article><h3>'+esc(d.file_name||d.document_name)+'</h3><p>'+esc(d.document_type)+' · версія '+esc(d.version_number)+'</p><p><b>Видалив: '+esc(d.deleted_by_name||CRMResponsibility.name(d.deleted_by))+'</b><br>'+esc(CRMResponsibility.date(d.deleted_at))+'</p>'+CRMResponsibility.documentInfo(d)+(!readOnly&&CRMResponsibility.canDelete()?'<button type="button" data-doc-restore="'+esc(d.id)+'">Відновити</button>':'')+'</article>').join('')||'<p>Видалених документів немає.</p>');
  document.body.append(dialog);dialog.showModal();const close=()=>{dialog.close();dialog.remove()};dialog.querySelector('[data-close]').onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();close()});
  CRMResponsibility.bindHistory(dialog);
  dialog.addEventListener('click',async e=>{const b=e.target.closest('[data-doc-restore]');if(!b||readOnly)return;b.disabled=true;CRMWorkspace.busy=true;try{if(await setDocumentDeleted(removed.find(d=>d.id===b.dataset.docRestore),false))close()}catch(error){alert(error.message)}finally{CRMWorkspace.busy=false;if(b.isConnected)b.disabled=false}});
}
