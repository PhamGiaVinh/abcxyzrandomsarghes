import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// Invoked only by payoutIntegrity.native.mjs after its exact local PG/datadir guards.
export async function mainEvent163Concurrency({sql,session,until}){
 const actor='675fe35e-60a8-4452-bb90-e79486d54da6',club='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760';
 const key=randomUUID(),name=`MAIN_EVENT163_COMMITTED_CONCURRENCY_${key}`;
 const config={name,itm_percent:15,buy_in:100000,rake_amount:0,starting_stack:20000,
  game_type:'nlh',minutes_per_level:20,late_reg_close_level:6,flight_count:2,
  final_start_time:'2026-10-22T12:00:00+07',flight_start_times:['2026-10-21T12:00:00+07','2026-10-21T18:00:00+07']};
 const levels=[{level_number:1,small_blind:100,big_blind:200,ante:0,duration_minutes:20,is_break:false}];
 const json=value=>`'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
 const args=`'${club}',${json(config)},${json(levels)},'${key}','${actor}'`;
 const auth=`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';SET LOCAL ROLE authenticated;`;
 const untouched=()=>sql(`SELECT md5(jsonb_build_array(
  (SELECT to_jsonb(h) FROM public.tournament_hands h WHERE id='4aa376ee-4a27-4963-9c69-dd0a2cd17abf'),
  (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.tournament_seats s WHERE s.tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'),
  (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM public.tournament_entries e WHERE e.tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'))::text);`);
 const before=untouched();
 const a=session(`main_event163_a_${key}`),b=session(`main_event163_b_${key}`);
 try{
  a.child.stdin.write(`BEGIN;${auth}SELECT public.create_tournament_event_with_flights_v2(${args});SELECT 'MAIN_EVENT163_A_HOLDING';\n`);
  await until(()=>a.output().includes('MAIN_EVENT163_A_HOLDING'));
  b.child.stdin.write(`BEGIN;${auth}SELECT public.create_tournament_event_with_flights_v2(${args});SELECT 'MAIN_EVENT163_B_RETURNED';\n`);
  await until(()=>sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name='main_event163_b_${key}' AND cardinality(pg_blocking_pids(pid))>0;`)==='1');
  assert.ok(!b.output().includes('MAIN_EVENT163_B_RETURNED'),'second writer did not actually overlap');
  a.child.stdin.end('COMMIT;\n');await a.closed;
  await until(()=>b.output().includes('MAIN_EVENT163_B_RETURNED'));
  b.child.stdin.end('COMMIT;\n');await b.closed;
  const first=JSON.parse(a.output().split('\n').find(row=>row.startsWith('{')));
  const second=JSON.parse(b.output().split('\n').find(row=>row.startsWith('{')));
  assert.equal(first.ok,true);assert.deepEqual(second,first);
  const recovered=JSON.parse(sql(`BEGIN READ ONLY;${auth}SELECT public.get_tournament_event_create_receipt_v1(${args});COMMIT;`));
  assert.deepEqual(recovered,first,'new connection failed to recover committed receipt');
  const post=JSON.parse(sql(`SELECT jsonb_build_object('events',(SELECT count(*) FROM public.tournament_events WHERE name='${name}'),
   'children',(SELECT count(*) FROM public.tournaments WHERE event_id='${first.event_id}'),
   'levels',(SELECT count(*) FROM public.tournament_levels l JOIN public.tournaments t ON t.id=l.tournament_id WHERE t.event_id='${first.event_id}'),
   'receipts',(SELECT count(*) FROM public.table_operation_receipts WHERE actor_id='${actor}' AND request_id='${key}' AND operation_type='create_tournament_event_with_flights_v2'));
  `));
  assert.deepEqual(post,{events:1,children:3,levels:3,receipts:1});
  assert.equal(untouched(),before,'existing hand/seat/entry facts changed');
  console.log('MAIN_EVENT163_TWO_OVERLAPPING_AUTHENTICATED_WRITERS_ONE_COMMIT_RECEIPT_PASS',JSON.stringify({actor,club,key,event:first.event_id,final:first.final_tournament_id,post,fixture:'retained TEST event; not UI or full-tour evidence'}));
 }finally{
  if(a.child.exitCode===null&&!a.child.stdin.destroyed)a.child.stdin.end('ROLLBACK;\n');
  if(b.child.exitCode===null&&!b.child.stdin.destroyed)b.child.stdin.end('ROLLBACK;\n');
  await Promise.allSettled([a.closed,b.closed]);
 }
}

// Direct pending registration metadata is a scoped server-side fixture, not a
// cashier/payment acceptance claim. No seat, entry, transfer or payment is made.
export async function mainEvent164GuaranteeConcurrency({sql,session,until}){
 const actor='675fe35e-60a8-4452-bb90-e79486d54da6',club='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760';
 const player='5f4dd4c4-a9d0-43a9-b523-ab5ec5d3c103',key=randomUUID();
 const config={name:`MAIN_EVENT164_GUARANTEE_BOUNDARY_${key}`,itm_percent:15,buy_in:100000,rake_amount:0,
  starting_stack:20000,game_type:'nlh',minutes_per_level:20,late_reg_close_level:6,flight_count:2,
  final_start_time:'2026-10-22T12:00:00+07',guarantee_amount:2500000};
 const json=value=>`'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
 const owner=`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';SET LOCAL ROLE authenticated;`;
 const server=`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='service_role';SET LOCAL request.jwt.claims='{"role":"service_role","sub":"${actor}"}';`;
 assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.tournament_registrations WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND player_id='${player}');`),'t');
 const created=JSON.parse(sql(`BEGIN;${owner}SELECT public.create_tournament_event_with_flights_v2('${club}',${json(config)},'[]'::jsonb,'${key}','${actor}');COMMIT;`));
 assert.equal(created.ok,true);
 const event=created.event_id;
 const tables=JSON.parse(sql(`SELECT jsonb_agg(id ORDER BY flight_label) FROM public.tournaments WHERE event_id='${event}' AND phase='flight';`));
 assert.equal(tables.length,2);
 const insert=(tour,registration)=>`INSERT INTO public.tournament_registrations(id,tournament_id,player_id,buy_in,total_pay,reference_code,status)
  VALUES('${registration}','${tour}','${player}',100000,100000,'MAIN_EVENT164_${registration}','pending');`;
 async function race(firstSql,secondSql,marker){
  const id=randomUUID(),a=session(`gtd164_a_${id}`),b=session(`gtd164_b_${id}`);
  try{
   a.child.stdin.write(`BEGIN;${server}${firstSql}SELECT 'GTD164_A_HOLDING';\n`);
   await until(()=>a.output().includes('GTD164_A_HOLDING'));
   b.child.stdin.write(`BEGIN;${server}${secondSql}SELECT '${marker}';\n`);
   await until(()=>sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name='gtd164_b_${id}' AND cardinality(pg_blocking_pids(pid))>0;`)==='1');
   assert.ok(!b.output().includes(marker));
   a.child.stdin.end('COMMIT;\n');await a.closed;
   await until(()=>b.output().includes(marker));
   b.child.stdin.end('COMMIT;\n');await b.closed;
  }finally{
   if(a.child.exitCode===null&&!a.child.stdin.destroyed)a.child.stdin.end('ROLLBACK;\n');
   if(b.child.exitCode===null&&!b.child.stdin.destroyed)b.child.stdin.end('ROLLBACK;\n');
   await Promise.allSettled([a.closed,b.closed]);
  }
 }
 // Edit wins first: registration waits, then freezes the newly committed GTD.
 const registrationA=randomUUID();
 await race(`UPDATE public.tournament_events SET guarantee_amount=3000000 WHERE id='${event}';`,
  insert(tables[0],registrationA),'GTD164_EDIT_FIRST_REGISTERED');
 assert.equal(sql(`SELECT guarantee_amount FROM public.tournament_events WHERE id='${event}';`),'3000000');
 // Registration wins first: use a separate fresh event (the previous is frozen).
 const secondKey=randomUUID(),secondConfig={...config,name:`MAIN_EVENT164_GUARANTEE_BOUNDARY_${secondKey}`};
 const second=JSON.parse(sql(`BEGIN;${owner}SELECT public.create_tournament_event_with_flights_v2('${club}',${json(secondConfig)},'[]'::jsonb,'${secondKey}','${actor}');COMMIT;`));
 assert.equal(second.ok,true);
 const secondFlight=sql(`SELECT id FROM public.tournaments WHERE event_id='${second.event_id}' AND phase='flight' ORDER BY flight_label LIMIT 1;`);
 const registrationB=randomUUID();
 await race(insert(secondFlight,registrationB),`DO $$ BEGIN
  BEGIN UPDATE public.tournament_events SET guarantee_amount=3000000 WHERE id='${second.event_id}';RAISE EXCEPTION 'GTD164_RACE_EDIT_ACCEPTED';
  EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='main_event_guarantee_frozen';END;
 END $$;`,'GTD164_REGISTRATION_FIRST_EDIT_DENIED');
 assert.equal(sql(`SELECT guarantee_amount FROM public.tournament_events WHERE id='${second.event_id}';`),'2500000');
 assert.equal(sql(`SELECT count(*) FROM public.tournament_entries WHERE tournament_id IN(SELECT id FROM public.tournaments WHERE event_id IN('${event}','${second.event_id}'));`),'0');
 assert.equal(sql(`SELECT count(*) FROM public.tournament_registrations WHERE id IN('${registrationA}','${registrationB}') AND status='pending' AND cashier_paid_at IS NULL;`),'2');
 console.log('MAIN_EVENT164_GTD_FIRST_REGISTRATION_TWO_REAL_LOCK_ORDERS_PASS',JSON.stringify({events:[event,second.event_id],registrations:[registrationA,registrationB],unpaidFixture:true,actualCashierFlow:false}));
}
