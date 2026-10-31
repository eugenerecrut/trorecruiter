// Document-scoped AI synchronization. No OCR calls and no writes during preview.
(function (root) {
  'use strict';
  const empty = v => v == null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v)&&v.length===0);
  const norm = v => String(v ?? '').normalize('NFKC').replace(/[’ʼ`]/g,"'").trim().replace(/\s+/g,' ').toLocaleLowerCase('uk');
  const object = v => { if(typeof v==='string'){try{v=JSON.parse(v)}catch(_){return {}}}return v && typeof v==='object' && !Array.isArray(v)?v:{}; };
  // Object property order is not a difference in document facts. Array order stays significant.
  const stable = v => JSON.stringify(v,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(k=>[k,value[k]])):value);
  const equal = (a,b) => typeof a==='object'||typeof b==='object'?stable(a)===stable(b):norm(a)===norm(b);
  function flatten(value) {
    const e=object(value), out={...e}, formatConflicts=[];
    for(const section of ['personal','service'])for(const [k,v] of Object.entries(object(e[section]))){if(!empty(out[k])&&!empty(v)&&!equal(comparable(k,out[k]),comparable(k,v)))formatConflicts.push(k);if(empty(out[k]))out[k]=v;}
    out._sync_format_conflicts=formatConflicts;
    for(const [k,v] of Object.entries(object(e.name_cases))) {
      const key=k==='nominative'?'name_nominative':k==='gender'?'name_gender':'name_'+k;
      if(empty(out[key]))out[key]=v;
    }
    if(!Array.isArray(out.relatives))out.relatives=Array.isArray(e.family?.relatives)?e.family.relatives:[];
    return out;
  }
  function service(v){const n=norm(v);return /мобілізац/.test(n)?'За мобілізацією':/контракт/.test(n)?'За контрактом':null;}
  function normalizeSex(value){
    if(typeof value!=='string')return null;
    const maleAliases=new Set(['male','m','м','ч','чол','чоловіча','чоловічий']);
    const femaleAliases=new Set(['female','f','ж','жін','жіноча','жіночий']);
    value=norm(value);
    return maleAliases.has(value)?'male':femaleAliases.has(value)?'female':null;
  }
  function comparable(key,value){return key==='sex'?(normalizeSex(value)??value):value;}
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
    if(key==='sex')return !!normalizeSex(v);
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
      if(raw.requires_review||!r.relationship||!valid('full_name',String(r.full_name||'').replace(/[()]/g,' '))){add('profile','relatives',raw,'conflict','Некоректні ПІБ або спорідненість');continue;}
      let i=merged.findIndex(x=>relativeKey(x)===relativeKey(r));
      if(i<0&&['мати','дружина'].includes(r.relationship)){
        const names=root.CRMParentNames||(typeof module!=='undefined'&&module.exports?require('./parent-names.js'):null);
        const matches=merged.map((x,index)=>({x,index})).filter(({x})=>relation(x.relationship||x.relation)===r.relationship&&names?.maidenNameMatch?.([x.full_name||x.name,r.full_name]));
        if(matches.length>1){add('profile','relatives',r,'conflict','Кілька записів родича відповідають ПІБ; дівоче прізвище не усуває неоднозначність');continue;}
        if(matches.length===1){const match=matches[0];
          if(!empty(match.x.birth_date)&&!empty(r.birth_date)&&!equal(match.x.birth_date,r.birth_date)){add('profile','relatives',r,'conflict','Дати народження родича відрізняються');continue;}
          i=match.index;add('profile','relatives.'+i+'.full_name',r.full_name,'leave','Дівоче прізвище в дужках; повне ПІБ збігається, збережене ПІБ залишено',match.x.full_name||match.x.name);
        }
      }
      if(i<0){const matches=merged.map((x,index)=>({x,index})).filter(({x})=>relation(x.relationship||x.relation)===r.relationship&&norm(r.full_name).startsWith(norm(x.full_name||x.name)+' '));
        if(matches.length===1){const {x,index}=matches[0],manual=x.confirmed_by_user||x.manually_confirmed||x.field_confirmations?.full_name||x.field_sources?.full_name===null;
          const dates=x.birth_date&&r.birth_date&&String(x.birth_date)!==String(r.birth_date),sameSource=x.source_document_id===documentId||x.field_sources?.full_name===documentId;
          if(!manual&&!dates&&(sameSource||x.birth_date&&r.birth_date&&String(x.birth_date)===String(r.birth_date)))add('profile','relatives.'+index+'.full_name',r.full_name,'conflict','Документ містить повніше ПІБ цього родича. Можна доповнити після підтвердження.',x.full_name);
          else add('profile','relatives',r,'conflict',manual?'ПІБ родича підтверджено вручну; автоматичне доповнення заборонено':'Неоднозначне доповнення ПІБ родича: звірте дату та джерело');
          continue;
        }
      }
      // A differently OCR-spelled parent must never silently become a second parent.
      if(i<0&&['мати','батько','дружина','чоловік'].includes(r.relationship)&&merged.some(x=>relation(x.relationship||x.relation)===r.relationship)){
        add('profile','relatives',raw,'conflict','Інші ПІБ уже записаного родича');continue;
      }
      const added=i<0;
      if(added){i=merged.length;merged.push({relationship:r.relationship,full_name:r.full_name,source_document_id:documentId,field_sources:{relationship:documentId,full_name:documentId}});}
      const dest=merged[i];
      for(const [key,v] of Object.entries(r)){
        if(['source_document_id','relationship','full_name','requires_review'].includes(key)||empty(v))continue;
        if(!['birth_date','death_date','birth_place','citizenship','address','phone','workplace','position','notes','deceased'].includes(key))continue;
        const field='relatives.'+i+'.'+key;
        if(/_date$/.test(key)&&!date(v,true)){add('profile',field,v,'conflict','Некоректна дата',dest[key]);continue;}
        if(empty(dest[key])){add('profile',field,v,'fill','',dest[key]);dest[key]=v;dest.field_sources={...object(dest.field_sources),[key]:documentId};}
        else {const same=key==='phone'&&root.CRMPhone?equal(root.CRMPhone.normalize(dest[key]),root.CRMPhone.normalize(v)):equal(dest[key],v);add('profile',field,v,same?'leave':'conflict',same?'':'Збережене значення родича має пріоритет',dest[key]);}
      }
      if(added)add('profile','relatives.'+i,r,'fill','Новий родич',null);
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
      const sameOrganisation=r=>{
        if(r.employer_code&&row.employer_code&&norm(r.employer_code)===norm(row.employer_code))return true;
        if(!empty(r.employer)&&norm(r.employer)===norm(row.employer))return true;
        if(!['military_service','service_start','service_end'].includes(row.kind))return false;
        const unit=x=>String(x.unit||x.employer||'').toUpperCase().match(/[АA]\s*\d{4}/u)?.[0].replace(/A/g,'А').replace(/\s/g,'');
        return !!unit(r)&&unit(r)===unit(row);
      };
      const old=merged.find(r=>identity(r)===identity(row)||(key!=='education_records'&&r.kind===row.kind&&equal(key==='work_events'?r.event_date:r.start_date,key==='work_events'?row.event_date:row.start_date)&&sameOrganisation(r)));
      if(old){if(Object.keys(row).some(k=>!metadata.has(k)&&!empty(row[k])&&!equal(old[k],row[k])))conflicts.push('Запис уже є, але відомості відрізняються або доповнені. Звірте його без створення дубля.');continue;}
      if(row.source_document_id!==documentId||row.requires_review||row.confirmed_by_user===true){conflicts.push('Для нового запису потрібне перевірене джерело.');continue;}
      merged.push(structuredClone(row));
    }
    return {value:merged,conflicts};
  }
  function plan(document,candidate){
    const policy=root.CRMDocumentPolicy?.normalize(document),p=object(candidate.profile_data),e=flatten(policy?.extracted||document.ai_extracted),rows=[],selections=[];
    if(['AI обробка','AI помилка'].includes(document.processing_status))return {document,candidate,rows,selections,supported:false,blockedReason:'Розпізнавання не завершено; старі дані AI не переносяться.'};
    if(document.candidate_id&&candidate.id&&document.candidate_id!==candidate.id||p.merged_into||p.workflow?.archived_at)return {document,candidate,rows:[],selections:[],supported:false};
    const childBirth=root.CRMDocumentPolicy?.isChildBirth?.(document)??[document.document_type,document.ai_document_type,document.requirement_type].some(t=>/народження.*(?:дитин|дітей)/iu.test(String(t||'')));
    if(childBirth)return {document,candidate,rows,selections,supported:false,blockedReason:'Це свідоцтво дитини: особисті дані кандидата з нього не переносяться.'};
    const type=String(policy?.type||document.ai_document_type||document.document_type||'');
    const recommendation=/рекомендац/i.test(type),birth=/(?:свідоцтво|акт(?:овий|ового) запис|витяг).{0,35}народження/iu.test(type)&&!/дитин|дітей/iu.test(type),marriage=/свідоцтво про шлюб|акт(?:овий|ового) запис.{0,25}шлюб|витяг.{0,35}шлюб/i.test(type),tax=/ідентифікаційн(?:ого|ий) код|картка платника податків|рнокпп|податков(?:а|ий) картк/i.test(type);
    const identity=/паспорт|ID[\s-]*карт/iu.test(type),military=!!root.CRMMilitary?.isDocument(type),work=!!root.CRMWork?.isDocument(type),vlk=!!root.CRMVLK?.isDocument(type);
    const registry=/Резерв\s*\+|приписн|військовий облік/iu.test(type)||/^(?:копія\s+)?посвідчення\s+про\s+приписку\s+до\s+призовної\s+дільниці$/iu.test(String(type||'').trim());
    const militaryFacts=!!root.CRMMilitaryFacts?.isDocument(type);
    const biography=/автобіограф/iu.test(type);
    const ancillary=['education','residence','driver','ubd'].includes(policy?.category)||/довідка.*МВС|несудиміст/i.test(type);
    if(!recommendation&&!birth&&!marriage&&!tax&&!ancillary&&!identity&&!military&&!work&&!vlk&&!registry&&!militaryFacts&&!biography)return {document,candidate,rows,selections,supported:false};
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
    const educationOwnerMatch=policy?.category==='education'&&document.verification_status==='Підтверджено'&&
      (e.education_records||[]).length>0&&(e.education_records||[]).every(r=>!r.requires_review&&equal(r.owner_full_name,e.full_name)&&root.CRMEducation?.ownerMatches(r,candidate,p.education_records||[],true));
    let ownerIssue='';
    const confidence=Number(document.ai_confidence);
    if(document.verification_status!=='Підтверджено'&&document.ai_confidence!=null&&(!Number.isFinite(confidence)||confidence<0.85||confidence>1))ownerIssue='Недостатня впевненість AI: потрібна перевірка рекрутера';
    if(!empty(e.rnokpp)&&!empty(candidate.rnokpp)&&String(e.rnokpp)!==String(candidate.rnokpp))ownerIssue='РНОКПП іншої особи';
    if(!empty(e.birth_date)&&!empty(candidate.birth_date)&&String(e.birth_date)!==String(candidate.birth_date))ownerIssue='Дата народження іншої особи';
    const strongMatch=valid('rnokpp',e.rnokpp)&&!empty(e.rnokpp)&&String(e.rnokpp)===String(candidate.rnokpp);
    if(!ownerIssue&&!empty(e.full_name)&&!equal(e.full_name,candidate.full_name)&&!root.CRMNameHistory?.matches(e.full_name,candidate)&&!strongMatch&&!educationOwnerMatch)ownerIssue='ПІБ не збігається: звірте власника документа';
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
      if(key==='full_name'&&educationOwnerMatch&&!ownerIssue&&!equal(value,candidate.full_name)){add(target,key,value,'leave','Диплом містить ім’я та прізвище; повне ПІБ картки збережено',current);return;}
      if(birth&&key==='full_name'&&!ownerIssue&&!empty(value)&&root.CRMNameHistory?.matches(value,candidate)&&!equal(value,candidate.full_name)){add(target,key,value,'leave','ПІБ при народженні підтверджене історією зміни; чинне ПІБ збережено',current);return;}
      if(!empty(value)){
        if(e.field_evidence?.[key]?.requires_review||e.meta?.field_evidence?.[key]?.requires_review||['low','unreadable'].includes(e.field_evidence?.[key]?.legibility||e.meta?.field_evidence?.[key]?.legibility)){action='conflict';reason='AI позначив поле як нерозбірливе';}
        else if(e._sync_format_conflicts.includes(key)){action='conflict';reason='Плоске і вкладене значення AI не збігаються';}
        else if(!(['driver_license','ubd_certificate','registration_records','marriage_record','education_records','work_records','work_events'].includes(key)?typeof value==='object'&&!empty(value):valid(key,value))){action='conflict';reason='Некоректне OCR-значення'+(ownerIssue?'; '+ownerIssue:'');}
        else if(!empty(protectedValue)&&typeof value!=='object'&&equal(key==='service_type'?service(protectedValue):comparable(key,protectedValue),value)){action='leave';reason=ownerIssue?'Значення збігається з карткою; документ потребує перевірки':'';}
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
        else if(recommendation&&target==='candidate'&&['phone','military_rank'].includes(key)){action='conflict';reason=key==='phone'?'Номер у рекомендаційному листі може належати контактній особі. Потрібно підтвердити телефон кандидата.':'Чинне військове звання потрібно підтвердити військово-обліковим документом. ШПК у рекомендаційному листі не є підтвердженням звання.';}
        else action='fill';
      }
      add(target,key,value,action,reason,action==='fill'?(current??null):protectedValue);
      if(action==='fill')selections.push({target,key,incoming:value,expected_current:current??null,fill_only:structured||!(Array.isArray(current)&&current.length===0),...(structured?{merge_records:true,structured_records:true}:{}),expected_ai:document.ai_extracted});
    };
    for(const key of ['full_name','name_nominative','name_genitive','birth_date','birth_place','rnokpp','phone','sex','military_rank','civilian_profession','desired_position','tcc','military_specialty']){
      if(biography)continue;
      if(birth&&!['full_name','birth_date','birth_place'].includes(key))continue;
      if(tax&&!['full_name','birth_date','rnokpp'].includes(key))continue;
      if(marriage&&!['full_name','birth_date','rnokpp'].includes(key))continue;
      if(ancillary||(militaryFacts&&!military&&!registry))continue;
      let v=comparable(key,e[key]);if(key==='phone'&&!empty(v)&&root.CRMPhone)v=root.CRMPhone.normalize(v);
      propose('candidate',key,v);
    }
    if(recommendation){
      if(empty(e.unit_phone) && !empty(e.recruiter_phone)) e.unit_phone = e.recruiter_phone;
      if(empty(e.recruiter_phone) && !empty(e.unit_phone)) e.recruiter_phone = e.unit_phone;
      for(const key of ['shpk','tariff_grade','recruiter_name','recruiter_phone','unit_phone','military_unit','desired_unit','recommender_unit','signatory','service_type']){
        let val = e[key];
        if(['recruiter_phone','unit_phone'].includes(key) && !empty(val) && root.CRMPhone) val = root.CRMPhone.normalize(val);
        propose('profile',key,key==='service_type'&&!empty(val)?service(val)||val:val);
      }
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
    return {document,candidate,rows,selections,supported:true,ownerBlocked:!!ownerIssue};
  }
  async function preview(client,id){
    const dr=await client.from('documents').select('*').eq('id',id).single();if(dr.error)throw dr.error;
    const cr=await client.from('candidates').select('*').eq('id',dr.data.candidate_id).single();if(cr.error)throw cr.error;
    const report=plan(dr.data,cr.data);
    if(root.CRMDocumentCrosscheck)root.CRMDocumentCrosscheck.guard(report,await root.CRMDocumentCrosscheck.load(client,cr.data));
    return report;
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
  async function automate(client,id,options={}){
    const before=await preview(client,id);let report=before,error=null;
    if(Object.prototype.hasOwnProperty.call(options,'expectedRevision')&&before.document.ai_processed_at!==options.expectedRevision)return {...before,superseded:true,needsRecruiter:false,reasons:[],autoFilled:0};
    if(before.blockedReason)return {...before,needsRecruiter:true,reasons:[before.blockedReason],autoFilled:0};
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
      if(typeof options.markReview==='function'){
        await options.markReview(dr.data,warnings);
      }else{
      let query=client.from('documents').update({verification_status:'Потребує перевірки',ai_warnings:warnings}).eq('id',id);
      if(dr.data.updated_at)query=query.eq('updated_at',dr.data.updated_at);
      for(const field of ['ai_processed_at','verification_status','verified_at','candidate_id','storage_path','deleted_at'])if(dr.data[field]!==undefined)query=dr.data[field]===null?query.is(field,null):query.eq(field,dr.data[field]);
      const result=await query.select('id');if(result.error)throw result.error;if(Array.isArray(result.data)&&!result.data.length)throw new Error('Документ змінився. Оновіть перевірку.');
      }
    }
    return {...report,needsRecruiter,reasons,autoFilled:!error?before.rows.filter(r=>r.action==='fill').length:0};
  }
  async function showPreview(client,id){
    const report=await preview(client,id),dialog=document.createElement('dialog');dialog.className='crm-ai-container';
    const esc=v=>String(typeof v==='object'?JSON.stringify(v):v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const labels={fill:'Заповнити',leave:'Залишити',conflict:'Конфлікт'};
    dialog.innerHTML='<h3>Порівняння з документом</h3><p>'+esc(report.candidate.full_name)+' · '+esc(report.document.file_name)+'</p>'+((root.CRMNameHistory?.chain(report.candidate).links||[]).length?'<p>Підтверджена послідовність ПІБ: '+esc(root.CRMNameHistory.chain(report.candidate).links.map(r=>r.previous_full_name+' → '+r.new_full_name).join('; '))+'</p>':'')+'<div style="overflow:auto;max-height:60vh"><table><thead><tr><th>Поле</th><th>У CRM</th><th>AI</th><th>Дія</th></tr></thead><tbody>'+report.rows.map(r=>'<tr><td>'+esc(root.CRMCaseAssistant?.label(r.key)||r.key)+'</td><td>'+esc(r.current)+'</td><td>'+esc(r.incoming)+'</td><td>'+labels[r.action]+'<br>'+esc(r.reason)+'</td></tr>').join('')+'</tbody></table></div><p role="status">Відмінні значення не замінюються автоматично. Щоб залишити дані картки й закрити питання, скористайтеся дією біля поля у списку питань.</p><button type="button" data-apply>Заповнити лише порожні поля ('+report.selections.length+')</button> <button type="button" data-close>Закрити</button>';
    document.body.append(dialog);dialog.showModal();const close=()=>{dialog.close();dialog.remove();};dialog.querySelector('[data-close]').onclick=close;dialog.addEventListener('cancel',ev=>{ev.preventDefault();if(!dialog.dataset.busy)close();});
    dialog.querySelector('[data-apply]').disabled=!report.selections.length;
    dialog.querySelector('[data-apply]').onclick=async()=>{
      dialog.dataset.busy='1';dialog.querySelectorAll('button').forEach(b=>b.disabled=true);
      try{await apply(client,report);const rs1 = dialog.querySelector('[role=status]'); if (rs1) rs1.textContent='Поля збережено. Конфлікти записано у попередження документа.';}
      catch(err){const rs2 = dialog.querySelector('[role=status]'); if (rs2) rs2.textContent='Зміни не застосовано: '+err.message+' Оновіть перегляд.';}
      finally{delete dialog.dataset.busy;dialog.querySelector('[data-close]').disabled=false;}
    };
    return report;
  }
  const api={flatten,plan,preview,apply,sync,automate,showPreview,mergeRelatives,appendRecords,valid,relation};
  root.CRMDocumentSync=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
