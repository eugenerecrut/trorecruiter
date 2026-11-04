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
 pf=pf&&(!pf.candidate_id||pf.candidate_id===c.id)?pf:{};
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
 const cleanPosition=v=>{const parts=String(v??'').split(/\s*,\s*/).filter(Boolean);return parts.filter((part,idx)=>idx===0||normalize(part)!==normalize(parts[idx-1])).join(', ');};
 const rankMatches=printable(p.military_rank_records).filter(r=>(r.confirmed_by_user===true||r.accepted_by_ai===true)&&!r.requires_review&&normalize(r.rank)===normalize(c.military_rank)&&normalize(c.military_rank));
 const rankOrders=[...new Map(rankMatches.map(r=>[JSON.stringify([r.order_issuer||'',r.order_number||'',r.order_date||'']),r])).values()];
 const rank=rankOrders.length===1?rankOrders[0]:null;
 add('rank_order','Наказ про присвоєння звання',0,[156.3,262,326.5,309.7],rank?[rank.order_issuer,rank.order_number&&'№'+rank.order_number,date(rank.order_date)].filter(Boolean).join(' '):'');
 const eduYear=e=>Number(e.graduation_year||String(e.study_end_date||'').slice(0,4)||9999),eduStart=e=>Number(String(e.study_start_date||'').slice(0,4)||0);
 const eduRank=e=>{
  if(!e)return 0;
  const d=String(e.degree||e.degree_raw||'').toLowerCase(),i=String(e.institution||'').toLowerCase(),q=String(e.qualification||'').toLowerCase();
  if(/доктор|аспірант|науковий ступінь|phd/u.test(d+' '+q))return 50;
  if(/магістр/u.test(d))return 44;
  if(/спеціаліст/u.test(d))return 43;
  if(/бакалавр/u.test(d)&&!/молодший/u.test(d))return 42;
  if(/вищ|студент/u.test(d)||/університет|академі|інститут|консерваторі/u.test(i))return 40;
  if(/фахов|молодший|середня спеціальна/u.test(d)||/коледж|технікум/u.test(i))return 30;
  if(/професійн|профтех|кваліфікований робітник|робітнич/u.test(d+' '+q)||/професійн|пту|центр професійної|професійний ліцей/u.test(i))return 20;
  if(/середн/u.test(d)||/школа|зош|сзш|гімназі|ліцей|нвк|колегіум/u.test(i))return 10;
  return 5;
 };
 const eduRecords=printable(p.education_records);
 const bestEdu=eduRecords.length?eduRecords.slice().sort((a,b)=>eduRank(b)-eduRank(a)||eduYear(b)-eduYear(a)||eduStart(b)-eduStart(a))[0]:null;
 const eduCivil=bestEdu?[bestEdu.institution,eduRank(bestEdu)<=10||bestEdu.degree==='середня'?null:bestEdu.specialty,eduRank(bestEdu)<=10||bestEdu.degree==='середня'?null:bestEdu.qualification,bestEdu.graduation_year&&bestEdu.graduation_year+' р.'].filter(Boolean).join(', '):[p.education_institution,p.education_specialty,p.education_qualification,p.education_year].filter(Boolean).join(', ');
 const y=[29,70,125.2,230.8,326.7,372.5,435.3,806];
 const personal=[['birth_date','Дата народження',words(c.birth_date)],['birth_place','Місце народження',String(c.birth_place??'').trim()?c.birth_place:pf.birth_place],['education_civil','Цивільна освіта',eduCivil],['education_military','Військова освіта',p.military_education||''],['languages','Іноземні мови',p.foreign_languages||p.languages||''],['scientific_degree','Науковий ступінь і вчене звання',p.scientific_degree||''],['scientific_works','Наукові праці й винаходи',p.scientific_works||'']];
 personal.forEach(([k,l,v],i)=>add(k,l,1,[238,y[i],510,y[i+1]],v,'Освіта та особисті відомості'));
 const worked=bool(c.worked_before??p.worked_before),served=bool(c.served_before??p.served_before);
 const periods=(Array.isArray(p.work_records)?p.work_records:[]).filter(r=>r&&!r.requires_review&&!r.crossed_out);
 const employment=periods.filter(r=>r.kind==='employment');
 if(worked===false)add('not_worked','Відомості про роботу',2,[85.4,126.2,571.1,152.5],c.sex==='female'?'Не працювала':'Не працював','Трудова діяльність',true);
 else {
  let initialTop=126.2+2*13.8;
  employment.forEach((r,i)=>{
   const cols=[85.4,156.9,228.4,493.1,571.1],top=initialTop,bottom=initialTop+36;
   initialTop+=36+2*13.8;
   [stacked(r.start_date),stacked(r.end_date),[r.employer,r.locality||r.location].filter(Boolean).join(', '),cleanPosition(r.position)].forEach((v,j)=>add('work_'+i+'_'+j,['Початок','Завершення','Підприємство та місцевість','Посада'][j]+' · '+(i+1),2,[cols[j],top,cols[j+1],bottom],v,'Трудова діяльність'));
  });
 }
 const oath=printableObject(p.military_oath),discharge=printableObject(p.military_discharge);
 add('callup','Призов / початок служби',3,[222.6,39,510.3,55.6],served===false?'':p.service_start_date?words(p.service_start_date)+(p.previous_service_type?' '+p.previous_service_type:''):'','Військова служба');
 add('oath','Присяга',3,[102.3,89,425.5,105.4],served===false?'':[date(oath.date),oath.unit&&'в/ч '+oath.unit].filter(Boolean).join(', '),'Військова служба');
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
 const relatives=printable(p.relatives),parentRoles=['Батько','Мати'],ambiguousParents=parentRoles.filter(role=>new Set(relatives.filter(r=>normalize(r.relationship||r.relation)===normalize(role)).map(r=>normalize(r.full_name)).filter(Boolean)).size>1);
 const parents=parentRoles.flatMap(role=>{const rows=relatives.filter(r=>normalize(r.relationship||r.relation)===normalize(role));return new Set(rows.map(r=>normalize(r.full_name)).filter(Boolean)).size>1?[]:rows.slice(0,1).map(r=>role+': '+relativeName(r.full_name)+(r.address?'. '+r.address:''));});
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
 for(const f of fields){if(f.source_value===undefined)f.source_value=f.value;if(typeof p.service_record_print?.[f.key]==='string'){const override=p.service_record_print[f.key];if(override!==f.value&&f.key!=='education_civil'&&!/^work_\d+_\d+$/.test(f.key)&&!(f.key==='birth_place'&&window.CRMDocumentCrosscheck?.sameRenamedBirthplace([override,f.value])))printWarnings.push('Друкована правка «'+f.label+'» відрізняється від картки. Звірте перед формуванням.');f.source_value=f.value;f.print_override=true;f.value=override;}}
 for(const field of fields)if(field.key.startsWith('work_')){field.center=true;field.verticalCenter=true;}
 return {fields,worked,served,name:c.name_nominative||c.full_name,issues:[...printWarnings,...(rankOrders.length>1?['Для чинного звання є кілька різних наказів. Звірте поле «Наказ про присвоєння звання» за документами.']:[]),...(ambiguousParents.length?['Для батьків є кілька різних записів ('+ambiguousParents.map(r=>r.toLocaleLowerCase('uk-UA')).join(', ')+'). Звірте поле «Батько та мати» за документами.']:[])]};
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
 pdf.registerFontkit(window.fontkit);const font=await pdf.embedFont(fontBytes,{subset:false}),form=pdf.getForm(),size=12,line=13.8,pad=3;
 function lines(value,width,label){return wrapText(value,width,text=>font.widthOfTextAtSize(text,size));}
 function draw(f){if(!f.value.trim())return;const [x,top,right,bottom]=f.box,inset=bottom-top<20?1:pad,rows=lines(f.value,right-x-2*inset,f.label);if(size+(rows.length-1)*line+2*inset>bottom-top+.05)throw Error('Не вміщується поле «'+f.label+'». Скоротіть текст для друку; повні дані CRM збережені.');const pg=pdf.getPage(f.page),textHeight=font.heightAtSize(size),blockHeight=textHeight+(rows.length-1)*line,firstY=f.verticalCenter?pg.getHeight()-(top+bottom)/2+blockHeight/2-textHeight:pg.getHeight()-top-inset-size;rows.forEach((row,i)=>pg.drawText(row,{font,size,x:f.center?(x+right-font.widthOfTextAtSize(row,size))/2:x+inset,y:firstY-i*line}));}
 function drawSignature(page,left,top,right,end){
  draw({label:'Підписний блок',page,box:[left,top,right,top+34.2],value:sign.split('\n')[0]});
  draw({label:'Звання підписанта',page,box:[left,top+32.2,left+172,end],value:'капітан'});
  rule(page,left+56,top+48,left+202,top+48);
  draw({label:'Підписант',page,box:[left+216.44,top+32.2,right,end],value:'Володимир СОВІН'});
 }
 function rect(page,box){const [x,t,r,b]=box;pdf.getPage(page).drawRectangle({x,y:pdf.getPage(page).getHeight()-b,width:r-x,height:b-t,color:PDFLib.rgb(1,1,1)});}
 function rule(page,x1,t1,x2,t2){const pg=pdf.getPage(page);pg.drawLine({start:{x:x1,y:pg.getHeight()-t1},end:{x:x2,y:pg.getHeight()-t2},thickness:.48});}
 const printFields=state.fields.map(f=>({...f,box:[...f.box]}));
 const rowPages=new Map();
 for(const f of printFields.filter(f=>/^service_\d+_\d+$/.test(f.key))){
  const id=f.key.split('_')[1];if(!rowPages.has(id))rowPages.set(id,rowPages.size);
  const i=rowPages.get(id),j=Number(f.key.split('_')[2]);f.page=i<5?3:4+Math.floor((i-5)/8);
  const cols=serviceColumns[f.page];f.box[0]=cols[j];f.box[2]=cols[j+1];
 }
 const serviceRows=printFields.filter(f=>/^service_\d+_\d+$/.test(f.key));
 const lastServicePage=serviceRows.length?Math.max(...serviceRows.map(f=>f.page)):3;
 for(const page of new Set(serviceRows.map(f=>f.page))){
  const fields=serviceRows.filter(f=>f.page===page),rows=[...new Set(fields.map(f=>f.key.split('_')[1]))].map(id=>fields.filter(f=>f.key.split('_')[1]===id));
  const start=page===3?262.3:162.4,end=page===3?607.7:page===lastServicePage?729:783;
  rows.forEach((row,i)=>row.forEach(f=>{f.box[1]=start+i*(end-start)/rows.length;f.box[3]=start+(i+1)*(end-start)/rows.length;}));
 }
 if(state.worked===true){
  rect(2,[85.1,126.2,571.3,762.2]);
  const workFields=printFields.filter(f=>/^work_\d+_\d+$/.test(f.key));
  let signatureTop=700;
  if(workFields.length&&workFields.every(f=>f.page===2)){
   const rows=[...new Set(workFields.map(f=>f.key.split('_')[1]))].map(id=>workFields.filter(f=>f.key.split('_')[1]===id));
   let currentTop=126.2+2*line; // 2 відступи з гори
   rows.forEach((row,i)=>{
    const contentHeight=Math.max(...row.map(f=>size+(Math.max(1,lines(f.value,f.box[2]-f.box[0]-2*pad,f.label).length)-1)*line+2*pad));
    row.forEach(f=>{f.box[1]=currentTop;f.box[3]=currentTop+contentHeight;});
    currentTop+=contentHeight;
    if(i<rows.length-1)currentTop+=2*line; // між полями теж 2 відступи
   });
   signatureTop=currentTop+2*line;if(signatureTop>700)throw Error('Рядки трудового стажу не вміщуються. Скоротіть текст або заберіть зайвий рядок.'); // наприкінці 2 відступи, Совіна підтягувати до кінця полів у гору
  }
  const tableBottom=762.12,signatureEnd=signatureTop+62.12;
  for(const x of [85.34,156.86,228.41,493.06,571.08])rule(2,x,126.2,x,signatureTop);
  for(const x of [85.34,571.08])rule(2,x,signatureTop,x,signatureEnd);
  if(signatureEnd<tableBottom){
   for(const x of [85.34,156.86,228.41,493.06,571.08])rule(2,x,signatureEnd,x,tableBottom);
  }
  for(const t of [126.2,signatureTop,signatureEnd,tableBottom])rule(2,85.34,t,571.08,t);
  drawSignature(2,85.34,signatureTop,571.08,signatureEnd);
 }
 if(state.served===false){rect(3,[28.32,262.3,510.34,769.44]);for(const t of [262.3,289.3,342.5,769.44])rule(3,28.56,t,510.1,t);for(const x of [28.56,510.1])rule(3,x,262.3,x,769.44);for(const x of [70.7,120.4,324.8,445.2])rule(3,x,342.5,x,769.44);drawSignature(3,28.56,289.3,510.1,342.5);}
 else if(lastServicePage===3){
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
  const dischargeField=printFields.find(f=>f.key==='discharge');
  if(dischargeField?.value.trim()){
   const dischargeHeight=Math.max(22,size+(lines(dischargeField.value,475.5,dischargeField.label).length-1)*line+2*pad);
   dischargeField.box=[28.6,signatureTop,510.1,signatureTop+dischargeHeight];
   rect(3,[28.32,signatureTop-.2,510.34,signatureTop+dischargeHeight]);rule(3,28.56,signatureTop,510.1,signatureTop);
   for(const x of [28.56,510.1])rule(3,x,signatureTop,x,signatureTop+dischargeHeight);
   signatureTop+=dischargeHeight;
  }
  const signatureEnd=signatureTop+53.1;
  if(signatureEnd>769.44)throw Error('Не вміщується блок звільнення та підпису. Скоротіть текст звільнення.');
  rect(3,[28.32,signatureTop-.2,510.34,769.7]);
  for(const t of [signatureTop,signatureEnd,769.44])rule(3,28.56,t,510.1,t);
  for(const x of [28.56,510.1])rule(3,x,signatureTop,x,769.44);
  for(const x of [70.7,120.4,324.8,445.2])rule(3,x,signatureEnd,x,769.44);
  drawSignature(3,28.56,signatureTop,510.1,signatureEnd);
 }
 if(lastServicePage>3){
  for(const page of new Set(serviceRows.filter(f=>f.page<lastServicePage).map(f=>f.page))){
   const fields=serviceRows.filter(f=>f.page===page),left=Math.min(...fields.map(f=>f.box[0])),right=Math.max(...fields.map(f=>f.box[2]));
   for(const y of new Set(fields.map(f=>f.box[3])))rule(page,left,y,right,y);
  }
  const fields=serviceRows.filter(f=>f.page===lastServicePage),rows=[...new Set(fields.map(f=>f.key.split('_')[1]))].map(id=>fields.filter(f=>f.key.split('_')[1]===id));
  const cols=[...rows[0].map(f=>f.box[0]),rows[0].at(-1).box[2]],left=cols[0],right=cols.at(-1),start=162.4;
  const heights=rows.map(row=>Math.max(...row.map(f=>size+(Math.max(1,lines(f.value,f.box[2]-f.box[0]-2*pad,f.label).length)-1)*line+2*pad))+2*line);
  const compact=start+heights.reduce((a,b)=>a+b,0)<=729;
  let top=start;
  rect(3,[28.32,660.9,510.34,714.1]);for(const x of [28.56,510.1])rule(3,x,660.9,x,714.1);
  rect(lastServicePage,[left-.2,start-.2,right+.2,783.2]);
  rows.forEach((row,i)=>{
   rule(lastServicePage,left,top,right,top);
   const height=compact?heights[i]:(729-start)/rows.length,padding=compact?line:0;
   row.forEach(f=>{f.box[1]=top+padding;f.box[3]=top+height-padding;});top+=height;
  });
  for(const x of cols)rule(lastServicePage,x,start,x,top);
  const end=top+53.1;
  for(const y of [top,end,783])rule(lastServicePage,left,y,right,y);
  for(const x of [left,right])rule(lastServicePage,x,top,x,end);
  for(const x of cols)rule(lastServicePage,x,end,x,783);
  drawSignature(lastServicePage,left,top,right,end);
 }
 for(const [index,f] of printFields.entries()){
  if(f.key==='discharge'&&!f.value.trim()&&lastServicePage===3)continue;
  const [x,top,right,bottom]=f.box,width=right-x,height=bottom-top,inset=height<20?1:pad,rows=lines(f.value,width-2*inset,f.label);
  if(f.value.trim()&&size+(rows.length-1)*line+2*inset>height+.05)throw Error('Не вміщується поле «'+f.label+'». Скоротіть текст для друку; повні дані CRM збережені.');
  const page=pdf.getPage(f.page),field=form.createTextField('service_'+index+'_'+f.key),zero=PDFLib.degrees(0);
  if(height>=size+line+2*inset)field.enableMultiline();
  if(f.center)field.setAlignment(PDFLib.TextAlignment.Center);
  field.setText(f.value);field.addToPage(page,{x,y:page.getHeight()-bottom,width,height,font,borderWidth:0,borderColor:undefined,backgroundColor:undefined});field.setFontSize(size);
  const textHeight=font.heightAtSize(size),blockHeight=textHeight+(rows.length-1)*line,firstY=f.verticalCenter?(height+blockHeight)/2-textHeight:height-inset-size;
  field.updateAppearances(font,()=>rows.flatMap((row,i)=>PDFLib.drawText(font.encodeText(row),{font:font.name,size,color:PDFLib.rgb(0,0,0),x:f.center?(width-font.widthOfTextAtSize(row,size))/2:inset,y:firstY-i*line,rotate:zero,xSkew:zero,ySkew:zero})));
 }
 pdf.setTitle('Послужний список — '+state.name);pdf.setAuthor('');pdf.setCreator('PSK_RECRUTER CRM');return new Blob([await pdf.save({updateFieldAppearances:false})],{type:'application/pdf'});
}
const serviceColumns={3:[28.6,70.7,120.4,324.8,445.2,510.1],4:[85.4,127.5,177.2,381.6,502,566.9],5:[28.6,70.8,120.5,318.9,446.6,510.1],6:[85.4,127.6,177.3,368.7,503.4,566.9]};
const rowConfig={
 service:{group:'Військова служба',flag:'served',empty:'not_served',max:29,labels:['Початок','Завершення','Посада та ВОС','Частина','Наказ']},
 work:{group:'Трудова діяльність',flag:'worked',empty:'not_worked',max:11,labels:['Початок','Завершення','Підприємство та місцевість','Посада']}
};
const rowFields=(state,kind)=>state.fields.filter(f=>new RegExp('^'+kind+'_\\d+_\\d+$').test(f.key));
function addRow(state,kind){
 const cfg=rowConfig[kind],fields=rowFields(state,kind),count=fields.length/cfg.labels.length;
 if(count>=cfg.max)return [];
 const i=Math.max(-1,...fields.map(f=>Number(f.key.split('_')[1])))+1;
 const page=kind==='work'?2:count<5?3:4+Math.floor((count-5)/8);
 const cols=kind==='work'?[85.4,156.9,228.4,493.1,571.1]:serviceColumns[page];
 state[cfg.flag]=true;state.fields=state.fields.filter(f=>f.key!==cfg.empty);
 const added=cfg.labels.map((label,j)=>({key:kind+'_'+i+'_'+j,label:label+' · '+(count+1),page,box:[cols[j],0,cols[j+1],0],value:'',source_value:'',group:cfg.group,center:kind==='work'||j!==2,verticalCenter:true,printOnly:true}));
 state.fields.push(...added);return added;
}
function removeRow(state,kind,id){state.fields=state.fields.filter(f=>!f.key.startsWith(kind+'_'+id+'_'));}
const addServiceRow=state=>addRow(state,'service');
async function renderEditablePreview(blob,state,pane,onEdit){
 await loadExternalScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js','pdfjsLib');
 pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
 const pdf=await pdfjsLib.getDocument({data:new Uint8Array(await blob.arrayBuffer()),isEvalSupported:false}).promise;
 const output=document.createDocumentFragment(),fields=new Map(state.fields.map(f=>[f.key,f]));
 try{
  for(let number=1;number<=pdf.numPages;number++){
   const page=await pdf.getPage(number),base=page.getViewport({scale:1}),width=Math.max(240,pane.clientWidth-18);
   const viewport=page.getViewport({scale:width/base.width}),sheet=document.createElement('div'),canvas=document.createElement('canvas');
   sheet.style.cssText='position:relative;margin:0 auto 12px;background:white;width:'+viewport.width+'px;height:'+viewport.height+'px';
   const ratio=Math.min(2,window.devicePixelRatio||1);canvas.width=Math.ceil(viewport.width*ratio);canvas.height=Math.ceil(viewport.height*ratio);
   canvas.style.cssText='display:block;width:100%;height:100%';sheet.append(canvas);
   await page.render({canvasContext:canvas.getContext('2d'),viewport,transform:[ratio,0,0,ratio,0,0],annotationMode:pdfjsLib.AnnotationMode.ENABLE_FORMS}).promise;
   for(const widget of await page.getAnnotations({intent:'display'})){
    if(widget.fieldType!=='Tx')continue;
    const key=widget.fieldName?.replace(/^service_\d+_/,''),field=fields.get(key);if(!field)continue;
    const [x1,y1,x2,y2]=viewport.convertToViewportRectangle(widget.rect),control=document.createElement(widget.multiLine?'textarea':'input');
    control.setAttribute('aria-label',field.label);control.value=field.value;control.dataset.pdfField=key;
    control.style.cssText='position:absolute;box-sizing:border-box;border:0;background:rgba(228,236,255,.36);padding:1px 2px;resize:none;margin:0;font-family:"Times New Roman",serif;font-size:'+(12*viewport.scale)+'px;line-height:1.15;left:'+Math.min(x1,x2)+'px;top:'+Math.min(y1,y2)+'px;width:'+Math.abs(x2-x1)+'px;height:'+Math.abs(y2-y1)+'px;text-align:'+(field.center?'center':'left');
    control.addEventListener('input',()=>onEdit(key,control.value));sheet.append(control);
   }
   output.append(sheet);page.cleanup();
  }
 }finally{await pdf.destroy();}
 return output;
}
async function open(c,pf,{save}){
 if(window.CRMCandidateConditions?.formsPersonalFile?.(c)===false)throw Error('Для цього виду оформлення послужний список не формується.');
 const state=model(c,pf),dialog=document.createElement('dialog');dialog.className='crm-dialog crm-workflow-dialog';
 const readiness=window.CRMServiceReadiness?.review(c,pf,window.CRMWorkspace?.card?.documents||[]);
 if(readiness)state.issues=[...new Set([...state.issues,...readiness.issues.map(r=>r.label+': '+r.text)])];
 if(window.CRMDocumentCrosscheck){try{const evidence=await CRMDocumentCrosscheck.load(supabaseClient,c);for(const e of evidence.filter(e=>['conflict','needs_review'].includes(e.status)))state.issues.push('Розбіжність між документами: '+({rnokpp:'РНОКПП',birth_date:'Дата народження',birth_place:'Місце народження',relatives:'Родич '+(e.subject||''),education_records:'Освіта',work_records:'Періоди роботи / служби'}[e.key]||e.key)+'. Джерела: '+e.sources.map(s=>s.file_name||s.document_type).join('; '));}catch(e){state.issues.push('Не вдалося звірити пакет документів: '+e.message)}}
 const snapshot=value=>({...value,fields:value.fields.map(f=>({...f,box:[...f.box]}))});
 const initial=snapshot(state);
 const groups=[...new Set([...state.fields.map(f=>f.group),'Трудова діяльність','Військова служба'])];
 const multilineKeys=new Set(['education_civil','scientific_works','injuries','foreign_trips','elected_bodies','captivity','parents','family','not_worked','not_served','discharge']);
 const isMulti=f=>multilineKeys.has(f.key)||String(f.value).includes('\n')||(f.box[3]-f.box[1]>60);
 const fieldHtml=f=>{
  const compactDate=/^(?:work|service)_\d+_[01]$/.test(f.key),wide=!compactDate&&isMulti(f);
  const rows=Math.max(2,Math.min(5,String(f.value).split('\n').length+1));
  const control=compactDate?'<textarea name="'+esc(f.key)+'" data-service-field="'+esc(f.key)+'" rows="2" style="width:100%;box-sizing:border-box;resize:none;text-align:center;padding:4px">'+esc(f.value)+'</textarea>':wide
   ?'<textarea name="'+esc(f.key)+'" data-service-field="'+esc(f.key)+'" rows="'+rows+'" style="width:100%;box-sizing:border-box;resize:vertical">'+esc(f.value)+'</textarea>'
   :'<input type="text" name="'+esc(f.key)+'" data-service-field="'+esc(f.key)+'" value="'+esc(f.value)+'" style="width:100%;box-sizing:border-box">';
  return '<label style="'+(compactDate?'width:100%;min-width:0;font-size:12px;':wide?'grid-column:1/-1;':'')+'display:grid;gap:6px;font-weight:600">'+esc(f.label)+control+'</label>';
 };
 const sectionFields=(g,kind)=>{
  const rows=rowFields(state,kind),ids=[...new Set(rows.map(f=>f.key.split('_')[1]))];
  return state.fields.filter(f=>f.group===g&&!rows.includes(f)).map(fieldHtml).join('')+ids.map((id,i)=>
   '<fieldset class="crm-service-print-row" style="grid-column:1/-1;display:grid;grid-template-columns:'+(kind==='work'?'96px 96px minmax(0,1fr) minmax(0,1fr)':'68px 84px minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)')+';gap:8px;align-items:start;min-width:0"><legend>Рядок '+(i+1)+'</legend>'+
   rows.filter(f=>f.key.split('_')[1]===id).map((f,j)=>j<2?'<div style="width:'+Math.round((f.box[2]-f.box[0])*1.333)+'px;max-width:100%">'+fieldHtml({...f,label:rowConfig[kind].labels[j]})+'</div>':fieldHtml({...f,label:rowConfig[kind].labels[j]})).join('')+
   '<button type="button" data-remove-row="'+kind+':'+id+'" style="grid-column:1/-1;justify-self:end;min-height:0;padding:3px 8px;font-size:12px;border:1px solid #cfd8dc;border-radius:6px;background:#fff">Забрати рядок</button></fieldset>').join('');
 };
 const formContent=groups.map(g=>{
  const kind=Object.keys(rowConfig).find(k=>rowConfig[k].group===g);
  const header='<div style="grid-column:1/-1;margin-top:16px;padding:6px 0 4px;border-bottom:2px solid #cfd8dc"><strong>'+esc(g)+'</strong></div>';
  return header+(kind?'<div data-print-rows="'+kind+'" style="display:contents">'+sectionFields(g,kind)+'</div><button type="button" data-add-row="'+kind+'" style="grid-column:1/-1">＋ Додати рядок '+(kind==='work'?'трудового стажу':'служби')+'</button>':state.fields.filter(f=>f.group===g).map(fieldHtml).join(''));
 }).join('');
 dialog.innerHTML='<style>.crm-service-panes{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);gap:16px;height:68dvh}.crm-service-panes>form,.crm-service-preview-pane{min-width:0;min-height:0;overflow:auto}.crm-service-panes>form{align-content:start;padding-right:8px}.crm-service-preview-pane{display:flex;flex-direction:column}.crm-service-preview-pane iframe{flex:1;min-height:0;margin-top:0!important}.crm-service-preview-pane iframe[hidden],.crm-service-preview-pane a[hidden]{display:none!important}@media(max-width:850px){.crm-service-panes{display:block;height:auto}.crm-service-preview-pane iframe{height:65dvh!important;flex:auto}}@media(max-width:650px){.crm-service-print-row{grid-template-columns:repeat(2,minmax(0,1fr))!important}}</style><h2>Послужний список</h2><p><strong>'+esc(state.name)+'</strong> · 10 сторінок для двостороннього друку (5 аркушів). Завантажений PDF має редаговані поля. Зміни у PDF не оновлюють картку CRM. Редагуйте будь-яке поле перед друком; оригінальні первинні документи картки зберігаються.</p>'+(state.issues.length? '<details class="crm-notice"><summary>Є зауваження</summary><ul>'+state.issues.map(text=>'<li>'+esc(text)+'</li>').join('')+'</ul></details>' :'')+'<form class="crm-workflow-grid">'+formContent+'<div style="grid-column:1/-1;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-top:10px;padding:8px 0;border-top:1px solid #e5eaed"><label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:#34414a;cursor:pointer"><input type="checkbox" data-service-persist checked style="width:18px;height:18px;accent-color:#5d741f;margin:0"> Запам’ятати правки для друку</label><button type="button" data-service-reset style="font-size:12px;padding:6px 12px;background:#f5f7f8;border:1px solid #cfd8dc;border-radius:6px;cursor:pointer">↺ Скинути до значень із картки</button></div><p data-service-status role="status" style="grid-column:1/-1;margin:6px 0;min-height:1.2em;font-weight:600"></p><div style="grid-column:1/-1;display:flex;gap:12px;flex-wrap:wrap"><button type="submit" data-service-submit style="flex:1;min-height:44px;background:#18232d;color:#fff;font-weight:700;border-radius:8px;border:none;cursor:pointer">Сформувати PDF</button><button type="button" data-service-save style="flex:1;min-height:44px;background:#446123;color:#fff;font-weight:700;border-radius:8px;border:none;cursor:pointer">Зберегти у справі та завантажити PDF</button></div></form><iframe title="Послужний список — PDF" hidden style="width:100%;height:65vh;border:1px solid #cfd8dc;border-radius:8px;margin-top:14px"></iframe><div style="display:flex;gap:10px;align-items:center;margin-top:10px"><a data-download hidden style="display:inline-block;padding:10px 18px;background:#18232d;color:#fff;text-decoration:none;border-radius:8px;font-weight:700">Завантажити PDF</a></div><div class="crm-actions"><button type="button" data-service-close>Закрити</button></div>';
 dialog.classList?.add('crm-service-split');
 dialog.style.cssText+=';width:96vw;max-width:1760px;height:92dvh;max-height:92dvh;box-sizing:border-box';
 const editor=dialog.querySelector('form'),frame=dialog.querySelector('iframe');
 let livePane=null;
 if(editor&&frame&&typeof editor.before==='function'){
  const split=document.createElement('div'),preview=document.createElement('section'),hint=document.createElement('p');
  split.className='crm-service-panes';preview.className='crm-service-preview-pane';preview.setAttribute('aria-label','Перегляд PDF');
  hint.setAttribute('data-pdf-hint','');hint.textContent='Натисніть «Сформувати PDF», щоб переглянути послужний.';
  editor.before(split);split.append(editor,preview);preview.append(hint,frame);
  livePane=document.createElement('div');livePane.style.cssText='flex:1;min-height:0;overflow:auto;max-height:68dvh;background:#e8edf1;padding:8px 0';preview.append(livePane);
  frame.addEventListener('load',()=>{hint.hidden=!frame.hidden;});
  const link=dialog.querySelector('[data-download]');if(link)preview.append(link);
 }
 if(livePane){
  let syncing=false;
  const follow=(source,target,from,to)=>{
   if(syncing||source.clientHeight>=source.scrollHeight)return;
   const top=source.getBoundingClientRect().top;
   const fields=[...source.querySelectorAll('['+from+']')];
   const anchor=fields.find(el=>el.getBoundingClientRect().bottom>top+8);
   if(!anchor)return;
   const key=anchor.getAttribute(from);
   const match=[...target.querySelectorAll('['+to+']')].find(el=>el.getAttribute(to)===key);
   if(!match)return;
   const offset=match.getBoundingClientRect().top-target.getBoundingClientRect().top;
   syncing=true;target.scrollTop+=offset-8;
   requestAnimationFrame(()=>requestAnimationFrame(()=>{syncing=false;}));
  };
  editor.addEventListener('scroll',()=>follow(editor,livePane,'data-service-field','data-pdf-field'),{passive:true});
  livePane.addEventListener('scroll',()=>follow(livePane,editor,'data-pdf-field','data-service-field'),{passive:true});
 }
 document.body.append(dialog);dialog.showModal();let busy=false,previewUrl=null,refreshTimer=null,queued=false;const status=dialog.querySelector('[data-service-status]');
 const close=()=>{if(busy)return;if(refreshTimer!==null)clearTimeout(refreshTimer);dialog.close();dialog.remove();if(previewUrl)URL.revokeObjectURL(previewUrl);};dialog.querySelector('[data-service-close]').onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
 const readFields=()=>{for(const f of state.fields){const el=dialog.querySelector('[data-service-field="'+f.key+'"]');if(el)f.value=el.value;}};
 const invalidate=()=>{const frame=dialog.querySelector('iframe'),link=dialog.querySelector('[data-download]');if(frame)frame.hidden=true;if(link)link.hidden=true;const hint=dialog.querySelector('[data-pdf-hint]');if(hint)hint.hidden=false;};
 const renderRows=kind=>{const section=dialog.querySelector('[data-print-rows="'+kind+'"]');if(section)section.innerHTML=sectionFields(rowConfig[kind].group,kind);};
 dialog.addEventListener('click',event=>{
  const add=event.target.closest?.('[data-add-row]'),remove=event.target.closest?.('[data-remove-row]');
  if(busy||!add&&!remove)return;
  readFields();
  const [kind,id]=remove?remove.dataset.removeRow.split(':'):[add.dataset.addRow];
  if(remove)removeRow(state,kind,id);
  else if(!addRow(state,kind).length){status.textContent='Досягнуто межі рядків бланка.';return;}
  renderRows(kind);invalidate();schedulePreview();
 });
 dialog.querySelector('[data-service-reset]').onclick=()=>{
  Object.assign(state,snapshot(initial));for(const kind of Object.keys(rowConfig))renderRows(kind);
  for(const f of state.fields){const el=dialog.querySelector('[data-service-field="'+f.key+'"]');if(el)el.value=f.value=f.source_value??'';}
  invalidate();schedulePreview();
 };
 function schedulePreview(){if(!livePane)return;clearTimeout(refreshTimer);const link=dialog.querySelector('[data-download]');if(link)link.hidden=true;refreshTimer=setTimeout(()=>{if(dialog.isConnected)build(false);},350);}
 editor?.addEventListener?.('input',event=>{if(event.target.dataset?.serviceField!==undefined)schedulePreview();});
 livePane?.addEventListener('focusout',event=>{if(event.target.dataset?.pdfField!==undefined)schedulePreview();});
 async function build(saving){
  if(busy){if(!saving)queued=true;return;}
  if(saving&&CRMWorkspace.busy)return;
  busy=true;if(saving){if(refreshTimer!==null)clearTimeout(refreshTimer);CRMWorkspace.busy=true;}
  if(saving)dialog.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=true);
  try{
   state.fields.forEach(f=>{
    const el=dialog.querySelector('[data-service-field="'+f.key+'"]');
    if(el)f.value=el.value;
   });
   const persist=dialog.querySelector('[data-service-persist]')?.checked;
   if(saving&&persist){
    const overrides={...(obj(c.profile_data).service_record_print||{})};let changed=false;
    for(const f of state.fields){
     if(f.printOnly)continue;
     if(f.value!==(f.source_value??'')){overrides[f.key]=f.value;changed=true;}
     else if(overrides[f.key]!==undefined){delete overrides[f.key];changed=true;}
    }
    if(changed){
     const pd={...(obj(c.profile_data)||{})};pd.service_record_print=overrides;c.profile_data=pd;
     try{
      const up=await supabaseClient.from('candidates').update({profile_data:pd}).eq('id',c.id).select('updated_at').single();
      if(!up.error&&up.data?.updated_at)c.updated_at=up.data.updated_at;
     }catch{}
    }
   }
   if(status)status.textContent='Формуємо та перевіряємо PDF…';
   const current=snapshot(state),blob=await create(current);
   let output=null;
   if(livePane&&!saving)try{output=await renderEditablePreview(blob,current,livePane,(key,value)=>{
    const field=state.fields.find(f=>f.key===key),input=dialog.querySelector('[data-service-field="'+key+'"]');
    if(field)field.value=value;if(input)input.value=value;
    const link=dialog.querySelector('[data-download]');if(link)link.hidden=true;
   });}catch(e){if(status)status.textContent='Редагований перегляд недоступний: '+e.message;}
   if(!saving&&(queued||current.fields.some(f=>dialog.querySelector('[data-service-field="'+f.key+'"]')?.value!==f.value)))return;
   if(!dialog.isConnected)return;
   if(previewUrl)URL.revokeObjectURL(previewUrl);
   previewUrl=URL.createObjectURL(blob);
   const iframe=dialog.querySelector('iframe');
   if(output&&livePane){const offset=livePane.scrollTop;livePane.replaceChildren(output);livePane.hidden=false;livePane.scrollTop=offset;if(iframe)iframe.hidden=true;const hint=dialog.querySelector('[data-pdf-hint]');if(hint)hint.hidden=true;}
   else if(iframe&&(!livePane||!saving)){if(livePane)livePane.hidden=true;iframe.src=previewUrl+'#view=FitH';iframe.hidden=false;}
   const a=dialog.querySelector('[data-download]');
   if(a){
    a.href=previewUrl;
    a.download='Послужний_список_'+String(state.name||'Кандидат').replace(/[<>:"/\\|?*\x00-\x1f\s]+/g,'_')+'.pdf';
    a.hidden=false;
   }
   if(saving){
    const fresh=await supabaseClient.from('candidates').select('updated_at').eq('id',c.id).single();
    if(fresh.error)throw fresh.error;
    if(fresh.data.updated_at!==c.updated_at)throw Error('Дані картки змінилися. Закрийте й відкрийте послужний повторно.');
    await save(blob);
    if(status)status.textContent='Послужний список (10 сторінок) збережено у справі та завантажено.';
   }else{
    if(status)status.textContent=livePane&&!output?'PDF готовий. Двостороннє редагування зараз недоступне; змінюйте поля ліворуч.':'PDF готовий: 10 сторінок. Правки в обох панелях синхронізуються.';

   }
  }catch(e){
   if(status){status.textContent=e.message;status.scrollIntoView({block:'nearest'});}
  }finally{
   busy=false;if(saving){CRMWorkspace.busy=false;dialog.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=false);}
   if(queued){queued=false;schedulePreview();}
  }
 }
 dialog.querySelector('form').onsubmit=ev=>{ev.preventDefault();build(false);};
 dialog.querySelector('[data-service-save]').onclick=()=>build(true);
 if(livePane)schedulePreview();
 return dialog;
}
window.CRMServiceRecord={model,create,open,wrapText,addServiceRow,addRow,removeRow};
})();
