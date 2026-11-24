import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';

const psql = process.env.TRACKER_TEST_PSQL ?? 'psql';
const args = ['-h', '127.0.0.1', '-p', '55519', '-U', 'postgres', '-d', 'tracker_bba349_current', '-X', '-At', '-v', 'ON_ERROR_STOP=1'];
const sql = query => execFileSync(psql, [...args, '-c', query], { encoding: 'utf8', windowsHide: true }).trim();
const identity = JSON.parse(sql(`SELECT json_build_object('database',current_database(),
  'host',host(inet_server_addr()),'port',inet_server_port(),'data',current_setting('data_directory'));`));
assert.equal(identity.database, 'tracker_bba349_current');
assert.equal(identity.host, '127.0.0.1');
assert.equal(identity.port, 55519);
assert.ok(identity.data.includes('tracker-bba349-pg17-'));

const actor = randomUUID(), club = randomUUID(), tour = randomUUID(), table = randomUUID();
const session = randomUUID(), level = randomUUID(), hand = randomUUID(), sb = randomUUID(), bb = randomUUID();
const auth = `SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL ROLE authenticated;`;
const post = `SELECT public.post_tracker_blinds_v1('${hand}','${randomUUID()}');`;
const run = (name, query) => {
  const child = spawn(psql, [...args, '-c', query], { env: { ...process.env, PGAPPNAME: name }, windowsHide: true });
  let output = '', error = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { error += chunk; });
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve(output) : reject(new Error(error)));
  });
};

sql(`BEGIN;
 INSERT INTO auth.users(id) VALUES('${actor}');
 INSERT INTO public.clubs(id,owner_id) VALUES('${club}','${actor}');
 INSERT INTO public.tournaments(id,club_id,name,status,current_level_id,current_level)
 VALUES('${tour}','${club}','BB ante concurrency TEST','active','${level}',1);
 INSERT INTO public.tournament_levels(id,tournament_id,level_number,small_blind,big_blind,ante,is_break)
 VALUES('${level}','${tour}',1,100,200,0,false);
 INSERT INTO public.table_sessions(id,tournament_id,control_mode) VALUES('${session}','${tour}','tracker');
 INSERT INTO public.tournament_seats(id,tournament_id,player_id,entry_number,table_id,seat_number,chip_count,is_active,status)
 VALUES(gen_random_uuid(),'${tour}','${sb}',1,'${table}',1,1000,true,'active'),
       (gen_random_uuid(),'${tour}','${bb}',1,'${table}',2,1000,true,'active');
 INSERT INTO public.tournament_hands(id,tournament_id,table_id,table_session_id,hand_number,status,created_by,locked_by_user_id,locked_at,button_seat)
 VALUES('${hand}','${tour}','${table}','${session}',1,'in_progress','${actor}','${actor}',now(),1);
 INSERT INTO public.hand_players(hand_id,tournament_id,player_id,entry_number,seat_number,starting_stack)
 VALUES('${hand}','${tour}','${sb}',1,1,1000),('${hand}','${tour}','${bb}',1,2,1000);
 COMMIT;`);

try {
  const first = run('tracker-bba349-first', `BEGIN;${auth}${post}SELECT pg_sleep(2);COMMIT;`);
  let held = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    held = sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='tracker-bba349-first' AND wait_event='PgSleep' AND xact_start IS NOT NULL);`) === 't';
    if (held) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(held, 'first writer must hold its uncommitted batch');
  const started = Date.now();
  const second = await run('tracker-bba349-second', `BEGIN;${auth}${post}COMMIT;`);
  assert.ok(Date.now() - started > 500, 'second writer must wait for the first transaction');
  const original = await first;
  const payload = output => JSON.parse(output.split(/\r?\n/).find(line => line.startsWith('{')));
  assert.equal(payload(original).duplicate, false);
  assert.equal(payload(second).duplicate, true);
  const count = () => JSON.parse(sql(`SELECT json_build_object('actions',(SELECT count(*) FROM public.hand_actions WHERE hand_id='${hand}'),
    'receipts',(SELECT count(*) FROM floor_private.tracker_blind_receipts350 WHERE hand_id='${hand}'),
    'chips',(SELECT sum(action_amount) FROM public.hand_actions WHERE hand_id='${hand}'));`));
  assert.deepEqual(count(), { actions: 3, receipts: 1, chips: 500 });
  const call = sql(`BEGIN;${auth}SELECT public.record_action('${hand}','${sb}','call',4,1,'preflop',100);COMMIT;`);
  assert.equal(payload(call).status, 'success');
  assert.deepEqual(count(), { actions: 4, receipts: 1, chips: 600 });
  console.log('BB_ANTE_CONCURRENCY_PASS: overlapping writers produced one batch; matched wagers plus ante total 600');
} finally {
  sql(`BEGIN;
    DELETE FROM public.hand_actions WHERE hand_id='${hand}';
    DELETE FROM public.hand_players WHERE hand_id='${hand}';
    DELETE FROM public.tournament_hands WHERE id='${hand}';
    DELETE FROM public.tournament_seats WHERE tournament_id='${tour}';
    DELETE FROM public.table_sessions WHERE id='${session}';
    DELETE FROM public.tournament_levels WHERE id='${level}';
    DELETE FROM public.tournaments WHERE id='${tour}';
    DELETE FROM public.clubs WHERE id='${club}';
    DELETE FROM auth.users WHERE id='${actor}';
    COMMIT;`);
}
