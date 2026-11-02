import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// Intentionally consumes only the owned814 copy of the old negative fixture.
// Keeps all canonical commits/audit; never resets the original primary journeys.
export async function verifyRetainedSeed846Commit({sql,session,until}){
 assert.equal(process.env.VINPOKER_D2_846_COMMIT,'1');
 assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),'vinpoker_checkout814_race_local|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');
 assert.equal(sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'VINPOKER_CHECKOUT814_OWNED_LOCAL_CLONE_SOURCE_vinpoker_fnb719_gate_local_HEAD_ef6a26948');
 assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink');"),'0');
 assert.equal(sql("SELECT to_regclass('private.d2_seed846_commit_fixture') IS NULL;"),'t','846 consumed; inspect retained proof, never reset/replay');
 assert.equal(sql("SELECT md5(pg_get_functiondef('public.multi_day_apply_initial_draw_v1(uuid,uuid)'::regprocedure));"),'e5477fb2a8220f9b4cc1ff5c3401dac6');
 assert.equal(sql("SELECT md5(pg_get_functiondef('public.multi_day_correct_final_seed_v1(uuid,uuid,bigint,integer,text,text,uuid)'::regprocedure));"),'4b209eeaaf17a2579ebf80c952bcc9b7');
 const event='e6551af0-e6d0-4fb0-9342-fdd7465fcaf2',final='0f56388a-c47f-48fd-970a-4f5589627d4b',club='399956aa-7858-422a-ad34-ca7ee52ff64d',actor='ba3e052f-27d5-4da5-b832-0b5d9cecbf2f',part='4c1fcee6-2e45-40ed-b57b-6b6b8ae60668',oldPlan='57178526-818d-4549-9660-28909254a03f';
 const quote=x=>"'"+String(x).replaceAll("'","''")+"'";
 const claims=`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';SET LOCAL ROLE authenticated;`;
 const call=q=>JSON.parse(sql(`BEGIN;${claims}${q}COMMIT;`));
 const roster=call(`SELECT public.multi_day_final_roster_v1('${event}');`);
 assert.equal(roster.players.length,1);assert.equal(roster.players[0].state,'UNSEATED');assert.equal(roster.players[0].stack,20000);assert.equal(roster.players[0].seedRevision,0);
 const player=roster.players[0].playerId,stored=JSON.parse(sql(`SELECT receipt FROM private.multi_day_initial_draw_plans_v1 WHERE id='${oldPlan}' AND actor_id='${actor}';`));
 assert.equal(stored.sourceHash,roster.sourceHash);
 const order=(a,b)=>a.tournamentTableId.localeCompare(b.tournamentTableId);
 assert.deepEqual([...roster.tables].sort(order),[...stored.selectedTables].sort(order));
 assert.equal(sql(`SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${final}';`),'0');
 assert.equal(sql(`SELECT count(*) FROM public.multi_day_final_requests_v1 WHERE participation_id='${part}';`),'0');
 assert.equal(sql(`SELECT count(*) FROM public.multi_day_final_stack_revisions_v1 WHERE participation_id='${part}';`),'0');
 assert.equal(sql(`SELECT count(*) FROM public.multi_day_final_adjustments_v1 WHERE participation_id='${part}';`),'0');
 assert.equal(sql(`SELECT count(*) FROM private.multi_day_initial_draw_plans_v1 WHERE event_id='${event}';`),'1');
 assert.equal(sql(`SELECT count(*) FROM public.club_settings WHERE club_id='${club}' AND auto_swing_enabled;`),'0');
 const groups=[['tournaments',`id<>'${final}'`],['tournament_entries',`tournament_id<>'${final}'`],['tournament_seats',`tournament_id<>'${final}'`],['tournament_tables',`tournament_id<>'${final}'`],['table_sessions',`tournament_id IS DISTINCT FROM '${final}'::uuid`],['tournament_chip_counts',`tournament_id<>'${final}'`],['multi_day_final_stack_revisions_v1',`participation_id<>'${part}'`],['multi_day_final_requests_v1',`participation_id<>'${part}'`],['multi_day_final_seatings_v1',`participation_id<>'${part}'`],['multi_day_final_adjustments_v1',`participation_id<>'${part}'`],['seat_draw_receipts',`tournament_id<>'${final}'`],['seat_assignment_history',`tournament_id<>'${final}'`],['tournament_redraw_batches',`tournament_id<>'${final}'`],
  ...['cashier_buyin_movements','tournament_prize_payments','chip_inventory_ledger','chip_bank_ledger','chip_bag','tournament_hands','hand_actions','hand_players','tournament_settlement_outcomes','dealer_attendance','dealer_assignments','dealer_breaks','dealer_rotation_schedule','dealer_payroll','payroll_periods','club_settings','audit_logs'].map(t=>[t,'true'])];
 const protect=()=>sql(`SELECT md5(jsonb_build_array(${groups.map(([t,w])=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x WHERE ${w})`).concat([
  `(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM private.multi_day_initial_draw_plans_v1 x WHERE event_id<>'${event}' OR id='${oldPlan}')`,
  `(SELECT jsonb_agg(to_jsonb(x) ORDER BY plan_id) FROM private.multi_day_initial_draw_applications_v1 x WHERE plan_id NOT IN(SELECT id FROM private.multi_day_initial_draw_plans_v1 WHERE event_id='${event}'))`,
  '(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM private.multi_day_final_write_intents_v1 x)']).join(',')})::text);`);
 const before=protect(),gates=['multi_day_package_release_v1','centerpoint_tournament_ops_release'];
 const old=gates.map(t=>JSON.parse(sql(`SELECT to_jsonb(x) FROM public.${t} x WHERE id;`)));
 assert.ok(old.every(g=>g?.id===true&&typeof g.enabled==='boolean'));
 const canaryBefore=JSON.parse(sql(`SELECT jsonb_build_object('tour',(SELECT to_jsonb(t) FROM public.tournaments t WHERE id='${final}'),'tables',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournament_tables t WHERE tournament_id='${final}'),'sessions',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.table_sessions t WHERE tournament_id='${final}'));`));
 const keys={correct:randomUUID(),staleApply:randomUUID(),plan:randomUUID(),apply:randomUUID(),held:randomUUID()};
 const context={event,final,club,actor,part,player,oldPlan,keys,gatesBefore:old,canaryBefore};
 sql(`BEGIN;CREATE TABLE private.d2_seed846_commit_fixture(id boolean PRIMARY KEY DEFAULT true CHECK(id),context jsonb NOT NULL,before_hash text NOT NULL,stages jsonb NOT NULL DEFAULT '[]');ALTER TABLE private.d2_seed846_commit_fixture ENABLE ROW LEVEL SECURITY;REVOKE ALL ON private.d2_seed846_commit_fixture FROM PUBLIC,anon,authenticated,service_role;INSERT INTO private.d2_seed846_commit_fixture(context,before_hash) VALUES(${quote(JSON.stringify(context))}::jsonb,${quote(before)});COMMIT;`);
 const record=(stage,evidence)=>sql(`UPDATE private.d2_seed846_commit_fixture SET stages=stages||jsonb_build_array(jsonb_build_object('stage',${quote(stage)},'evidence',${quote(JSON.stringify(evidence))}::jsonb)) WHERE id;`);
 const sessions=[],expectedFailure=new Set();
 let applied,held,newPlan;
 const start=`BEGIN;SET LOCAL statement_timeout='12s';SET LOCAL idle_in_transaction_session_timeout='15s';${claims}`;
 const parse=(s,prefix)=>JSON.parse(s.output().split(/\r?\n/).find(x=>x.startsWith(prefix)).slice(prefix.length));
 async function waitBlocked(aName,bName){await until(()=>sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity w JOIN pg_stat_activity h ON h.pid=ANY(pg_blocking_pids(w.pid)) WHERE w.application_name='${bName}' AND h.application_name='${aName}' AND w.wait_event_type='Lock');`)==='t');}
 try{
  sql(`BEGIN;${gates.map(t=>`UPDATE public.${t} SET enabled=true,allowed_club_ids=ARRAY['${club}'::uuid] WHERE id;`).join('')}COMMIT;`);
  const tag=randomUUID().slice(0,8),aName=`d2846_correct_${tag}`,bName=`d2846_stale_${tag}`;
  const a=session(aName),b=session(bName);sessions.push(a,b);
  a.child.stdin.write(`${start}SELECT 'CORRECT|'||public.multi_day_correct_final_seed_v1('${event}','${player}',20001,0,'LOCAL846 committed synthetic seed evidence','local://846/seed','${keys.correct}')::text;SELECT 'CORRECT_HELD';\n`);
  await until(()=>a.output().includes('CORRECT_HELD'));const corrected=parse(a,'CORRECT|');assert.equal(corrected.state,'REVISED_PRE_SEAT');
  b.child.stdin.end(`${start}SELECT public.multi_day_apply_initial_draw_v1('${oldPlan}','${keys.staleApply}');COMMIT;\n`);
  await waitBlocked(aName,bName);
  a.child.stdin.end('COMMIT;\n');await a.closed;
  expectedFailure.add(b);await assert.rejects(b.closed,/multi_day_initial_draw_source_stale/);
  assert.equal(sql(`SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${final}';`),'0');
  assert.equal(sql(`SELECT count(*) FROM private.multi_day_initial_draw_applications_v1 WHERE plan_id='${oldPlan}';`),'0');
  record('correction_committed_waiter_stale',{corrected,oldPlan,staleApply:keys.staleApply});
  const current=call(`SELECT public.multi_day_final_roster_v1('${event}');`);
  assert.equal(current.players[0].stack,20001);assert.equal(current.players[0].seedRevision,1);
  newPlan=call(`SELECT public.multi_day_plan_initial_draw_v1('${event}',ARRAY[${current.tables.map(t=>quote(t.tournamentTableId)+'::uuid').join(',')}],${quote(current.sourceHash)},'${keys.plan}');`);
  assert.equal(newPlan.state,'PLANNED');assert.equal(newPlan.assignments[0].stack,20001);
  record('fresh_plan_after_correction',{planId:newPlan.planId,sourceHash:current.sourceHash});
  const cName=`d2846_apply_${tag}`,dName=`d2846_held_${tag}`,c=session(cName),d=session(dName);sessions.push(c,d);
  c.child.stdin.write(`${start}SELECT 'APPLY|'||public.multi_day_apply_initial_draw_v1('${newPlan.planId}','${keys.apply}')::text;SELECT 'APPLY_HELD';\n`);
  await until(()=>c.output().includes('APPLY_HELD'));applied=parse(c,'APPLY|');assert.equal(applied.state,'APPLIED');assert.equal(applied.seatReceipts[0].seedStack,20001);
  d.child.stdin.write(`${start}SELECT 'HELD|'||public.multi_day_correct_final_seed_v1('${event}','${player}',20002,1,'LOCAL846 post-seating synthetic evidence','local://846/held','${keys.held}')::text;SELECT 'HELD_DONE';\n`);
  await waitBlocked(cName,dName);
  c.child.stdin.end('COMMIT;\n');await c.closed;
  await until(()=>d.output().includes('HELD_DONE'));held=parse(d,'HELD|');
  assert.equal(held.state,'OWNER_APPROVED_HELD');assert.equal(held.liveStackChanged,false);assert.equal(held.priorSeedStack,20001);assert.equal(held.proposedSeedStack,20002);
  d.child.stdin.end('COMMIT;\n');await d.closed;
  record('apply_committed_waiter_held',{applied,held});
  assert.equal(sql(`SELECT count(*)||'|'||sum(current_stack) FROM public.tournament_entries WHERE tournament_id='${final}';`),'1|20001');
  assert.equal(sql(`SELECT count(*)||'|'||sum(chip_count) FROM public.tournament_seats WHERE tournament_id='${final}' AND is_active;`),'1|20001');
  assert.equal(sql(`SELECT count(*)||'|'||sum(chip_count) FROM public.tournament_chip_counts WHERE tournament_id='${final}';`),'1|20001');
  assert.equal(sql(`SELECT count(*) FROM public.multi_day_final_stack_revisions_v1 WHERE participation_id='${part}';`),'1');
  assert.equal(sql(`SELECT count(*) FROM public.multi_day_final_adjustments_v1 WHERE participation_id='${part}';`),'1');
  assert.equal(sql(`SELECT count(*) FROM public.multi_day_final_requests_v1 WHERE participation_id='${part}';`),'3');
  const replay=call(`SELECT public.multi_day_apply_initial_draw_v1('${newPlan.planId}','${keys.apply}');`);assert.equal(replay.idempotent,true);assert.deepEqual(replay.seatReceipts,applied.seatReceipts);
  assert.equal(protect(),before,'other-scope or immutable source facts changed');
 }finally{
  const cleanup=await Promise.allSettled(sessions.map(async s=>{if(!s.child.stdin.writableEnded)s.child.stdin.end('ROLLBACK;\n');try{await s.closed;}catch(error){if(!expectedFailure.has(s))throw error;}}));
  sql(`BEGIN;${gates.map((t,i)=>`UPDATE public.${t} SET(enabled,allowed_club_ids,updated_at)=(SELECT r.enabled,r.allowed_club_ids,r.updated_at FROM jsonb_populate_record(NULL::public.${t},${quote(JSON.stringify(old[i]))}::jsonb)r) WHERE id;`).join('')}COMMIT;`);
  for(const [i,t] of gates.entries())assert.deepEqual(JSON.parse(sql(`SELECT to_jsonb(x) FROM public.${t} x WHERE id;`)),old[i]);
  assert.equal(protect(),before,'final protected other-scope fingerprint differs');
  assert.ok(cleanup.every(x=>x.status==='fulfilled'),'child sessions failed cleanup');
 }
 record('complete',{newPlanId:newPlan.planId,groups:groups.length+3,stack:20001,proposedHeld:20002,gatesRestored:true});
 console.log('D2_846_OWNED_CLONE_BOTH_COMMIT_LOCK_ORDERS_STALE_THEN_HELD_LIVE20001_REPLAY_GATES_RESTORED_PASS',JSON.stringify({planId:newPlan.planId,groups:groups.length+3}));
}
