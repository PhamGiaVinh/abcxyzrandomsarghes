import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';

assert.equal(process.env.PGHOST, '127.0.0.1');
assert.equal(process.env.PGPORT, '55441');
assert.equal(process.env.PGUSER, 'postgres');
assert.equal(process.env.PGDATABASE, 'vinpoker_ops_checkin');
for (const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS']) assert.equal(process.env[key], undefined);
const fixture = readFileSync('tests/dealerSwing/operationalInventory.pg17.sql', 'utf8');
assert.equal((fixture.match(/ROLLBACK;/g) ?? []).length, 1);
function sql(query) {
  const result = spawnSync('psql', ['-X','-qAt','-v','ON_ERROR_STOP=1'], {input:query, encoding:'utf8'});
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
sql(`DO $$ BEGIN IF current_database()<>'vinpoker_ops_checkin' OR current_user<>'postgres'
 OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR inet_server_port()<>55441
 OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
 THEN RAISE EXCEPTION 'Exact owned loopback PG17 required'; END IF; END $$;`);
function concurrent(query, marker) {
  return new Promise((resolve,reject) => {
    const child = spawn('psql',['-X','-qAt','-v','ON_ERROR_STOP=1']);
    let out='', err='';
    child.stdout.on('data', chunk => out+=chunk);
    child.stderr.on('data', chunk => err+=chunk);
    child.on('error',reject);
    child.on('close', code => code===0 ? resolve(out) : reject(new Error(err)));
    child.stdin.end(`SET application_name='${marker}'; SET statement_timeout='8s'; ${query}`);
  });
}
async function barrier(marker, condition) {
  for(let i=0;i<100;i++) {
    if(sql(`SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='${marker}' AND ${condition});`)==='t') return;
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  assert.fail(`overlap barrier missing: ${marker}`);
}
for (const closeFirst of [true,false]) {
  const ns=randomUUID().slice(0,8);
  const id=suffix=>`${ns}-0000-4000-8000-${suffix.toString().padStart(12,'0')}`;
  const intent=`SET request.jwt.claim.sub='${id(1)}'; SET request.headers='{"x-vinpoker-dealer-intent":"manual","x-vinpoker-dealer-actor":"${id(1)}"}';`;
  sql(fixture.replace('BEGIN;',`BEGIN; ${intent}`).replace('ROLLBACK;','COMMIT;')
    .replaceAll('e1700000-',`${ns}-`)
    .replaceAll("'exact-key'",`'${ns}-exact'`).replaceAll("'cross-club-key'",`'${ns}-cross'`)
    .replaceAll("'closed-key'",`'${ns}-closed'`));
  const assignment=sql(`SELECT id FROM public.dealer_assignments WHERE table_session_id='${id(21)}' AND released_at IS NULL;`);
  const persist=`${intent} SET ROLE service_role; SET request.jwt.claim.role='service_role';
    SELECT public.upsert_rotation_plan('${id(2)}','${id(63)}',jsonb_build_array(jsonb_build_object(
    'table_id','${id(11)}','assignment_id','${assignment}','slot_index',0,
    'planned_relief_at',now()+interval '30 minutes','is_shortage',true,'solver_version','overlap87')),
    ARRAY['${id(11)}'::uuid]);`;
  const close=`${intent} SET ROLE authenticated; SET request.jwt.claim.role='authenticated';
    SELECT public.operator_close_club_table_v2('${id(21)}',1,'${id(61)}');`;
  const holderMarker=`persist87_${ns}_holder`, waiterMarker=`persist87_${ns}_waiter`;
  const holder=concurrent(`BEGIN; ${closeFirst?close:persist} SELECT pg_sleep(2); COMMIT;`,holderMarker);
  await barrier(holderMarker,"wait_event='PgSleep'");
  const waiter=concurrent(closeFirst?persist:close,waiterMarker);
  await barrier(waiterMarker,"wait_event_type='Lock'");
  const outputs=await Promise.all([holder,waiter]);
  const closeOutput=JSON.parse(outputs[closeFirst?0:1].split(/\r?\n/).find(line=>line.startsWith('{')));
  assert.equal(closeOutput.ok,true,JSON.stringify(closeOutput));
  const persistOutput=JSON.parse(outputs[closeFirst?1:0].split(/\r?\n/).find(line=>line.startsWith('{')));
  assert.equal(persistOutput.outcome,'ok');
  assert.equal(Number(persistOutput.inserted),closeFirst?0:1);
  if(closeFirst) assert.ok(persistOutput.rejected_table_ids.includes(id(11)));
  assert.equal(sql(`SELECT count(*) FROM public.dealer_assignments WHERE id='${assignment}' AND released_at IS NULL;`),'0');
  console.log(`${closeFirst?'close→persist':'persist→close'} true lock overlap PASS`);
}
// This isolates persist fencing. Cancellation of a prediction committed BEFORE
// close is covered by the separate close79/81 package, not claimed here.

for (const operation of ['lock','swing']) for (const lockFirst of [true,false]) {
  const ns=randomUUID().slice(0,8);
  const id=suffix=>`${ns}-0000-4000-8000-${suffix.toString().padStart(12,'0')}`;
  const intent=`SET request.jwt.claim.sub='${id(1)}'; SET request.headers='{"x-vinpoker-dealer-intent":"manual","x-vinpoker-dealer-actor":"${id(1)}"}';`;
  sql(fixture.replace('BEGIN;',`BEGIN; ${intent}`).replace('ROLLBACK;','COMMIT;')
    .replaceAll('e1700000-',`${ns}-`)
    .replaceAll("'exact-key'",`'${ns}-exact'`).replaceAll("'cross-club-key'",`'${ns}-cross'`)
    .replaceAll("'closed-key'",`'${ns}-closed'`));
  sql(`INSERT INTO public.dealers(id,club_id,full_name,status)
    VALUES('${id(32)}','${id(2)}','Lock overlap TEST','active');
    INSERT INTO public.dealer_attendance(id,dealer_id,shift_id,shift_date,status,check_in_time,current_state)
    VALUES('${id(42)}','${id(32)}','${id(30)}',current_date,'checked_in',now(),'available');`);
  const assignment=sql(`SELECT id FROM public.dealer_assignments WHERE table_session_id='${id(21)}' AND released_at IS NULL;`);
  const persist=`${intent} SET ROLE service_role; SET request.jwt.claim.role='service_role';
    SELECT public.upsert_rotation_plan('${id(2)}','${id(63)}',jsonb_build_array(jsonb_build_object(
    'table_id','${id(11)}','assignment_id','${assignment}','slot_index',0,
    'in_attendance_id','${id(42)}','planned_relief_at','2030-01-01T00:00:00Z',
    'is_shortage',false,'solver_version','lock-overlap87')),ARRAY['${id(11)}'::uuid]);`;
  assert.equal(JSON.parse(sql(persist)).outcome,'ok');
  const schedule=JSON.parse(sql(`SELECT json_build_object('id',id,'version',version)
    FROM public.dealer_rotation_schedule WHERE assignment_id='${assignment}' AND status='predicted';`));
  const assignmentVersion=Number(sql(`SELECT version FROM public.dealer_assignments WHERE id='${assignment}';`));
  const lock=`${intent} SET ROLE service_role; SET request.jwt.claim.role='service_role';
    SELECT ${operation==='lock'?`public.lock_rotation_slot('${schedule.id}',${schedule.version})`:
      `public.worker_perform_swing('${id(11)}','${id(21)}','${assignment}',30,true,15,60,${assignmentVersion},'${id(42)}',0)`};`;
  const holderMarker=`lock87_${ns}_holder`, waiterMarker=`lock87_${ns}_waiter`;
  const holder=concurrent(`BEGIN; ${lockFirst?lock:persist} SELECT pg_sleep(2); COMMIT;`,holderMarker);
  await barrier(holderMarker,"wait_event='PgSleep'");
  const waiter=concurrent(lockFirst?persist:lock,waiterMarker);
  await barrier(waiterMarker,"wait_event_type='Lock'");
  const outputs=await Promise.all([holder,waiter]);
  const lockResult=JSON.parse(outputs[lockFirst?0:1].split(/\r?\n/).find(line=>line.startsWith('{')));
  assert.equal(lockResult.outcome,operation==='lock'?'locked':'swung',JSON.stringify(lockResult));
  const persistResult=JSON.parse(outputs[lockFirst?1:0].split(/\r?\n/).find(line=>line.startsWith('{')));
  assert.equal(persistResult.outcome,'ok');
  if(operation==='lock') {
    assert.equal(sql(`SELECT status FROM public.dealer_rotation_schedule WHERE id='${schedule.id}';`),'announced');
    assert.equal(sql(`SELECT count(*) FROM public.dealer_rotation_schedule WHERE table_id='${id(11)}'
      AND status IN ('predicted','announced','executing');`),'1');
    assert.equal(sql(`SELECT pre_assigned_attendance_id FROM public.dealer_assignments WHERE id='${assignment}';`),id(42));
  } else {
    assert.equal(sql(`SELECT count(*) FROM public.dealer_assignments WHERE table_session_id='${id(21)}'
      AND attendance_id='${id(42)}' AND status='assigned' AND released_at IS NULL;`),'1');
    assert.equal(sql(`SELECT count(*) FROM public.dealer_assignments WHERE id='${assignment}' AND released_at IS NULL;`),'0');
    if(lockFirst) assert.ok(persistResult.rejected_table_ids.includes(id(11)));
    assert.equal(Number(persistResult.inserted),0);
  }
  console.log(`${lockFirst?`${operation}→persist`:`persist→${operation}`} true lock overlap PASS`);
}

{
  const ns=randomUUID().slice(0,8);
  const id=suffix=>`${ns}-0000-4000-8000-${suffix.toString().padStart(12,'0')}`;
  const intent=`SET request.jwt.claim.sub='${id(1)}'; SET request.headers='{"x-vinpoker-dealer-intent":"manual","x-vinpoker-dealer-actor":"${id(1)}"}';`;
  sql(fixture.replace('BEGIN;',`BEGIN; ${intent}`).replace('ROLLBACK;','COMMIT;')
    .replaceAll('e1700000-',`${ns}-`)
    .replaceAll("'exact-key'",`'${ns}-exact'`).replaceAll("'cross-club-key'",`'${ns}-cross'`)
    .replaceAll("'closed-key'",`'${ns}-closed'`));
  const open=JSON.parse(sql(`${intent} SET ROLE authenticated; SET request.jwt.claim.role='authenticated';
    SELECT public.operator_open_club_tables_v2(ARRAY['${id(12)}'::uuid],'cash','${id(64)}');`));
  assert.equal(open.ok,true,JSON.stringify(open));
  const session2=sql(`SELECT id FROM public.table_sessions WHERE game_table_id='${id(12)}' AND closed_at IS NULL;`);
  sql(`INSERT INTO public.dealers(id,club_id,full_name,status) VALUES('${id(32)}','${id(2)}','Multi-table overlap TEST','active');
    INSERT INTO public.dealer_attendance(id,dealer_id,shift_id,shift_date,status,check_in_time,current_state)
    VALUES('${id(42)}','${id(32)}','${id(30)}',current_date,'checked_in',now(),'available');`);
  const assigned=JSON.parse(sql(`${intent} SET ROLE service_role; SET request.jwt.claim.role='service_role';
    SELECT public.worker_assign_dealer_to_session_v1('${id(2)}','${id(12)}','${session2}',
      '${id(42)}','2030-01-01T00:00:00Z','${ns}-second-table');`));
  assert.equal(assigned.outcome,'ok',JSON.stringify(assigned));
  const assignments=[11,12].map(table=>({table:id(table),assignment:sql(`SELECT id FROM public.dealer_assignments
    WHERE table_id='${id(table)}' AND status='assigned' AND released_at IS NULL;`)}));
  const persist=rows=>`${intent} SET ROLE service_role; SET request.jwt.claim.role='service_role';
    SELECT public.upsert_rotation_plan('${id(2)}','${id(63)}','${JSON.stringify(rows.map(row=>({
      table_id:row.table,assignment_id:row.assignment,slot_index:0,
      planned_relief_at:'2030-01-01T00:00:00Z',is_shortage:true,solver_version:'multi-overlap87',
    })))}'::jsonb,ARRAY['${id(11)}'::uuid,'${id(12)}'::uuid]);`;
  const holderMarker=`multi87_${ns}_holder`, waiterMarker=`multi87_${ns}_waiter`;
  const holder=concurrent(`BEGIN; ${persist([...assignments].reverse())} SELECT pg_sleep(2); COMMIT;`,holderMarker);
  await barrier(holderMarker,"wait_event='PgSleep'");
  const waiter=concurrent(persist(assignments),waiterMarker);
  await barrier(waiterMarker,"wait_event_type='Lock'");
  const outputs=await Promise.all([holder,waiter]);
  const results=outputs.map(out=>JSON.parse(out.split(/\r?\n/).find(line=>line.startsWith('{'))));
  assert.equal(results[0].inserted,2);
  assert.equal(results[1].inserted,0);
  assert.equal(results[1].unchanged,2);
  assert.equal(sql(`SELECT count(*) FROM public.dealer_rotation_schedule WHERE club_id='${id(2)}'
    AND status='predicted' AND version=1;`),'2');
  console.log('two planners with reversed table order: true overlap and unchanged replay PASS');
}
