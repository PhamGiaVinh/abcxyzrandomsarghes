import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPaidJourneyFixture} from './paidJourney.fixture.mjs';
import {resolveScheduleBatchResult} from '../../src/lib/tournamentScheduleBatch.ts';

export async function runScheduleBatchNative(sql,{session,until}) {
 assert.equal(sql('SELECT current_database();'),'vinpoker_ops_cash115_qualified_c');
 const f=createPaidJourneyFixture(sql),other=createPaidJourneyFixture(sql),request=randomUUID();
 const prefix=`Schedule batch ${randomUUID()} TEST`;
 const rows=[1,2].map(i=>({club_id:f.club,name:`${prefix} ${i}`,start_time:'2026-10-18T10:00:00+07:00',buy_in:100000,starting_stack:20000,game_type:'nlh',location:null}));
 const encoded=value=>`'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
 const auth=`SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${f.actor}"}';SET LOCAL ROLE authenticated;`;
 const call=(name,payload=rows,key=request,actor=f.actor)=>JSON.parse(sql(`BEGIN;${auth}SELECT public.${name}(${encoded(payload)},'${key}','${actor}');COMMIT;`));
 const result=call('create_tournament_schedule_batch_v1');assert.equal(result.ok,true,JSON.stringify(result));
 assert.equal(result.count,2);assert.equal(result.actor_id,f.actor);assert.equal(result.request_id,request);
 assert.equal(resolveScheduleBatchResult(result,{p_expected_actor_id:f.actor,p_request_id:request,p_rows:rows}).length,2);
 assert.equal(new Set(result.tournaments.map(t=>t.tournament_id)).size,2);
 assert.deepEqual(call('create_tournament_schedule_batch_v1'),result);
 assert.deepEqual(call('get_tournament_schedule_batch_receipt_v1'),result);
 if(process.argv.includes('--schedule-batch-cancel')) {
  assert.deepEqual(call('cancel_tournament_schedule_batch_v1'),result,'cancel after commit must preserve existing tours');
  const cancelRows=rows.map(r=>({...r,name:r.name+' cancelled'})),cancelKey=randomUUID();
  const cancelled=call('cancel_tournament_schedule_batch_v1',cancelRows,cancelKey);
  assert.equal(cancelled.outcome,'cancelled');assert.equal(cancelled.actor_id,f.actor);assert.equal(cancelled.request_id,cancelKey);
  assert.deepEqual(call('create_tournament_schedule_batch_v1',cancelRows,cancelKey),cancelled,'late writer must observe tombstone');
  assert.deepEqual(call('get_tournament_schedule_batch_receipt_v1',cancelRows,cancelKey),cancelled);
  assert.equal(call('cancel_tournament_schedule_batch_v1',rows,cancelKey).error,'IDEMPOTENCY_CONFLICT');
  assert.equal(sql(`SELECT count(*) FROM public.tournaments WHERE name LIKE '${prefix}% cancelled';`),'0');
  assert.equal(sql("SELECT has_function_privilege('anon','public.cancel_tournament_schedule_batch_v1(jsonb,uuid,uuid)','EXECUTE') OR has_function_privilege('service_role','public.cancel_tournament_schedule_batch_v1(jsonb,uuid,uuid)','EXECUTE');"),'f');
  console.log('SCHEDULE_BATCH_CANCEL_BEFORE_AFTER_COMMIT_LATE_WRITE_NO_DELETE_PASS');
 }
 assert.equal(call('create_tournament_schedule_batch_v1',[{...rows[0],name:'changed TEST'},rows[1]]).error,'IDEMPOTENCY_CONFLICT');
 assert.equal(call('get_tournament_schedule_batch_receipt_v1',rows,request,other.actor).error,'actor_changed');
 assert.equal(call('create_tournament_schedule_batch_v1',[rows[0],{...rows[1],club_id:other.club}],randomUUID()).error,'actor_not_allowed');
 const ids=result.tournaments.map(t=>`'${t.tournament_id}'::uuid`).join(',');
 const saved=JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_object('club',club_id,'buyin',buy_in,'stack',starting_stack,'live',live_status) ORDER BY name) FROM public.tournaments WHERE id=ANY(ARRAY[${ids}]);`));
 assert.ok(saved.every(t=>t.club===f.club&&t.buyin===100000&&t.stack===20000&&t.live==='registering'));
 assert.equal(sql(`SELECT count(*) FROM public.tournaments WHERE name LIKE '${prefix}%';`),'2');
 assert.equal(sql(`SELECT count(*) FROM public.tournament_levels WHERE tournament_id=ANY(ARRAY[${ids}]);`),'0');
 assert.equal(sql(`SELECT count(*) FROM public.cashier_buyin_movements WHERE tournament_id=ANY(ARRAY[${ids}]);`),'0');
 // Trigger rejects the SECOND child only; wrapper must roll back the first child
 // and its receipt too. Test-only DDL is fully removed by ROLLBACK.
 const faultRows=rows.map((r,i)=>({...r,name:`${prefix} fault ${i}`}));
 const fault=JSON.parse(sql(`BEGIN;
 CREATE FUNCTION floor_private.schedule_batch_test_fault() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN IF NEW.name='${prefix} fault 1' THEN RAISE EXCEPTION 'local schedule fault'; END IF;RETURN NEW;END $$;
 CREATE TRIGGER schedule_batch_test_fault BEFORE INSERT ON public.tournaments FOR EACH ROW EXECUTE FUNCTION floor_private.schedule_batch_test_fault();
 ${auth}
 DO $verify$ DECLARE outcome jsonb; BEGIN
 outcome:=public.create_tournament_schedule_batch_v1(${encoded(faultRows)},'${randomUUID()}','${f.actor}');
 IF outcome->>'ok' IS DISTINCT FROM 'false' OR outcome->>'error' IS DISTINCT FROM 'schedule_batch_rejected' THEN
  RAISE EXCEPTION 'fault did not reject batch'; END IF;
 IF EXISTS(SELECT 1 FROM public.tournaments WHERE name LIKE '${prefix} fault%') THEN
  RAISE EXCEPTION 'first child leaked before outer rollback'; END IF;
 END $verify$;
 RESET ROLE;
 SELECT jsonb_build_object('ok',false,'error','schedule_batch_rejected','remaining',count(*)) FROM public.tournaments WHERE name LIKE '${prefix} fault%';
 ROLLBACK;`));
 assert.equal(fault.ok,false);assert.equal(fault.error,'schedule_batch_rejected');assert.equal(fault.remaining,0);
 assert.equal(sql(`SELECT count(*) FROM public.tournaments WHERE name LIKE '${prefix}%';`),'2');
 assert.equal(sql("SELECT to_regprocedure('floor_private.schedule_batch_test_fault()') IS NULL;"),'t');
 for(const name of ['create_tournament_schedule_batch_v1','get_tournament_schedule_batch_receipt_v1']) {
  assert.equal(sql(`SELECT has_function_privilege('anon','public.${name}(jsonb,uuid,uuid)','EXECUTE') OR has_function_privilege('service_role','public.${name}(jsonb,uuid,uuid)','EXECUTE');`),'f');
 }
 const cases=process.argv.includes('--schedule-batch-cancel')?[['create','create'],['cancel','create'],['create','cancel']]:[['create','create']];
 for(const [leaderOp,followerOp] of cases) {
 const suffix=` parallel ${leaderOp}_${followerOp}`;
 const parallelRows=rows.map(r=>({...r,name:r.name+suffix})),parallelKey=randomUUID();
 const app='schedule_batch_'+randomUUID().replaceAll('-','');
 const leader=session(app+'_leader'),follower=session(app+'_follower');
 const statement=op=>`SELECT public.${op}_tournament_schedule_batch_v1(${encoded(parallelRows)},'${parallelKey}','${f.actor}');`;
 try {
  leader.child.stdin.write(`BEGIN;SELECT floor_private.floor_table_v3_lock_receipt('${f.actor}','create_tournament_schedule_batch_v1','${parallelKey}');SELECT 'SCHEDULE_LOCKED';\n`);
  await until(()=>leader.output().includes('SCHEDULE_LOCKED'));
  follower.child.stdin.end(`BEGIN;${auth}${statement(followerOp)}COMMIT;\n`);
  await until(()=>sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${app}_follower' AND wait_event_type='Lock' AND wait_event='advisory');`)==='t');
  leader.child.stdin.end(`${auth}${statement(leaderOp)}COMMIT;\n`);
  const [one,two]=await Promise.all([leader.closed,follower.closed]);
  const parse=output=>JSON.parse(output.split('\n').find(line=>line.startsWith('{')));
  assert.deepEqual(parse(one),parse(two));assert.equal(parse(one).count,2);
  assert.equal(sql(`SELECT count(*) FROM public.tournaments WHERE name LIKE '${prefix}%${suffix}';`),leaderOp==='cancel'?'0':'2');
  if(leaderOp==='cancel')assert.equal(parse(one).outcome,'cancelled');
  console.log('SCHEDULE_BATCH_REAL_OVERLAP_ADVISORY_BARRIER_SAME_RECEIPT_PASS',JSON.stringify({parallelKey,leaderOp,followerOp}));
 } finally {
  for(const task of [leader,follower])if(task.child.exitCode===null&&!task.child.stdin.destroyed)task.child.stdin.end('ROLLBACK;\n\\q\n');
 }
 }
 console.log('SCHEDULE_BATCH_NATIVE_COMMIT_REPLAY_CONFLICT_TENANT_LATE_FAULT_ROLLBACK_PASS',JSON.stringify({request,tours:result.tournaments.map(t=>t.tournament_id)}));
}
