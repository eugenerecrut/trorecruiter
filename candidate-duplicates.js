(function(){
'use strict';
const norm=v=>String(v||'').normalize('NFKC').replace(/[’ʼ`]/g,"'").replace(/\s+/g,' ').trim().toLocaleLowerCase('uk-UA');
const profile=c=>{try{return typeof c.profile_data==='string'?JSON.parse(c.profile_data):c.profile_data||{}}catch{return {}}};
const names=c=>[c.name_nominative||c.full_name,...(window.CRMNameHistory?.records(c)||[]).filter(r=>r.verified).map(r=>r.previous_full_name)].map(norm).filter(Boolean);
function matching(incoming,rows){return rows.filter(c=>!profile(c).merged_into&&((/^\d{10}$/.test(incoming.rnokpp||'')&&incoming.rnokpp===c.rnokpp)||(incoming.birth_date&&incoming.birth_date===c.birth_date&&names(c).some(n=>names(incoming).includes(n)))));}
async function choose(rows,hasFile){
 const esc=CRMWorkspace.escape,d=document.createElement('dialog');d.className='crm-dialog';d.innerHTML='<h2>Кандидат уже є в CRM</h2><p>Оберіть наявну справу. Її заповнені дані залишаться без змін.</p><label>Справа<select data-existing>'+rows.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.full_name)+(profile(c).workflow?.archived_at?' · Архів':'')+' · '+esc(c.birth_date||'Дата не вказана')+'</option>').join('')+'</select></label><div class="crm-actions"><button type="button" data-choice="open">Відкрити справу</button>'+(hasFile?'<button type="button" data-choice="attach">Додати РЛ до цієї справи</button>':'')+'<button type="button" data-choice="cancel">Скасувати</button></div>';
 document.body.append(d);d.showModal();return new Promise(resolve=>{const finish=action=>{const id=d.querySelector('[data-existing]').value;d.close();d.remove();resolve({action,id});};d.querySelectorAll('[data-choice]').forEach(b=>b.onclick=()=>finish(b.dataset.choice));d.addEventListener('cancel',e=>{e.preventDefault();finish('cancel')});});
}

function groups(rows){const map=new Map();for(const c of rows){if(!/^\d{10}$/.test(c.rnokpp||'')||profile(c).merged_into)continue;const key=c.rnokpp+'|'+(c.birth_date||'');if(!map.has(key))map.set(key,[]);map.get(key).push(c);}return [...map.values()].filter(g=>g.length>1);}
async function mergePreview(ids){
 if(!await CRMWorkspace.guard())return;
 const [cr,dr,fr]=await Promise.all([supabaseClient.from('candidates').select('*').in('id',ids),supabaseClient.from('documents').select('*').in('candidate_id',ids),supabaseClient.from('personal_files').select('*').in('candidate_id',ids)]);
 for(const r of [cr,dr,fr])if(r.error)throw r.error;
 const rows=cr.data||[],docs=dr.data||[],files=fr.data||[];if(rows.length!==2)throw Error('Оберіть одну пару справ.');
 rows.sort((a,b)=>docs.filter(d=>d.candidate_id===b.id).length-docs.filter(d=>d.candidate_id===a.id).length);
 const esc=CRMWorkspace.escape,d=document.createElement('dialog');d.className='crm-dialog';
 d.innerHTML='<h2>Об’єднання справ</h2><label>Основна картка<select data-target>'+rows.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.full_name)+' · документів '+docs.filter(x=>x.candidate_id===c.id).length+' · '+esc(c.created_at)+'</option>').join('')+'</select></label><p>Порожні поля доповнюються. Відмінні заповнені значення залишаються в резервній історії. Файли копіюються до основної справи; оригінали й технічний запис дубля зберігаються. У списках CRM буде одна справа.</p><div data-review></div><p role="status"></p><button type="button" data-merge>Об’єднати зі збереженням оригіналів</button> <button type="button" data-close>Скасувати</button>';
 document.body.append(d);d.showModal();let busy=false;const close=()=>{if(busy)return;d.close();d.remove()};d.querySelector('[data-close]').onclick=close;d.addEventListener('cancel',e=>{e.preventDefault();close()});
 const pair=()=>{const target=rows.find(c=>c.id===d.querySelector('[data-target]').value);return {target,source:rows.find(c=>c.id!==target.id)}};
 const draw=()=>{const {target,source}=pair(),tp=profile(target),sp=profile(source),lines=[];const value=v=>v==null||v===''?'—':typeof v==='object'?JSON.stringify(v):String(v);const add=(label,a,b)=>{if(b==null||b===''||JSON.stringify(a)===JSON.stringify(b))return;lines.push('<tr><td>'+esc(label)+'</td><td>'+esc(value(a))+'</td><td>'+esc(value(b))+'</td><td>'+(a==null||a===''?'Заповнити':'Залишити основне; зберегти відмінність')+'</td></tr>');};
 for(const key of ['full_name','birth_date','rnokpp','phone','desired_position','direction','military_specialty','birth_place','tcc','email','civilian_profession'])add(key,target[key],source[key]);
 for(const [key,value] of Object.entries(sp))add('Профіль: '+key,tp[key],value);
 const sf=files.find(f=>f.candidate_id===source.id),tf=files.find(f=>f.candidate_id===target.id);for(const [key,value] of Object.entries(sf||{}))if(!['id','candidate_id','created_at','updated_at'].includes(key))add('Особова справа: '+key,tf?.[key],value);
 d.querySelector('[data-review]').innerHTML='<p>Документів після об’єднання: <b>'+docs.length+'</b>. Дубль: '+esc(source.created_at)+'</p><div style="max-height:40vh;overflow:auto"><table><thead><tr><th>Поле</th><th>Основне</th><th>Дубль</th><th>Дія</th></tr></thead><tbody>'+lines.join('')+'</tbody></table></div>';};
 d.querySelector('[data-target]').onchange=draw;draw();d.querySelector('[data-merge]').onclick=async()=>{
 busy=true;d.querySelectorAll('button,select').forEach(b=>b.disabled=true);const status=d.querySelector('[role=status]'),{source,target}=pair();
 try{const moves={};for(const doc of docs.filter(x=>x.candidate_id===source.id)){
 if(!doc.storage_path)throw Error('Документ без файла потребує окремої перевірки.');
 const path=target.id+'/merged/'+doc.id+'/'+doc.storage_path.split('/').pop();status.textContent='Копіюємо: '+doc.file_name;
 const r=await supabaseClient.storage.from('candidate-documents').copy(doc.storage_path,path);if(r.error&&!/already exists|duplicate/i.test(r.error.message||''))throw r.error;moves[doc.id]=path;
 }
 status.textContent='Зберігаємо об’єднання…';const result=await supabaseClient.rpc('crm_merge_candidates',{source_id:source.id,target_id:target.id,source_updated:source.updated_at,target_updated:target.updated_at,expected_document_ids:docs.map(x=>x.id),document_moves:moves});if(result.error)throw result.error;
 const check=await supabaseClient.from('documents').select('id').eq('candidate_id',target.id);if(check.error)throw check.error;if(check.data.length!==docs.length)throw Error('Потрібна повторна перевірка кількості документів.');
 busy=false;close();await crmNavigate('card',target.id);
 }catch(error){status.textContent='Об’єднання не завершено: '+error.message+' Оригінали збережено. Закрийте вікно й повторіть перегляд.';busy=false;d.querySelector('[data-close]').disabled=false;}
 };
}
function mount(rows,root){const list=groups(rows),host=root.querySelector('.quick-actions');if(!host)return;host.querySelector('[data-duplicates]')?.remove();if(!list.length||!CRMResponsibility.canMerge())return;const b=document.createElement('button');b.type='button';b.dataset.duplicates='1';b.textContent='Дублікати: '+list.length;b.onclick=()=>mergePreview(list[0].slice(0,2).map(c=>c.id)).catch(e=>alert(e.message));host.append(b);}
window.CRMCandidateDuplicates={matching,choose,groups,mergePreview,mount};

})();
