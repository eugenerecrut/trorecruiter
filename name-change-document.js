(function(root){
'use strict';
const norm=v=>String(v||'').normalize('NFKC').replace(/[’ʼ]/g,"'").replace(/\s+/g,' ').trim().toLocaleLowerCase('uk-UA');
const profile=c=>{try{return typeof c.profile_data==='string'?JSON.parse(c.profile_data):c.profile_data||{}}catch{return {}}};
const records=c=>Array.isArray(profile(c).name_history)?profile(c).name_history:[];
function chain(c){
 const names=new Set([norm(c.name_nominative||c.full_name)]),links=[];let changed=true;
 while(changed){changed=false;for(const r of records(c)){if(r.verified!==true||!norm(r.previous_full_name)||!norm(r.new_full_name)||!names.has(norm(r.new_full_name)))continue;if(!links.includes(r))links.push(r);if(!names.has(norm(r.previous_full_name))){names.add(norm(r.previous_full_name));changed=true;}}}
 return {names,links};
}
const matches=(name,c)=>!!norm(name)&&chain(c).names.has(norm(name));
async function birthLinks(candidateId){
 const docs=CRMResponsibility.latest(await getCandidateDocuments(candidateId)).filter(d=>!d.deleted_at&&/свідоцтво про народження/iu.test(d.document_type||d.ai_document_type||'')&&!/дітей/iu.test(d.document_type||''));
 const esc=CRMWorkspace.escape,dialog=document.createElement('dialog');dialog.className='crm-dialog';dialog.innerHTML='<h2>Свідоцтва про народження</h2><p>Перевірте дані за підтвердженою історією ПІБ. Чинне ПІБ залишиться без змін.</p>'+docs.map((d,i)=>'<p><button type="button" data-birth-link="'+i+'">'+esc(d.file_name||d.document_type)+'</button></p>').join('')+(!docs.length?'<p>Свідоцтво ще не завантажено.</p>':'')+'<button type="button" data-close>Закрити</button>';document.body.append(dialog);dialog.showModal();const close=()=>{dialog.close();dialog.remove()};dialog.querySelector('[data-close]').onclick=close;dialog.querySelectorAll('[data-birth-link]').forEach(b=>b.onclick=()=>{const d=docs[Number(b.dataset.birthLink)];close();CRMDocumentSync.showPreview(supabaseClient,d.id).catch(e=>alert(e.message));});
}

const isDocument=t=>/свідоцтв.*змін.*(?:імен|прізвищ)/iu.test(String(t||''));
function review(e,c,d){
 const n=e.name_change||{},issues=[],history=records(c).map(r=>({...r}));
 if(d.verification_status!=='Підтверджено')issues.push('Спочатку перевірте й підтвердьте документ.');
 if(!n.previous_full_name||!n.new_full_name||n.requires_review||!matches(n.new_full_name,c))issues.push('Нове ПІБ має відповідати чинному ПІБ кандидата; нечіткі дані потребують ручної перевірки.');
 if((e.birth_date&&c.birth_date&&e.birth_date!==c.birth_date)||(e.rnokpp&&c.rnokpp&&e.rnokpp!==c.rnokpp))issues.push('Реквізити власника не збігаються.');
 if(!issues.length){const draft=history.findIndex(r=>!r.verified&&norm(r.previous_full_name)===norm(n.previous_full_name));if(draft>=0)history.splice(draft,1);}
 if(!issues.length&&!history.some(r=>r.verified&&norm(r.previous_full_name)===norm(n.previous_full_name)&&norm(r.new_full_name)===norm(n.new_full_name)&&String(r.change_date||'')===String(n.change_date||'')))history.push({...n,verified:true,source_document_id:d.id,document_number:e.document_number||null,document_series:e.document_series||null,document_issuer:e.document_issuer||null,document_date:e.document_date||null});
 return {issues,history,blocked:!!issues.length};
}
function editor(c){const esc=CRMWorkspace.escape;return '<details class="cc-wide"><summary>Попередні ПІБ ('+records(c).length+')</summary>'+records(c).map(r=>'<p>'+esc(r.previous_full_name)+' → '+esc(r.new_full_name||'')+' · '+esc(r.change_date||'Дата не зазначена')+(r.source_document_id?' <button type="button" data-name-source="'+esc(r.source_document_id)+'">Документ</button>':'')+'</p>').join('')+'<label>Попереднє ПІБ<input name="previous_full_name"></label><label>Дата зміни<input name="name_change_date" type="date"></label><small>Ручний запис зберігається в історії; для звірки старих документів підтвердьте свідоцтво.</small></details>';}
function save(fd,c,p){const name=String(fd.get('previous_full_name')||'').trim();if(!name)return;const history=Array.isArray(p.name_history)?p.name_history:[];if(!history.some(r=>norm(r.previous_full_name)===norm(name)))history.push({previous_full_name:name,new_full_name:String(fd.get('name_nominative')||c.full_name).trim(),change_date:fd.get('name_change_date')||null,verified:false});p.name_history=history;}
root.CRMNameHistory={chain,birthLinks,matches,records,isDocument,review,editor,save};
})(typeof window==='undefined'?globalThis:window);
