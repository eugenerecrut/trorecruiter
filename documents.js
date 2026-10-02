// PSK_RECRUTER CRM — document manager v2
const DOC_BUCKET='candidate-documents';
const DOC_MAX_SIZE=20*1024*1024;
const AI_DOC_FUNCTION='process-id-document';
let activeDocumentsCandidateId=null;

function docEscape(v){return typeof escapeHtml==='function'?escapeHtml(v):String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[c]));}
function formatDocSize(b){const n=Number(b||0);if(!n)return'—';if(n<1024*1024)return Math.round(n/1024)+' КБ';return(n/1024/1024).toFixed(1)+' МБ';}
async function getDocumentRequirements(candidateId=null){
if(candidateId){
  const{data,error}=await supabaseClient.from('candidate_document_requirements').select('requirement_id,child_index,status,document_requirements(*)').eq('candidate_id',candidateId).order('requirement_id',{ascending:true}).order('child_index',{ascending:true});
  if(error){console.error(error);return[]}
  const seen=new Set(),result=[];
  for(const row of (data||[])){
    const r=row.document_requirements;
    if(!r||r.active===false||seen.has(r.id))continue;
    seen.add(r.id);result.push(r);
  }
  return result;
}
const{data,error}=await supabaseClient.from('document_requirements').select('*').eq('active',true).order('sort_order',{ascending:true});
if(error){console.error(error);return[]}
return data||[]
}
async function getCandidateDocuments(id){const{data,error}=await supabaseClient.from('documents').select('*').eq('candidate_id',id).order('created_at',{ascending:true});if(error){console.error(error);return[]}return data||[]}
function documentStatusHtml(r,docs){const m=docs.filter(d=>d.requirement_id===r.id||d.document_type===r.document_type);if(!m.length)return`<span class="status status-doc">${r.is_required?'Не завантажено':'Не додано'}</span>`;if(m.some(d=>d.verification_status==='Підтверджено'))return'<span class="status status-done">Підтверджено</span>';if(m.some(d=>d.processing_status==='AI оброблено'))return'<span class="status status-work">AI розпізнано · перевірити</span>';return'<span class="status status-work">Завантажено · перевірити</span>'}

function requirementCondition(r,c){
  if(!r.condition_field)return true;
  const value=c[r.condition_field];
  if(value===null||value===undefined||value==='')return null;
  if(r.condition_field==='marital_status'){
    const text=String(value).trim().toLocaleLowerCase('uk-UA');
    const expected=String(r.condition_value).toLowerCase();
    return expected==='married'?['married','одружений','одружена'].includes(text):expected==='divorced'?['divorced','розлучений','розлучена'].includes(text):text===expected;
  }
  return String(value)===String(r.condition_value);
}
function documentsForRequirement(r,docs){return docs.filter(d=>d.requirement_id===r.id||d.document_type===r.document_type)}
function documentDisplayState(d,aiEnabled=true){
  if(d.verification_status==='Підтверджено')return 'Підтверджено';
  if(d.verification_status==='Потребує перевірки')return 'Є розбіжності';
  if(aiEnabled&&d.processing_status==='AI помилка')return 'Помилка розпізнавання';
  if(aiEnabled&&d.processing_status==='AI обробка')return 'Розпізнавання…';
  if(aiEnabled&&d.ai_extracted&&Object.keys(d.ai_extracted).length)return 'Розпізнано — перевірте дані';
  return 'Завантажено — перевірте документ';
}
async function showDocuments(id){
  const content=document.querySelector('.content');if(!content)return;
  activeDocumentsCandidateId=id;
  const [docs,reqs,cr]=await Promise.all([getCandidateDocuments(id),getDocumentRequirements(),supabaseClient.from('candidates').select('*').eq('id',id).single()]);
  if(cr.error)throw cr.error;const c=cr.data,esc=docEscape;
  CRMWorkspace.setContext(id,c.name_nominative||c.full_name);CRMWorkspace.markMenu('documents');
  let profile=c.profile_data||{};if(typeof profile==='string'){try{profile=JSON.parse(profile)}catch(_){profile={}}}
  const children=Number(c.children_count)||((profile.relatives||[]).filter(r=>/син|доньк|дитин/i.test(r.relationship||r.relation||'')).length);
  const rows=[];
  reqs.forEach(r=>{
    const files=documentsForRequirement(r,docs),condition=requirementCondition(r,c);
    if(condition===false&&!files.length)return;
    const count=r.condition_field==='has_children'&&condition===true?Math.max(1,children):1;
    for(let i=0;i<count;i++){
      const child=r.condition_field==='has_children',rowFiles=child?(i===count-1?files.slice(i):files.slice(i,i+1)):files;
      rows.push({r,files:rowFiles,condition:child&&condition===true&&!children?null:condition,childIndex:child?i+1:null});
    }
  });
  const knownIds=new Set(reqs.map(r=>r.id)),knownTypes=new Set(reqs.map(r=>r.document_type));
  docs.filter(d=>!knownIds.has(d.requirement_id)&&!knownTypes.has(d.document_type)).forEach(d=>rows.push({r:{id:'',document_type:d.document_name||d.document_type||'Інший документ',is_required:false,ai_enabled:!!d.ai_extracted},files:[d],condition:true}));
  content.innerHTML='<div class="dashboard-top"><div><h1 class="page-title">Документи особової справи</h1><p class="page-subtitle">'+esc(c.name_nominative||c.full_name)+'</p></div><div class="quick-actions"><button id="docBackCard">Картка кандидата</button><button id="docAddFiles" class="primary">＋ Додати документи</button><button id="docScanFiles">Сканувати пакет</button></div></div><section class="card" style="margin-bottom:18px"><strong>Контроль комплекту</strong><p id="docProgressText"></p><div id="docProgress" style="height:9px;background:#edf0f1;border-radius:8px"><div style="height:100%;background:#b7d957;border-radius:8px"></div></div><p class="muted" id="docBatchStatus"></p></section><div class="crm-filter-bar" id="docFilters">'+[['all','Усі'],['missing','Не вистачає'],['review','Потребують перевірки'],['errors','Помилки'],['additional','Додаткові']].map(([key,title])=>'<button type="button" data-doc-filter="'+key+'">'+title+'</button>').join('')+'</div><section class="card" style="padding:0;overflow:auto"><table><thead><tr><th>Документ</th><th>Обов’язковість</th><th>Файли та статус</th><th>Дії</th></tr></thead><tbody id="documentRows" data-requirements-managed="1"></tbody></table><p id="docEmpty" class="muted" style="padding:18px" hidden>Документів за цим фільтром немає.</p></section>';
  content.querySelector('#docBackCard').onclick=()=>crmNavigate('card',id);
  content.querySelector('#docAddFiles').onclick=()=>openAddDocumentModal(id);
  content.querySelector('#docScanFiles').onclick=()=>openScannerImport(id);
  const mandatory=rows.filter(row=>row.r.is_required&&row.condition===true);
  const uploaded=mandatory.filter(row=>row.files.length).length;
  const verified=mandatory.filter(row=>row.files.some(d=>d.verification_status==='Підтверджено')).length;
  const unknown=rows.filter(row=>row.r.is_required&&row.condition===null).length;
  content.querySelector('#docProgressText').textContent='Завантажено '+uploaded+' із '+mandatory.length+' · Підтверджено '+verified+' із '+mandatory.length+(unknown?' · Уточніть умови для '+unknown+' пунктів':'');
  content.querySelector('#docProgress > div').style.width=(mandatory.length?Math.round(verified/mandatory.length*100):0)+'%';
  content.querySelector('#docBatchStatus').textContent='Комплектність враховує лише обов’язкові документи, які потрібні цьому кандидату.';
  const body=content.querySelector('#documentRows');
  body.innerHTML=rows.map(row=>{
    const {r,files,condition,childIndex}=row;
    const required=r.is_required&&condition===true,missing=required&&!files.length,errors=files.some(d=>r.ai_enabled!==false&&d.processing_status==='AI помилка'),review=files.some(d=>d.verification_status!=='Підтверджено');
    const label=condition===null?'Уточніть у картці':condition===false?'Додатковий':required?'Обов’язковий':'За наявності';
    return '<tr data-missing="'+missing+'" data-errors="'+errors+'" data-review="'+review+'" data-additional="'+(!required)+'"><td><b>'+esc(r.document_type)+(childIndex?' · дитина '+childIndex:'')+'</b>'+(r.condition_note?'<p class="muted">'+esc(r.condition_note)+'</p>':'')+'</td><td>'+label+'</td><td>'+(files.length?files.map(d=>'<div class="crm-document-file"><small>'+esc(d.file_name||'Файл')+' · '+formatDocSize(d.file_size)+'<br><span class="status '+(d.verification_status==='Підтверджено'?'status-done':'status-work')+'">'+esc(documentDisplayState(d,r.ai_enabled!==false))+'</span></small><button class="crm-button" data-doc-open="'+esc(d.id)+'">Відкрити</button>'+(r.ai_enabled!==false&&d.ai_extracted?'<button class="crm-button" data-doc-data="'+esc(d.id)+'">Дані AI</button>':'')+(r.ai_enabled!==false?'<button class="crm-button" data-doc-retry="'+esc(d.id)+'">Повторити AI</button>':'')+(d.verification_status!=='Підтверджено'?'<button class="crm-button" data-doc-confirm="'+esc(d.id)+'">Підтвердити</button>':'')+'</div>').join(''):required?'Не завантажено':'Не додано')+'</td><td><button class="crm-button" data-doc-add="'+esc(r.id)+'">＋ Додати</button></td></tr>';
  }).join('');
  body.addEventListener('click',async e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.hasAttribute('data-doc-add'))return openAddDocumentModal(id,b.dataset.docAdd);
    if(b.dataset.docOpen)return openDocument(b.dataset.docOpen);
    if(b.dataset.docData)return reviewDocumentData(b.dataset.docData).catch(error=>alert(error.message));
    b.disabled=true;CRMWorkspace.busy=true;
    try{
      if(b.dataset.docRetry)await retryDocumentAI(b.dataset.docRetry);
      if(b.dataset.docConfirm)await confirmDocument(b.dataset.docConfirm);
    }catch(error){alert(error.message)}finally{CRMWorkspace.busy=false;if(b.isConnected)b.disabled=false}
  });
  const filter=key=>{
    body.querySelectorAll('tr').forEach(tr=>tr.hidden=key!=='all'&&tr.dataset[key]!=='true');
    content.querySelectorAll('[data-doc-filter]').forEach(b=>b.classList.toggle('active',b.dataset.docFilter===key));
    content.querySelector('#docEmpty').hidden=[...body.querySelectorAll('tr')].some(tr=>!tr.hidden);
  };
  content.querySelector('#docFilters').addEventListener('click',e=>{const key=e.target.closest('[data-doc-filter]')?.dataset.docFilter;if(key)filter(key)});filter('all');
}
async function confirmDocument(id){
  const user=await getCurrentUser();if(!user)throw new Error('Увійдіть повторно.');
  const {data,error}=await supabaseClient.from('documents').update({verification_status:'Підтверджено',verified_by:user.id,verified_at:new Date().toISOString()}).eq('id',id).select('id,candidate_id');
  if(error)throw error;if(!data?.length)throw new Error('Документ не підтверджено. Перевірте права доступу до цього файла.');
  await showDocuments(data[0].candidate_id);
}
async function makeDocumentInput(id,reqId=''){
  const old=document.getElementById('documentModal');if(old)old.remove();
  const modal=document.createElement('dialog');modal.id='documentModal';modal.className='crm-dialog';modal.dataset.candidateId=id;
  document.body.append(modal);
  return getDocumentRequirements().then(reqs=>{
    const options='<option value="">Оберіть тип документа</option>'+reqs.map(r=>'<option value="'+docEscape(r.id)+'" '+(r.id===reqId?'selected':'')+'>'+docEscape(r.document_type)+'</option>').join('');
    modal.innerHTML='<h2>Додати документи</h2><p class="muted">'+docEscape(CRMWorkspace.candidateName||'Кандидат')+' · виберіть тип для кожного файла до обробки.</p><label>Тип документа <select id="docRequirement" class="crm-search">'+options+'</select></label><input id="docFileInput" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"><div id="docFilePlan"></div><div id="docUploadStatus" role="status" style="margin-top:14px;white-space:pre-line"></div><div class="crm-actions"><button id="docUploadButton" disabled>Завантажити документи</button><button id="closeDocModal">Закрити</button></div>';
    const input=modal.querySelector('#docFileInput'),rootType=modal.querySelector('#docRequirement'),plan=modal.querySelector('#docFilePlan'),upload=modal.querySelector('#docUploadButton');
    const render=()=>{
      const files=Array.from(input.files||[]);
      plan.innerHTML=files.map((file,i)=>'<div class="crm-review-field"><strong>'+docEscape(file.name)+'</strong><select data-file-type="'+i+'" class="crm-search">'+options+'</select><small data-file-mode="'+i+'"></small></div>').join('');
      plan.querySelectorAll('select').forEach(select=>select.value=rootType.value);updateMode();
    };
    const updateMode=()=>{
      const selections=[...plan.querySelectorAll('[data-file-type]')];
      selections.forEach(select=>{const r=reqs.find(x=>x.id===select.value);plan.querySelector('[data-file-mode="'+select.dataset.fileType+'"]').textContent=r?(r.ai_enabled===false?'Збереження без AI/OCR':'Збереження та AI/OCR-розпізнавання'):'Виберіть тип документа'});
      upload.disabled=!selections.length||selections.some(s=>!s.value);
    };
    input.addEventListener('change',render);
    rootType.addEventListener('change',()=>{plan.querySelectorAll('select').forEach(s=>s.value=rootType.value);updateMode()});
    plan.addEventListener('change',updateMode);
    modal.querySelector('#closeDocModal').onclick=async()=>{if(CRMWorkspace.busy)return;modal.close();modal.remove();await showDocuments(id)};
    modal.addEventListener('cancel',e=>{e.preventDefault();if(!CRMWorkspace.busy)modal.querySelector('#closeDocModal').click()});
    upload.onclick=uploadSelectedDocuments;modal.showModal();
  }).catch(e=>{modal.remove();alert(e.message)});
}
function openAddDocumentModal(id,reqId=''){activeDocumentsCandidateId=id;makeDocumentInput(id,reqId)}
async function classifyStoredDocument(documentId,path,fileName,extractedText=''){
if(!documentId)throw new Error('Не передано ID документа для AI');
const doc={id:documentId};
const{data:ai,error:aiError}=await supabaseClient.functions.invoke(AI_DOC_FUNCTION,{body:{document_id:doc.id}});
if(aiError)throw new Error(aiError.message||'Помилка AI');
if(!ai?.ok&&!ai?.extracted)throw new Error(ai?.error||'AI не повернув структуровані дані');
return ai
}
function normName(s){return String(s||'').toLowerCase().replace(/[^a-zа-яіїєґ0-9]/gi,'')}
function findCandidateByName(name,candidates){const n=normName(name);if(!n)return null;return candidates.find(c=>{const cn=normName(c.full_name);return cn===n||cn.includes(n)||n.includes(cn)})||null}
function identityDocumentTypeValue(documentType=''){
const type=String(documentType||'').toLocaleLowerCase('uk-UA').replace(/\s+/g,' ').trim();
if(type.includes('свідоцтво про народження'))return'birth';
if(/\bid\b|id[\s-]*карт/.test(type))return'ID';
if(type.includes('паспорт'))return'passport';
return null;
}
async function applyAiExtraction(candidateId,extracted,documentType=''){
const {data:c,error}=await supabaseClient.from('candidates').select('*').eq('id',candidateId).single();
if(error||!c)return['Не вдалося відкрити картку кандидата'];
const {data:pf}=await supabaseClient.from('personal_files').select('*').eq('candidate_id',candidateId).maybeSingle();
const cu={},pu={},conf=[];const identityType=identityDocumentTypeValue(documentType);
const put=(key,val)=>{if(val===null||val===undefined||val==='')return;if(c[key]===null||c[key]===undefined||String(c[key]).trim()==='')cu[key]=val;else if(String(c[key]).trim().toLowerCase()!==String(val).trim().toLowerCase())conf.push(key+' відрізняється від даних картки')};
const pput=(key,val)=>{if(val===null||val===undefined||val==='')return;if(!pf?.[key]||String(pf[key]).trim()==='')pu[key]=val;else if(String(pf[key]).trim().toLowerCase()!==String(val).trim().toLowerCase())conf.push('особова справа: '+key+' відрізняється')};
const aiName=extracted.name_nominative||extracted.full_name;put('full_name',aiName);if(!c.full_name||normName(c.full_name)===normName(aiName))put('name_nominative',aiName);put('name_genitive',extracted.name_genitive);put('name_gender',extracted.name_gender);if(extracted.name_cases)put('name_cases',extracted.name_cases);
if(extracted.birth_date&&!c.birth_date)cu.birth_date=extracted.birth_date;else if(extracted.birth_date&&c.birth_date&&String(c.birth_date)!==String(extracted.birth_date))conf.push('дата народження відрізняється');
put('birth_place',extracted.birth_place);put('rnokpp',extracted.rnokpp);if(identityType!=='birth')put('passport_data',extracted.passport_data);put('phone',extracted.phone);put('email',extracted.email);put('sex',extracted.sex);put('marital_status',extracted.marital_status);put('military_rank',extracted.military_rank);put('civilian_profession',extracted.civilian_profession);put('desired_position',extracted.desired_position);put('direction',extracted.desired_unit);put('tcc',extracted.tcc);
if(extracted.has_children!==null&&extracted.has_children!==undefined){if(c.has_children===null||c.has_children===undefined)cu.has_children=extracted.has_children;else if(c.has_children!==extracted.has_children)conf.push('наявність дітей відрізняється')}
if(extracted.worked_before!==null&&extracted.worked_before!==undefined){if(c.worked_before===null||c.worked_before===undefined)cu.worked_before=extracted.worked_before;else if(c.worked_before!==extracted.worked_before)conf.push('дані про роботу відрізняються')}
if(extracted.served_before!==null&&extracted.served_before!==undefined){if(c.served_before===null||c.served_before===undefined)cu.served_before=extracted.served_before;else if(c.served_before!==extracted.served_before)conf.push('дані про військову службу відрізняються')}
if(extracted.military_unit||extracted.military_specialty){cu.profile_data={...(c.profile_data||{}),military_unit:extracted.military_unit||c.profile_data?.military_unit||null,military_specialty:extracted.military_specialty||c.profile_data?.military_specialty||null,last_ai_update:new Date().toISOString()}}
if(identityType){let profile=cu.profile_data??c.profile_data??{};if(typeof profile==='string'){try{profile=JSON.parse(profile)}catch(_){profile={}}}profile={...profile};let profileUpdated=false;const profilePut=(key,value)=>{if(value===null||value===undefined||value==='')return;const current=profile[key];if(current===null||current===undefined||String(current).trim()===''){profile[key]=value;profileUpdated=true}else if(String(current).trim().toLowerCase()!==String(value).trim().toLowerCase())conf.push(key+' відрізняється від даних картки')};const savedIdentityType=String(profile.identity_document_type||'').trim().toLocaleLowerCase('uk-UA');const hasBirthType=savedIdentityType==='birth'||savedIdentityType.includes('свідоцтво про народження');const hasIdentityFields=['passport_series','passport_number','passport_issuer','passport_issue_date','passport_expiry_date'].some(key=>profile[key]!==null&&profile[key]!==undefined&&String(profile[key]).trim()!=='');if(identityType!=='birth'&&(hasBirthType||!hasIdentityFields)){profile.identity_document_type=identityType;profileUpdated=true}else profilePut('identity_document_type',identityType);if(identityType==='birth')profilePut('birth_certificate',extracted.document_number);if(identityType==='ID'||identityType==='passport'){profilePut('passport_number',extracted.document_number);profilePut('passport_issuer',extracted.document_issuer);profilePut('passport_issue_date',extracted.document_date)}if(identityType==='passport')profilePut('passport_series',extracted.document_series);if(profileUpdated)cu.profile_data=profile}
pput('address',extracted.address);pput('birth_place',extracted.birth_place);pput('passport_data',extracted.passport_data);pput('education',extracted.education);pput('family_status',extracted.marital_status);pput('children_info',extracted.children_info);pput('work_history',extracted.worked_before===true?'Працював(-ла)':extracted.worked_before===false?'Не працював(-ла)':null);pput('military_service_history',extracted.military_service_history);
if(Object.keys(cu).length){cu.updated_at=new Date().toISOString();const{error:e}=await supabaseClient.from('candidates').update(cu).eq('id',candidateId);if(e)conf.push('картку не оновлено: '+e.message)}
if(Object.keys(pu).length){pu.candidate_id=candidateId;pu.updated_at=new Date().toISOString();const{error:e}=await supabaseClient.from('personal_files').upsert(pu,{onConflict:'candidate_id'});if(e)conf.push('особову справу не оновлено: '+e.message)}return conf;}

async function processOneDocument(file,requirementId,user,candidates,forcedCandidateId){
const name=String(file.name||'').toLowerCase(),mime=String(file.type||'').toLowerCase();
const ok=mime==='application/pdf'||mime==='image/jpeg'||mime==='image/png'||mime==='application/msword'||mime==='application/vnd.openxmlformats-officedocument.wordprocessingml.document'||/\.(pdf|jpe?g|png|docx?)$/i.test(name);if(!ok)throw new Error('Підтримуються PDF, JPG, JPEG, PNG, DOC та DOCX');if(file.size>DOC_MAX_SIZE)throw new Error('Файл більший за 20 МБ');
const reqs=await getDocumentRequirements(),forced=reqs.find(r=>r.id===requirementId),tempType=forced?.document_type||'Обробка AI';
const aiEnabled=forced?.ai_enabled!==false;
const ext=(name.match(/\.[a-z0-9]+$/i)||[''])[0].toLowerCase();
const safeName=Date.now()+'_'+Math.random().toString(36).slice(2,10)+ext;
const path=forcedCandidateId+'/incoming/'+safeName;
const upload=await supabaseClient.storage.from(DOC_BUCKET).upload(path,file,{upsert:false,contentType:mime||'application/octet-stream'});if(upload.error)throw new Error('Завантаження: '+upload.error.message);
const baseDocument={candidate_id:forcedCandidateId,requirement_id:forced?.id||null,document_type:tempType,document_name:tempType,storage_path:path,file_name:file.name,file_size:file.size,mime_type:mime||null,uploaded_by:user.id,status:'Завантажено',verification_status:'Не перевірено',processing_status:aiEnabled?'AI обробка':'Завантажено',ai_warnings:[]};
const{data:document,error:documentError}=await supabaseClient.from('documents').insert(baseDocument).select('id').single();
if(documentError||!document?.id){await supabaseClient.storage.from(DOC_BUCKET).remove([path]);throw new Error('Реєстрація документа: '+(documentError?.message||'не створено запис'))}
if(!aiEnabled)return{file:file.name,type:tempType,confidence:0,warnings:[],skipped:true};
let documentText='';try{if(mime==='application/pdf'||/\.pdf$/i.test(name)){documentText=await extractPdfText(file);if(!documentText||documentText.length<100){const images=await pdfToImages(file,10),parts=[];for(let i=0;i<images.length;i++){const s=document.getElementById('docUploadStatus');if(s)s.textContent='OCR сторінки '+(i+1)+' із '+images.length+': '+file.name;const pt=await runOcr(images[i]);if(pt)parts.push(pt)}documentText=parts.join('\n\n').trim()}}else if(mime==='image/jpeg'||mime==='image/png'||/\.(jpe?g|png)$/i.test(name)){documentText=await runOcr(file)}}catch(e){console.warn('OCR не вдався:',e)}
let ai=null;
try{ai=await classifyStoredDocument(document.id,path,file.name,documentText)}catch(e){await supabaseClient.from('documents').update({processing_status:'AI помилка',notes:e.message}).eq('id',document.id);throw new Error('Файл збережено. Розпізнавання не завершено: '+e.message)}
const extracted=ai?.extracted||{},aiType=ai?.document_type||tempType,matchedReq=forced||reqs.find(r=>r.document_type===aiType),matchedCandidate=findCandidateByName(ai?.candidate_name,candidates),warnings=Array.isArray(ai?.warnings)?ai.warnings.slice():[];let syncWarnings=[];try{syncWarnings=await applyAiExtraction(forcedCandidateId,extracted,aiType)}catch(e){syncWarnings=['Перенесення даних у картку не виконано: '+e.message]}warnings.push(...syncWarnings);if(matchedCandidate&&matchedCandidate.id!==forcedCandidateId)warnings.push('AI визначив кандидата: '+matchedCandidate.full_name+'. Документ завантажено до відкритої справи.');
const{error:updateError}=await supabaseClient.from('documents').update({requirement_id:matchedReq?.id||null,document_type:aiType,document_name:aiType,status:'Завантажено',verification_status:'Не перевірено',processing_status:'AI оброблено',ai_document_type:aiType,ai_confidence:Number(ai?.confidence||0),ai_candidate_name:ai?.candidate_name||null,ai_extracted:extracted,ai_warnings:warnings,notes:ai?.model?`AI OK model=${ai.model}`:'AI OK'}).eq('id',document.id);if(updateError)throw new Error('Оновлення документа: '+updateError.message);return{file:file.name,type:aiType,confidence:Number(ai?.confidence||0),candidate:ai?.candidate_name||'',warnings};
}
async function uploadSelectedDocuments(){
  const modal=document.getElementById('documentModal');if(!modal||CRMWorkspace.busy)return;
  const files=Array.from(modal.querySelector('#docFileInput').files||[]),id=modal.dataset.candidateId;
  const types=[...modal.querySelectorAll('[data-file-type]')].map(s=>s.value);
  if(!files.length||types.some(v=>!v))return;
  const user=await getCurrentUser();if(!user)return alert('Увійдіть повторно.');
  const candidates=await getCandidates(),status=modal.querySelector('#docUploadStatus');
  CRMWorkspace.busy=true;window.__PSK_DOC_AI_ENABLED=true;
  modal.querySelectorAll('button,input,select').forEach(b=>b.disabled=true);
  const results=[];
  try{
    for(let i=0;i<files.length;i++){
      status.textContent='Обробка '+(i+1)+' із '+files.length+': '+files[i].name;
      try{
        const result=await processOneDocument(files[i],types[i],user,candidates,id);
        results.push('✓ '+files[i].name+' — '+result.type+(result.skipped?' · без AI/OCR':' · розпізнано')+(result.warnings.length?'\n  '+result.warnings.join('; '):''));
      }catch(e){results.push('✕ '+files[i].name+' — '+e.message)}
    }
  }finally{
    CRMWorkspace.busy=false;
    status.textContent=results.join('\n');
    modal.querySelector('#closeDocModal').disabled=false;
    modal.querySelector('#docUploadButton').textContent='Обробку завершено';
  }
}

let scannerBatchFiles=[];function openScannerImport(id){activeDocumentsCandidateId=id;scannerBatchFiles=[];let modal=document.getElementById('scannerModal');if(!modal){modal=document.createElement('div');modal.id='scannerModal';modal.style.cssText='position:fixed;inset:0;background:rgba(10,18,24,.55);z-index:100;display:grid;place-items:center;padding:20px';document.body.appendChild(modal)}renderScannerBatchModal()}function renderScannerBatchModal(){const modal=document.getElementById('scannerModal');if(!modal)return;const count=scannerBatchFiles.length;modal.innerHTML=`<div style="width:min(720px,100%);max-height:90vh;overflow:auto;background:#fff;border-radius:14px;padding:24px;box-shadow:0 20px 70px rgba(0,0,0,.25)"><div style="display:flex;justify-content:space-between;gap:12px"><div><h3 style="margin:0">🖨 Сканування пакета</h3><div class="muted" style="font-size:11px;margin-top:6px">Відскануй документ через Canon, збережи його як PDF і додай його до поточного пакета.</div></div><button class="logout" onclick="cancelScannerBatch()">Скасувати</button></div><div style="margin-top:18px;padding:14px;border:1px solid #e1e7ea;border-radius:10px;background:#f8fafb"><b>У пакеті: ${count} документ${count===1?'':'ів'}</b><div style="margin-top:8px;font-size:11px;color:#68757d">${count?scannerBatchFiles.map((f,i)=>`${i+1}. ${docEscape(f.name)} · ${formatDocSize(f.size)}`).join('<br>'):'Ще немає відсканованих документів.'}</div></div><input id="nextScannerPdf" type="file" accept="application/pdf,.pdf" style="display:none"><div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:18px"><button class="login-button" style="width:auto" onclick="scanNextDocument()">🖨 Сканувати наступний документ</button><button style="border:1px solid #d8e0e3;background:#fff;border-radius:8px;padding:11px 15px;font-weight:800" onclick="removeLastScannerDocument()" ${count?'':'disabled'}>🗑 Видалити останній</button><button style="border:1px solid #2e3b42;background:#2e3b42;color:#fff;border-radius:8px;padding:11px 15px;font-weight:800" onclick="finishScannerBatch()" ${count?'':'disabled'}>✓ Завершити пакет</button></div><div id="scannerBatchStatus" class="muted" style="margin-top:12px;font-size:11px"></div></div>`}function scanNextDocument(){const input=document.getElementById('nextScannerPdf');if(!input)return;input.value='';input.onchange=()=>{const f=input.files?.[0];if(!f)return;if(f.type!=='application/pdf'&&!f.name.toLowerCase().endsWith('.pdf')){document.getElementById('scannerBatchStatus').textContent='Потрібен PDF-файл.';return}if(f.size>DOC_MAX_SIZE){document.getElementById('scannerBatchStatus').textContent='PDF більший за 20 МБ.';return}scannerBatchFiles.push(f);renderScannerBatchModal()};input.click()}function removeLastScannerDocument(){if(scannerBatchFiles.length)scannerBatchFiles.pop();renderScannerBatchModal()}function cancelScannerBatch(){scannerBatchFiles=[];document.getElementById('scannerModal')?.remove()}async function finishScannerBatch(){const files=[...scannerBatchFiles],id=activeDocumentsCandidateId;if(!files.length)return;cancelScannerBatch();await makeDocumentInput(id);const input=document.querySelector('#documentModal #docFileInput');if(!input)return;const transfer=new DataTransfer();files.forEach(file=>transfer.items.add(file));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));}
async function retryDocumentAI(id){
const{data:doc,error:documentError}=await supabaseClient.from('documents').select('candidate_id,document_type,requirement_id').eq('id',id).single();
if(documentError||!doc?.candidate_id){alert('Не вдалося визначити кандидата для документа.');return}
const reqs=await getDocumentRequirements(),req=reqs.find(r=>r.id===doc.requirement_id||r.document_type===doc.document_type);
if(req?.ai_enabled===false)return alert('Для цього документа розпізнавання не передбачене.');
const{data,error}=await supabaseClient.functions.invoke(AI_DOC_FUNCTION,{body:{document_id:id}});
if(error){alert('Не вдалося повторити AI: '+error.message);return}
if(!data?.ok&&!data?.extracted){alert(data?.error||'AI не повернув структуровані дані');return}
let warnings=[];
try{warnings=await applyAiExtraction(doc.candidate_id,data.extracted||{},data.document_type||doc.document_type||'')}
catch(e){warnings=['Перенесення даних у картку не виконано: '+e.message]}
alert('Повторне AI-розпізнавання завершено.'+(warnings.length?'\n'+warnings.join('\n'):''));
if(activeDocumentsCandidateId===doc.candidate_id)await showDocuments(doc.candidate_id)
}
async function openDocument(id){const{data,error}=await supabaseClient.from('documents').select('*').eq('id',id).single();if(error||!data?.storage_path){alert('Документ не знайдено.');return}const{data:signed,error:se}=await supabaseClient.storage.from(DOC_BUCKET).createSignedUrl(data.storage_path,300);if(se||!signed?.signedUrl){alert('Не вдалося відкрити документ: '+(se?.message||'невідома помилка'));return}window.open(signed.signedUrl,'_blank','noopener,noreferrer')}
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
  const [cr,pr]=await Promise.all([supabaseClient.from('candidates').select('*').eq('id',d.candidate_id).single(),supabaseClient.from('personal_files').select('*').eq('candidate_id',d.candidate_id).maybeSingle()]);
  if(cr.error)throw cr.error;if(pr.error)throw pr.error;
  const c=cr.data,pf=pr.data||{},esc=docEscape,e=d.ai_extracted||{};
  let p=c.profile_data||{};if(typeof p==='string'){try{p=JSON.parse(p)}catch(_){p={}}}
  const labels={full_name:'ПІБ',name_nominative:'ПІБ у називному відмінку',name_genitive:'ПІБ у родовому відмінку',name_gender:'Стать за ПІБ',name_cases:'Відмінки ПІБ',birth_date:'Дата народження',birth_place:'Місце народження',rnokpp:'РНОКПП',passport_data:'Дані паспорта',phone:'Телефон',email:'Email',sex:'Стать',marital_status:'Сімейний стан',has_children:'Є діти',children_info:'Відомості про дітей',relatives:'Рідні та близькі',education:'Освіта',civilian_profession:'Цивільна професія',worked_before:'Працював / працювала',work_history:'Трудовий стаж',served_before:'Служив / служила',military_rank:'Військове звання',military_unit:'Військова частина',military_specialty:'ВОС',military_service_history:'Військовий стаж',desired_position:'Бажана посада',desired_unit:'Бажаний напрям',tcc:'ТЦК та СП',address:'Адреса з документа',registered_address:'Адреса реєстрації',citizenship:'Громадянство',unzr:'УНЗР',document_type:'Тип документа',document_number:'Номер документа',document_series:'Серія документа',document_date:'Дата видачі',document_issuer:'Ким виданий',passport_number:'Номер паспорта',passport_series:'Серія паспорта',passport_issuer:'Ким виданий паспорт',passport_issue_date:'Дата видачі паспорта',passport_expiry_date:'Дійсний до',birth_certificate:'Номер свідоцтва про народження',confidence:'Впевненість AI',warnings:'Попередження',meta:'Додаткові відомості',relationship:'Спорідненість',workplace:'Місце роботи',position:'Посада',notes:'Примітки',signatory:'Підписант',recommender_unit:'Організація рекомендації',recruiter_name:'Рекрутер'};
  const display=v=>v===true?'Так':v===false?'Ні':v==null||v===''?'Не вказано':typeof v==='object'?JSON.stringify(v,null,2):String(v);
  const renderValue=v=>Array.isArray(v)?v.map(renderValue).join('<hr>'):v&&typeof v==='object'?Object.entries(v).map(([k,value])=>'<div><b>'+esc(labels[k]||k)+':</b> '+renderValue(value)+'</div>').join(''):esc(display(v));
  const type=identityDocumentTypeValue(d.ai_document_type||d.document_type),changes=[];
  // Restrict editable mapping to candidate identity documents and the established
  // recommendation/autobiography flow. Other people's certificates stay in their container.
  const ownIdentity=(type==='ID'||type==='passport'||type==='birth')&&!/дітей/i.test(d.document_type||'');
  const personalSource=ownIdentity||/рекомендац|автобіограф|ідентифікаційн/i.test(d.document_type||'');
  const add=(target,key,incoming,label)=>{
    if(incoming===null||incoming===undefined||incoming==='')return;
    const current=target==='candidate'?c[key]:target==='file'?pf[key]:p[key];
    if(JSON.stringify(current)===JSON.stringify(incoming)||String(current??'').trim()===String(incoming).trim())return;
    changes.push({target,key,incoming,current,label:label||labels[key]||key});
  };
  if(personalSource){
    for(const key of ['birth_date','birth_place','rnokpp','phone','email','sex','marital_status','has_children','worked_before','served_before','military_rank','civilian_profession','desired_position','tcc'])add('candidate',key,e[key]);
    add('candidate','full_name',e.name_nominative||e.full_name);
    add('candidate','name_nominative',e.name_nominative||e.full_name);
    add('candidate','name_genitive',e.name_genitive);
    for(const key of ['education','work_history','military_service_history','children_info'])add('file',key,e[key]);
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
  const dialog=document.createElement('dialog');dialog.className='crm-dialog';
  dialog.innerHTML='<h2>Розпізнані дані документа</h2><p>'+esc(c.name_nominative||c.full_name)+' · '+esc(d.file_name)+'</p><div class="crm-actions"><button data-original>Відкрити оригінал</button><button data-close>Закрити</button></div>'+(changes.length?'<h3>Відмінності від картки</h3><p>Позначте лише ті значення, які потрібно перенести. Без позначки дані картки залишаться.</p><div class="crm-review-grid">'+changes.map((change,i)=>'<label class="crm-review-field"><input type="checkbox" data-change="'+i+'"> <strong>'+esc(change.label)+'</strong><div class="crm-review-values"><span>У картці:<br>'+esc(display(change.current))+'</span><span>З документа:<br>'+esc(display(change.incoming))+'</span></div></label>').join('')+'</div><div class="crm-actions"><button data-apply>Взяти позначені дані з документа</button></div>':'<p>Для доступних полів перенесення немає відмінностей від картки.</p>')+'<p role="status"></p><h3>Контейнер документа</h3><div class="crm-review-grid">'+Object.entries(e).map(([key,value])=>'<section class="crm-review-field"><strong>'+esc(labels[key]||key)+'</strong><div>'+renderValue(value)+'</div></section>').join('')+'</div>'+(d.ai_warnings?.length?'<h3>Попередження</h3><p>'+renderValue(d.ai_warnings)+'</p>':'');
  document.body.append(dialog);dialog.showModal();
  const close=()=>{dialog.close();dialog.remove()};
  dialog.querySelector('[data-close]').onclick=close;
  dialog.addEventListener('cancel',ev=>{ev.preventDefault();if(!CRMWorkspace.busy)close()});
  dialog.querySelector('[data-original]').onclick=()=>openDocument(id);
  const apply=dialog.querySelector('[data-apply]');
  if(apply)apply.onclick=async()=>{
    const selected=[...dialog.querySelectorAll('[data-change]:checked')].map(el=>changes[Number(el.dataset.change)]);
    if(!selected.length)return;
    apply.disabled=true;dialog.querySelectorAll('[data-close],input').forEach(el=>el.disabled=true);CRMWorkspace.busy=true;
    try{
      // Refresh profile to preserve unrelated edits performed after the dialog opened.
      const current=await supabaseClient.from('candidates').select('profile_data').eq('id',d.candidate_id).single();if(current.error)throw current.error;
      let profile=current.data.profile_data||{};if(typeof profile==='string')profile=JSON.parse(profile);
      const cp={},fp={};
      selected.forEach(change=>{if(change.target==='candidate')cp[change.key]=change.incoming;else if(change.target==='file')fp[change.key]=change.incoming;else profile[change.key]=change.incoming});
      if(selected.some(change=>change.target==='profile'))cp.profile_data=profile;
      if(Object.keys(cp).length){const r=await supabaseClient.from('candidates').update(cp).eq('id',d.candidate_id).select('id');if(r.error)throw r.error;if(!r.data?.length)throw new Error('Картку не оновлено. Перевірте права доступу.');}
      if(Object.keys(fp).length){const r=await supabaseClient.from('personal_files').upsert({...fp,candidate_id:d.candidate_id},{onConflict:'candidate_id'});if(r.error)throw r.error;}
      dialog.querySelector('[role=status]').textContent='Позначені дані збережено в картці.';apply.textContent='Дані збережено';
      dialog.querySelectorAll('[data-change]:checked').forEach(el=>{el.checked=false;el.disabled=true});
    }catch(err){dialog.querySelector('[role=status]').textContent='Помилка збереження: '+err.message;apply.disabled=false;dialog.querySelectorAll('input').forEach(el=>el.disabled=false)}
    finally{CRMWorkspace.busy=false;dialog.querySelector('[data-close]').disabled=false;}
  };
}
