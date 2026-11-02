import assert from 'node:assert/strict';
import {createPaidInitialAssignmentHandler} from './paidTourInitialAssign.native.mjs';
export function createSingle644Assignment({sql,fixture,actor,dealers,log}){
 assert.equal(actor,'febf2b51-fdb7-42ff-886c-b3bb1fffdc3e');
 assert.equal(fixture.club,'d4427834-5f5f-48ef-bde5-e2dc388ed00b');
 assert.equal(fixture.tour,'c367013a-3ed3-48af-ad48-3915acadc50e');
 assert.equal(sql("SELECT host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),'127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');
 const scope=JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_object('table',game_table_id,'session',table_session_id)) FROM public.tournament_tables WHERE tournament_id='${fixture.tour}' AND status='active';`));
 assert.equal(scope.length,2);assert.equal(dealers.length,4);
 assert.ok(dealers.every(id=>/^e6420000-0000-4000-8000-00000000000[1-4]$/.test(id)));
 const native=createPaidInitialAssignmentHandler(sql,{...fixture,actor});
 const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
 return {async invoke(body){
  // Suggestions are a separate read path; never fabricate a successful picker.
  if(body.return_suggestions_only===true)return {status:503,value:{error:'LOCAL_SUGGESTIONS_NOT_YET_CONNECTED'}};
  assert.ok(['assign','receipt','resolve'].includes(body.mode));
  const intent=body.mode==='assign'?body:body.assignment_intent;
  assert.ok(intent&&typeof intent==='object');
  assert.equal(intent.expected_actor_id,actor);assert.equal(intent.expected_club_id,fixture.club);
  if(process.env.VINPOKER_SINGLE659_ASSIGN==='1')assert.deepEqual([intent.table_id,intent.table_session_id,intent.force_dealer_id],
   ['29b12a26-6987-4bfa-810f-bfc64d13ef01','f60106c2-7ed5-4be3-8512-602b16eddff3','e6420000-0000-4000-8000-000000000003']);
  assert.ok(scope.some(row=>row.table===intent.table_id&&row.session===intent.table_session_id));
  assert.ok(dealers.includes(intent.force_dealer_id)&&uuid(intent.idempotency_key));
  if(intent.requested_by!==undefined)assert.equal(intent.requested_by,actor);
  if(intent.shift_id!==undefined)assert.equal(intent.shift_id,'dc91889f-0f73-4e2c-aaf1-d539a6072aed');
  const response=await native.invoke(body),value=await response.json();
  log.push({single644:body.mode,request:intent.idempotency_key,table:intent.table_id,session:intent.table_session_id,dealer:intent.force_dealer_id,status:response.status,result:value});
  return {status:response.status,value};
 },cleanup:native.cleanup};
}
