import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function probeActionStackConcurrency(sql,{session,until,update=false}){
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');
 assert.equal(sql('SELECT current_database();'),'vinpoker_ops_cash115_qualified_c');
 const tour='46cab483-91e7-4220-aacf-e17bdf05269c',actor='675fe35e-60a8-4452-bb90-e79486d54da6';
 const table='d294f4a4-082b-4efc-a6ca-1f96579ea344',tableSession='ee2b9393-0c96-42f9-8667-7f306edeb9bc';
 assert.equal(sql(`SELECT count(*) FROM public.table_sessions s JOIN public.tournament_tables t ON t.table_session_id=s.id
  JOIN public.tournaments tr ON tr.id=t.tournament_id JOIN public.clubs c ON c.id=tr.club_id
  WHERE s.id='${tableSession}' AND t.id='${table}' AND tr.id='${tour}' AND tr.name='Cash identity local TEST'
  AND c.owner_id='${actor}' AND s.closed_at IS NULL AND s.control_mode='tracker'
  AND NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE tournament_id=tr.id AND status='in_progress');`),'1');
 const state=JSON.parse(sql(`SELECT jsonb_build_object('epoch',control_epoch) FROM public.table_sessions WHERE id='${tableSession}';`));
 const auth=`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';SET LOCAL ROLE authenticated;`;
 const call=q=>JSON.parse(sql(`BEGIN;${auth}${q}COMMIT;`));
 const business=()=>sql(`SELECT md5(jsonb_build_object(
  'cash',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x WHERE tournament_id='${tour}'),
  'entries',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x WHERE tournament_id='${tour}'),
  'seats',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x WHERE tournament_id='${tour}'),
  'proof4',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_settlement_outcomes x WHERE hand_id='4ce3c57e-4521-48eb-813c-993d75d6a7e9'))::text);`);
 const before=business(),usage=sql("SELECT has_schema_privilege('authenticated','auth','USAGE');");
 let hand,a,b;
 try{
  if(usage==='f')sql('GRANT USAGE ON SCHEMA auth TO authenticated;');
  const number=Number(sql(`SELECT coalesce(max(hand_number),0)+1 FROM public.tournament_hands WHERE tournament_id='${tour}';`));
  const started=call(`SELECT public.start_tracker_hand_v3('${tour}','${table}','${tableSession}',${state.epoch},${number},now(),'${actor}',1);`);
  assert.equal(started.status,'success',JSON.stringify(started));
  hand=sql(`SELECT id FROM public.tournament_hands WHERE tournament_id='${tour}' AND hand_number=${number} AND table_id='${table}';`);
  assert.match(hand,/^[a-f0-9-]{36}$/);
  assert.equal(call(`SELECT public.heartbeat_lock('${hand}','${actor}');`).status,'success');
  const short=JSON.parse(sql(`SELECT jsonb_build_object('player',player_id,'entry',entry_number) FROM public.hand_players WHERE hand_id='${hand}' AND starting_stack=600;`));
  assert.ok(short);
  const record=(amount,order,key)=>`SELECT public.record_action('${hand}','${short.player}','bet',${order},${short.entry},'preflop',${amount},'${key}',NULL,'${actor}');`;
  const keyA=randomUUID(),keyB=randomUUID(),tag='stack189_'+randomUUID().replaceAll('-','');
  if(update)assert.equal(call(record(400,1,randomUUID())).status,'success');
  // Each proposal fits the initial600; together400+300 exceed it.
  a=session(tag+'_a');a.child.stdin.write(`BEGIN;${auth}${record(update?200:400,update?2:1,keyA)}SELECT 'STACK189_A_STAGED';\n`);
  await until(()=>a.output().includes('STACK189_A_STAGED'));
  const updateProbe=`DO $$ BEGIN
    UPDATE public.hand_actions SET action_amount=450 WHERE hand_id='${hand}' AND action_order=1;
    RAISE EXCEPTION 'STACK189_STALE_UPDATE_BUDGET_ACCEPTED';
    EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='tracker_action_stack_exceeded',SQLERRM;END $$;
    SELECT jsonb_build_object('error','tracker_action_stack_exceeded');`;
  b=session(tag+'_b');b.child.stdin.end(`BEGIN;${auth}${update?updateProbe:record(300,2,keyB)}COMMIT;\n`);
  await until(()=>sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name='${tag}_b' AND wait_event_type='Lock';`)==='1');
  a.child.stdin.end('COMMIT;\n');
  const [outA,outB]=await Promise.all([a.closed,b.closed]);
  const results=out=>out.split('\n').filter(x=>x.startsWith('{')).map(x=>JSON.parse(x));
  assert.equal(results(outA)[0].status,'success');
  assert.equal(results(outB)[0].error,'tracker_action_stack_exceeded');
  assert.equal(sql(`SELECT count(*)||'|'||sum(action_amount) FROM public.hand_actions WHERE hand_id='${hand}';`),update?'2|600':'1|400');
  console.log(update?'STACK189_TRUE_OVERLAP_DIRECT_UPDATE_RECHECK_450_PLUS_200_DENIED':'STACK189_TRUE_OVERLAP_PARENT_LOCK_WAITER_RECHECK_400_PLUS_300_DENIED',JSON.stringify({hand,requestA:keyA,requestB:update?null:keyB}));
 }finally{
  // Close sessions before canonical void. That existing RPC clears active-hand
  // action rows; retain its void marker, never manually clean up ledger/history.
  for(const pending of [a,b])if(pending&&!pending.child.stdin.writableEnded)pending.child.stdin.end('ROLLBACK;\n');
  await Promise.allSettled([a?.closed,b?.closed].filter(Boolean));
  try{
   if(hand){const voided=call(`SELECT public.void_last_hand('${hand}');`);assert.equal(voided.status,'success',JSON.stringify(voided));}
   assert.equal(business(),before,'negative child probe changed paid journey money/entry/seat/proof');
   if(hand)assert.equal(sql(`SELECT status||'|'||is_voided FROM public.tournament_hands WHERE id='${hand}';`),'voided|true');
  }finally{if(usage==='f')sql('REVOKE USAGE ON SCHEMA auth FROM authenticated;');}
 }
 console.log('STACK189_CANONICAL_VOID_MARKER_RETAINED_BUSINESS_UNCHANGED_PASS');
}
