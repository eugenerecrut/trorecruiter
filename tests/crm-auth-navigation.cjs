const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../crm-workspace.js'),'utf8');
function setup(){
 let handler,loads=0,home=true,reloads=0;const queue=[],notices=[];
 const workspace={loadHome:async()=>{loads++}};
 const context={CRMWorkspace:workspace,supabaseClient:{auth:{onAuthStateChange:fn=>handler=fn}},setTimeout:fn=>queue.push(fn),console:{error(){}},location:{reload(){reloads++}},updateDashboard:async()=>{},getDocumentRequirements:()=>{},document:{readyState:'complete',createElement:()=>({setAttribute(){},append(child){this.child=child}}),querySelector:selector=>selector==='.content'?{prepend:n=>notices.push(n)}:selector.includes('.cards')&&home?{}:null}};
 vm.runInNewContext(source.slice(source.indexOf('let workspaceAuthUserId='),source.indexOf('CRMWorkspace.trackNewForm=')),context);
 return {context,notices,reloads:()=>reloads,workspace,emit:(event,id='one')=>handler(event,id?{user:{id}}:null),flush:async()=>{while(queue.length)queue.shift()();await new Promise(r=>setImmediate(r));},loads:()=>loads,leaveHome:()=>home=false};
}

test('static dashboard cannot claim zero candidates before data loading',()=>{
 const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');assert(!html.includes('<div class="card-number">0</div>'));assert(!html.includes('Кандидатів поки немає'));assert(html.includes('Очікуємо завантаження кандидатів'));
});

test('missing startup dependencies display an explicit manual recovery without automatic reload',async()=>{
 const s=setup();s.context.getDocumentRequirements=undefined;s.emit('INITIAL_SESSION');await s.flush();assert.equal(s.loads(),0);assert.equal(s.notices.length,1);assert.match(s.notices[0].textContent,/не означає, що база порожня/);assert.equal(s.reloads(),0);s.notices[0].child.onclick();assert.equal(s.reloads(),1);
});
test('synchronous startup failures are caught, without overwriting a later candidate view',async()=>{
 for(const leave of [false,true]){
  const s=setup();s.context.updateDashboard=()=>{throw Error('failed startup')};s.emit('INITIAL_SESSION');if(leave)s.leaveHome();await s.flush();assert.equal(s.notices.length,leave?0:1);assert.equal(s.reloads(),0);
 }
});
test('initial login loads dashboard once; returning SIGNED_IN and token refresh preserve screen',async()=>{
 const s=setup();s.emit('INITIAL_SESSION');await s.flush();assert.equal(s.loads(),1);
 s.workspace.card={form:{isConnected:true},dirty:true};s.leaveHome();
 for(const event of ['SIGNED_IN','SIGNED_IN','TOKEN_REFRESHED','USER_UPDATED'])s.emit(event);
 await s.flush();assert.equal(s.loads(),1);assert.equal(s.workspace.card.dirty,true);
});
test('late initial session cannot replace another screen or pending navigation',async()=>{
 for(const state of ['other','card','busy','navigating','workflow']){
  const s=setup();s.emit('INITIAL_SESSION');
  if(state==='other')s.leaveHome();else if(['card','workflow'].includes(state))s.workspace[state]={form:{isConnected:true}};else s.workspace[state]=true;
  await s.flush();assert.equal(s.loads(),0,state);
 }
});
test('sign-out resets initialization for next login, anonymous and token events do not initialize',async()=>{
 const s=setup();s.emit('INITIAL_SESSION',null);s.emit('TOKEN_REFRESHED');await s.flush();assert.equal(s.loads(),0);
 s.emit('SIGNED_IN');await s.flush();assert.equal(s.loads(),1);
 s.emit('SIGNED_OUT',null);s.emit('SIGNED_IN');await s.flush();assert.equal(s.loads(),2);
});
