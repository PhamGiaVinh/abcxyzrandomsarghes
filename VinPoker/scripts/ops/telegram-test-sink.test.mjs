import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {once} from 'node:events';
import {createTelegramTestSink} from './telegram-test-sink.mjs';
import {instrumentCheckoutTelegramForTest} from './prepare-checkout-telegram-test.mjs';

test('real local HTTP sink accepts only synthetic destinations and records failed attempts',async()=>{
 const server=createTelegramTestSink();server.listen(0,'127.0.0.1');await once(server,'listening');
 const base='http://127.0.0.1:'+server.address().port,body={chat_id:'-1000000000001',text:'Notification TEST &lt;1&gt; @notify_test_1',parse_mode:'HTML'};
 const send=(path,value,headers={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(value)});
 try{
  assert.equal((await send('/sendMessage',body)).status,200);
  assert.equal((await send('/sendMessage',{...body,chat_id:'unexpected'})).status,400);
  assert.equal((await send('/sendMessage',body,{Authorization:'LOCAL_INVALID'})).status,400);
  assert.equal((await send('/control',{failGroup:true})).status,200);
  assert.equal((await send('/sendMessage',body)).status,503);
  assert.equal((await send('/sendMessage',{...body,chat_id:'9900000000001'})).status,200);
  const {messages}=await(await fetch(base+'/snapshot')).json();assert.equal(messages.length,3);
  assert.deepEqual(messages.map(m=>m.accepted),[true,false,true]);assert.ok(messages.every(m=>Number.isSafeInteger(m.receivedAt)));
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('test adapter preserves non-provider fetch and rejects other tokens/credential headers',async()=>{
 const stub='const core={};const recovered=false;function unused(){if (core.idempotent || recovered) return;} Deno.serve(async (req) => {});';
 const source=instrumentCheckoutTelegramForTest(stub),calls=[];
 const context=vm.createContext({URL,Headers,Deno:{env:{get:name=>({VINPOKER_ISOLATED_TELEGRAM:'cashier-current-only',TELEGRAM_BOT_TOKEN:'LOCAL_TEST_ONLY_INVALID_TOKEN'})[name]},serve(){}},fetch:(...args)=>{calls.push(args);return Promise.resolve('actual-transport-result');}});
 vm.runInContext(source,context);
 const init={method:'POST',headers:{'Content-Type':'application/json'},body:'{}'};
 assert.equal(await context.fetch('https://api.telegram.org/botLOCAL_TEST_ONLY_INVALID_TOKEN/sendMessage',init),'actual-transport-result');
 assert.equal(calls[0][0],'http://telegram-test-sink:8788/sendMessage');assert.equal(calls[0][1],init);
 await context.fetch('http://kong:8000/rest/v1/rpc/example',init);assert.equal(calls[1][0],'http://kong:8000/rest/v1/rpc/example');
 assert.throws(()=>context.fetch('https://api.telegram.org/botOTHER/sendMessage',init),/denied/);
 assert.throws(()=>context.fetch('https://api.telegram.org/botLOCAL_TEST_ONLY_INVALID_TOKEN/sendMessage',{...init,headers:{apikey:'LOCAL_INVALID'}}),/denied/);
 assert.throws(()=>instrumentCheckoutTelegramForTest(source),/preimage/);
});
