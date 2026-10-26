// Fixed ten-page service record. Print edits never overwrite source candidate facts.
(function(){
'use strict';
const script=typeof document!=='undefined'&&document.currentScript?.src||'http://localhost/';
const asset=path=>new URL(path,script).href;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const obj=v=>{if(typeof v==='string'){try{return JSON.parse(v)||{}}catch{return {}}}return v||{}};
const date=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')?v.slice(8)+'.'+v.slice(5,7)+'.'+v.slice(0,4):/^\d{4}-\d{2}$/.test(v||'')?v.slice(5,7)+'.'+v.slice(0,4):String(v||'');
const stacked=v=>date(v).replace(/\.(\d{4})$/u,'.\n$1');
const bool=v=>v===true||v==='true'?true:v===false||v==='false'?false:null;
const months=['січня','лютого','березня','квітня','травня','червня','липня','серпня','вересня','жовтня','листопада','грудня'];
const words=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')?v.slice(8)+' '+months[Number(v.slice(5,7))-1]+' '+v.slice(0,4)+' року':'';
const sign='Начальник регіональної мобільної групи “Схід” секції територіального рекрутингу 4 центру рекрутингу Сил територіальної оборони ЗС України\nкапітан                                      Володимир СОВІН';
function model(c,pf={}){
 const raw=obj(c.profile_data),p=window.CRMBiographyFacts?window.CRMBiographyFacts.profile(raw):raw,fields=[];
 const add=(key,label,page,box,value,group='Основне',center=false)=>{fields.push({key,label,page,box,value:String(value??''),group,center});};
 const name=String(c.name_nominative||c.full_name||'').trim().split(/\s+/);
 add('personal_number','Особистий номер',0,[85,123,567,139],c.rnokpp,'Основне',true);
 add('surname','Прізвище',0,[85,141,567,157],name.shift()?.toLocaleUpperCase('uk-UA'),'Основне',true);
 add('given_names','Ім’я та по батькові',0,[85,172,567,188],name.join(' '),'Основне',true);
 add('rank','Чинне військове звання',0,[85.4,262,156.2,309.7],String(c.military_rank||'').toLocaleLowerCase('uk-UA').replace(/^./u,ch=>ch.toLocaleUpperCase('uk-UA')));
 const printable=rows=>(Array.isArray(rows)?rows:[]).filter(r=>r&&!r.requires_review&&!r.crossed_out);
 const printableObject=value=>{const record=obj(value);return record&&typeof record==='object'&&!Array.isArray(record)&&!record.requires_review&&!record.crossed_out?record:{};};
 const normalize=v=>String(v||'').trim().replace(/\s+/g,' ').toLocaleLowerCase('uk-UA');
 const rankMatches=printable(p.military_rank_records).filter(r=>(r.confirmed_by_user===true||r.accepted_by_ai===true)&&!r.requires_review&&normalize(r.rank)===normalize(c.military_rank)&&normalize(c.military_rank));
 const rankOrders=[...new Map(rankMatches.map(r=>[JSON.stringify([r.order_issuer||'',r.order_number||'',r.order_date||'']),r])).values()];
 const rank=rankOrders.length===1?rankOrders[0]:null;
 add('rank_order','Наказ про присвоєння звання',0,[156.3,262,326.5,309.7],rank?[rank.order_issuer,rank.order_number&&'№'+rank.order_number,date(rank.order_date)].filter(Boolean).join(' '):'');
 const y=[29,70,125.2,230.8,326.7,372.5,435.3,806];
 const personal=[['birth_date','Дата народження',words(c.birth_date)],['birth_place','Місце народження',c.birth_place||pf.birth_place],['education_civil','Цивільна освіта',(Array.isArray(p.education_records)?p.education_records:[]).filter(r=>r&&!r.requires_review&&!r.crossed_out).slice().sort((a,b)=>Number(a.graduation_year||0)-Number(b.graduation_year||0)).map(e=>[e.institution,e.degree==='середня'?null:e.specialty,e.degree==='середня'?null:e.qualification,e.graduation_year&&e.graduation_year+' р.'].filter(Boolean).join(', ')).join('\n')||[p.education_institution,p.education_specialty,p.education_qualification,p.education_year].filter(Boolean).join(', ')],['education_military','Військова освіта',p.military_education||''],['languages','Іноземні мови',p.foreign_languages||p.languages||''],['scientific_degree','Науковий ступінь і вчене звання',p.scientific_degree||''],['scientific_works','Наукові праці й винаходи',p.scientific_works||'']];
 personal.forEach(([k,l,v],i)=>add(k,l,1,[238,y[i],510,y[i+1]],v,'Освіта та особисті відомості'));
 const worked=bool(c.worked_before??p.worked_before),served=bool(c.served_before??p.served_before);
 const periods=(Array.isArray(p.work_records)?p.work_records:[]).filter(r=>r&&!r.requires_review&&!r.crossed_out);
 const employment=periods.filter(r=>r.kind==='employment');
 if(worked===false)add('not_worked','Відомості про роботу',2,[85.4,126.2,571.1,152.5],c.sex==='female'?'Не працювала':'Не працював','Трудова діяльність',true);
 else employment.forEach((r,i)=>{
  const cols=[85.4,156.9,228.4,493.1,571.1],top=126.2+i*(573.8/Math.max(employment.length,1)),bottom=126.2+(i+1)*(573.8/Math.max(employment.length,1));
  [stacked(r.start_date),stacked(r.end_date),[r.employer,r.locality||r.location].filter(Boolean).join(', '),r.position].forEach((v,j)=>add('work_'+i+'_'+j,['Початок','Завершення','Підприємство та місцевість','Посада'][j]+' · '+(i+1),2,[cols[j],top,cols[j+1],bottom],v,'Трудова діяльність'));
 });
 const oath=printableObject(p.military_oath),discharge=printableObject(p.military_discharge);
 add('callup','Призов / початок служби',3,[222.6,39,510.3,70.7],served===false?'':p.service_start_date?words(p.service_start_date)+(p.previous_service_type?' '+p.previous_service_type:''):'','Військова служба');
 add('oath','Присяга',3,[312,75,510.3,105.9],served===false?'':[date(oath.date),oath.unit&&'в/ч '+oath.unit].filter(Boolean).join(', '),'Військова служба');
 const service=periods.filter(r=>['military_service','police_service'].includes(r.kind));
 if(served===false)add('not_served','Відомості про службу',3,[28.6,262.3,510.1,289.3],c.sex==='female'?'Військову службу не проходила':'Військову службу не проходив','Військова служба',true);
 else service.forEach((r,i)=>{
  // First page plus the original three continuation pages; never add pages.
  const page=i<5?3:4+Math.floor((i-5)/8),row=i<5?i:(i-5)%8;
  if(page>6)throw Error('У бланку місце для 29 записів служби. Скоротіть текст для друку.');
  const grids={3:[28.6,70.7,120.4,324.8,445.2,510.1],4:[85.4,127.5,177.2,381.6,502,566.9],5:[28.6,70.8,120.5,318.9,446.6,510.1],6:[85.4,127.6,177.3,368.7,503.4,566.9]};
  const top0=page===3?262.3:162.4,total=page===3?345.4:620.6,count=page===3?Math.min(service.length,5):Math.min(8,service.length-5-(page-4)*8),top=top0+row*total/count,end=top0+(row+1)*total/count,cols=grids[page];
  const unit=r.unit||String(r.employer||'').replace(/^В[Іі]ЙСЬКОВА ЧАСТИНА\s*/iu,'');
  const police=r.kind==='police_service';
  const order=[!police&&unit&&'Ком. в/ч',!police&&unit,r.order_number&&'№'+r.order_number,date(r.order_date)].filter(Boolean).join('\n');
  [stacked(r.start_date),stacked(r.end_date),[r.position,!police&&r.military_specialty&&'ВОС '+r.military_specialty].filter(Boolean).join(', '),unit&&(police?unit:'в/ч '+unit),order].forEach((v,j)=>add('service_'+i+'_'+j,['Початок','Завершення','Посада та ВОС','Частина','Наказ'][j]+' · '+(i+1),page,[cols[j],top,cols[j+1],end],v,'Військова служба',j!==2));
 });
 if(served!==false)add('discharge','Звільнення в запас',3,[28.6,607.8,510.1,660.9],discharge.order_number?'Звільнений у запас '+(discharge.basis?'за '+discharge.basis+', ':'')+'наказ командира в/ч '+(discharge.unit||'')+' №'+discharge.order_number+' від '+date(discharge.order_date):'','Військова служба');
 printable(p.combat_records).forEach((r,i,rows)=>{
  const top=99.5+i*283.6/rows.length,end=99.5+(i+1)*283.6/rows.length,cols=[28.6,330,420.1,510.1];
  [r.location,date(r.start_date),date(r.end_date)].forEach((v,j)=>add('combat_'+i+'_'+j,['Місце','Початок','Завершення'][j]+' · '+(i+1),7,[cols[j],top,cols[j+1],end],v,'Бойові дії та нагороди'));
 });
 add('injuries','Поранення, травми, контузії',7,[28.6,412,510.1,796.3],p.injuries||'','Бойові дії та нагороди');
 printable(p.awards).forEach((r,i,rows)=>{
  const top=104.6+i*198.5/rows.length,end=104.6+(i+1)*198.5/rows.length,cols=[85.4,245.8,405.9,566.9];
  [r.name,r.reason,[r.order_issuer,r.order_number&&'№'+r.order_number,date(r.order_date)].filter(Boolean).join(' ')].forEach((v,j)=>add('award_'+i+'_'+j,['Нагорода','Підстава','Наказ'][j]+' · '+(i+1),8,[cols[j],top,cols[j+1],end],v,'Бойові дії та нагороди'));
 });
 add('foreign_trips','Закордонні відрядження',8,[85.4,391.3,375.7,475.9],p.foreign_business_trips||'','Додаткові відомості');
 add('foreign_trips_start','Початок відрядження',8,[375.7,391.3,471.3,475.9],'','Додаткові відомості');
 add('foreign_trips_end','Завершення відрядження',8,[471.3,391.3,566.9,475.9],'','Додаткові відомості');
 add('elected_bodies','Виборчі органи',8,[85.4,498,566.9,573.3],p.elected_bodies||'','Додаткові відомості');
 add('captivity','Полон, заручники, інтернування',8,[85.4,625,566.9,770.3],p.captivity||'','Додаткові відомості');
 const relativeName=v=>window.CRMCandidateName?.proper(v)??v;
 const relatives=printable(p.relatives),parents=['Батько','Мати'].flatMap(role=>relatives.filter(r=>normalize(r.relationship||r.relation)===normalize(role)).map(r=>role+': '+relativeName(r.full_name)+(r.address?'. '+r.address:'')));
 add('parents','Батько та мати',9,[241.4,28.6,517.4,91.1],parents.join('\n'),'Родина');
 const spouses=relatives.filter(r=>['дружина','чоловік'].includes(normalize(r.relationship||r.relation))),m=printableObject(p.marriage_record),children=bool(c.has_children??p.has_children)===false?[]:relatives.filter(r=>/^(?:Син|Донька|Дочка|Дитина)$/iu.test(r.relationship||r.relation||''));
 const family=[c.marital_status||p.marital_status,...spouses.map(r=>[r.full_name,r.birth_date&&r.birth_date.slice(0,4)+' р.н.'].filter(Boolean).join(', ')),m.certificate_number&&'Свідоцтво '+m.certificate_number+(m.registration_date?' від '+date(m.registration_date):''),m.registration_authority,...children.map(r=>[r.full_name,date(r.birth_date)].filter(Boolean).join(', ')),p.dependants].filter(Boolean).join('\n');
 add('family','Сімейний стан, шлюб, діти, утриманці',9,[241.4,91.1,517.4,216.6],family,'Родина');
 add('family_address','Підтверджене місце проживання сім’ї',9,[241.4,216.6,517.4,242.7],p.family_residence_confirmed?p.family_residence_address:'','Родина');
 printable(p.reserve_training_records).forEach((r,i,rows)=>{
  const cols=[28.6,99.5,170.3,266.1,432.8,517.4],top=389+i*145.3/rows.length,end=389+(i+1)*145.3/rows.length;
  [stacked(r.start_date),stacked(r.end_date),[r.position,r.military_specialty].filter(Boolean).join(', '),r.unit,[r.order_issuer,r.order_number,date(r.order_date)].filter(Boolean).join(' ')].forEach((v,j)=>add('training_'+i+'_'+j,['Початок','Завершення','Посада та ВОС','Частина','Наказ'][j]+' зборів · '+(i+1),9,[cols[j],top,cols[j+1],end],v,'Збори в запасі'));
 });
 const printWarnings=[];
 for(const f of fields)if(typeof p.service_record_print?.[f.key]==='string'){const override=p.service_record_print[f.key];if(override!==f.value)printWarnings.push('Друкована правка «'+f.label+'» відрізняється від картки. Звірте перед формуванням.');f.source_value=f.value;f.print_override=true;f.value=override;}
 for(const field of fields)if(field.key.startsWith('work_')){field.center=true;field.verticalCenter=true;}
 return {fields,worked,served,name:c.name_nominative||c.full_name,issues:[...printWarnings,...(rankOrders.length>1?['Для чинного звання є кілька різних наказів. Звірте поле «Наказ про присвоєння звання» за документами.']:[])]};
}
function wrapText(value,width,measure){
 const out=[];
 for(const part of String(value||'').split('\n')){let row='';
  for(const word of part.split(/\s+/).filter(Boolean)){
   if(measure(word)<=width){const next=row?row+' '+word:word;if(row&&measure(next)>width){out.push(row);row=word;}else row=next;continue;}
   if(row){out.push(row);row='';}
   // Prefer existing hyphens; split a longer segment only when it cannot fit alone.
   const chunks=word.match(/[^-‐‑–—]+[-‐‑–—]?|[-‐‑–—]/gu)||[word];
   for(const chunk of chunks){
    if(measure(chunk)<=width){if(row&&measure(row+chunk)>width){out.push(row);row='';}row+=chunk;}
    else for(const ch of Array.from(chunk)){if(measure(ch)>width)throw Error('Комірка надто вузька для друку.');if(row&&measure(row+ch)>width){out.push(row);row='';}row+=ch;}
   }
  }out.push(row);
 }return out;
}
async function create(state){
 await Promise.all([loadExternalScript('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js','PDFLib'),loadExternalScript('https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js','fontkit')]);
 const responses=await Promise.all([fetch(asset('templates/service-record/blank.pdf?v=1.1.0.473')),fetch(asset('templates/fonts/TimesNewRoman-Regular.ttf'))]);if(responses.some(r=>!r.ok))throw Error('Не вдалося завантажити бланк послужного або шрифт.');
 const [bytes,fontBytes]=await Promise.all(responses.map(r=>r.arrayBuffer())),pdf=await PDFLib.PDFDocument.load(bytes);if(pdf.getPageCount()!==10)throw Error('Бланк має містити 10 сторінок.');
 pdf.registerFontkit(window.fontkit);const font=await pdf.embedFont(fontBytes,{subset:true}),size=12,line=13.8,pad=3;
 function lines(value,width,label){return wrapText(value,width,text=>font.widthOfTextAtSize(text,size));}
 function draw(f){if(!f.value.trim())return;const [x,top,right,bottom]=f.box,inset=bottom-top<20?1:pad,rows=lines(f.value,right-x-2*inset,f.label);if(size+(rows.length-1)*line+2*inset>bottom-top)throw Error('Не вміщується поле «'+f.label+'». Скоротіть текст для друку; повні дані CRM збережені.');const pg=pdf.getPage(f.page),textHeight=font.heightAtSize(size),blockHeight=textHeight+(rows.length-1)*line,firstY=f.verticalCenter?pg.getHeight()-(top+bottom)/2+blockHeight/2-textHeight:pg.getHeight()-top-inset-size;rows.forEach((row,i)=>pg.drawText(row,{font,size,x:f.center?(x+right-font.widthOfTextAtSize(row,size))/2:x+inset,y:firstY-i*line}));}
 function rect(page,box){const [x,t,r,b]=box;pdf.getPage(page).drawRectangle({x,y:pdf.getPage(page).getHeight()-b,width:r-x,height:b-t,color:PDFLib.rgb(1,1,1)});}
 function rule(page,x1,t1,x2,t2){const pg=pdf.getPage(page);pg.drawLine({start:{x:x1,y:pg.getHeight()-t1},end:{x:x2,y:pg.getHeight()-t2},thickness:.48});}
 const printFields=state.fields.map(f=>({...f,box:[...f.box]}));
 if(state.worked===true){
  rect(2,[85.1,126.2,571.3,762.2]);for(const x of [85.34,156.86,228.41,493.06,571.08])rule(2,x,126.2,x,700);for(const t of [126.2,700,762.12])rule(2,85.34,t,571.08,t);for(const x of [85.34,571.08])rule(2,x,700,x,762.12);draw({label:'Підписний блок',page:2,box:[85.34,700,571.08,762.12],value:sign});
 }
 if(state.served===false){rect(3,[28.32,262.3,510.34,769.44]);for(const t of [262.3,289.3,342.5,769.44])rule(3,28.56,t,510.1,t);for(const x of [28.56,510.1])rule(3,x,262.3,x,769.44);for(const x of [70.7,120.4,324.8,445.2])rule(3,x,342.5,x,769.44);draw({label:'Підписний блок',page:3,box:[28.56,289.3,510.1,342.5],value:sign});}
 else if(!state.fields.find(f=>f.key==='discharge')?.value.trim()){
  let signatureTop=607.8;
  const serviceFields=printFields.filter(f=>/^service_\d+_\d+$/.test(f.key));
  if(serviceFields.length&&serviceFields.every(f=>f.page===3)){
   const rows=[...new Set(serviceFields.map(f=>f.key.split('_')[1]))].map(id=>serviceFields.filter(f=>f.key.split('_')[1]===id));
   const heights=rows.map(row=>Math.max(...row.map(f=>size+(Math.max(1,lines(f.value,f.box[2]-f.box[0]-2*pad,f.label).length)-1)*line+2*pad))+2*line);
   if(262.3+heights.reduce((a,b)=>a+b,0)<=607.8){
    rect(3,[28.32,262.1,510.34,769.7]);let top=262.3;
    rows.forEach((row,i)=>{rule(3,28.56,top,510.1,top);row.forEach(f=>{f.box[1]=top+line;f.box[3]=top+heights[i]-line;});top+=heights[i];});
    signatureTop=top;for(const x of [28.56,70.7,120.4,324.8,445.2,510.1])rule(3,x,262.3,x,signatureTop);
   }
  }
  rect(3,[28.32,signatureTop-.2,510.34,769.7]);const signatureEnd=signatureTop+53.1;
  for(const t of [signatureTop,signatureEnd,769.44])rule(3,28.56,t,510.1,t);
  for(const x of [28.56,510.1])rule(3,x,signatureTop,x,769.44);
  for(const x of [70.7,120.4,324.8,445.2])rule(3,x,signatureEnd,x,769.44);
  draw({label:'Підписний блок',page:3,box:[28.56,signatureTop,510.1,signatureTop+34.2],value:sign.split('\n')[0]});
  draw({label:'Звання підписанта',page:3,box:[28.56,signatureTop+32.2,200,signatureEnd],value:'капітан'});
  draw({label:'Підписант',page:3,box:[245,signatureTop+32.2,510.1,signatureEnd],value:'Володимир СОВІН'});
 }
 for(const f of printFields)draw(f);
 pdf.setTitle('Послужний список — '+state.name);pdf.setAuthor('');pdf.setCreator('PSK_RECRUTER CRM');return new Blob([await pdf.save()],{type:'application/pdf'});
}
async function open(c,pf,{save}){
 const state=model(c,pf),dialog=document.createElement('dialog');dialog.className='crm-dialog crm-workflow-dialog';
 const readiness=window.CRMServiceReadiness?.review(c,pf,window.CRMWorkspace?.card?.documents||[]);
 if(readiness)state.issues=[...new Set([...state.issues,...readiness.issues.map(r=>r.label+': '+r.text)])];
 if(window.CRMDocumentCrosscheck){try{const evidence=await CRMDocumentCrosscheck.load(supabaseClient,c);for(const e of evidence.filter(e=>['conflict','needs_review'].includes(e.status)))state.issues.push('Розбіжність між документами: '+({rnokpp:'РНОКПП',birth_date:'Дата народження',birth_place:'Місце народження',relatives:'Родич '+(e.subject||''),education_records:'Освіта',work_records:'Періоди роботи / служби'}[e.key]||e.key)+'. Джерела: '+e.sources.map(s=>s.file_name||s.document_type).join('; '));}catch(e){state.issues.push('Не вдалося звірити пакет документів: '+e.message)}}
 const groups=[...new Set(state.fields.map(f=>f.group))];
 dialog.innerHTML='<h2>Послужний список</h2><p>'+esc(state.name)+'</p>'+state.issues.map(text=>'<p class="crm-notice" role="alert">'+esc(text)+'</p>').join('')+'<p>10 сторінок для двостороннього друку. Змінюється лише текст для цього PDF. Повні дані картки зберігаються. Тексти можна уточнити за підтвердженими документами. Зміни в редакторі діють лише для поточного PDF.</p><p>Рядки жетона, складання документа та підписів залишаються порожніми. Реквізити наказу про звання вносьте лише за військовим документом.</p>'+groups.map((g,i)=>'<details '+(!i?'open':'')+'><summary>'+esc(g)+'</summary>'+state.fields.filter(f=>f.group===g).map(f=>'<label style="display:block;margin:10px 0">'+esc(f.label)+'<textarea data-service-field="'+esc(f.key)+'" rows="'+(f.box[3]-f.box[1]>70?4:2)+'" style="display:block;width:100%;box-sizing:border-box">'+esc(f.value)+'</textarea></label>').join('')+'</details>').join('')+'<p data-service-status role="status"></p><div class="crm-actions"><button type="button" data-service-preview>Переглянути PDF</button><button type="button" data-service-save>Зберегти у справі та завантажити PDF</button><button type="button" data-service-close>Закрити</button></div>';
 document.body.append(dialog);dialog.showModal();let busy=false,previewUrl=null;const status=dialog.querySelector('[data-service-status]');
 const close=()=>{if(busy)return;dialog.close();dialog.remove();if(previewUrl)URL.revokeObjectURL(previewUrl);};dialog.querySelector('[data-service-close]').onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
 async function build(saving){if(busy||CRMWorkspace.busy)return;busy=true;CRMWorkspace.busy=true;dialog.querySelectorAll('button,textarea').forEach(el=>el.disabled=true);try{state.fields.forEach(f=>f.value=dialog.querySelector('[data-service-field="'+f.key+'"]').value);status.textContent='Формуємо та перевіряємо PDF…';const blob=await create(state);if(saving){const fresh=await supabaseClient.from('candidates').select('updated_at').eq('id',c.id).single();if(fresh.error)throw fresh.error;if(fresh.data.updated_at!==c.updated_at)throw Error('Дані картки змінилися. Закрийте й відкрийте послужний повторно.');await save(blob);status.textContent='Послужний збережено у справі та завантажено.';}else{if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=URL.createObjectURL(blob);let iframe=dialog.querySelector('iframe');if(!iframe){iframe=document.createElement('iframe');iframe.title='Послужний список — PDF';iframe.style='width:100%;height:65vh;border:1px solid #ddd';dialog.querySelector('.crm-actions').before(iframe);}iframe.src=previewUrl;status.textContent='PDF готовий: 10 сторінок. Перевірте всі сторінки перед збереженням.';}}catch(e){status.textContent=e.message;status.scrollIntoView({block:'nearest'});}finally{busy=false;CRMWorkspace.busy=false;dialog.querySelectorAll('button,textarea').forEach(el=>el.disabled=false);}}
 dialog.querySelector('[data-service-preview]').onclick=()=>build(false);dialog.querySelector('[data-service-save]').onclick=()=>build(true);return dialog;
}
window.CRMServiceRecord={model,create,open,wrapText};
})();
