// PSK_RECRUTER CRM — document manager v2
const DOC_BUCKET='candidate-documents';
const DOC_MAX_SIZE=20*1024*1024;
const AI_DOC_FUNCTION='ai-classify-document';
let activeDocumentsCandidateId=null;

function docEscape(v){return typeof escapeHtml==='function'?escapeHtml(v):String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[c]));}
function formatDocSize(b){const n=Number(b||0);if(!n)return'—';if(n<1024*1024)return Math.round(n/1024)+' КБ';return(n/1024/1024).toFixed(1)+' МБ';}

/* OCR preview: show extracted text/data to the recruiter before anything is written to the candidate card. */
function openOcrResultPreview(extracted={}, rawText=''){
  const modal=document.createElement('div');
  modal.id='ocrResultModal';
  modal.style.cssText='position:fixed;inset:0;background:rgba(10,18,24,.62);z-index:300;display:grid;place-items:center;padding:20px';
  const fields=[
    ['full_name','ПІБ'],['birth_date','Дата народження'],['birth_place','Місце народження'],
    ['rnokpp','РНОКПП'],['passport_data','Паспорт / ID'],['phone','Телефон'],['email','Email'],
    ['address','Адреса'],['marital_status','Сімейний стан']
  ];
  const rows=fields.map(([key,label])=>`<label style="display:block;margin:0 0 10px;font-size:12px;font-weight:800;color:#44515a">${label}<input data-ocr-key="${key}" value="${docEscape(extracted[key]??'')}" style="width:100%;margin-top:5px;padding:10px;border:1px solid #cfd8dc;border-radius:8px"></label>`).join('');
  modal.innerHTML=`<div style="width:min(900px,100%);max-height:90vh;overflow:auto;background:#fff;border-radius:14px;padding:24px;box-shadow:0 20px 70px rgba(0,0,0,.25)">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px"><div><h3 style="margin:0">Результат розпізнавання</h3><div class="muted" style="margin-top:5px">Перевірте дані перед внесенням у картку кандидата.</div></div><button id="ocrClose" class="logout">Закрити</button></div>
    <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:18px">${rows}</div>
    <div style="margin-top:18px"><b style="font-size:12px">Розпізнаний текст</b><textarea id="ocrRawText" style="width:100%;min-height:180px;margin-top:6px;padding:11px;border:1px solid #cfd8dc;border-radius:8px;resize:vertical">${docEscape(rawText)}</textarea></div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px"><button id="ocrCancel" class="logout">Скасувати</button><button id="ocrSave" class="login-button" style="width:auto;margin-top:0">Відкрити як нового кандидата</button></div>
  </div>`;
  document.body.appendChild(modal);
  const close=()=>modal.remove();
  modal.querySelector('#ocrClose').onclick=close;
  modal.querySelector('#ocrCancel').onclick=close;
  modal.querySelector('#ocrSave').onclick=()=>{
    const data={...extracted};
    modal.querySelectorAll('[data-ocr-key]').forEach(i=>data[i.dataset.ocrKey]=i.value.trim());
    const text=modal.querySelector('#ocrRawText').value;
    close();
    if(typeof showNewCandidateForm==='function') showNewCandidateForm(data,text);
    else alert('Форма нового кандидата недоступна в поточному екрані.');
  };
}

/* Hook used by the OCR pipeline. It deliberately does not save extracted fields. */
function showOcrResultBeforeCandidateSave(extracted, rawText=''){
  openOcrResultPreview(extracted||{},rawText||'');
}
