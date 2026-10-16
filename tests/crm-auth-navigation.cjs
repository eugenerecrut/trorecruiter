const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../crm-workspace.js'),'utf8');
function setup(){
 let handler,loads=0,home=true;const queue=[];
 const workspace={loadHome:async()=>{loads++}};
 const context={CRMWorkspace:workspace,supabaseClient:{auth:{onAuthStateChange:fn=>handler=fn}},setTimeout:fn=>queue.push(fn),console,updateDashboard:async()=>{},getDocumentRequirements:()=>{},document:{readyState:'complete',querySelector:selector=>selector.includes('.cards')&&home?{}:null}};
 vm.runInNewContext(source.slice(source.indexOf('let workspaceAuthUserId='),source.indexOf('CRMWorkspace.trackNewForm=')),context);
 return {workspace,emit:(event,id='one')=>handler(event,id?{user:{id}}:null),flush:async()=>{while(queue.length)queue.shift()();await Promise.resolve();},loads:()=>loads,leaveHome:()=>home=false};
}
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
