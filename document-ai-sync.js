// Document-scoped AI synchronization. No OCR calls and no writes during preview.
(function (root) {
  'use strict';
  const empty = v => v == null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v)&&v.length===0);
  const norm = v => String(v ?? '').normalize('NFKC').replace(/[’ʼ`]/g,"'").trim().replace(/\s+/g,' ').toLocaleLowerCase('uk');
  const object = v => { if(typeof v==='string'){try{v=JSON.parse(v)}catch(_){return {}}}return v && typeof v==='object' && !Array.isArray(v)?v:{}; };
  const equal = (a,b) => typeof a==='object'||typeof b==='object'?JSON.stringify(a)===JSON.stringify(b):norm(a)===norm(b);
  function flatten(value) {
    const e=object(value), out={...e}, formatConflicts=[];
    for(const section of ['personal','service'])for(const [k,v] of Object.entries(object(e[section]))){if(!empty(out[k])&&!empty(v)&&!equal(out[k],v))formatConflicts.push(k);if(empty(out[k]))out[k]=v;}
    out._sync_format_conflicts=formatConflicts;
    for(const [k,v] of Object.entries(object(e.name_cases))) {
      const key=k==='nominative'?'name_nominative':k==='gender'?'name_gender':'name_'+k;
      if(empty(out[key]))out[key]=v;
    }
    if(!Array.isArray(out.relatives))out.relatives=Array.isArray(e.family?.relatives)?e.family.relatives:[];
    return out;
  }
  function service(v){const n=norm(v);return /мобілізац/.test(n)?'За мобілізацією':/контракт/.test(n)?'За контрактом':null;}
  function date(v,partial=false){
    const text=String(v??'').trim();if(!new RegExp(partial?'^\\d{4}(?:-\\d{2}(?:-\\d{2})?)?$':'^\\d{4}-\\d{2}-\\d{2}$').test(text))return false;
    const [y,m=1,d=1]=text.split('-').map(Number), dt=new Date(Date.UTC(y,m-1,d));
    return y>=1800&&y<=new Date().getUTCFullYear()&&dt.getUTCFullYear()===y&&dt.getUTCMonth()===m-1&&dt.getUTCDate()===d;
  }
  const ranks=new Set(['солдат','старший солдат','матрос','старший матрос','молодший сержант','сержант','старший сержант','головний сержант','штаб-сержант','майстер-сержант','старший майстер-сержант','головний майстер-сержант','старшина','головний старшина','молодший лейтенант','лейтенант','старший лейтенант','капітан','майор','підполковник','полковник','бригадний генерал','генерал-майор','генерал-лейтенант','генерал']);
  function valid(key,v){
    if(empty(v))return true;if(typeof v!=='string'&&typeof v!=='number')return false;
    if(/birth_date|death_date/.test(key))return date(v,key!=='birth_date'||key.startsWith('relative.'));
    if(key==='military_specialty')return /^\d{6}[А-ЯІЇЄҐA-Z]?$/u.test(String(v).trim());
    if(key==='shpk'||key==='military_rank')return ranks.has(norm(v));
    if(key==='tariff_grade')return /^\d{1,2}$/.test(String(v))&&Number(v)>=1&&Number(v)<=99;
    if(key==='service_type')return !!service(v);
    if(key==='rnokpp')return /^\d{10}$/.test(String(v));
    if(/full_name|name_nominative|name_genitive|recruiter_name|signatory/.test(key))return /^[А-ЯІЇЄҐа-яіїєґ\s.'’ʼ-]+$/u.test(String(v))&&String(v).trim().split(/\s+/).length>=2;
    if(key==='desired_position')return !(/[A-Za-z]/.test(String(v))&&/[А-Яа-яІіЇїЄє]/.test(String(v)));
    return String(v).length<=2000;
  }
  const relation=v=>({mother:'мати','мать':'мати',father:'батько','отец':'батько',wife:'дружина','жена':'дружина',husband:'чоловік','муж':'чоловік',son:'син','сын':'син',daughter:'донька','дочка':'донька',brother:'брат',sister:'сестра'})[norm(v)]||norm(v);
  const relativeKey=r=>relation(r.relationship||r.relation)+'|'+norm(r.full_name||r.name);
  function mergeRelatives(current,incoming,add,documentId){
    const merged=structuredClone(Array.isArray(current)?current:[]);
    for(const rawValue of incoming){
      const raw=object(rawValue);
      const r={...object(raw),relationship:relation(raw.relationship||raw.relation),full_name:raw.full_name||raw.name};
      delete r.relation;delete r.name;
      if(raw.requires_review||!r.relationship||!valid('full_name',r.full_name)){add('profile','relatives',raw,'conflict','Некоректні ПІБ або спорідненість');continue;}
      let i=merged.findIndex(x=>relativeKey(x)===relativeKey(r));
      // A differently OCR-spelled parent must never silently become a second parent.
      if(i<0&&['мати','батько','дружина','чоловік'].includes(r.relationship)&&merged.some(x=>relation(x.relationship||x.relation)===r.relationship)){
        add('profile','relatives',raw,'conflict','Інші ПІБ уже записаного родича');continue;
      }
      if(i<0){i=merged.length;merged.push({relationship:r.relationship,full_name:r.full_name,source_document_id:documentId,field_sources:{relationship:documentId,full_name:documentId}});}
      const dest=merged[i];
      for(const [key,v] of Object.entries(r)){
        if(['source_document_id','relationship','full_name','requires_review'].includes(key)||empty(v))continue;
        if(!['birth_date','death_date','birth_place','citizenship','address','phone','workplace','position','notes','deceased'].includes(key))continue;
        const field='relatives.'+i+'.'+key;
        if(/_date$/.test(key)&&!date(v,true)){add('profile',field,v,'conflict','Некоректна дата',dest[key]);continue;}
        if(empty(dest[key])){add('profile',field,v,'fill','',dest[key]);dest[key]=v;dest.field_sources={...object(dest.field_sources),[key]:documentId};}
        else add('profile',field,v,equal(dest[key],v)?'leave':'conflict',equal(dest[key],v)?'':'Збережене значення родича має пріоритет',dest[key]);
      }
      if(!Array.isArray(current)||!current.some(x=>relativeKey(x)===relativeKey(r)))add('profile','relatives.'+i,r,'fill','Новий родич',null);
    }
    return merged;
  }
  function appendRecords(key,current,incoming,documentId){
    if(current!=null&&!Array.isArray(current)||!Array.isArray(incoming))return {error:'Некоректний формат збережених записів.'};
    const merged=structuredClone(current||[]),conflicts=[];
    const metadata=new Set(['source_document_id','source_pages','raw_text','source_record_index','field_sources','degree_raw','requires_review','confirmed_by_user','accepted_by_ai']);
    const identity=r=>key==='education_records'?(r.diploma_number?[r.diploma_series,r.diploma_number].map(norm).join('|'):[r.degree,r.institution,r.graduation_year].map(norm).join('|')):key==='work_events'?[r.kind,r.employer_code||r.employer,r.event_date,r.order_number].map(norm).join('|'):[r.kind,r.employer_code||r.employer,r.start_date].map(norm).join('|');
    for(const row of incoming){
      if(!row||typeof row!=='object'||Array.isArray(row)){conflicts.push('Некоректний запис залишено для звірки.');continue;}
      const old=merged.find(r=>identity(r)===identity(row));
      if(old){if(Object.keys(row).some(k=>!metadata.has(k)&&!empty(row[k])&&!equal(old[k],row[k])))conflicts.push('Запис уже є, але відомості відрізняються або доповнені. Звірте його без створення дубля.');continue;}
      if(row.source_document_id!==documentId||row.requires_review||row.confirmed_by_user===true){conflicts.push('Для нового запису потрібне перевірене джерело.');continue;}
      merged.push(structuredClone(row));
    }
    return {value:merged,conflicts};
  }
  function plan(document,candidate){
    const policy=root.CRMDocumentPolicy?.normalize(document),p=object(candidate.profile_data),e=flatten(policy?.extracted||document.ai_extracted),rows=[],selections=[];
    const type=String(policy?.type||document.ai_document_type||document.document_type||'');
    const recommendation=/рекомендац/i.test(type),birth=/свідоцтво про народження/i.test(type)&&!/дітей/i.test(type),marriage=/свідоцтво про шлюб|акт(?:овий|ового) запис.{0,25}шлюб|витяг.{0,35}шлюб/i.test(type),tax=/ідентифікаційн(?:ого|ий) код|картка платника податків|рнокпп|податков(?:а|ий) картк/i.test(type);
    const identity=/паспорт|ID[\s-]*карт/iu.test(type),military=!!root.CRMMilitary?.isDocument(type),work=!!root.CRMWork?.isDocument(type),vlk=!!root.CRMVLK?.isDocument(type);
    const registry=/Резерв\s*\+|приписн|військовий облік/iu.test(type);
    const militaryFacts=!!root.CRMMilitaryFacts?.isDocument(type);
    const ancillary=['education','residence','driver','ubd'].includes(policy?.category)||/довідка.*МВС|несудиміст/i.test(type);
    if(!recommendation&&!birth&&!marriage&&!tax&&!ancillary&&!identity&&!military&&!work&&!vlk&&!registry&&!militaryFacts)return {document,candidate,rows,selections,supported:false};
    const marriageCheck=marriage?root.CRMDocumentPolicy?.marriage(e,candidate):null;
    if(marriageCheck&&!marriageCheck.blocked){
      if(empty(e.full_name))e.full_name=marriageCheck.owner.full_name;
      if(empty(e.birth_date))e.birth_date=marriageCheck.owner.birth_date;
      e.relatives=marriageCheck.relatives;
    }
    const add=(target,key,incoming,action,reason='',current)=>{
      if(current===undefined)current=target==='candidate'?candidate[key]:p[key];
      rows.push({candidate:candidate.full_name,document:document.file_name||document.id,target,key,current:current??null,incoming:incoming??null,action,reason});
    };
    if(policy?.category==='education'&&empty(e.full_name)){
      const owners=[...new Set((Array.isArray(e.education_records)?e.education_records:[]).map(r=>r?.owner_full_name).filter(v=>!empty(v)).map(norm))];
      if(owners.length===1)e.full_name=(e.education_records||[]).find(r=>norm(r?.owner_full_name)===owners[0]).owner_full_name;
    }
    let ownerIssue='';
    const confidence=Number(document.ai_confidence);
    if(document.verification_status!=='Підтверджено'&&document.ai_confidence!=null&&(!Number.isFinite(confidence)||confidence<0.85||confidence>1))ownerIssue='Недостатня впевненість AI: потрібна перевірка рекрутера';
    if(!empty(e.rnokpp)&&!empty(candidate.rnokpp)&&String(e.rnokpp)!==String(candidate.rnokpp))ownerIssue='РНОКПП іншої особи';
    if(!empty(e.birth_date)&&!empty(candidate.birth_date)&&String(e.birth_date)!==String(candidate.birth_date))ownerIssue='Дата народження іншої особи';
    const strongMatch=valid('rnokpp',e.rnokpp)&&!empty(e.rnokpp)&&String(e.rnokpp)===String(candidate.rnokpp);
    if(!ownerIssue&&!empty(e.full_name)&&!equal(e.full_name,candidate.full_name)&&!root.CRMNameHistory?.matches(e.full_name,candidate)&&!strongMatch)ownerIssue='ПІБ не збігається: звірте власника документа';
    if(!strongMatch&&empty(e.full_name))ownerIssue='Не визначено власника документа';
    const warnings=[...(Array.isArray(document.ai_warnings)?document.ai_warnings:[]),...(Array.isArray(e.meta?.warnings)?e.meta.warnings:[])].filter(w=>!String(w).startsWith('[CRM AI sync]')).join(' ');
    if(/інш(?:а|ої|у|ого|ий|е).{0,60}(особ|кандидат|ПІБ)|згаду.{0,80}(особ|ПІБ)|different (?:person|candidate|name)|another (?:person|candidate)/i.test(warnings))ownerIssue='У документі згадано іншу особу: потрібна ручна перевірка';
    if(document.deleted_at)ownerIssue='Документ видалено';
    if(document.verification_status!=='Підтверджено'&&/AI REVIEW REQUIRED/.test(document.notes||''))ownerIssue='AI просить перевірити документ перед перенесенням';
    if(marriageCheck?.blocked)ownerIssue=marriageCheck.issue;
    if(identity&&/ID[\s-]*карт/iu.test(type)){
      const check=root.CRMIDValidation?.review({document_type:'ID',extracted:e,candidate_name:document.ai_candidate_name,confidence:document.ai_confidence},candidate);
      if(!check||check.blocked)ownerIssue='ID-картка потребує перевірки реквізитів';
    }
    if(military&&root.CRMMilitary.review(e,candidate,p,document.id).blocked)ownerIssue='Потрібна перевірка власника військового документа';
    if(vlk&&root.CRMVLK.review(e,candidate).issues?.length)ownerIssue='Потрібна перевірка власника ВЛК';
    const propose=(target,key,value)=>{
      const current=target==='candidate'?candidate[key]:p[key];
      const legacy=p.form_data?.[key]??(key==='military_specialty'?p[key]:null);
      const protectedValue=!empty(current)?current:legacy;
      let action='leave',reason='',structured=false;
      if(birth&&key==='full_name'&&!ownerIssue&&!empty(value)&&root.CRMNameHistory?.matches(value,candidate)&&!equal(value,candidate.full_name)){add(target,key,value,'leave','ПІБ при народженні підтверджене історією зміни; чинне ПІБ збережено',current);return;}
      if(!empty(value)){
        if(e.field_evidence?.[key]?.requires_review||e.meta?.field_evidence?.[key]?.requires_review||['low','unreadable'].includes(e.field_evidence?.[key]?.legibility||e.meta?.field_evidence?.[key]?.legibility)){action='conflict';reason='AI позначив поле як нерозбірливе';}
        else if(e._sync_format_conflicts.includes(key)){action='conflict';reason='Плоске і вкладене значення AI не збігаються';}
        else if(!(['driver_license','ubd_certificate','registration_records','marriage_record','education_records','work_records','work_events'].includes(key)?typeof value==='object'&&!empty(value):valid(key,value))){action='conflict';reason='Некоректне OCR-значення'+(ownerIssue?'; '+ownerIssue:'');}
        else if(ownerIssue){action='conflict';reason=ownerIssue;}
        else if(target==='profile'&&['education_records','work_records','work_events'].includes(key)&&empty(legacy)){
          if(key!=='education_records'&&Array.isArray(value))value=value.filter(row=>{
            if((Array.isArray(current)?current:[]).some(old=>equal(old,row)))return true;
            const kind=row?.kind,employment=key==='work_events'?['hire','dismissal','transfer'].includes(kind):kind==='employment',military=key==='work_events'?['service_start','service_end'].includes(kind):kind==='military_service';
            const noWork=candidate.worked_before??p.worked_before,noService=candidate.served_before??p.served_before;
            const issue=employment&&(noWork===false||noWork==='false')?'У картці вказано «Не працював». Звірте суперечність із документом.':military&&(noService===false||noService==='false')?'У картці вказано «Не служив». Звірте суперечність із документом.':'';
            if(issue)add(target,key,row,'conflict',issue,current);
            return !issue;
          });
          const merged=document.verification_status!=='Підтверджено'&&(!Number.isFinite(Number(document.ai_confidence))||Number(document.ai_confidence)<0.85||Number(document.ai_confidence)>1)?{error:'Потрібна звірка впевненості розпізнавання.'}:appendRecords(key,current,value,document.id);
          if(merged.error){action='conflict';reason=merged.error;}
          else{for(const issue of merged.conflicts)add(target,key,null,'conflict',issue,current);value=merged.value;structured=true;action=equal(current||[],value)?'leave':'fill';}
        }
        else if(!empty(protectedValue)){action=equal(key==='service_type'?service(protectedValue):protectedValue,value)?'leave':'conflict';reason=action==='conflict'?'Збережене значення має пріоритет':'';}
        else action='fill';
      }
      add(target,key,value,action,reason,protectedValue);
      if(action==='fill')selections.push({target,key,incoming:value,expected_current:current??null,fill_only:structured||!(Array.isArray(current)&&current.length===0),...(structured?{merge_records:true,structured_records:true}:{}),expected_ai:document.ai_extracted});
    };
    for(const key of ['full_name','name_nominative','name_genitive','birth_date','birth_place','rnokpp','phone','sex','military_rank','civilian_profession','desired_position','tcc','military_specialty']){
      if(birth&&!['full_name','birth_date','birth_place'].includes(key))continue;
      if(tax&&!['full_name','birth_date','rnokpp'].includes(key))continue;
      if(marriage&&!['full_name','birth_date','rnokpp'].includes(key))continue;
      if(ancillary||(militaryFacts&&!military&&!registry))continue;
      let v=e[key];if(key==='phone'&&!empty(v)&&root.CRMPhone)v=root.CRMPhone.normalize(v);
      propose('candidate',key,v);
    }
    if(recommendation){
      for(const key of ['shpk','tariff_grade','recruiter_name','military_unit','desired_unit','recommender_unit','signatory','service_type'])propose('profile',key,key==='service_type'&&!empty(e[key])?service(e[key])||e[key]:e[key]);
    }
    if(identity){
      const check=/ID[\s-]*карт/iu.test(type)?root.CRMIDValidation?.review({document_type:'ID',extracted:e,candidate_name:document.ai_candidate_name,confidence:document.ai_confidence},candidate):null;
      if(check?.blocked)ownerIssue='ID-картка потребує перевірки реквізитів';
      for(const key of ['passport_number','passport_series','passport_issuer','passport_issue_date','passport_expiry_date','citizenship','unzr'])propose('profile',key,e[key]);
      propose('profile','identity_document_type',/ID[\s-]*карт/iu.test(type)?'ID':'passport');
    }
    if(military){
      const checked=root.CRMMilitary.review(e,candidate,p,document.id);
      if(checked.blocked)ownerIssue=checked.issues?.join('; ')||'Потрібна перевірка військового документа';
      for(const [key,value] of Object.entries(checked.fields||{}))propose('profile',key,value);
      if(checked.accepted)propose('profile','work_records',checked.records);
      for(const issue of checked.issues||[])add('profile','military_service_records',null,'conflict',issue);
    }
    if(registry){
      for(const key of ['military_document_number','military_document_type','military_registration_date','military_registration_category','military_registration_status','military_registry_number','military_document_expiry_date','military_data_updated_at','military_deferment_type','military_deferment_until','military_registration_removal_reason','military_training_status'])propose('profile',key,e[key]);
    }
    if(militaryFacts){
      const facts=root.CRMMilitaryFacts.review(e,p,document);
      for(const row of facts.conflicts)add('profile',row.key,row.incoming,'conflict',row.reason,p[row.key]);
      for(const row of facts.proposals){
        const noService=(candidate.served_before??p.served_before);
        const issue=ownerIssue||(e._sync_format_conflicts.includes(row.key)?'Плоске і вкладене значення AI не збігаються':'')||((noService===false||noService==='false')&&['military_oath','military_discharge','combat_records'].includes(row.key)?'У картці підтверджено відсутність служби. Звірте суперечність із документом.':'')||(!empty(p.form_data?.[row.key])?'Раніше заповнені відомості мають пріоритет':'');
        if(issue){add('profile',row.key,row.incoming,'conflict',issue,p[row.key]);continue;}
        add('profile',row.key,row.incoming,'fill','',p[row.key]);
        selections.push({target:'profile',key:row.key,incoming:row.incoming,expected_current:row.current,expected_ai:document.ai_extracted,fill_only:true,merge_records:row.merge_records,structured_military:true});
      }
    }else if(military||registry){
      for(const key of ['military_rank_records','military_oath','military_discharge','combat_records','awards','reserve_training_records'])if(!empty(e[key]))add('profile',key,null,'conflict','Модуль перевірки військових відомостей недоступний.',p[key]);
    }
    if(militaryFacts&&!military&&Array.isArray(e.military_service_records)&&e.military_service_records.length){
      const checked=root.CRMMilitary?.review(e,candidate,p,document.id);
      if(!checked||checked.blocked)add('profile','work_records',null,'conflict','Періоди служби з наказу потребують звірки власника документа.');
      else{if(checked.accepted)propose('profile','work_records',checked.records);for(const issue of checked.issues||[])add('profile','work_records',null,'conflict',issue);}
    }
    if(work){
      const checked=root.CRMWork.review(e,candidate,p,document.id);
      if(checked.accepted){propose('profile','work_records',checked.records);propose('profile','work_events',checked.events);}
      for(const issue of checked.issues||[])add('profile','work_records',null,'conflict',issue);
    }
    if(vlk){
      const checked=root.CRMVLK.review(e,candidate);
      if(checked.issues?.length)ownerIssue=checked.issues.join('; ');
      for(const [key,value] of Object.entries(checked.fields||{}))propose('profile',key,value);
    }
    if(policy?.category==='education'&&root.CRMEducation){
      const checked=root.CRMEducation.review({...e,source_verified:document.verification_status==='Підтверджено',education_records:(e.education_records||[]).map(r=>({...r,source_document_id:document.id}))},candidate,p);
      if(checked.accepted)propose('profile','education_records',checked.records);
      for(const issue of checked.issues||[])add('profile','education_records',null,'conflict',issue);
    }
    if(birth)propose('profile','birth_certificate',e.document_number||e.birth_certificate);
    if(marriage&&e.relatives.some(r=>['дружина','чоловік'].includes(relation(r.relationship||r.relation))))propose('candidate','marital_status',candidate.sex==='female'?'Одружена':'Одружений');
    if(marriage&&!marriageCheck?.blocked&&e.marriage_record)propose('profile','marriage_record',{...e.marriage_record,source_document_id:document.id});
    if(ancillary){
      if(policy?.category==='education'){
        const records=(Array.isArray(e.education_records)?e.education_records:[]).filter(r=>!r.requires_review&&equal(r.owner_full_name,e.full_name)&&(!r.owner_birth_date||!candidate.birth_date||r.owner_birth_date===candidate.birth_date));
        const qualification=records.map(r=>r.qualification).find(v=>!empty(v));
        if(qualification)propose('candidate','civilian_profession',/^техніка-електрика$/i.test(qualification)?'Технік-електрик':qualification);
      }
      if(policy?.category==='driver'&&e.driver_license_number)propose('profile','driver_license',{number:e.driver_license_number,issue_date:e.driver_license_issue_date||null,expiry_date:e.driver_license_expiry_date||null,categories:e.driver_license_categories||null,source_document_id:document.id});
      if(policy?.category==='ubd'&&e.document_number)propose('profile','ubd_certificate',{series:e.document_series||null,number:e.document_number,issue_date:e.document_date||null,source_document_id:document.id});
      if(policy?.category==='residence'){
        const residence=root.CRMResidence?.review(e,candidate,p);
        if(residence?.address)propose('profile','registration_records',(e.registration_records||[]).map(r=>({...r,source_document_id:document.id})));
      }
      if(/довідка.*МВС|несудиміст/i.test(type)&&e.criminal_record_details)propose('profile','criminal_record_details',e.criminal_record_details);
    }
    if(e.relatives.length){
      if(ownerIssue)add('profile','relatives',e.relatives,'conflict',ownerIssue);
      else{
        const merged=mergeRelatives(p.relatives,e.relatives,add,document.id);
        if(!equal(p.relatives||[],merged))selections.push({target:'profile',key:'relatives',incoming:merged,expected_current:p.relatives??null,fill_only:true,merge_relatives:true,relative_sources:true,expected_ai:document.ai_extracted});
      }
    }
    return {document,candidate,rows,selections,supported:true};
  }
  async function preview(client,id){
    const dr=await client.from('documents').select('*').eq('id',id).single();if(dr.error)throw dr.error;
    const cr=await client.from('candidates').select('*').eq('id',dr.data.candidate_id).single();if(cr.error)throw cr.error;
    return plan(dr.data,cr.data);
  }
  async function apply(client,report){
    const conflicts=report.rows.filter(r=>r.action==='conflict').map(r=>({target:'sync_conflict',key:r.key,incoming:JSON.stringify({field:r.key,current:r.current,ai:r.incoming,reason:r.reason}),expected_ai:report.document.ai_extracted}));
    const selections=[...report.selections,...conflicts];if(!selections.length)return report;
    // An old RPC must reject the request before it can ignore compare-and-set metadata.
    selections.unshift({target:'sync_guard',key:'version',incoming:report.selections.some(s=>s.structured_records||s.relative_sources)?'3':report.selections.some(s=>s.structured_military)?'2':'1',expected_ai:report.document.ai_extracted});
    const result=await client.rpc('crm_apply_document_fields',{document_id:report.document.id,selections});if(result.error)throw result.error;
    const after=await preview(client,report.document.id);
    for(const row of report.rows.filter(r=>r.action==='fill'&&!r.key.startsWith('relatives.'))){
      if(after.rows.some(r=>r.key===row.key&&r.target===row.target&&r.action==='fill'))throw new Error('Сервер не зберіг поле '+row.key);
    }
    return after;
  }
  async function sync(client,id){return apply(client,await preview(client,id));}
  async function automate(client,id){
    const before=await preview(client,id);let report=before,error=null;
    try{if(before.supported)report=await apply(client,before);}catch(e){error=e;}
    const reasons=[];
    if(!before.supported)reasons.push('Для цього типу документа потрібна звірка рекрутера: автоматичне перенесення ще не підтримується.');
    if(error)reasons.push('Дані не перенесено: '+error.message);
    if(report.rows.some(r=>r.action==='conflict'))reasons.push('Є розбіжності або нерозбірливі дані. Збережені значення залишено без змін.');
    if(report.document.verification_status!=='Підтверджено'&&/AI REVIEW REQUIRED/.test(report.document.notes||''))reasons.push('AI просить перевірити документ перед перенесенням.');
    const needsRecruiter=reasons.length>0;
    if(needsRecruiter){
      const dr=await client.from('documents').select('*').eq('id',id).single();if(dr.error)throw dr.error;
      if(JSON.stringify(dr.data.ai_extracted)!==JSON.stringify(before.document.ai_extracted))throw new Error('Результат AI змінився. Оновіть перевірку.');
      const warnings=[...new Set([...(Array.isArray(dr.data.ai_warnings)?dr.data.ai_warnings:[]),...reasons.map(r=>'[Рекрутер] '+r)])];
      let query=client.from('documents').update({verification_status:'Потребує перевірки',ai_warnings:warnings}).eq('id',id);
      if(dr.data.updated_at)query=query.eq('updated_at',dr.data.updated_at);
      const result=await query.select('id');if(result.error)throw result.error;if(Array.isArray(result.data)&&!result.data.length)throw new Error('Документ змінився. Оновіть перевірку.');
    }
    return {...report,needsRecruiter,reasons,autoFilled:!error?before.rows.filter(r=>r.action==='fill').length:0};
  }
  async function showPreview(client,id){
    const report=await preview(client,id),dialog=document.createElement('dialog');dialog.className='crm-ai-container';
    const esc=v=>String(typeof v==='object'?JSON.stringify(v):v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const labels={fill:'Заповнити',leave:'Залишити',conflict:'Конфлікт'};
    dialog.innerHTML='<h3>Перевірка синхронізації</h3><p>'+esc(report.candidate.full_name)+' · '+esc(report.document.file_name)+'</p>'+((root.CRMNameHistory?.chain(report.candidate).links||[]).length?'<p>Підтверджена послідовність ПІБ: '+esc(root.CRMNameHistory.chain(report.candidate).links.map(r=>r.previous_full_name+' → '+r.new_full_name).join('; '))+'</p>':'')+'<div style="overflow:auto;max-height:60vh"><table><thead><tr><th>Поле</th><th>У CRM</th><th>AI</th><th>Дія</th></tr></thead><tbody>'+report.rows.map(r=>'<tr><td>'+esc(r.target+'.'+r.key)+'</td><td>'+esc(r.current)+'</td><td>'+esc(r.incoming)+'</td><td>'+labels[r.action]+'<br>'+esc(r.reason)+'</td></tr>').join('')+'</tbody></table></div><p role="status">Конфлікти залишаються без змін.</p><button type="button" data-apply>Заповнити лише порожні поля ('+report.selections.length+')</button> <button type="button" data-close>Закрити</button>';
    document.body.append(dialog);dialog.showModal();const close=()=>{dialog.close();dialog.remove();};dialog.querySelector('[data-close]').onclick=close;dialog.addEventListener('cancel',ev=>{ev.preventDefault();if(!dialog.dataset.busy)close();});
    dialog.querySelector('[data-apply]').disabled=!report.selections.length;
    dialog.querySelector('[data-apply]').onclick=async()=>{
      dialog.dataset.busy='1';dialog.querySelectorAll('button').forEach(b=>b.disabled=true);
      try{await apply(client,report);dialog.querySelector('[role=status]').textContent='Поля збережено. Конфлікти записано у попередження документа.';}
      catch(err){dialog.querySelector('[role=status]').textContent='Зміни не застосовано: '+err.message+' Оновіть перегляд.';}
      finally{delete dialog.dataset.busy;dialog.querySelector('[data-close]').disabled=false;}
    };
    return report;
  }
  const api={flatten,plan,preview,apply,sync,automate,showPreview,mergeRelatives,appendRecords,valid,relation};
  root.CRMDocumentSync=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
