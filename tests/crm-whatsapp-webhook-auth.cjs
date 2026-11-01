const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {stripTypeScriptTypes}=require('node:module');
function setup(env={}){
 let handler,clients=0;const calls=[];
 const source=fs.readFileSync(path.join(__dirname,'../supabase/functions/whatsapp-webhook/index.ts'),'utf8').replace(/^import .*?;\s*/,'');
 const context=vm.createContext({Request,Response,URL,console:{error(){}},Deno:{env:{get:key=>env[key]},serve:fn=>handler=fn},createClient:()=>{clients++;return {rpc:async(...args)=>{calls.push(args);return {data:{message_id:'synthetic'}}}}}});
 vm.runInContext(stripTypeScriptTypes(source),context);return {run:req=>handler(req),calls,clients:()=>clients};
}
const event={typeWebhook:'incomingMessageReceived',senderData:{chatId:'380000000000@c.us'},messageData:{typeMessage:'textMessage',textMessageData:{textMessage:'synthetic test'}}};
const request=(authorization,body=event)=>new Request('https://crm.invalid/webhook',{method:'POST',headers:{'content-type':'application/json',...(authorization?{authorization}:{})},body:JSON.stringify(body)});
test('missing server secret rejects before client creation or writes',async()=>{const s=setup();assert.equal((await s.run(request('Bearer test'))).status,503);assert.equal(s.clients(),0)});
test('missing, wrong and default public tokens cannot write',async()=>{for(const token of [null,'Bearer wrong','Basic private','Bearer psk_recruiter_wa_token']){const s=setup({WHATSAPP_WEBHOOK_SECRET:'private'});assert.equal((await s.run(request(token))).status,401);assert.equal(s.clients(),0);assert.equal(s.calls.length,0)}});
test('authorized Green message reaches the existing RPC exactly once',async()=>{const s=setup({WHATSAPP_WEBHOOK_SECRET:'private'});assert.equal((await s.run(request('Bearer private'))).status,200);assert.equal(s.calls.length,1);assert.equal(s.calls[0][0],'crm_receive_whatsapp_message');assert.equal(s.calls[0][1].p_content,'synthetic test')});
test('verification challenge requires explicit configured verification token',async()=>{for(const token of ['', 'wrong', 'psk_recruiter_wa_token']){const s=setup({WHATSAPP_VERIFY_TOKEN:'private'});assert.equal((await s.run(new Request('https://crm.invalid/?hub.mode=subscribe&hub.challenge=test&hub.verify_token='+token))).status,403);assert.equal(s.clients(),0)}const s=setup({WHATSAPP_VERIFY_TOKEN:'private'});assert.equal(await(await s.run(new Request('https://crm.invalid/?hub.mode=subscribe&hub.challenge=test&hub.verify_token=private'))).text(),'test')});
test('OPTIONS and health checks never create privileged client',async()=>{const s=setup();assert.equal((await s.run(new Request('https://crm.invalid/',{method:'OPTIONS'}))).status,200);assert.equal((await s.run(new Request('https://crm.invalid/'))).status,200);assert.equal(s.clients(),0)});
