import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createFakeSePayServer,fixtureAccountId} from './fake-sepay-server.mjs';
test('isolated provider matches current account and transaction pagination contract',async()=>{
 const server=createFakeSePayServer('TEST-ONLY-REFERENCE');server.listen(0,'127.0.0.1');await once(server,'listening');
 const base=`http://127.0.0.1:${server.address().port}`;
 const get=(path,authenticated=true)=>fetch(base+path,{headers:authenticated?{Authorization:'Bearer cashier-edge-fake-token'}:{}});
 try{
  assert.equal((await get('/v2/transactions?account_number=999100001',false)).status,401);
  const accounts=await (await get('/v2/bank-accounts?q=999100001&per_page=100&page=1')).json();
  assert.deepEqual(accounts.data,[{id:fixtureAccountId,account_number:'999100001',active:true}]);
  const path=`/v2/transactions?bank_account_id=${fixtureAccountId}&transaction_date_from=2026-01-01&transaction_date_to=2027-01-01&transaction_date_sort=asc&per_page=100&page=1`;
  const first=await(await get(path)).json(),second=await(await get(path)).json();
  assert.deepEqual(first,second,'Provider retry retains the same transaction identity and timestamp');
  assert.equal(first.data[0].bank_account_id,fixtureAccountId);assert.equal(first.data[0].transaction_content,'TEST-ONLY-REFERENCE');
  assert.deepEqual(first.meta.pagination,{total:1,current_page:1,last_page:1,has_more:false});
  assert.equal((await get(path.replace(fixtureAccountId,'wrong'))).status,400);
  assert.equal((await get('/v2/transactions?account_number=999100001&page=1')).status,400);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
