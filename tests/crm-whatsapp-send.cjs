const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const ctx={};ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../crm-whatsapp.js'),'utf8'),ctx);
const send=ctx.CRMWhatsApp.sendGatewayText;
const settings={is_active:true,instance_id:'123',api_token:'synthetic'};
test('only provider acknowledgement returns message ID',async()=>{
 let calls=0;const result=await send(settings,'380000000000','test',async(url,opts)=>{
  calls++;assert.equal(JSON.parse(opts.body).message,'test');
  return {ok:true,json:async()=>({idMessage:'accepted-id'})};
 });assert.equal(result,'accepted-id');assert.equal(calls,1);
});
test('disabled gateway does not call provider',async()=>{
 assert.equal(await send({is_active:false},'1','test',()=>{throw Error('unexpected')}),null);
});
test('network errors, HTTP errors and empty acknowledgements never retry',async()=>{
 for(const response of [()=>{throw Error('network')},()=>({ok:false,status:429}),()=>({ok:true,json:async()=>({})})]){
  let calls=0;await assert.rejects(()=>send(settings,'1','test',async()=>{calls++;return response()}));assert.equal(calls,1);
 }
});
