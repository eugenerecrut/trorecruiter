(function(){
'use strict';
const esc=v=>CRMWorkspace.escape(v),object=v=>{if(typeof v==='string'){try{return JSON.parse(v)||{}}catch{return {}}}return v||{}};
// One shared snapshot per document, not a duplicate extraction per decision.
// This is an equality guard, not an authentication token or provenance proof.
const reviewObject=v=>{const x=object(v);return x&&typeof x==='object'&&!Array.isArray(x)?x:{};};
function reviewEqual(a,b){if(a===b)return true;if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;const ak=Object.keys(a),bk=Object.keys(b);return ak.length===bk.length&&ak.every(k=>Object.prototype.hasOwnProperty.call(b,k)&&reviewEqual(a[k],b[k]));}
function reviewSource(doc){const ai={...reviewObject(doc.ai_extracted)};delete ai._crm_review_decisions;delete ai._crm_review_context;return {document_id:doc.id??null,candidate_id:doc.candidate_id??null,document_type:doc.document_type??null,version_group_id:doc.version_group_id??null,version_number:doc.version_number??null,storage_path:doc.storage_path??null,file_hash:doc.file_hash??null,extraction:ai};}
function reviewContext(doc,candidate){const context=reviewObject(doc.ai_extracted)._crm_review_context;return !!context&&context.version===1&&!!context.id&&!!candidate?.id&&doc.candidate_id===candidate.id&&!doc.deleted_at&&!['AI обробка','AI помилка'].includes(doc.processing_status)&&reviewEqual(context.source,reviewSource(doc));}
function reviewBinding(doc,d,candidate,contextCurrent){
 if(!Object.prototype.hasOwnProperty.call(d,'source_binding'))return 'container-only';
 const binding=d.source_binding,context=reviewObject(doc.ai_extracted)._crm_review_context;
 if(!binding||binding.version!==1||!binding.context_id||!context||binding.context_id!==context.id||!(contextCurrent===undefined?reviewContext(doc,candidate):contextCurrent))return 'stale-source';
 return 'source-snapshot';
}
function reviewMatches(doc,d,row,candidate,contextCurrent){return !!d&&d.action==='keep_card'&&!!d.reviewed_by&&!!d.reviewed_at&&d.target===row.target&&d.key===row.key&&JSON.stringify(d.current)===JSON.stringify(row.current)&&JSON.stringify(d.incoming)===JSON.stringify(row.incoming)&&d.reason===row.reason&&reviewBinding(doc,d,candidate,contextCurrent)!=='stale-source';}
function keepKind(row){
 if(!row||row.action!=='conflict'||row.current==null||row.current==='')return null;
 if(/власник|іншої особи|ПІБ не збігається/.test(row.reason||''))return typeof row.current==='string'&&row.current.trim()&&row.target==='candidate'&&['full_name','birth_date','rnokpp'].includes(row.key)?'identity-field':null;
 return 'ordinary';
}
window.CRMReviewDecision={source:reviewSource,contextMatches:reviewContext,binding:reviewBinding,matches:reviewMatches,keepKind};
function items(candidate,docs){const owned=(Array.isArray(docs)?docs:[]).filter(doc=>doc&&(!doc.candidate_id||doc.candidate_id===candidate?.id));return CRMResponsibility.latest(owned).map(doc=>{
 const pending=doc.processing_status==='AI обробка',failed=doc.processing_status==='AI помилка';
 let plan=null,error=null;try{if(doc.ai_extracted&&!pending&&!failed)plan=CRMDocumentSync.plan(doc,candidate);}catch(e){error=e.message;}
 if(plan&&window.CRMDocumentCrosscheck)CRMDocumentCrosscheck.guard(plan,CRMDocumentCrosscheck.compare(docs,candidate));
 const contextCurrent=reviewContext(doc,candidate);
 if(plan)for(const row of plan.rows){const decisions=object(doc.ai_extracted)?._crm_review_decisions;const saved=(Array.isArray(decisions)?decisions:[]).find(d=>reviewMatches(doc,d,row,candidate,contextCurrent));if(saved&&row.action==='conflict')row.action='leave';}
 const conflicts=plan?.rows.filter(r=>r.action==='conflict')||[],fills=plan?.rows.filter(r=>r.action==='fill')||[];
 return {doc,plan,error,conflicts,fills,pending,failed,review:!pending&&(!!error||conflicts.length>0||doc.verification_status==='Потребує перевірки'||!!plan&&!plan.supported)};
});}
function renderValue(value,key){if(value==null||value==='')return 'Не заповнено';if(typeof value==='object'&&window.CRMHistoryFormat)return CRMHistoryFormat.fields({[key]:value});return esc(typeof value==='object'?JSON.stringify(value):value);}
function reasonText(row){
 const reason=typeof row?.reason==='string'?row.reason:'';
 if(/власник|іншої особи|ПІБ не збігається/.test(reason))return 'Розпізнані дані для перевірки особи не збігаються з карткою. Це може бути помилка AI або документ іншої людини. Порівняйте оригінал із карткою; перенесення з цього джерела заблоковане.';
 if(/Некоректне OCR|нерозбірлив|Некоректн/.test(reason))return 'AI прочитав значення з помилкою або не зміг його впевнено визначити.';
 if(/Збережене значення|пріоритет/.test(reason))return 'У картці вже є інше значення. Оберіть, яке залишити після звірки з оригіналом.';
 return reason||'Потрібно порівняти значення з оригіналом.';
}
function unavailableText(item){
 if(item.plan?.blockedReason)return item.plan.blockedReason;
 if(item.plan?.supported===false)return 'Автоматичне перенесення для цього типу документа не підтримується. Перегляньте оригінал і звірте потрібні дані вручну.';
 return 'Перегляньте оригінал і уточніть причину перевірки. Повторне розпізнавання потрібне лише за помилки читання.';
}
function confirmationMatches(shown,fresh,candidate){
 if(!shown?.id||!fresh?.id||!candidate?.id||shown.candidate_id!==candidate.id||fresh.candidate_id!==candidate.id||shown.deleted_at||fresh.deleted_at)return false;
 if([shown,fresh].some(d=>['AI обробка','AI помилка'].includes(d.processing_status)))return false;
 return reviewEqual(reviewSource(shown),reviewSource(fresh))&&['ai_processed_at','processing_status','verification_status','verified_at','ai_confidence','ai_warnings','notes'].every(key=>reviewEqual(shown[key],fresh[key]));
}
function questionTitle(r){if(r.failed)return 'Не вдалося прочитати документ';if(r.error)return 'Не вдалося перевірити дані';if(r.plan?.supported===false)return 'Перенесення даних недоступне';if(r.conflicts.some(x=>/власник|ПІБ не збігається|іншої особи/.test(x.reason)))return 'Чи належить цей документ кандидату?';if(r.conflicts.length)return 'Потрібно уточнити: '+[...new Set(r.conflicts.map(x=>window.CRMCaseAssistant?.label(x.key)||x.key))].slice(0,3).join(', ');return r.fills.length?'Знайдено дані для порожніх полів':'Перевірте читабельність документа';}
async function review(host,candidate,documents){
 const rows=items(candidate,documents),pending=rows.filter(r=>r.pending).length,actionable=rows.filter(r=>r.fills.length||r.review||r.failed),fillable=rows.filter(r=>r.plan?.supported&&r.plan.selections.length);
 const question=questionTitle;
 const humanReason=reasonText;
 host.innerHTML='<h2>Що потрібно уточнити</h2><p>Відкрийте питання, порівняйте значення та оберіть дію. Рішення зберігається; якщо дані зміняться, питання з’явиться знову.</p><p role="status" data-intake-status>Документів із питаннями: '+actionable.length+' · Розпізнаються: '+pending+'</p><button type="button" data-intake-fill '+(!fillable.length?'disabled':'')+'>Заповнити порожні поля з усіх документів</button>'+actionable.map(r=>'<details class="card" style="padding:12px;margin:12px 0"><summary><strong>'+esc(question(r))+'</strong><br><span>'+esc(r.doc.document_type)+'</span></summary><p>'+esc(r.error||'')+'</p>'+(r.plan?.supported?r.plan.rows.filter(x=>x.action!=='leave').map(x=>{const index=r.plan.rows.indexOf(x);return '<section style="border-top:1px solid var(--border,#ddd);padding:12px 0"><strong>'+esc(window.CRMCaseAssistant?.label(x.key)||x.key)+'</strong><p>'+esc(x.action==='fill'?'У картці це поле порожнє. Можна заповнити його з документа.':humanReason(x))+'</p><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px"><div>Зараз у картці<br>'+renderValue(x.current,x.key)+'</div><div>Розпізнано з документа<br>'+renderValue(x.incoming,x.key)+'</div></div><div class="crm-actions"><button type="button" data-intake-open="'+esc(r.doc.id)+'">Подивитися оригінал</button>'+(/^relatives\.\d+\.full_name$/.test(x.key)&&/повніше ПІБ/.test(x.reason)?'<button type="button" data-intake-complete-name="'+esc(r.doc.id)+'" data-row="'+index+'">Доповнити ПІБ родича</button>':'')+(x.action==='fill'?'<button type="button" data-intake-field="'+esc(r.doc.id)+'" data-row="'+index+'">Заповнити це поле</button>':keepKind(x)?'<button type="button" data-intake-keep="'+esc(r.doc.id)+'" data-row="'+index+'">'+(keepKind(x)==='identity-field'?'Оригінал звірено — залишити це поле картки':'Залишити дані картки — питання вирішено')+'</button>':'')+'<button type="button" data-intake-review="'+esc(r.doc.id)+'">Уточнити за документом</button></div></section>';}).join(''):'<p>'+esc(unavailableText(r))+'</p><button type="button" data-intake-open="'+esc(r.doc.id)+'">Подивитися оригінал</button>')+'<details><summary>Файл і технічні подробиці</summary><p>'+esc(r.doc.file_name)+'</p><ul>'+(Array.isArray(r.doc.ai_warnings)?r.doc.ai_warnings:[]).map(w=>'<li>'+esc(w)+'</li>').join('')+'</ul></details><div class="crm-actions">'+(r.failed?'<button type="button" data-intake-retry="'+esc(r.doc.id)+'">Спробувати розпізнати ще раз</button>':'')+(!r.failed&&!r.pending&&r.doc.verification_status!=='Підтверджено'?'<button type="button" data-intake-confirm="'+esc(r.doc.id)+'">'+(r.plan?.supported?'Підтвердити файл і заповнити порожні поля':'Підтвердити перевірку файла')+'</button>':'')+'</div></details>').join('')+(!actionable.length?'<p>Немає питань, що потребують рішення.</p>':'');
 const status=host.querySelector('[data-intake-status]');
 host.querySelector('[data-intake-fill]').hidden=!fillable.length;
 async function run(fn){if(CRMWorkspace.busy)return;if(CRMWorkspace.workflow?.form?.isConnected&&CRMWorkspace.workflow.dirty){status.textContent='Спочатку збережіть зміну етапу в особовій справі.';return;}if(!await CRMWorkspace.guard())return;CRMWorkspace.busy=true;host.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();const cr=await supabaseClient.from('candidates').select('*').eq('id',candidate.id).single();if(cr.error)throw cr.error;Object.assign(candidate,cr.data);CRMWorkspace.busy=false;await window.openCandidateCard(candidate.id);}catch(e){status.textContent='Не завершено: '+e.message;}finally{CRMWorkspace.busy=false;host.querySelectorAll('button').forEach(b=>b.disabled=false);}}
 host.querySelector('[data-intake-fill]').onclick=()=>run(async()=>{for(const r of fillable){status.textContent='Переносимо: '+r.doc.file_name;await CRMDocumentSync.sync(supabaseClient,r.doc.id);}});
 host.onclick=async e=>{const b=e.target.closest('button');if(!b)return;try{
  if(b.dataset.intakeCompleteName)await run(async()=>{const id=b.dataset.intakeCompleteName,row=rows.find(r=>r.doc.id===id)?.plan?.rows[Number(b.dataset.row)],index=Number(row?.key.split('.')[1]);if(!row||!Number.isInteger(index))throw Error('Оновіть питання.');const result=await supabaseClient.rpc('crm_complete_relative_name',{p_document_id:id,p_index:index,p_expected_current:row.current,p_expected_ai:rows.find(r=>r.doc.id===id).doc.ai_extracted,p_name:row.incoming});if(result.error)throw result.error;});
  if(b.dataset.intakeField)await run(async()=>{const id=b.dataset.intakeField,old=rows.find(r=>r.doc.id===id)?.plan?.rows[Number(b.dataset.row)];const fresh=await CRMDocumentSync.preview(supabaseClient,id);fresh.selections=fresh.selections.filter(s=>s.key===old?.key&&s.target===old?.target);fresh.rows=fresh.rows.filter(x=>x.key===old?.key&&x.target===old?.target);if(!fresh.selections.length)throw Error('Дані змінилися. Оновіть перевірку.');await CRMDocumentSync.apply(supabaseClient,fresh)});
  if(b.dataset.intakeKeep)await run(async()=>{
   const id=b.dataset.intakeKeep,row=rows.find(r=>r.doc.id===id)?.plan?.rows[Number(b.dataset.row)];if(!keepKind(row))throw Error('Питання вже змінилося.');
   if(keepKind(row)==='identity-field'&&!window.confirm('Підтвердіть після перегляду оригіналу: документ належить цьому кандидату, а AI помилився саме в цьому полі. Залишити '+(window.CRMCaseAssistant?.label(row.key)||row.key)+' картки? Рішення стосується лише цього поля; інші розбіжності та заборона перенесення залишаються.'))return;
   const fresh=await CRMDocumentSync.preview(supabaseClient,id),match=fresh.rows.find(x=>x.target===row.target&&x.key===row.key&&x.reason===row.reason&&JSON.stringify(x.current)===JSON.stringify(row.current)&&JSON.stringify(x.incoming)===JSON.stringify(row.incoming));if(!match)throw Error('Дані змінилися. Перевірте їх повторно.');
   const user=await getCurrentUser();if(!user)throw Error('Увійдіть повторно.');const original=fresh.document.ai_extracted,e=object(original),decisions=Array.isArray(e._crm_review_decisions)?e._crm_review_decisions:[];if(decisions.length>=200)throw Error('Забагато збережених рішень. Потрібна технічна перевірка.');
   const decision={target:row.target,key:row.key,current:row.current,incoming:row.incoming,reason:row.reason,action:'keep_card',reviewed_by:user.id,reviewed_at:new Date().toISOString()};
   const result=await supabaseClient.rpc('crm_keep_document_value',{p_document_id:id,p_candidate_id:candidate.id,p_expected_ai:original,p_expected_candidate_updated_at:fresh.candidate.updated_at,p_decision:decision});if(result.error)throw result.error;
  });
  if(b.dataset.intakeOpen)await openDocument(b.dataset.intakeOpen);
  if(b.dataset.intakeRetry)await run(()=>retryDocumentAI(b.dataset.intakeRetry));
  if(b.dataset.intakeReview){if(await CRMWorkspace.guard())await reviewDocumentData(b.dataset.intakeReview);}
  if(b.dataset.intakeConfirm)await run(async()=>{const id=b.dataset.intakeConfirm,current=CRMResponsibility.latest(await getCandidateDocuments(candidate.id));const shown=rows.find(r=>r.doc.id===id)?.doc,fresh=current.find(d=>d.id===id);if(!confirmationMatches(shown,fresh,candidate))throw Error('Документ або результат AI змінився. Оновіть картку й повторно звірте оригінал.');const user=await getCurrentUser();if(!user)throw Error('Увійдіть повторно.');let update=supabaseClient.from('documents').update({verification_status:'Підтверджено',verified_by:user.id,verified_at:new Date().toISOString()}).eq('id',id).eq('candidate_id',candidate.id).is('deleted_at',null);for(const key of ['ai_processed_at','processing_status','verification_status','verified_at','storage_path','version_group_id','version_number','file_hash'])if(fresh[key]!==undefined)update=fresh[key]===null?update.is(key,null):update.eq(key,fresh[key]);const changed=await update.select('id');if(changed.error)throw changed.error;if(!changed.data?.length)throw Error('Документ не підтверджено.');const report=await CRMDocumentSync.preview(supabaseClient,id);if(report.supported){if(!report.document||report.document.verification_status!=='Підтверджено'||report.document.ai_processed_at!==fresh.ai_processed_at||report.document.processing_status!==fresh.processing_status||!reviewEqual(reviewSource(fresh),reviewSource(report.document)))throw Error('Файл підтверджено, але джерело вже змінилося. Дані не перенесено; оновіть картку.');await CRMDocumentSync.apply(supabaseClient,report);}});
 }catch(e){status.textContent=e.message;}};
}
window.CRMIntake={items,review,reasonText,questionTitle,unavailableText,confirmationMatches};
})();
