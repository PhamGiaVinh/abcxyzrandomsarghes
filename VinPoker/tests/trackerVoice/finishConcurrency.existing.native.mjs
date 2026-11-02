import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {computeVoiceFinishSettlement} from '../../supabase/functions/_shared/trackerSettlement/finishAssist.ts';

export async function probeRestoredEntryEliminationVoid(sql,{session,until}){
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');
 assert.equal(sql('SELECT current_database();'),'vinpoker_ops_cash115_qualified_c');
 assert.equal(sql("SELECT host(inet_server_addr())||':'||inet_server_port();"),'127.0.0.1:55441');
 const source=readFileSync('tests/trackerVoice/finishExistingActions191.existing.pg17.sql','utf8').replaceAll('\r','');
 const footer="ROLLBACK;\nSELECT 'FINISH191_FRESH_CHILD_EXISTING_CONFLICT_NEW_BUDGET_RECEIPT_ROLLBACK_PASS';";
 assert.equal(source.split(footer).length,2);
 const fingerprint=()=>sql(`SELECT md5(jsonb_build_object(
  'hands',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_hands x WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'),
  'seats',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'),
  'entries',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'),
  'proof',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_settlement_outcomes x WHERE hand_id='fdb2996a-bb7d-4356-87aa-9d9a1bf281fb'))::text);`);
 const before=fingerprint(),child=session('void192_eliminated_'+randomUUID().replaceAll('-',''));
 const quote=value=>`'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
 const historical=JSON.parse(sql("SELECT to_jsonb(s) FROM public.tournament_seats s WHERE id='d5b6eaeb-1616-493c-9da1-6dea18c97d1f';"));
 const results=()=>child.output().split('\n').filter(row=>row.startsWith('{')).map(row=>JSON.parse(row));
 try{
  child.child.stdin.write(source.replace('BEGIN;',"BEGIN;SET LOCAL test.finish191.prepare='true';")
   .replace(footer,"SELECT current_setting('test.finish191.intent');SELECT 'VOID192_CHILD_READY';")+'\n');
  await until(()=>child.output().includes('VOID192_CHILD_READY'));
  const intent=results()[0],board=['4s','4h','Kc','Qd','Ts'];
  const settled=await computeVoiceFinishSettlement({handId:intent.hand_id,stateVersion:'rollback-elimination',buttonSeat:1,
   communityCards:board,players:intent.payload.players,actions:intent.payload.actions,bettingComplete:true});
  assert.equal(settled.potSize,1200);
  assert.deepEqual(settled.recordPlayers.map(p=>p.ending_stack),[60000,0]);
  child.child.stdin.write(`SET LOCAL ROLE authenticated;SELECT public.update_community_cards('${intent.hand_id}',${quote(board)},'${intent.actor_id}');
   RESET ROLE;SELECT jsonb_build_object('revision',source_revision) FROM public.tournament_hands WHERE id='${intent.hand_id}';SELECT 'VOID192_BOARD_READY';\n`);
  await until(()=>child.output().includes('VOID192_BOARD_READY'));
  const revision=results().find(row=>Object.hasOwn(row,'revision')).revision;
  const finish={...intent,source_revision:revision,payload:{...intent.payload,community_cards:board,players:settled.recordPlayers,
   actions:settled.recordActions,side_pots:settled.sidePots,pot_size:settled.potSize}};
  child.child.stdin.write(`SET LOCAL ROLE authenticated;SELECT public.record_tracker_manual_hand_v1(${quote(finish)});
   RESET ROLE;
   DO $$ DECLARE r jsonb;BEGIN
    ASSERT NOT has_table_privilege('authenticated','floor_private.tracker_hand_seat_snapshots193','SELECT,INSERT,UPDATE,DELETE');
    ASSERT NOT has_table_privilege('service_role','floor_private.tracker_hand_seat_snapshots193','SELECT,INSERT,UPDATE,DELETE');
    ASSERT NOT has_table_privilege('anon','floor_private.tracker_hand_seat_snapshots193','SELECT,INSERT,UPDATE,DELETE');
    ASSERT (SELECT count(*) FROM floor_private.tracker_hand_seat_snapshots193 WHERE hand_id='${intent.hand_id}')=2;
    ASSERT EXISTS(SELECT 1 FROM floor_private.tracker_hand_seat_snapshots193 WHERE hand_id='${intent.hand_id}'
     AND player_id='533feda3-28c5-4194-bdf3-53a07c41305b' AND entry_id='9384eec9-8014-4d38-a1b0-03a35d264aa9'
     AND seat_id='d08e59cf-3f49-4302-8785-1cef5e15e26f' AND table_session_id='ee2b9393-0c96-42f9-8667-7f306edeb9bc' AND seat_number=2);
    PERFORM set_config('role','authenticated',true);
    BEGIN
     UPDATE floor_private.tracker_hand_seat_snapshots193 SET seat_id='d5b6eaeb-1616-493c-9da1-6dea18c97d1f' WHERE hand_id='${intent.hand_id}';
     RAISE EXCEPTION 'authenticated rewrote seat snapshot';
    EXCEPTION WHEN insufficient_privilege THEN NULL;END;
    PERFORM set_config('role','none',true);
    BEGIN
     DELETE FROM floor_private.tracker_hand_seat_snapshots193 WHERE hand_id='${intent.hand_id}' AND seat_number=1;
     PERFORM set_config('role','authenticated',true);
     r:=public.void_last_hand('${intent.hand_id}');ASSERT r->>'error'='void_seat_dependency',r::text;
     RAISE SQLSTATE 'PZ193';
    EXCEPTION WHEN SQLSTATE 'PZ193' THEN NULL;END;
    BEGIN
     UPDATE floor_private.tracker_hand_seat_snapshots193 SET entry_id='96ae5f01-7e6e-4344-895a-2b5cdbf124cd'
      WHERE hand_id='${intent.hand_id}' AND seat_number=2;
     PERFORM set_config('role','authenticated',true);
     r:=public.void_last_hand('${intent.hand_id}');ASSERT r->>'error'='void_seat_dependency',r::text;
     RAISE SQLSTATE 'PZ193';
    EXCEPTION WHEN SQLSTATE 'PZ193' THEN NULL;END;
    BEGIN
     INSERT INTO public.table_session_seat_locks(tournament_id,tournament_table_id,table_session_id,seat_number,reason,locked_by)
     VALUES('${intent.tournament_id}','${intent.tournament_table_id}','${intent.table_session_id}',2,'Snapshot193 rollback TEST','${intent.actor_id}');
     PERFORM set_config('role','authenticated',true);
     r:=public.void_last_hand('${intent.hand_id}');ASSERT r->>'error'='void_seat_locked',r::text;
     RAISE SQLSTATE 'PZ193';
    EXCEPTION WHEN SQLSTATE 'PZ193' THEN NULL;END;
    BEGIN
     -- Model an old hand without captured identity: ambiguity stays denied.
     DELETE FROM floor_private.tracker_hand_seat_snapshots193 WHERE hand_id='${intent.hand_id}';
     PERFORM set_config('role','authenticated',true);
     r:=public.void_last_hand('${intent.hand_id}');ASSERT r->>'error'='void_seat_dependency',r::text;
     RAISE SQLSTATE 'PZ193';
    EXCEPTION WHEN SQLSTATE 'PZ193' THEN NULL;END;
   END $$;
   SET LOCAL ROLE authenticated;SELECT public.void_last_hand('${intent.hand_id}');RESET ROLE;
   DO $$ BEGIN
    ASSERT (SELECT to_jsonb(s) FROM public.tournament_seats s WHERE id='d5b6eaeb-1616-493c-9da1-6dea18c97d1f')=${quote(historical)},'historical seat changed';
    ASSERT (SELECT is_active AND status='active' AND chip_count=600 FROM public.tournament_seats WHERE id='d08e59cf-3f49-4302-8785-1cef5e15e26f'),'void did not restore exact current seat';
    ASSERT (SELECT status='seated' AND current_stack=600 AND busted_at IS NULL FROM public.tournament_entries WHERE id='9384eec9-8014-4d38-a1b0-03a35d264aa9'),'void did not restore entry';
    ASSERT (SELECT count(*)=2 AND sum(chip_count)=60000 FROM public.tournament_seats WHERE tournament_id='${intent.tournament_id}' AND is_active),'void conservation failed';
    ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_eliminations WHERE hand_id='${intent.hand_id}'),'void left elimination';
   END $$;SELECT 'VOID192_ELIMINATION_DONE';\n`);
  await until(()=>child.output().includes('VOID192_ELIMINATION_DONE'));
  const rows=results(),finishResult=rows.at(-2),voidResult=rows.at(-1);
  assert.equal(finishResult.ok,true,JSON.stringify(finishResult));
  console.log('VOID192_ACTUAL_ENGINE_ELIMINATION_FINISH',JSON.stringify({hand:intent.hand_id,endingStacks:[60000,0],voidResult}));
  assert.equal(voidResult.status,'success',JSON.stringify(voidResult));
 }finally{
  if(!child.child.stdin.writableEnded)child.child.stdin.end('ROLLBACK;\n');
  await child.closed;
  assert.equal(fingerprint(),before,'rollback-only elimination changed retained journey');
 }
 console.log('RESTORED_ENTRY_ELIMINATION_FINISH_VOID_ROLLBACK_PASS');
}

export async function probeFinishConcurrency191(sql,{session,until}){
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');
 assert.equal(sql('SELECT current_database();'),'vinpoker_ops_cash115_qualified_c');
 assert.equal(sql("SELECT host(inet_server_addr())||':'||inet_server_port();"),'127.0.0.1:55441');
 assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');"),'f');
 const tour='46cab483-91e7-4220-aacf-e17bdf05269c',actor='675fe35e-60a8-4452-bb90-e79486d54da6';
 const auth=`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';SET LOCAL ROLE authenticated;`;
 const quote=value=>`'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
 const call=q=>JSON.parse(sql(`BEGIN;${auth}${q}COMMIT;`));
 // A completed child is canonically voided afterwards. Audit timestamps may
 // change, but participation, balances and the retained proof must not.
 const business=()=>sql(`SELECT md5(jsonb_build_object(
  'cash',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x WHERE tournament_id='${tour}'),
  'entries',(SELECT jsonb_agg(to_jsonb(x)-'updated_at' ORDER BY id) FROM public.tournament_entries x WHERE tournament_id='${tour}'),
  'seats',(SELECT jsonb_agg(to_jsonb(x)-'updated_at' ORDER BY id) FROM public.tournament_seats x WHERE tournament_id='${tour}'),
  'counts',(SELECT jsonb_agg(to_jsonb(x)-'updated_at' ORDER BY id) FROM public.tournament_chip_counts x WHERE tournament_id='${tour}'),
  'proof10',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_settlement_outcomes x WHERE hand_id='fdb2996a-bb7d-4356-87aa-9d9a1bf281fb'))::text);`);
 const baseline=business(),usage=sql("SELECT has_schema_privilege('authenticated','auth','USAGE');");
 const source=readFileSync('tests/trackerVoice/finishExistingActions191.existing.pg17.sql','utf8');
 const footer="ROLLBACK;\nSELECT 'FINISH191_FRESH_CHILD_EXISTING_CONFLICT_NEW_BUDGET_RECEIPT_ROLLBACK_PASS';";
 const normalized=source.replaceAll('\r','');
 assert.equal(normalized.split(footer).length,2,'exact rollback-only fixture footer required');
 // Only this guarded concurrency runner opts into committing the fresh child.
 const prepare=normalized.replace('BEGIN;',"BEGIN;SET LOCAL test.finish191.prepare='true';")
  .replace(footer,"SELECT current_setting('test.finish191.intent');\nCOMMIT;");
 try{
  if(usage==='f')sql('GRANT USAGE ON SCHEMA auth TO authenticated;');
  for(const sameKey of [true,false]){
   let hand,a,b;
   try{
    const intent=JSON.parse(sql(prepare));hand=intent.hand_id;
    assert.match(hand,/^[a-f0-9-]{36}$/);
    const tag='finish191_'+randomUUID().replaceAll('-','');
    const other=sameKey?intent:{...intent,request_id:randomUUID()};
    const invoke=i=>`SELECT public.record_tracker_manual_hand_v1(${quote(i)});`;
    a=session(tag+'_a');
    a.child.stdin.write(`BEGIN;${auth}${invoke(intent)}SELECT 'FINISH191_A_HELD';\n`);
    await until(()=>a.output().includes('FINISH191_A_HELD'));
    b=session(tag+'_b');b.child.stdin.end(`BEGIN;${auth}${invoke(other)}COMMIT;\n`);
    // The product intentionally uses try-lock/NOWAIT, not a blocking waiter.
    // B must finish while A is still an open transaction and return busy.
    const busyOutput=await b.closed;
    assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${tag}_a'
     AND state='idle in transaction' AND xact_start IS NOT NULL);`),'t');
    const result=out=>JSON.parse(out.split('\n').find(row=>row.startsWith('{')));
    assert.equal(result(busyOutput).error,'manual_finish_busy',busyOutput);
    a.child.stdin.end('COMMIT;\n');
    const first=result(await a.closed),second=call(invoke(other));
    assert.equal(first.ok,true,JSON.stringify(first));
    if(sameKey)assert.deepEqual(second,first,'same-key waiter must recover the exact committed receipt');
    else assert.equal(second.error,'stale_manual_finish_context',JSON.stringify(second));
    assert.equal(sql(`SELECT status||'|'||pot_size||'|'||(SELECT count(*) FROM public.hand_actions WHERE hand_id=h.id) FROM public.tournament_hands h WHERE id='${hand}';`),'completed|1200|5');
    console.log('FINISH191_TRUE_OVERLAP_PASS',JSON.stringify({hand,sameKey,requestA:intent.request_id,requestB:other.request_id}));
   }finally{
    for(const pending of [a,b])if(pending&&!pending.child.stdin.writableEnded)pending.child.stdin.end('ROLLBACK;\n');
    await Promise.allSettled([a?.closed,b?.closed].filter(Boolean));
    if(hand){
     const voided=call(`SELECT public.void_last_hand('${hand}');`);
     assert.equal(voided.status,'success',JSON.stringify(voided));
     assert.equal(sql(`SELECT status||'|'||is_voided FROM public.tournament_hands WHERE id='${hand}';`),'voided|true');
    }
    assert.equal(business(),baseline,'Finish/void changed paid journey business state or retained proof');
   }
  }
 }finally{if(usage==='f')sql('REVOKE USAGE ON SCHEMA auth FROM authenticated;');}
 console.log('FINISH191_TWO_CONCURRENCY_CASES_CANONICAL_VOID_BUSINESS_UNCHANGED_PASS');
}
