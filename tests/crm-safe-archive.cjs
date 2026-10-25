const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=f=>fs.readFileSync(require('node:path').join(__dirname,'..',f),'utf8');
const source=read('crm-workflow.js');
function runtime(extra={}){
 const c=vm.createContext({Intl,Date,console,CRMWorkspace:{escape:v=>String(v??'')},...extra});c.window=c;
 for(const f of ['candidate-conditions.js','document-presence.js','document-state.js','crm-workflow.js'])vm.runInContext(read(f),c,{filename:f});
 return c;
}
const candidate=()=>({id:'candidate',full_name:'Тестова Особа',recruitment_status:'В роботі',updated_at:'before',profile_data:{manual_value:'keep',workflow:{stage:'В роботі',paused:true}}});
const values=extra=>({outcome:'Відмова кандидата',completion_date:'2026-01-01',reason:'Пояснення',...extra});
const json=v=>JSON.parse(JSON.stringify(v));
test('ordinary archive is one retained workflow patch and does not require missing originals',()=>{
 const c=runtime(),row=candidate(),before=JSON.stringify(row),patch=c.CRMWorkflow.completionPatch(row,values(),[{id:'passport',document_type:'Копія паспорта/ID Картки',is_required:true}],[],'2026-01-02T00:00:00Z');
 assert.equal(patch.archive_mode,'retained');assert.equal(patch.archived_at,'2026-01-02T00:00:00Z');assert.equal(patch.archive_previous_stage,'В роботі');assert.equal(patch.paused,false);assert.equal(JSON.stringify(row),before);
 assert.equal(patch.order_number,null);assert.equal(patch.destination,null);
});
test('result, reason, real date and destination are validated',()=>{
 const api=runtime().CRMWorkflow,row=candidate();
 for(const change of [{outcome:''},{reason:' '},{completion_date:'2026-02-30'},{completion_date:'2999-01-01'},{outcome:'Переданий до іншої РМГ',destination:''}])assert.throws(()=>api.completionPatch(row,values(change),[],[]));
 assert.equal(api.completionPatch(row,values({outcome:'Переданий до іншої РМГ',destination:'РМГ'}),[],[]).destination,'РМГ');
});
test('enrollment retains order, prescription and incomplete-kit controls including paper attestations',()=>{
 const api=runtime().CRMWorkflow,row=candidate(),v=values({outcome:'Зарахований до ВЧ',destination:'ВЧ',order_number:'29',order_date:'2025-12-31'});
 assert.throws(()=>api.completionPatch(row,v,[],[]),/припис/iu);
 row.profile_data.document_presence={'Припис про направлення':{available:true,document_type:'Припис про направлення',checked_by:'staff',checked_at:'2026-01-01'}};
 assert.equal(api.completionPatch(row,v,[],[]).archive_mode,'retained','paper prescription works without the old server/file mismatch');
 const docs=[{id:'p',document_type:'Припис про направлення',verification_status:'Підтверджено'}],reqs=[{id:'passport',document_type:'Копія паспорта/ID Картки',is_required:true}];
 assert.throws(()=>api.completionPatch(row,v,reqs,docs),/неповний/iu);
 assert.throws(()=>api.completionPatch(row,{...v,incomplete:true},reqs,docs),/причину/iu);
 const patch=api.completionPatch(row,{...v,incomplete:true,incomplete_reason:'Документ очікується'},reqs,docs);
 assert.equal(patch.missing_documents,'Копія паспорта/ID Картки');assert.equal(patch.order_number,'29');
 assert.throws(()=>api.completionPatch(row,{...v,order_date:'2026-01-02'},[],docs),/наказу/iu);
 assert.throws(()=>api.completionPatch(row,{...v,order_date:'2025-02-30'},[],docs),/наказу/iu);
});
test('merged, archived and legacy-locked cases cannot start another archive',()=>{
 const api=runtime().CRMWorkflow;
 for(const p of [{merged_into:'other'},{workflow:{archived_at:'date'}},{workflow:{archive_lock:'legacy'}}])assert.throws(()=>api.completionPatch({...candidate(),profile_data:p},values(),[],[]));
});
test('restore returns the previous working stage while retaining completion details and unrelated data',()=>{
 const api=runtime().CRMWorkflow,row=candidate();row.profile_data.workflow={...row.profile_data.workflow,...api.completionPatch(row,values(),[],[],'2026-01-02')};
 const patch=api.restorePatch(row,'2026-01-03');assert.equal(patch.archived_at,null);assert.equal(patch.outcome,null);assert.equal(patch.stage,'В роботі');assert.equal(patch.last_archive.reason,'Пояснення');assert.equal(patch.last_archive.archived_at,'2026-01-02');assert.equal(row.profile_data.manual_value,'keep');
 assert.throws(()=>api.restorePatch({...row,profile_data:{workflow:{archived_at:'date',archive_lock:'legacy'}}}));
});
test('working lists exclude retained archives, while duplicate detection explicitly includes them',async()=>{
 const rows=[candidate(),{...candidate(),id:'archived',profile_data:{workflow:{archived_at:'date'}}},{...candidate(),id:'merged',profile_data:{merged_into:'other'}}];
 const ctx=vm.createContext({supabaseClient:{from(){return {select(){return this},order:async()=>({data:rows})}}}});
 const s=read('script.js'),start=s.indexOf('async function getCandidates('),end=s.indexOf('\nfunction showCandidates',start);vm.runInContext(s.slice(start,end),ctx);
 assert.deepEqual(json(await ctx.getCandidates()).map(c=>c.id),['candidate']);
 assert.deepEqual(json(await ctx.getCandidates({includeArchived:true})).map(c=>c.id),['candidate','archived']);
 assert(s.includes('matching(candidate,await getCandidates({includeArchived:true}))'));
});
test('archive and restoration persist through compare-and-swap without losing manual profile data',async()=>{
 let row=candidate(),updated=0;const api=runtime({getCurrentUser:async()=>({id:'staff'}),supabaseClient:{from(table){assert.equal(table,'candidates');let patch=null,expected=null;return {select(){return this},eq(key,value){if(key==='updated_at')expected=value;return this},is(key,value){expected=value;return this},update(v){patch=v;return this},async single(){if(!patch)return {data:structuredClone(row)};if(expected!==row.updated_at)return {error:Error('concurrent update')};row={...row,...patch,updated_at:'saved-'+(++updated)};return {data:structuredClone(row)}}}}}});
 api.profile=api.CRMWorkflow.profile;api.wf=api.CRMWorkflow.wf;
 const start=source.indexOf('async function persist('),end=source.indexOf('let pdfPromise;',start);vm.runInContext(source.slice(start,end),api);
 const c=candidate();row.profile_data.manual_value='new manual value';await api.persist(c,api.CRMWorkflow.completionPatch(c,values(),[],[]));
 assert.equal(row.profile_data.manual_value,'new manual value');assert.equal(row.profile_data.workflow.archived_by,'staff');
 await api.persist(c,api.CRMWorkflow.restorePatch(c));assert.equal(row.profile_data.workflow.restored_by,'staff');assert.equal(row.profile_data.manual_value,'new manual value');assert.equal(updated,2);
 row.profile_data.workflow.stage='ВЛК';await assert.rejects(api.persist(c,{reason:'stale'}),/змінив/iu);assert.equal(updated,2);
});
test('ordinary completion and archive screen cannot invoke permanent deletion or storage cleanup',()=>{
 assert(!source.includes("functions.invoke('archive-candidate'"));assert(!source.includes('confirm_delete_originals'));
 assert(source.includes('data-archive-restore'));assert(source.includes('data-archive-download'));assert(source.includes("CRMWorkspace.setContext(null,'')"));
 const start=source.indexOf(' const run=async (fn,'),end=source.indexOf(' const refresh=',start),run=source.slice(start,end);
 assert(run.indexOf('CRMWorkspace.busy=true')<run.indexOf("from('candidates')"));
 assert(source.includes("d.querySelector('[data-destination]').hidden=!enrolled&&!transfer"));
});
test('archive list includes retained cases and historical PDFs, excludes merged cases and clears stale context',async()=>{
 const nodes=Object.fromEntries(['[data-archive-rows]','[data-archive-search]','[data-archive-status]'].map(k=>[k,{value:'',innerHTML:'',textContent:''}]));
 const content={innerHTML:'',querySelector:s=>nodes[s]};let contextCleared=false;
 const c=runtime({document:{querySelector:s=>s==='.content'?content:null},CRMWorkspace:{escape:v=>String(v??'').replaceAll('<','&lt;'),setContext(id,name){assert.equal(id,null);assert.equal(name,'');contextCleared=true;},markMenu(){}},supabaseClient:{from(table){return {select(){return this},async order(){return {data:table==='crm_archive'?[{id:'old',candidate_id:'old-c',full_name:'Old',state:'Готово',archived_at:'2025-01-01',pdf_path:'old.pdf'}]:[{id:'new',full_name:'Retained',profile_data:{workflow:{id:'wrong',candidate_id:'other',full_name:'Wrong name',archived_at:'2026-01-01',archive_mode:'retained',outcome:'Відмова кандидата'}}},{id:'merged',full_name:'Do not show',profile_data:{merged_into:'new',workflow:{archived_at:'2026-01-01'}}}]};}}}}});
 await c.CRMWorkflow.showArchive();const html=nodes['[data-archive-rows]'].innerHTML;assert(contextCleared);assert(html.includes('data-archive-restore="new"'));assert(html.includes('data-archive-open="new"'));assert(html.includes('data-archive-download="old"'));assert(!html.includes('Do not show'));assert(!html.includes('data-archive-resume'));assert(html.indexOf('Retained')<html.indexOf('Old'));
 nodes['[data-archive-search]'].value='OLD';nodes['[data-archive-search]'].oninput();assert(!nodes['[data-archive-rows]'].innerHTML.includes('Retained'));
});
test('repeated completion opening reuses the dialog without rebinding it',()=>{
 const existing={sentinel:true},c=runtime({document:{querySelector:s=>{assert.equal(s,'dialog[data-crm-completion]');return existing;},createElement(){throw Error('must not create another modal');}}});
 assert.equal(c.CRMWorkflow.completionDialog(candidate(),[],[],()=>{}),existing);
 assert.equal(c.CRMWorkflow.completionDialog(candidate(),[],[],()=>{}),existing);
});
test('duplicate chooser blocks attaching to archived/locked cases and updates when selection changes',async()=>{
 const select={value:'archived'},note={textContent:''},buttons=['open','attach','cancel'].map(choice=>({dataset:{choice},disabled:false}));let closed=0;
 const dialog={innerHTML:'',querySelector:s=>s==='[data-existing]'?select:s==='[data-existing-status]'?note:buttons.find(b=>b.dataset.choice==='attach'),querySelectorAll:()=>buttons,showModal(){},close(){closed++;},remove(){},addEventListener(){}};
 const c=vm.createContext({CRMWorkspace:{escape:String},document:{createElement:()=>dialog,body:{append(){}}}});c.window=c;vm.runInContext(read('candidate-duplicates.js'),c);
 const archived={id:'archived',full_name:'Archive',profile_data:{workflow:{archived_at:'date'}}},active={id:'active',full_name:'Active'};
 for(const row of [archived,{profile_data:{merged_into:'other'}},{profile_data:{workflow:{archive_lock:'lock'}}}])assert.equal(c.CRMCandidateDuplicates.canAttach(row),false);
 const chosen=c.CRMCandidateDuplicates.choose([archived,active],true),attach=buttons.find(b=>b.dataset.choice==='attach');assert.equal(attach.disabled,true);assert(note.textContent.includes('Архівна'));
 attach.onclick();assert.equal(closed,0,'disabled action must not resolve even if triggered directly');select.value='active';select.onchange();assert.equal(attach.disabled,false);assert.equal(note.textContent,'');attach.onclick();assert.deepEqual(json(await chosen),{action:'attach',id:'active'});
});
test('retained card offers restore and reloads the card only after successful restoration',async()=>{
 assert(source.includes('data-restore>Повернути в роботу'));
 const handler=source.split('\n').find(l=>l.includes("host.querySelector('[data-restore]')"));
 const factory=new Function('host','confirm','run','persist','restorePatch','c','isArchived','CRMWorkspace','crmNavigate',handler);
 for(const mode of ['cancel','failed','success']){
  const api=runtime().CRMWorkflow,row=candidate();row.profile_data.workflow={...row.profile_data.workflow,...api.completionPatch(row,values(),[],[])};
  let click,navigations=0,writes=0;const workspace={card:{dirty:false}};
  factory({querySelector(){return {addEventListener(_event,fn){click=fn;}}}},()=>mode!=='cancel',async fn=>{if(mode!=='failed')await fn();},async(c,patch)=>{writes++;c.profile_data.workflow={...c.profile_data.workflow,...patch};},api.restorePatch,row,api.isArchived,workspace,async(key,id)=>{assert.equal(key,'card');assert.equal(id,row.id);assert.equal(workspace.card,null);navigations++;});
  await click();assert.equal(writes,mode==='success'?1:0);assert.equal(navigations,mode==='success'?1:0);
 }
});
