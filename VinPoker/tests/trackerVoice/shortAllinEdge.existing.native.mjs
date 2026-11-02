import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {runTrackerBrowserEdge} from './trackerBrowserEdge.local.mjs';

export async function probeShortAllinEdge(sql){
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');
 assert.equal(process.env.VINPOKER_NATIVE_BROWSER,'1');
 assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441');
 const tour='46cab483-91e7-4220-aacf-e17bdf05269c',actor='675fe35e-60a8-4452-bb90-e79486d54da6';
 const table='d294f4a4-082b-4efc-a6ca-1f96579ea344',session='ee2b9393-0c96-42f9-8667-7f306edeb9bc';
 assert.equal(sql(`SELECT count(*) FROM public.tournament_tables t JOIN public.table_sessions s ON s.id=t.table_session_id
 JOIN public.tournaments tr ON tr.id=t.tournament_id JOIN public.clubs c ON c.id=tr.club_id JOIN public.club_settings cs ON cs.club_id=c.id
 WHERE t.id='${table}' AND s.id='${session}' AND tr.id='${tour}' AND tr.name='Cash identity local TEST'
 AND c.owner_id='${actor}' AND NOT cs.auto_swing_enabled AND s.closed_at IS NULL AND s.control_mode='tracker'
 AND NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE tournament_id=tr.id AND status='in_progress');`),'1');
 const auth=`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';SET LOCAL ROLE authenticated;`;
 const query=statement=>JSON.parse(sql(`BEGIN;${auth}${statement}COMMIT;`));
 const business=()=>sql(`SELECT md5(jsonb_build_object(
 'cash',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x WHERE tournament_id='${tour}'),
 'entries',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x WHERE tournament_id='${tour}'),
 'seats',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x WHERE tournament_id='${tour}'),
 'proof4',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_settlement_outcomes x WHERE hand_id='4ce3c57e-4521-48eb-813c-993d75d6a7e9'),
 'proof10',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_settlement_outcomes x WHERE hand_id='fdb2996a-bb7d-4356-87aa-9d9a1bf281fb'))::text);`);
 const before=business(),usage=sql("SELECT has_schema_privilege('authenticated','auth','USAGE');");
 let hand;const log=[];
 try{
  if(usage==='f')sql('GRANT USAGE ON SCHEMA auth TO authenticated;');
  const n=Number(sql(`SELECT coalesce(max(hand_number),0)+1 FROM public.tournament_hands WHERE tournament_id='${tour}';`));
  const epoch=sql(`SELECT control_epoch FROM public.table_sessions WHERE id='${session}';`);
  const startResponse=await runTrackerBrowserEdge({body:{action:'start_hand',tournament_id:tour,
   tournament_table_id:table,table_session_id:session,control_epoch:Number(epoch),hand_number:n,
   hand_time:new Date().toISOString(),button_seat:1},fixture:{tour},user:{id:actor},query,log,validationMode:'enforce'});
  const started=await startResponse.json();
  assert.equal(startResponse.status,200,JSON.stringify(started));assert.equal(started.data?.status,'success',JSON.stringify(started));
  hand=sql(`SELECT id FROM public.tournament_hands WHERE tournament_id='${tour}' AND hand_number=${n};`);
  assert.match(hand,/^[a-f0-9-]{36}$/);
  assert.equal(sql(`SELECT count(*) FROM floor_private.tracker_hand_seat_snapshots193 WHERE hand_id='${hand}';`),'2');
  console.log('LOCAL_ACTUAL_EDGE_EXACT_CONTEXT_START193_SNAPSHOT_PASS',JSON.stringify({hand,number:n}));
  assert.equal(query(`SELECT public.heartbeat_lock('${hand}','${actor}');`).status,'success');
  const players=JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_object('id',player_id,'entry',entry_number,'stack',starting_stack) ORDER BY seat_number) FROM public.hand_players WHERE hand_id='${hand}';`));
  assert.deepEqual(players.map(p=>p.stack),[59400,600]);
  const edge=async(player,type,amount,order)=>{
   const response=await runTrackerBrowserEdge({body:{action:'record_action',tournament_id:tour,hand_id:hand,player_id:player.id,
    entry_number:player.entry,street:'preflop',action_type:type,action_amount:amount,action_order:order,idempotency_key:randomUUID(),trace_id:randomUUID()},
    fixture:{tour},user:{id:actor},query,log,validationMode:'enforce'});
   return {status:response.status,body:await response.json()};
  };
  for(const [player,type,amount,order] of [[players[0],'post_sb',100,1],[players[1],'post_bb',200,2],[players[0],'raise',400,3],[players[1],'all_in',400,4]]){
   const r=await edge(player,type,amount,order);assert.equal(r.status,200,JSON.stringify(r));
  }
  const snapshot=()=>sql(`SELECT md5(jsonb_build_object('hand',(SELECT to_jsonb(h) FROM public.tournament_hands h WHERE id='${hand}'),'actions',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.hand_actions a WHERE hand_id='${hand}'))::text);`);
  const staged=snapshot();
  for(const [type,amount] of [['raise',500],['all_in',58900]]){
   const r=await edge(players[0],type,amount,5);
   assert.equal(r.status,422,JSON.stringify(r));assert.equal(r.body.code,'ACTION_NOT_REOPENED',JSON.stringify(r));
   assert.equal(snapshot(),staged,'enforced rejected action changed hand revision/actions');
  }
  const call=await edge(players[0],'call',100,5);assert.equal(call.status,200,JSON.stringify(call));
  assert.equal(sql(`SELECT count(*)||'|'||sum(action_amount) FROM public.hand_actions WHERE hand_id='${hand}';`),'5|1200');
  assert.equal(log.filter(x=>x.edgeRpc==='record_action').length,5,'rejected actions reached DB writer');
  console.log('LOCAL_ACTUAL_EDGE_ENFORCE_SHORT_ALLIN_RAISE_SHOVE_422_NO_DELTA_CALL100_PASS',JSON.stringify({hand,number:n,mode:'enforce',sum:1200}));
 }finally{
  try{
   if(hand){const r=query(`SELECT public.void_last_hand('${hand}');`);assert.equal(r.status,'success',JSON.stringify(r));
    assert.equal(sql(`SELECT status||'|'||is_voided FROM public.tournament_hands WHERE id='${hand}';`),'voided|true');}
   assert.equal(business(),before,'child probe changed paid tour money/entry/seats/current proof');
   console.log('LOCAL_SHORT_ALLIN_CHILD_VOID_MARKER_FINANCIAL_PROOF_UNCHANGED_PASS');
  }finally{if(usage==='f')sql('REVOKE USAGE ON SCHEMA auth FROM authenticated;');}
 }
}
