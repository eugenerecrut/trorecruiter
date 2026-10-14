// Appendix 5: internal inventory of an actual candidate file. No schema changes.
(function () {
  'use strict';
  const fixedCounts={photo:'1',service:'5'};
  const fixedHint=id=>id==='photo'?'Фото — фіксовано 1 аркуш.':'Послужний список — фіксовано 5 аркушів.';
  const sections=['ПОСЛУЖНИЙ СПИСОК, АВТОБІОГРАФІЯ ТА АТЕСТАЦІЙНИЙ МАТЕРІАЛ','ДОДАТКОВІ МАТЕРІАЛИ'];
  const slots=[
    ['photo',0,"Фото",/^фото/iu],['service',0,"Послужний список",/послужний список/iu],['biography',0,"Автобіографії",/автобіограф/iu],
    ['application',1,"Заява",/заява/iu],['identity',1,"Копія ID-картки",/паспорт|(?:ID|ІД)[\s-]*карт/iu],
    ['residence',1,"Витяг з реєстру територіальної громади (ДІЯ)",/місц.*проживання|територіальн.*громад/iu],
    ['displaced',1,"Копія Довідки про взяття на облік внутрішньо переміщеної особи",/переміщен.*особ|ВПО/iu],
    ['tax',1,"Копія картки фізичної особи - платника податків",/ідентифікаційн.*код|платника податк|РНОКПП/iu],
    ['birth',1,"Актовий запис про народження (ДІЯ)",/свідоцтво.*народження|актовий запис.*народження/iu],
    ['education',1,"Свідоцтво про здобуття базової середньої освіти (ДІЯ)",/диплом|атестат|документи про освіту|свідоцтво.*освіт/iu],
    ['military',1,"Копія Військового квитка",/військов.*квит|військов.*облік|резерв\s*\+|приписн/iu],
    ['ubd',1,"Копія Посвідчення учасника бойових дій,",/УБД|посвідчення.*учасника бойових/iu],
    ['combat',1,"Копія Довідки про безпосередню участь особи у заходах,  необхідних для забезпечення оборони України, захисту безпеки населення та інтересів держави у зв’язку з військовою агресією російської федерації проти України",/безпосередн.*участ/iu],
    ['discharge',1,"Копія Витягу з наказу про звільнення з поперднього місця служби",/наказ.*звільнення|звільнення.*служб/iu],
    ['marriage',1,"Копія Свідоцтва про шлюб",/^(?!.*розірвання)(?:.*свідоцтво.*шлюб|.*актовий запис.*шлюб)/iu],
    ['child',1,"Копія Свідоцтва про народження (дитини)",/народження.*(?:дитин|дітей)/iu],
    ['work',1,"Витяг Індивідуальні відомості про застраховану особу",/застрахован.*особ|трудов.*діяльн|трудова книжка|ПФУ/iu],
    ['consent',1,"Згода на обробку персональних даних",/^згода.*обробку(?!.*психолог)/iu],
    ['collection',1,"Згода на збір та обробку персональних даних",/^згода.*збір/iu],
    ['receipt',1,"Розписка кандидата на контракт",/розписка.*(?:контракт|військов)/iu],
    ['psychology',1,"Карта професійно - психологічного відбору кандидата",/карт[ак].*(?:психолог|соціально)/iu],
    ['vlk',1,"Копія Довідки ВЛК",/^довідка ВЛК$/iu],
    ['form13',1,"Копія Картки обстеження та медичного огляду",/(?:додаток|форма|картка)\s*13|картка обстеження та медичного огляду/iu],
    ['blood',1,"Копія результатів аналізу крові на групу і резус",/груп.*кров|резус/iu],
    ['psychiatry',1,"Копія довідки форма № 100-2/о",/психіатр|нарколог|100[\s-]*2/iu],
    ['criminal',1,"Витяг щодо відомостей про наявність судимості (ДІЯ)",/несудиміст|наявність судимості/iu],
    ['truth',1,"Розписка кандидата щодо достовірності наданої інформації",/розписка.*достовір/iu],
    ['recommendation',1,"Копія рекомендаційного листа ",/рекомендац/iu],
    ['bank',1,"Довідка банку з IBAN отримувача",/IBAN|довідка.*банк/iu]
  ];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const latest=docs=>CRMResponsibility.latest(docs||[]);
  function model(c,documents) {
    const records=slots.map(([id,section,title])=>({id,section,title,files:[],paper:[],included:false,count:'',notes:''}));
    const byId=new Map(records.map(r=>[r.id,r]));
    function row(type) {
      if(/^(?:Перелік документів|Титульний аркуш)$/iu.test(type))return null;
      const special=/народження.*(?:дитин|дітей)/iu.test(type)?'child':/^згода.*збір/iu.test(type)?'collection':null;
      const slot=special?slots.find(s=>s[0]===special):slots.find(s=>s[3].test(type));if(slot)return byId.get(slot[0]);
      let r=records.find(r=>r.id==='extra:'+type);
      if(!r){r={id:'extra:'+type,section:1,title:type,files:[],paper:[],included:false,count:'',notes:''};records.push(r);}return r;
    }
    for(const d of latest(documents)) {
      if(!d.storage_path||CRMCandidateConditions.documentCondition(d.document_type,c)===false)continue;
      const r=row(d.document_type||d.document_name||'Документ');if(r)r.files.push(d);
    }
    for(const entry of window.CRMDocumentPresence?.withoutCopies(c,latest(documents))||[]){const r=row(entry.document_type);if(r)r.paper.push(entry);}
    for(const r of records){r.included=r.paper.length>0||r.files.some(d=>d.verification_status==='Підтверджено');r.verified=r.files.every(d=>d.verification_status==='Підтверджено');}
    for(const [id,count] of Object.entries(fixedCounts)){const row=byId.get(id);row.included=true;row.count=count;}
    // Identity label describes the actual document rather than always claiming an ID card.
    const identity=byId.get('identity');if(identity.files.some(d=>/книжечк/iu.test(d.document_type)))identity.title='Копія паспорта громадянина України';
    const education=byId.get('education');if(education.files.length)education.title='Копія документів про освіту з додатками';
    const birth=byId.get('birth');if(birth.files.some(d=>/свідоцтво/iu.test(d.document_type)))birth.title='Копія свідоцтва про народження';
    const military=byId.get('military');if(military.files.length&&!military.files.some(d=>/військов.*квит/iu.test(d.document_type)))military.title='Копія військово-облікового документа';
    return records;
  }
  function validate(records) {
    for(const r of records.filter(r=>r.included)){
      if(!r.title.trim())throw Error('Заповніть найменування документа.');
      if(!fixedCounts[r.id]&&(!/^\d+$/.test(String(r.count))||Number(r.count)<1||Number(r.count)>10000))throw Error('Уточніть кількість аркушів: '+r.title);
    }
    if(!records.some(r=>r.included))throw Error('Оберіть документи для внутрішнього опису.');
  }
  const moduleUrl=typeof document!=='undefined'&&document.currentScript?.src||'http://localhost/';
  const fontUrl=new URL('templates/fonts/Tinos-Regular.ttf',moduleUrl).href;
  const templateUrl=new URL('templates/internal-inventory/',moduleUrl).href;
  async function create(name,records) {
    validate(records);
    await Promise.all([loadExternalScript('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js','PDFLib'),loadExternalScript('https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js','fontkit')]);
    const responses=await Promise.all([fetch(templateUrl+'blank.pdf?v=1.1.0.456'),fetch(templateUrl+'layout.json?v=1.1.0.456'),fetch(fontUrl)]);
    if(responses.some(r=>!r.ok))throw Error('Не вдалося завантажити оригінальний бланк або шрифт PDF.');
    const [bytes,layout,fontBytes]=await Promise.all([responses[0].arrayBuffer(),responses[1].json(),responses[2].arrayBuffer()]);
    const pdf=await PDFLib.PDFDocument.load(bytes);pdf.registerFontkit(window.fontkit);
    const font=await pdf.embedFont(fontBytes,{subset:true});const size=14,lineHeight=16.2,padding=5.4;
    pdf.setTitle('Внутрішній опис — '+name);pdf.setAuthor('');pdf.setCreator('PSK_RECRUTER CRM');
    if(pdf.getPageCount()!==layout.page_count)throw Error('Бланк і карта полів не узгоджені.');
    const byId=new Map(records.map(r=>[r.id,r])),ids=new Set(layout.slots.map(r=>r.id));
    const extra=records.filter(r=>r.included&&!ids.has(r.id));
    if(extra.length>layout.extra_slots.length)throw Error('У бланку є лише '+layout.extra_slots.length+' додаткові рядки.');
    function text(page,box,value,center=false) {
      value=String(value??'');if(!value)return;
      const width=box[2]-box[0]-2*padding,lines=[];
      for(const part of value.split('\n')){let line='';for(const word of part.split(/\s+/).filter(Boolean)){
        if(font.widthOfTextAtSize(word,size)>width)throw Error('Задовге слово у полі: '+word);
        const candidate=line?line+' '+word:word;if(line&&font.widthOfTextAtSize(candidate,size)>width){lines.push(line);line=word;}else line=candidate;
      }lines.push(line);}
      if(size+(lines.length-1)*lineHeight+2>box[3]-box[1])throw Error('Текст не вміщується у рядок оригінального бланка: '+value);
      lines.forEach((line,i)=>page.drawText(line,{x:center?(box[0]+box[2]-font.widthOfTextAtSize(line,size))/2:box[0]+padding,y:page.getHeight()-box[1]-size-i*lineHeight,font,size}));
    }
    for(const slot of layout.slots){
      const page=pdf.getPage(slot.page),record=byId.get(slot.id);
      if(record?.included&&record.title!==slot.title)text(page,slot.cells[1],record.title);
      else page.pushOperators(PDFLib.pushGraphicsState(),PDFLib.drawObject(slot.xobject),PDFLib.popGraphicsState());
      text(page,slot.cells[2],fixedCounts[slot.id]??(record?.included?record.count:'0'),true);
      if(record?.included)text(page,slot.cells[3],record.notes);
    }
    extra.forEach((record,i)=>{const slot=layout.extra_slots[i],page=pdf.getPage(slot.page);text(page,slot.cells[0],String(27+i),true);text(page,slot.cells[1],record.title);text(page,slot.cells[2],record.count,true);text(page,slot.cells[3],record.notes);});
    return new Blob([await pdf.save()],{type:'application/pdf'});
  }
  async function open(c,requirements,{save}) {
    const documents=await getCandidateDocuments(c.id),records=model(c,documents),manifest=latest(documents).map(d=>[d.id,d.version_number,d.verification_status]).sort();
    await loadExternalScript('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js','PDFLib');
    const dialog=document.createElement('dialog');dialog.className='crm-dialog crm-inventory-dialog';
    dialog.innerHTML='<h2>Внутрішній опис особової справи</h2><p>'+esc(c.name_nominative||c.full_name)+'</p><p class="muted">Бланк з оригіналу: 7 сторінок, початкові поля та порожні рядки. Фото — фіксовано 1 аркуш, послужний список — 5 аркушів. Для інших незібраних документів кількість — 0. Перевірте кількість паперових аркушів перед формуванням. PDF-сторінки — початкова підказка; для двобічного друку або паперових документів уточніть кількість.</p><p data-inventory-status role="status">Рахуємо сторінки PDF…</p><label class="crm-inventory-extra"><input type="checkbox" data-inventory-all> Показати інші рядки зразка</label><div class="crm-inventory-rows"></div><div class="crm-actions"><button type="button" data-inventory-add>＋ Додати рядок</button><button type="button" data-inventory-create disabled>Завантажити PDF</button><button type="button" data-inventory-close>Закрити</button></div>';
    document.body.append(dialog);dialog.showModal();let busy=true,showAll=false;
    const status=dialog.querySelector('[data-inventory-status]'),body=dialog.querySelector('.crm-inventory-rows'),generate=dialog.querySelector('[data-inventory-create]');
    const close=()=>{if(busy)return;dialog.close();dialog.remove();};dialog.querySelector('[data-inventory-close]').onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
    function render() {
      body.innerHTML=sections.map((title,section)=>'<h3>'+title+'</h3>'+records.map((r,i)=>r.section===section&&(showAll||r.included||r.files.length||r.paper.length)?'<div class="crm-inventory-row"><label><input type="checkbox" data-inventory-include="'+i+'" '+(r.included?'checked':'')+(fixedCounts[r.id]?' disabled data-inventory-fixed':'')+' aria-label="Включити: '+esc(r.title)+'"></label><input data-inventory-title="'+i+'" value="'+esc(r.title)+'" aria-label="Найменування: '+esc(r.title)+'"><input type="number" min="1" max="10000" data-inventory-count="'+i+'" '+(fixedCounts[r.id]?'readonly title="'+fixedHint(r.id)+'" ':'')+'value="'+r.count+'" placeholder="Аркуші" aria-label="Кількість аркушів: '+esc(r.title)+'"><input data-inventory-note="'+i+'" value="'+esc(r.notes)+'" placeholder="Примітка" aria-label="Примітка: '+esc(r.title)+'"><details><summary>Джерела ('+(r.files.length+r.paper.length)+')</summary>'+r.files.map(d=>'<p>'+esc(d.file_name)+' · '+esc(d.verification_status)+'</p>').join('')+r.paper.map(e=>'<p>'+esc(e.document_type)+' · є без файла</p>').join('')+(r.countHint?'<p>'+esc(r.countHint)+'</p>':'')+'</details>'+(r.id==='biography'?'<small class="muted" style="grid-column:1/-1">'+esc(r.countHint||'Сумарна кількість сторінок рукописної та друкованої автобіографій.')+'</small>':'')+'</div>':'').join('')).join('');
    }
    dialog.querySelector('[data-inventory-all]').onchange=e=>{showAll=e.target.checked;render();};
    body.oninput=e=>{const t=e.target;for(const [key,field]of [['inventoryTitle','title'],['inventoryCount','count'],['inventoryNote','notes']])if(t.dataset[key]!==undefined){const r=records[Number(t.dataset[key])];if(!fixedCounts[r.id]||field!=='count')r[field]=t.value;}};
    body.onchange=e=>{if(e.target.dataset.inventoryInclude!==undefined){const r=records[Number(e.target.dataset.inventoryInclude)];if(!fixedCounts[r.id])r.included=e.target.checked;}};
    render();
    dialog.querySelectorAll('input,button').forEach(el=>el.disabled=true);
    try {
      // Limit concurrent downloads, and never send stored PDF contents to a third party.
      for(const r of records){if(fixedCounts[r.id]){r.count=fixedCounts[r.id];r.countHint=fixedHint(r.id);continue;}let count=0,unknown=!!r.paper.length;
        for(const d of r.files){try{const response=await supabaseClient.storage.from(DOC_BUCKET).download(d.storage_path);if(response.error)throw response.error;const data=new Uint8Array(await response.data.arrayBuffer());if(data[0]===37){const doc=await PDFLib.PDFDocument.load(data);count+=doc.getPageCount();}else if(/^image\//.test(d.mime_type||''))count++;else unknown=true;}catch{unknown=true;}}
        r.count=unknown?'':r.files.length?String(count):'';r.countHint=(count?'PDF-сторінок: '+count+'. ':'')+(unknown?'Кількість паперових аркушів потрібно уточнити.':'');
        if(r.id==='biography'){
          r.countHint='Рукописна + друкована: '+count+' стор. у завантажених файлах. ';
          if(r.paper.length)r.countHint+='Є без файла — введіть загальну кількість аркушів вручну, включно із завантаженими.';
          else if(unknown)r.countHint+='Не всі файли вдалося порахувати — введіть загальну кількість вручну.';
          else r.countHint+='Суму підставлено автоматично; за потреби скоригуйте вручну.';
        }
      }
      render();status.textContent='Готово. Перевірте кількість аркушів і позначте потрібні рядки.';
    }finally{busy=false;dialog.querySelectorAll('input,button').forEach(el=>el.disabled=el.hasAttribute('data-inventory-fixed'));}
    dialog.querySelector('[data-inventory-add]').onclick=()=>{records.push({id:'manual:'+records.length,section:1,title:'Новий документ',files:[],paper:[],included:true,count:'',notes:''});render();};
    generate.onclick=async()=>{
      if(busy||CRMWorkspace.busy)return;try{validate(records);}catch(error){status.textContent=error.message;status.scrollIntoView({block:'nearest'});return;}
      busy=true;CRMWorkspace.busy=true;dialog.querySelectorAll('button,input').forEach(el=>el.disabled=true);
      try{
        const current=latest(await getCandidateDocuments(c.id)).map(d=>[d.id,d.version_number,d.verification_status]).sort();
        if(JSON.stringify(current)!==JSON.stringify(manifest))throw Error('Список документів змінився. Закрийте й відкрийте опис повторно.');
        status.textContent='Формуємо та зберігаємо PDF…';await save(await create(c.name_nominative||c.full_name,records));status.textContent='PDF збережено у справі та завантажено.';
      }catch(error){status.textContent='Не сформовано: '+error.message;status.scrollIntoView({block:'nearest'});}
      finally{busy=false;CRMWorkspace.busy=false;dialog.querySelectorAll('button,input').forEach(el=>el.disabled=el.hasAttribute('data-inventory-fixed'));}
    };
    return dialog;
  }
  window.CRMInventory={model,validate,create,open,sections};
})();
