import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// Existing runner/session/barrier, retained negative fixture and immutable plan.
// Business transactions all ROLLBACK; only scoped local release gates are
// temporarily committed for cross-session visibility and exactly restored.
export async function verifyRetainedSeed845Overlap({sql,session,until}){
 assert.equal(process.env.VINPOKER_D2_845_LOCAL_GATES,'1');
 assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');
 assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink');"),'0');
 assert.equal(sql("SELECT md5(pg_get_functiondef('public.multi_day_apply_initial_draw_v1(uuid,uuid)'::regprocedure));"),'e5477fb2a8220f9b4cc1ff5c3401dac6');
 assert.equal(sql("SELECT md5(pg_get_functiondef('public.multi_day_correct_final_seed_v1(uuid,uuid,bigint,integer,text,text,uuid)'::regprocedure));"),'4b209eeaaf17a2579ebf80c952bcc9b7');
 const event='e6551af0-e6d0-4fb0-9342-fdd7465fcaf2',final='0f56388a-c47f-48fd-970a-4f5589627d4b',club='399956aa-7858-422a-ad34-ca7ee52ff64d',actor='ba3e052f-27d5-4da5-b832-0b5d9cecbf2f',plan='57178526-818d-4549-9660-28909254a03f';
 const claims=`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';SET LOCAL ROLE authenticated;`;
 const roster=JSON.parse(sql(`BEGIN READ ONLY;${claims}SELECT public.multi_day_final_roster_v1('${event}');ROLLBACK;`));
 assert.equal(roster.players.length,1);assert.equal(roster.players[0].state,'UNSEATED');assert.equal(roster.players[0].stack,20000);assert.equal(roster.players[0].seedRevision,0);
 assert.equal(sql(`SELECT receipt->>'sourceHash' FROM private.multi_day_initial_draw_plans_v1 WHERE id='${plan}' AND actor_id='${actor}' AND event_id='${event}';`),roster.sourceHash);
 assert.equal(sql(`SELECT count(*) FROM private.multi_day_initial_draw_applications_v1 WHERE plan_id='${plan}';`),'0');
 const stored=JSON.parse(sql(`SELECT receipt FROM private.multi_day_initial_draw_plans_v1 WHERE id='${plan}';`));
 const tableOrder=(a,b)=>a.tournamentTableId.localeCompare(b.tournamentTableId);
 assert.deepEqual(roster.tables.filter(t=>stored.selectedTables.some(s=>s.tournamentTableId===t.tournamentTableId)).sort(tableOrder),[...stored.selectedTables].sort(tableOrder),'retained plan table snapshot is stale; do not reset it');
 const tables=['tournament_entries','tournament_seats','tournament_tables','table_sessions','cashier_buyin_movements','tournament_chip_counts','table_session_seat_locks','chip_bag','multi_day_final_stack_revisions_v1','multi_day_final_requests_v1','multi_day_final_seatings_v1','seat_draw_receipts','seat_assignment_history','tournament_redraw_batches','audit_logs','club_settings','tournaments','tournament_hands','tournament_settlement_outcomes','chip_inventory_ledger','chip_bank_ledger','multi_day_final_adjustments_v1'];
 const privateTables=['multi_day_initial_draw_plans_v1','multi_day_initial_draw_applications_v1','multi_day_final_write_intents_v1'];
 const fingerprint=()=>sql(`SELECT md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).concat(privateTables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM private.${t} x)`)).join(',')})::text);`);
 const before=fingerprint(),gates=['multi_day_package_release_v1','centerpoint_tournament_ops_release'];
 const old=gates.map(t=>JSON.parse(sql(`SELECT to_jsonb(x) FROM public.${t} x WHERE id;`)));
 assert.ok(old.every(row=>row?.id===true&&typeof row.enabled==='boolean'&&Array.isArray(row.allowed_club_ids)));
 const quote=x=>"'"+String(x).replaceAll("'","''")+"'";
 const sessions=[];
 const restore=()=>sql(`BEGIN;${gates.map((t,i)=>`UPDATE public.${t} SET(enabled,allowed_club_ids,updated_at)=(SELECT r.enabled,r.allowed_club_ids,r.updated_at FROM jsonb_populate_record(NULL::public.${t},${quote(JSON.stringify(old[i]))}::jsonb)r) WHERE id;`).join('')}COMMIT;`);
 try{
  sql(`BEGIN;${gates.map(t=>`UPDATE public.${t} SET enabled=true,allowed_club_ids=ARRAY['${club}'::uuid] WHERE id;`).join('')}COMMIT;`);
  for(const first of ['correct','apply']){
   const tag=randomUUID().slice(0,8),aName=`d2845_${first}_hold_${tag}`,bName=`d2845_${first}_wait_${tag}`;
   const a=session(aName),b=session(bName);sessions.push(a,b);
   const apply=`public.multi_day_apply_initial_draw_v1('${plan}','${randomUUID()}')`;
   const correct=`public.multi_day_correct_final_seed_v1('${event}','${roster.players[0].playerId}',20001,0,'LOCAL845 rollback-only overlap','local://845/seed-evidence','${randomUUID()}')`;
   const begin=`BEGIN;SET LOCAL statement_timeout='12s';SET LOCAL idle_in_transaction_session_timeout='15s';${claims}`;
   a.child.stdin.write(`${begin}SELECT 'FIRST|'||${first==='correct'?correct:apply}::text;SELECT 'FIRST_HELD';\n`);
   await until(()=>a.output().includes('FIRST_HELD'));
   const held=JSON.parse(a.output().split(/\r?\n/).find(x=>x.startsWith('FIRST|')).slice(6));
   assert.equal(held.state,first==='correct'?'REVISED_PRE_SEAT':'APPLIED');
   b.child.stdin.write(`${begin}SELECT 'SECOND|'||${first==='correct'?apply:correct}::text;SELECT 'SECOND_DONE';\n`);
   await until(()=>sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity w JOIN pg_stat_activity h ON h.pid=ANY(pg_blocking_pids(w.pid)) WHERE w.application_name='${bName}' AND h.application_name='${aName}' AND w.wait_event_type='Lock');`)==='t');
   assert.equal(sql(`SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${final}';`),'0','uncommitted holder leaked entries');
   a.child.stdin.end('ROLLBACK;\n');await a.closed;
   await until(()=>b.output().includes('SECOND_DONE'));
   const second=JSON.parse(b.output().split(/\r?\n/).find(x=>x.startsWith('SECOND|')).slice(7));
   assert.equal(second.state,first==='correct'?'APPLIED':'REVISED_PRE_SEAT');
   if(first==='correct')assert.equal(second.seatReceipts[0].seedStack,20000);
   else assert.equal(second.seedRevision,1);
   b.child.stdin.end('ROLLBACK;\n');await b.closed;
   assert.equal(fingerprint(),before,'overlap rollback changed retained business facts');
   console.log('D2_845_TRUE_BLOCKING_ORDER_ROLLBACK_PASS',first);
  }
 }finally{
  const cleanup=await Promise.allSettled(sessions.map(async s=>{if(!s.child.stdin.writableEnded)s.child.stdin.end('ROLLBACK;\n');await s.closed;}));
  restore();
  for(const [i,t] of gates.entries())assert.deepEqual(JSON.parse(sql(`SELECT to_jsonb(x) FROM public.${t} x WHERE id;`)),old[i],'gate restoration failed');
  assert.equal(fingerprint(),before,'final cleanup changed retained business facts');
  assert.ok(cleanup.every(x=>x.status==='fulfilled'),'child session did not close cleanly');
 }
 console.log('D2_845_CORRECTION_APPLY_BOTH_TRUE_LOCK_ORDERS_ALL_ROLLBACK_25_GROUPS_GATES_RESTORED_NOT_COMMIT_RACE_PASS');
}
