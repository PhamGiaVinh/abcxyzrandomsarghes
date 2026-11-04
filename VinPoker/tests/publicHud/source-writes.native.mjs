import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {writeFileSync} from 'node:fs';
import {sql,jsonSql,sqlAsync,service} from './nativeDb.mjs';
const tour='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',number=9_910_001;
const operations=[],hands=new Set(),checked=[];
const op=()=>{const id=randomUUID();operations.push(id);return id;};
const query=(id,step,hand=null,tournament=tour)=>`${service}SELECT public.fixture_scale_step_once_v1('${id}','${tournament}',${number},${step},${hand?`'${hand}'`:'NULL'});`;
try{
 const opening=op();const replies=await Promise.all([sqlAsync(query(opening,0)),sqlAsync(query(opening,0))]);
 assert.equal(replies[0],replies[1]);const started=JSON.parse(replies[0]);hands.add(started.handId);
 assert.equal(Number(sql(`SELECT count(*) FROM public.tournament_hands WHERE tournament_id='${tour}' AND hand_number=${number};`)),1);checked.push('concurrent-open-one-hand');
 for(let step=1;step<=5;step++){
  const id=op(),first=jsonSql(query(id,step,started.handId));
  // The first transaction committed, but its response may have been lost.
  // A later client retry must return the same event timestamp and generation.
  await new Promise(resolve=>setTimeout(resolve,20));
  const again=jsonSql(query(id,step,started.handId));assert.deepEqual(again,first);
  if(step<5)assert.equal(Number(sql(`SELECT count(*) FROM public.hand_actions WHERE hand_id='${started.handId}' AND action_order=${step};`)),1);
 }
 checked.push('committed-response-replay','action-step-once','completion-retry');
 assert.equal(sql(`SELECT status FROM public.tournament_hands WHERE id='${started.handId}';`),'completed');
 assert.equal(Number(sql(`SELECT count(*) FROM public.hand_actions WHERE hand_id='${started.handId}';`)),4);
 assert.throws(()=>sql(query(opening,0,null,other)),/fixture_operation_conflict/);checked.push('operation-key-scope-conflict');
 const failed=op();assert.throws(()=>sql(query(failed,99)),/invalid_step/);
 assert.equal(Number(sql(`SELECT count(*) FROM spectator_projection_v2.fixture_source_operations WHERE operation_id='${failed}';`)),0);checked.push('failed-operation-rolls-back');
 for(const role of ['anon','authenticated'])assert.throws(()=>sql(`SET ROLE ${role};SELECT public.fixture_scale_step_once_v1('${op()}','${tour}',${number},0,NULL);`),/permission denied/);
 assert.throws(()=>sql(`${service}SELECT * FROM spectator_projection_v2.fixture_source_operations;`),/permission denied/);checked.push('browser-execute-denied','private-receipt-read-denied');
 const report={kind:'NATIVE_POSTGRESQL_FIXTURE_INTENT_IDEMPOTENCY_NOT_PRODUCTION_WRITER',checked,passed:true};
 if(process.env.PUBLIC_HUD_SOURCE_WRITE_REPORT)writeFileSync(process.env.PUBLIC_HUD_SOURCE_WRITE_REPORT,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{
 if(hands.size){const ids=[...hands].map(id=>`'${id}'::uuid`).join(',');
  assert.equal(Number(sql(`SELECT count(*) FROM tracker_analytics_v1.hand_contributions WHERE hand_id IN (${ids});`)),0);
  sql(`BEGIN;DELETE FROM public.hand_actions WHERE hand_id IN (${ids});DELETE FROM public.hand_players WHERE hand_id IN (${ids});DELETE FROM public.tournament_hands WHERE id IN (${ids});DELETE FROM tracker_analytics_v1.jobs WHERE kind='hand' AND entity_id IN (${ids});COMMIT;`);
 }
 sql(`DELETE FROM spectator_projection_v2.fixture_source_operations WHERE operation_id IN (${operations.map(id=>`'${id}'::uuid`).join(',')});`);
}
