import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHistoricalDisplayBrowser} from './historicalDisplayBrowser.local.mjs';

const tour='11111111-1111-4111-8111-111111111111';
const actor='22222222-2222-4222-8222-222222222222';
const hand='33333333-3333-4333-8333-333333333333';

test('local display bridge rejects unsafe scope before service RPC dispatch',async()=>{
 const previous=process.env.VINPOKER_NATIVE_BROWSER;
 process.env.VINPOKER_NATIVE_BROWSER='1';
 const commands=[];let reads=0;
 const log=[];
 const sql=statement=>{
  commands.push(statement);
  if(statement.includes('current_database()'))return 'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441';
  if(statement.includes('pg_extension'))return 'f';
  if(statement.startsWith('CREATE ROLE ')||statement.startsWith('DROP ROLE '))return '';
  assert.fail('unexpected service SQL dispatch');
 };
 let bridge;
 try{
  bridge=createHistoricalDisplayBrowser({sql,query:()=>{reads++;return false;},fixture:{tour},actor,log});
  const body={mode:'preview',tournament_id:tour,hand_id:hand};
  await assert.rejects(bridge.invoke({...body,mode:'backfill'}));
  await assert.rejects(bridge.invoke({...body,tournament_id:actor}));
  await assert.rejects(bridge.invoke({...body,hand_id:"not-a-uuid'"}));
  await assert.rejects(bridge.invoke(body),/only hands created in this local browser run/);
  log.push({edgeRpc:'start_tracker_hand_v3',status:'error',handId:hand});
  await assert.rejects(bridge.invoke(body),/only hands created in this local browser run/);
  assert.equal(reads,0);
  log.push({edgeRpc:'start_tracker_hand_v3',status:'success',handId:hand});
  // A started hand which is no longer completed/nonvoid must still be denied.
  await assert.rejects(bridge.invoke(body));
  assert.equal(reads,1);
  assert.equal(commands.length,3,'only catalog guards and role creation, no service transaction');
  assert.equal(log.some(row=>row.displayRpc||row.displayMode),false);
 }finally{
  bridge?.dispose();
  if(previous===undefined)delete process.env.VINPOKER_NATIVE_BROWSER;
  else process.env.VINPOKER_NATIVE_BROWSER=previous;
 }
 assert.match(commands.at(-1),/^DROP ROLE display_browser_/);
});
