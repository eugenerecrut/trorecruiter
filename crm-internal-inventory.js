// Appendix 5: internal inventory of an actual candidate file. No schema changes.
(function () {
  'use strict';
  const fixedCounts={photo:'1',service:'5',psychology:'5'};
  const fixedHint=id=>({photo:'Фото — фіксовано 1 аркуш.',service:'Послужний список — фіксовано 5 аркушів.',psychology:'Карта професійно-психологічного відбору кандидата — фіксовано 5 аркушів.'})[id];
  const sections=['ПОСЛУЖНИЙ СПИСОК, АВТОБІОГРАФІЯ ТА АТЕСТАЦІЙНИЙ МАТЕРІАЛ','ДОДАТКОВІ МАТЕРІАЛИ'];
  const slots=[
    ['photo',0,"Фото",/^фото/iu],['service',0,"Послужний список",/послужний список/iu],['biography',0,"Автобіографії",/автобіограф/iu],
    ['application',1,"Заява",/заява/iu],['identity',1,"Копія ID-картки",/паспорт|(?:ID|ІД)[\s-]*карт/iu],
    ['residence',1,"Витяг з реєстру територіальної громади (ДІЯ)",/місц.*проживання|територіальн.*громад/iu],
    ['displaced',1,"Копія Довідки про взяття на облік внутрішньо переміщеної особи",/переміщен.*особ|ВПО/iu],
    ['tax',1,"Копія картки фізичної особи - платника податків",/ідентифікаційн.*код|платника податк|РНОКПП/iu],
    ['birth',1,"Актовий запис про народження (ДІЯ)",/свідоцтво.*народження|актовий запис.*народження/iu],
    ['education',1,"Свідоцтво про здобуття базової середньої освіти (ДІЯ)",/диплом|атестат|документи про освіту|свідоцтво.*освіт/iu],
    ['military',1,"Копія Військового квитка",/військов.*квит|військов.*облік|резерв\s*\+|приписн|приписк/iu],
    ['ubd',1,"Копія Посвідчення учасника бойових дій,",/УБД|посвідчення.*учасника бойових/iu],
    ['combat',1,"Копія Довідки про безпосередню участь особи у заходах,  необхідних для забезпечення оборони України, захисту безпеки населення та інтересів держави у зв’язку з військовою агресією російської федерації проти України",/безпосередн.*участ/iu],
    ['discharge',1,"Копія Витягу з наказу про звільнення з поперднього місця служби",/наказ.*звільнення|звільнення.*служб/iu],
    ['marriage',1,"Копія Свідоцтва про шлюб",/^(?!.*розірвання)(?:.*свідоцтво.*шлюб|.*актовий запис.*шлюб)/iu],
    ['child',1,"Копія Свідоцтва про народження (дитини)",/народження.*(?:дитин|дітей)/iu],
    ['work',1,"Витяг з Реєстру застрахованих осіб Державного реєстру загальнообовя’зкового державного соціального страхування (ПФУ)",/застрахован.*особ|трудов.*діяльн|трудова книжка|ПФУ/iu],
    ['consent',1,"Згода на обробку персональних даних",/^згода.*обробку(?!.*психолог)/iu],
    ['collection',1,"Згода на збір та обробку персональних даних",/^згода.*збір/iu],
    ['receipt',1,"Розписка кандидата на контракт",/розписка.*(?:контракт|військов)/iu],
    ['psychology',1,"Карта професійно - психологічного відбору кандидата",/карт[ак].*(?:психолог|соціально)/iu],
    ['vlk',1,"Копія Довідки ВЛК",/^довідка ВЛК$/iu],
    ['form13',1,"Копія Картки обстеження та медичного огляду",/(?:додаток|форма|картка)\s*13|картка обстеження та медичного огляду/iu],
    ['blood',1,"Копія результатів аналізу крові на групу і резус",/груп.*кров|резус/iu],
    ['psychiatry',1,"Копія Довідки про проходження попереднього, періодичного та позачергового психіатричних оглядів, у тому числі на предмет вживання психоактивних речовин",/психіатр|нарколог|100[\s-]*2/iu],
    ['criminal',1,"Витяг з інформаційно-аналітичної системи «Облік відомостей про притягнення особи до кримінальної відповідальності та наявності судимості» (ДІЯ)",/несудиміст|наявність судимості/iu],
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
      if(/^(?:Копія\s*:?\s*)?(?:Припис про направлення(?:\s+до\s+ВЧ)?|Ре[єе]стр кандидата)$/iu.test(String(type).trim()))return null;
      const special=/народження.*(?:дитин|дітей)/iu.test(type)?'child':/^згода.*збір/iu.test(type)?'collection':null;
      const slot=special?slots.find(s=>s[0]===special):slots.find(s=>s[3].test(type));if(slot)return byId.get(slot[0]);
      let r=records.find(r=>r.id==='extra:'+type);
      if(!r){const title=/свідоцтво.*змін.*(?:імен|прізвищ)/iu.test(type)?'Копія свідоцтва про зміну імені / прізвища':type;
        r={id:'extra:'+type,section:1,title,files:[],paper:[],included:false,count:'',notes:''};records.push(r);}return r;
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
    const military=byId.get('military');if(military.files.length&&!military.files.some(d=>/військов.*квит/iu.test(d.document_type))){
      military.title=military.files.every(d=>/приписн|приписк/iu.test(d.document_type))?'Копія посвідчення про приписку до призовної дільниці':'Копія військово-облікового документа';
    }
    return records.filter(r=>r.id!=='recommendation').concat(records.filter(r=>r.id==='recommendation'));
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
    function wrapped(value,width){
      const lines=[];
      for(const part of String(value??'').split('\n')){let line='';
        for(const word of part.split(/\s+/).filter(Boolean)){
          if(font.widthOfTextAtSize(word,size)>width)throw Error('Задовге слово у полі: '+word);
          const candidate=line?line+' '+word:word;
          if(line&&font.widthOfTextAtSize(candidate,size)>width){lines.push(line);line=word;}else line=candidate;
        }lines.push(line);
      }return lines;
    }
    function text(page,box,value,center=false) {
      value=String(value??'');if(!value)return;
      const width=box[2]-box[0]-2*padding,lines=[];
      for(const part of value.split('\n')){let line='';for(const word of part.split(/\s+/).filter(Boolean)){
        if(font.widthOfTextAtSize(word,size)>width)throw Error('Задовге слово у полі: '+word);
        const candidate=line?line+' '+word:word;if(line&&font.widthOfTextAtSize(candidate,size)>width){lines.push(line);line=word;}else line=candidate;
      }lines.push(line);}
      if(size+(lines.length-1)*lineHeight+2>box[3]-box[1])throw Error('Текст не вміщується у рядок оригінального бланка: '+value);
      const textHeight=font.heightAtSize(size),blockHeight=textHeight+(lines.length-1)*lineHeight;
      const firstY=center?page.getHeight()-(box[1]+box[3])/2+blockHeight/2-textHeight:page.getHeight()-box[1]-size;
      lines.forEach((line,i)=>page.drawText(line,{x:center?(box[0]+box[2]-font.widthOfTextAtSize(line,size))/2:box[0]+padding,y:firstY-i*lineHeight,font,size}));
    }
    for(const slot of layout.slots.filter(s=>s.section===0)){
      const page=pdf.getPage(slot.page),record=byId.get(slot.id);
      if(!record?.included)continue;
      if(record.title!==slot.title)text(page,slot.cells[1],record.title);
      else page.pushOperators(PDFLib.pushGraphicsState(),PDFLib.drawObject(slot.xobject),PDFLib.popGraphicsState());
      text(page,slot.cells[2],fixedCounts[slot.id]??(record?.included?record.count:''),true);
      if(record?.included)text(page,slot.cells[3],record.notes);
    }
    // Keep the source cover, margins, header and column widths; flow full titles in taller rows.
    const originalSection=layout.slots.filter(s=>s.section===1),first=originalSection[0];
    const source=await PDFLib.PDFDocument.load(bytes),columns=[first.cells[0][0],...first.cells.map(c=>c[2])];
    const ordered=[...originalSection.filter(s=>s.id!=='recommendation'&&s.id!=='bank').map(s=>({record:byId.get(s.id),minimum:s.cells[0][3]-s.cells[0][1]})),
      {record:byId.get('bank'),minimum:32.76},...extra.map(record=>({record,minimum:32.76})),{record:byId.get('recommendation'),minimum:32.76}];
    const rows=ordered.filter(({record})=>record?.included).map(({record,minimum})=>{
      const values=[record.title,fixedCounts[record.id]??(record.included?record.count:''),record.included?record.notes:''];
      const lines=Math.max(...values.map((v,i)=>wrapped(v,columns[i+2]-columns[i+1]-2*padding).length));
      return {record,height:Math.max(minimum,size+(lines-1)*lineHeight+8)};
    });
    for(let i=extra.length;i<layout.extra_slots.length;i++)rows.push({height:32.76});
    let pageIndex=first.page,y=first.cells[0][1],number=1;
    const bottom=795,continuationTop=42.84;
    function clearPage(index){
      const page=pdf.getPage(index);page.node.set(PDFLib.PDFName.of('Contents'),pdf.context.obj([]));return page;
    }
    let page=clearPage(pageIndex);
    const header=await pdf.embedPage(source.getPage(pageIndex),{left:0,bottom:page.getHeight()-y,right:page.getWidth(),top:page.getHeight()});
    page.drawPage(header,{x:0,y:page.getHeight()-y});
    const used=new Set([pageIndex]);
    for(const row of rows){
      if(y+row.height>bottom+0.1){
        pageIndex++;if(pageIndex>=pdf.getPageCount())throw Error('Для повних назв бракує сторінок бланка.');
        page=clearPage(pageIndex);used.add(pageIndex);y=continuationTop;
      }
      const top=y,end=y+row.height;
      for(const x of columns)page.drawLine({start:{x,y:page.getHeight()-top},end:{x,y:page.getHeight()-end},thickness:0.5});
      for(const edge of [top,end])page.drawLine({start:{x:columns[0],y:page.getHeight()-edge},end:{x:columns[4],y:page.getHeight()-edge},thickness:0.5});
      if(row.record){
        const r=row.record;
        text(page,[columns[0],top,columns[1],end],String(number++),true);
        text(page,[columns[1],top,columns[2],end],r.title);
        text(page,[columns[2],top,columns[3],end],fixedCounts[r.id]??(r.included?r.count:''),true);
        if(r.included)text(page,[columns[3],top,columns[4],end],r.notes);
      }
      y=end;
    }
    for(let index=first.page;index<pdf.getPageCount();index++)if(!used.has(index))clearPage(index);
    return new Blob([await pdf.save()],{type:'application/pdf'});
  }
  async function open(c,requirements,{save}) {
    const documents=await getCandidateDocuments(c.id),records=model(c,documents),manifest=latest(documents).map(d=>[d.id,d.version_number,d.verification_status]).sort();
    await loadExternalScript('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js','PDFLib');
    const dialog=document.createElement('dialog');dialog.className='crm-dialog crm-inventory-dialog';
    dialog.innerHTML='<h2>Внутрішній опис особової справи</h2><p>'+esc(c.name_nominative||c.full_name)+'</p><p class="muted">Бланк з оригіналу: 7 сторінок, початкові поля та порожні рядки. Фото — фіксовано 1 аркуш, послужний список і карта професійно-психологічного відбору — по 5 аркушів. До PDF включаються лише позначені документи. Непозначені рядки зразка не друкуються. Перевірте кількість паперових аркушів перед формуванням. PDF-сторінки — початкова підказка; для двобічного друку або паперових документів уточніть кількість.</p><p data-inventory-status role="status">Рахуємо сторінки PDF…</p><label class="crm-inventory-extra"><input type="checkbox" data-inventory-all> Показати інші рядки зразка</label><div class="crm-inventory-rows"></div><div class="crm-actions"><button type="button" data-inventory-add>＋ Додати рядок</button><button type="button" data-inventory-create disabled>Завантажити PDF</button><button type="button" data-inventory-close>Закрити</button></div>';
    document.body.append(dialog);dialog.showModal();let busy=true,showAll=false;
    const status=dialog.querySelector('[data-inventory-status]'),body=dialog.querySelector('.crm-inventory-rows'),generate=dialog.querySelector('[data-inventory-create]');
    const close=()=>{if(busy)return;dialog.close();dialog.remove();};dialog.querySelector('[data-inventory-close]').onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
    function render() {
      body.innerHTML=sections.map((title,section)=>'<h3>'+title+'</h3>'+records.map((r,i)=>r.section===section&&(showAll||r.included||r.files.length||r.paper.length)?'<div class="crm-inventory-row"><label><input type="checkbox" data-inventory-include="'+i+'" '+(r.included?'checked':'')+(fixedCounts[r.id]?' disabled data-inventory-fixed':'')+' aria-label="Включити: '+esc(r.title)+'"></label><input data-inventory-title="'+i+'" value="'+esc(r.title)+'" aria-label="Найменування: '+esc(r.title)+'"><input type="number" min="1" max="10000" data-inventory-count="'+i+'" '+(fixedCounts[r.id]?'readonly title="'+fixedHint(r.id)+'" ':'')+'value="'+r.count+'" placeholder="Аркуші" aria-label="Кількість аркушів: '+esc(r.title)+'"><input data-inventory-note="'+i+'" value="'+esc(r.notes)+'" placeholder="Примітка" aria-label="Примітка: '+esc(r.title)+'"><details><summary>Джерела ('+(r.files.length+r.paper.length)+')</summary>'+r.files.map((d,j)=>'<p>'+esc(d.file_name)+' · '+esc(d.verification_status)+' <button type="button" data-inventory-open="'+i+':'+j+'" aria-label="Відкрити документ: '+esc(d.file_name||d.document_type)+'">Відкрити ↗</button></p>').join('')+r.paper.map(e=>'<p>'+esc(e.document_type)+' · є без файла</p>').join('')+(r.countHint?'<p>'+esc(r.countHint)+'</p>':'')+'</details>'+(r.id==='biography'?'<small class="muted" style="grid-column:1/-1">'+esc(r.countHint||'Сумарна кількість сторінок рукописної та друкованої автобіографій.')+'</small>':'')+'</div>':'').join('')).join('');
    }
    dialog.querySelector('[data-inventory-all]').onchange=e=>{showAll=e.target.checked;render();};
    body.onclick=async e=>{
      const button=e.target.closest('[data-inventory-open]');if(!button||busy||button.disabled)return;
      const [i,j]=button.dataset.inventoryOpen.split(':').map(Number),source=records[i]?.files[j];if(!source?.id)return;
      // Reserve the tab during the click so mobile browsers do not block it after awaiting Storage.
      const preview=window.open('about:blank','_blank');
      if(!preview){status.textContent='Дозвольте відкриття нової вкладки для перегляду документа.';status.scrollIntoView({block:'nearest'});return;}
      preview.opener=null;button.disabled=true;
      try{
        const {data:doc,error}=await supabaseClient.from('documents').select('storage_path,deleted_at').eq('id',source.id).eq('candidate_id',c.id).single();
        if(error)throw error;if(doc?.deleted_at||!doc?.storage_path)throw Error('Документ не знайдено або видалено.');
        const {data:signed,error:signError}=await supabaseClient.storage.from(DOC_BUCKET).createSignedUrl(doc.storage_path,300);
        if(signError)throw signError;if(!signed?.signedUrl)throw Error('Не вдалося отримати посилання.');
        if(!preview.closed)preview.location.replace(signed.signedUrl);
      }catch(error){if(!preview.closed)preview.close();status.textContent='Не вдалося відкрити документ: '+(error?.message||'невідома помилка');status.scrollIntoView({block:'nearest'});}
      finally{button.disabled=busy;}
    };
    body.oninput=e=>{const t=e.target;for(const [key,field]of [['inventoryTitle','title'],['inventoryCount','count'],['inventoryNote','notes']])if(t.dataset[key]!==undefined){const r=records[Number(t.dataset[key])];if(!fixedCounts[r.id]||field!=='count')r[field]=t.value;}};
    body.onchange=e=>{if(e.target.dataset.inventoryInclude!==undefined){const r=records[Number(e.target.dataset.inventoryInclude)];if(!fixedCounts[r.id])r.included=e.target.checked;}};
    render();
    dialog.querySelectorAll('input,button').forEach(el=>el.disabled=true);
    try {
      // Limit concurrent downloads, and never send stored PDF contents to a third party.
      for(const r of records){if(fixedCounts[r.id]){r.count=fixedCounts[r.id];r.countHint=fixedHint(r.id);continue;}let count=0,unknown=!!r.paper.length;
        for(const d of r.files){try{const response=await supabaseClient.storage.from(DOC_BUCKET).download(d.storage_path);if(response.error)throw response.error;const data=new Uint8Array(await response.data.arrayBuffer());if(/pdf/i.test(d.mime_type||'')||/\.pdf$/i.test(d.file_name||'')||new TextDecoder('ascii').decode(data.subarray(0,1024)).includes('%PDF-')){const doc=await PDFLib.PDFDocument.load(data);count+=doc.getPageCount();}else if(/^image\//.test(d.mime_type||''))count++;else unknown=true;}catch{unknown=true;}}
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
    dialog.querySelector('[data-inventory-add]').onclick=()=>{records.splice(records.findIndex(r=>r.id==='recommendation'),0,{id:'manual:'+records.length,section:1,title:'Новий документ',files:[],paper:[],included:true,count:'',notes:''});render();};
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
