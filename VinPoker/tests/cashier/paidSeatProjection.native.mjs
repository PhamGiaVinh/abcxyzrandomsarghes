import assert from 'node:assert/strict';
import {createPaidJourneyFixture} from './paidJourney.fixture.mjs';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';

export async function runPaidSeatProjectionNative(sql,{session,until}) {
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');
 const f=createPaidJourneyFixture(sql);
 const facts=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claim.sub='${f.actor}';
  SELECT jsonb_build_object('entry',(SELECT current_stack FROM public.tournament_entries WHERE id='${f.entry}'),
   'seat',(SELECT chip_count FROM public.tournament_seats WHERE entry_id='${f.entry}' AND is_active),
   'projection',(SELECT chip_count FROM public.tournament_chip_counts WHERE tournament_id='${f.tour}' AND player_id='${f.player}' AND entry_number=1),
   'participation',public.get_tournament_participation_v1('${f.tour}')->'counts');ROLLBACK;`));
 assert.equal(facts.entry,20000);assert.equal(facts.seat,20000);
 assert.equal(facts.projection,20000,'canonical initial paid seating must initialize its exact generation projection');
 assert.equal(facts.participation.seated,1);assert.equal(facts.participation.anomaly_seats,0);
 assert.equal(facts.participation.seated_stack,20000);
 const auth=`SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL request.jwt.claims='{"sub":"${f.actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;`;
 const snapshot=()=>sql(`SELECT jsonb_build_object('entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e WHERE tournament_id='${f.tour}'),
  'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s WHERE tournament_id='${f.tour}'),
  'counts',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.tournament_chip_counts c WHERE tournament_id='${f.tour}'),
  'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m WHERE tournament_id='${f.tour}'),
  'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.seat_draw_receipts r WHERE tournament_id='${f.tour}'))::text;`);
 const before=snapshot();
 const replay=JSON.parse(sql(`BEGIN;${auth}SELECT public.confirm_registration_and_assign_seat('${f.registration}','${f.actor}','random_balanced');COMMIT;`));
 assert.equal(replay.ok,true);assert.equal(replay.idempotent,true);assert.equal(replay.entry_id,f.entry);assert.equal(snapshot(),before);
 const denied=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claim.sub='${f.player}';SET LOCAL ROLE authenticated;
  SELECT public.confirm_registration_and_assign_seat('${f.registration}','${f.player}','random_balanced');ROLLBACK;`));
 assert.equal(denied.error,'actor_not_allowed');assert.equal(snapshot(),before);
 assert.equal(sql("SELECT has_function_privilege('anon','public.confirm_registration_and_assign_seat(uuid,uuid,text)','EXECUTE');"),'f');
 assert.equal(sql("SELECT has_function_privilege('authenticated','public._assign_reentry_seat(uuid,uuid,uuid,uuid,uuid,text,integer)','EXECUTE');"),'f');

 // Existing contract: cash already received remains recorded; only the failed
 // seating subtransaction rolls back. Check before outer disposable ROLLBACK.
 const player=randomUUID();
 sql(`BEGIN;INSERT INTO auth.users(id) VALUES('${player}');
 CREATE FUNCTION pg_temp.fail_paid_projection() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.tournament_id='${f.tour}' AND NEW.player_id='${player}' THEN RAISE EXCEPTION 'TEST_PROJECTION_INSERT_FAIL';END IF;RETURN NEW;END $$;
 CREATE TRIGGER test_paid_projection BEFORE INSERT ON public.tournament_chip_counts FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_paid_projection();
 DO $$ DECLARE reg jsonb; result jsonb; BEGIN
  SET LOCAL ROLE service_role;reg:=public.cashier_create_app_registration_v1('${f.tour}','${player}');RESET ROLE;
  IF reg->>'ok'<>'true' THEN RAISE EXCEPTION 'projection_fault_registration_failed';END IF;
  PERFORM set_config('request.jwt.claim.sub','${f.actor}',true);SET LOCAL ROLE authenticated;
  result:=public.cashier_record_cash_buyin_v1((reg->>'registration_id')::uuid,100000,gen_random_uuid());
  IF result->>'ok'<>'true' OR result->>'payment_state'<>'paid' OR result->>'seating_state'<>'needs_review'
    OR result->>'reason'<>'seating_exception' THEN RAISE EXCEPTION 'projection_fault_outcome_invalid: %',result;END IF;
  RESET ROLE;
  IF EXISTS(SELECT 1 FROM public.tournament_entries WHERE registration_id=(reg->>'registration_id')::uuid)
   OR EXISTS(SELECT 1 FROM public.tournament_seats WHERE tournament_id='${f.tour}' AND player_id='${player}')
   OR EXISTS(SELECT 1 FROM public.tournament_chip_counts WHERE tournament_id='${f.tour}' AND player_id='${player}')
   OR EXISTS(SELECT 1 FROM public.seat_draw_receipts WHERE registration_id=(reg->>'registration_id')::uuid)
   OR EXISTS(SELECT 1 FROM public.tournament_registrations WHERE id=(reg->>'registration_id')::uuid AND status='confirmed')
   THEN RAISE EXCEPTION 'projection_fault_left_partial_effects';END IF;
  IF (SELECT count(*) FROM public.cashier_buyin_movements WHERE registration_id=(reg->>'registration_id')::uuid)<>1
    OR (SELECT sum(applied_amount) FROM public.cashier_buyin_movements WHERE registration_id=(reg->>'registration_id')::uuid)<>100000
    THEN RAISE EXCEPTION 'projection_fault_lost_recorded_cash';END IF;
 END $$;ROLLBACK;`);
 assert.equal(snapshot(),before);
 for(const collision of [true,false]) {
  const outcome=JSON.parse(sql(`BEGIN;
   SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL request.jwt.claim.role='authenticated';
   SET LOCAL request.jwt.claims='{"sub":"${f.actor}","role":"authenticated"}';
   DO $$ DECLARE rev bigint; epoch bigint; reg jsonb; result jsonb; BEGIN
    SELECT x.revision,x.control_epoch INTO rev,epoch FROM public.table_sessions x
     JOIN public.tournament_seats s ON s.table_session_id=x.id WHERE s.entry_id='${f.entry}' AND s.is_active;
    SET LOCAL ROLE authenticated;
    result:=public.floor_bust_player_v3('${f.entry}',rev,epoch,20000,gen_random_uuid(),'projection_reentry_native_TEST');
    IF result->>'ok'<>'true' THEN RAISE EXCEPTION 'projection_reentry_bust_failed: %',result;END IF;
    RESET ROLE;
    PERFORM set_config('request.jwt.claim.sub','',true);PERFORM set_config('request.jwt.claim.role','service_role',true);
    PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);SET LOCAL ROLE service_role;
    reg:=public.cashier_create_app_reentry_v1('${f.tour}','${f.player}');RESET ROLE;
    IF reg->>'ok'<>'true' THEN RAISE EXCEPTION 'projection_reentry_register_failed: %',reg;END IF;
    ${collision?`INSERT INTO public.tournament_chip_counts(tournament_id,player_id,entry_number,chip_count) VALUES('${f.tour}','${f.player}',2,12345);`:''}
    PERFORM set_config('request.jwt.claim.sub','${f.actor}',true);PERFORM set_config('request.jwt.claim.role','authenticated',true);
    PERFORM set_config('request.jwt.claims','{"sub":"${f.actor}","role":"authenticated"}',true);SET LOCAL ROLE authenticated;
    result:=public.cashier_record_cash_buyin_v1((reg->>'registration_id')::uuid,100000,gen_random_uuid());RESET ROLE;
    PERFORM set_config('test.projection_reentry',jsonb_build_object('result',result,
     'new_entries',(SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${f.tour}' AND player_id='${f.player}' AND entry_no=2),
     'projection2',(SELECT chip_count FROM public.tournament_chip_counts WHERE tournament_id='${f.tour}' AND player_id='${f.player}' AND entry_number=2),
     'projection1',(SELECT chip_count FROM public.tournament_chip_counts WHERE tournament_id='${f.tour}' AND player_id='${f.player}' AND entry_number=1))::text,true);
   END $$;SELECT current_setting('test.projection_reentry')::jsonb;ROLLBACK;`));
  // Manual bust retains the previous generation's recorded chip projection;
  // only entry.current_stack becomes zero. Re-entry must not rewrite that row.
  assert.equal(outcome.projection1,20000);
  assert.equal(outcome.result.payment_state,'paid');
  assert.equal(outcome.result.seating_state,collision?'needs_review':'seated');
  if(collision)assert.equal(outcome.result.reason,'stack_projection_generation_conflict');
  assert.equal(outcome.projection2,collision?12345:20000);
  assert.equal(outcome.new_entries,collision?0:1);
  assert.equal(snapshot(),before,'disposable re-entry cases do not alter original fixture');
 }
 console.log('PAID_INITIAL_SEAT_PROJECTION_NATIVE_PASS',JSON.stringify({fixture:f,facts}));
 console.log('PAID_PROJECTION_REPLAY_ACTOR_ACL_FAULT_ATOMICITY_PASS');
 console.log('PAID_REENTRY_PROJECTION_AND_ORPHAN_NO_OVERWRITE_PASS');
 const concurrentPlayer=randomUUID(),request=randomUUID();
 sql(`INSERT INTO auth.users(id) VALUES('${concurrentPlayer}');`);
 const reg=JSON.parse(sql(`BEGIN;SET LOCAL ROLE service_role;
  SELECT public.cashier_create_app_registration_v1('${f.tour}','${concurrentPlayer}');COMMIT;`));
 assert.equal(reg.ok,true);
 const intent={actor_id:f.actor,club_id:f.club,tournament_id:f.tour,registration_id:reg.registration_id,amount:100000,request_id:request};
 const call=`SELECT public.resolve_cashier_cash_buyin_intent_v1('${JSON.stringify(intent)}'::jsonb,'record');`;
 const name='projection_follower_'+request;
 const leader=session('projection_leader_'+request),follower=session(name);
 try {
  leader.child.stdin.write(`BEGIN;${auth}SELECT 'PROJECTION_LOCK_HELD' FROM public.tournament_registrations WHERE id='${reg.registration_id}' FOR UPDATE;\n`);
  await until(()=>leader.output().includes('PROJECTION_LOCK_HELD'));
  follower.child.stdin.end(`BEGIN;${auth}${call}COMMIT;`);
  // The exact-intent resolver intentionally uses NOWAIT, not a waiting lock.
  // Its busy outcome proves the second session ran while the first held it.
  const b=JSON.parse((await follower.closed).trim());
  assert.equal(b.error,'cash_intent_busy');
  leader.child.stdin.end(`${call}COMMIT;`);
  const a=await leader.closed;
  const json=output=>JSON.parse(output.split('\n').find(line=>line.startsWith('{')));
  const retry=JSON.parse(sql(`BEGIN;${auth}${call}COMMIT;`));
  assert.deepEqual(json(a),retry,'busy follower retries the retained key and receives the original receipt');
  assert.equal(json(a).status,'recorded');
 } finally {
  for(const s of [leader,follower])if(s.child.exitCode===null&&!s.child.stdin.writableEnded)s.child.stdin.end('ROLLBACK;');
 }
 const concurrentFacts=JSON.parse(sql(`SELECT jsonb_build_object('entries',(SELECT count(*) FROM public.tournament_entries WHERE registration_id='${reg.registration_id}'),
  'projection',(SELECT chip_count FROM public.tournament_chip_counts WHERE tournament_id='${f.tour}' AND player_id='${concurrentPlayer}' AND entry_number=1),
  'seats',(SELECT count(*) FROM public.tournament_seats WHERE tournament_id='${f.tour}' AND player_id='${concurrentPlayer}' AND is_active),
  'movements',(SELECT count(*) FROM public.cashier_buyin_movements WHERE registration_id='${reg.registration_id}'),
  'paid',(SELECT sum(applied_amount) FROM public.cashier_buyin_movements WHERE registration_id='${reg.registration_id}'))`));
 assert.deepEqual(concurrentFacts,{entries:1,projection:20000,seats:1,movements:1,paid:100000});
 console.log('PAID_PROJECTION_TRUE_OVERLAP_SAME_KEY_PASS',JSON.stringify({request,concurrentFacts}));
 const acls=()=>sql(`SELECT jsonb_agg(jsonb_build_object('oid',oid,'acl',proacl::text) ORDER BY oid)::text FROM pg_proc WHERE pronamespace='public'::regnamespace;`);
 const aclBefore=acls();
 const containment=readFileSync('docs/emergency_rollbacks/20270128000139_paid_projection_suspend.sql','utf8');
 assert.match(containment,/COMMIT;\s*$/);
 sql(containment.replace(/COMMIT;\s*$/,()=>`DO $$ DECLARE fn text; role_name text; BEGIN
  FOREACH fn IN ARRAY ARRAY['public.confirm_registration_and_assign_seat(uuid,uuid,text)',
   'public.confirm_reentry_and_assign_seat(uuid,uuid,text)','public.cashier_record_cash_buyin_v1(uuid,bigint,uuid)',
   'public.resolve_cashier_cash_buyin_intent_v1(jsonb,text)','public.cashier_record_verified_bank_v1(uuid,boolean)',
   'public.cashier_retry_paid_seating_v1(boolean,integer)'] LOOP
   FOREACH role_name IN ARRAY ARRAY['authenticated','service_role'] LOOP
    IF has_function_privilege(role_name,fn,'EXECUTE') THEN RAISE EXCEPTION 'containment_path_still_callable: % %',fn,role_name;END IF;
   END LOOP;
  END LOOP;
 END $$;ROLLBACK;`));
 assert.equal(acls(),aclBefore,'containment rehearsal restores every original public function ACL');
 console.log('PAID_PROJECTION_CONTAINMENT_OUTER_PATHS_ROLLBACK_PASS');
 return f;
}
