import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

// Actual retained-schema PostgreSQL only; no remote connection/helper doubles.
assert.equal(process.env.PGHOST, '127.0.0.1');
assert.ok(['55464', '55441'].includes(process.env.PGPORT));
assert.match(process.env.PGDATABASE ?? '', /^vinpoker_ops_floor66_/);
function sql(input) {
  const r = spawnSync('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], { input, encoding: 'utf8', timeout: 8000 });
  assert.equal(r.status, 0, r.stderr || String(r.error));
  return r.stdout.trim();
}
assert.equal(sql("SELECT inet_server_addr()='127.0.0.1'::inet AND current_setting('server_version_num')::int BETWEEN 170000 AND 179999;"), 't');
const owner = randomUUID(), cashier = randomUUID(), club = randomUUID(), tour = randomUUID(), physical = randomUUID();
sql(`INSERT INTO auth.users(id) VALUES ('${owner}'),('${cashier}');
 INSERT INTO public.clubs(id,name,region,owner_id) VALUES ('${club}','Manual seat concurrency TEST','TEST','${owner}');
 INSERT INTO public.club_cashiers(club_id,user_id) VALUES ('${club}','${cashier}');
 INSERT INTO public.tournaments(id,name,club_id,status,live_status,starting_stack)
 VALUES ('${tour}','Manual seat concurrency TEST','${club}','active','registering',20000);
 INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status)
 VALUES ('${physical}','${club}','Manual concurrency TEST',77,'tournament','inactive','available');`);
const opened = JSON.parse(sql(`SET ROLE authenticated; SET request.jwt.claim.sub='${owner}';
 SELECT public.floor_open_tournament_table_v3('${tour}','${physical}','manual','${randomUUID()}');`));
assert.equal(opened.ok, true);
const table = opened.tournament_table_id, session = opened.table_session_id;
function intent(actor, key, seat, revision, name = 'Concurrent walk-in TEST') {
  return `SELECT public.floor_add_manual_player_v1('${tour}','${name}','${table}',${seat},'${session}',${revision},1,'${key}','${actor}');`;
}
function connection(name) {
  const child = spawn('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1']);
  let out = '', err = '';
  const timer = setTimeout(() => child.kill(), 25000);
  const done = new Promise((resolve, reject) => {
    child.stdout.on('data', value => { out += value; });
    child.stderr.on('data', value => { err += value; });
    child.on('error', reject);
    child.on('close', code => { clearTimeout(timer); resolve({ code, out, err }); });
  });
  child.stdin.write(`SET application_name='${name}'; BEGIN;
 SET LOCAL statement_timeout='15s'; SET LOCAL idle_in_transaction_session_timeout='15s';\n`);
  return { child, done };
}
async function barrier(query, message) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (sql(query) === 't') return;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  assert.fail(message);
}
const parse = response => {
  assert.equal(response.code, 0, response.err);
  return JSON.parse(response.out.split('\n').find(line => line.startsWith('{')));
};
for (const sameKey of [true, false]) {
  const seat = sameKey ? 1 : 2, key = randomUUID(), tag = randomUUID().slice(0, 8);
  const revision = Number(sql(`SELECT revision FROM public.table_sessions WHERE id='${session}';`));
  const firstName = `manual66_first_${tag}`, secondName = `manual66_second_${tag}`;
  const first = connection(firstName);
  let second;
  try {
    first.child.stdin.write(`SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='${owner}';
      ${intent(owner, key, seat, revision)}\n`);
    await barrier(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${firstName}' AND state='idle in transaction');`, 'first result not held before commit');
    second = connection(secondName);
    const actor = sameKey ? owner : cashier;
    second.child.stdin.end(`SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='${actor}';
      ${intent(actor, sameKey ? key : randomUUID(), seat, revision)} COMMIT;\n`);
    await barrier(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity b JOIN pg_stat_activity a ON a.application_name='${firstName}'
      WHERE b.application_name='${secondName}' AND b.wait_event_type='Lock' AND a.pid=ANY(pg_blocking_pids(b.pid)));`, 'exact second backend overlap missing');
    console.log(`MANUAL66_TRUE_OVERLAP_${sameKey ? 'SAME_KEY' : 'TWO_ACTORS'}`);
  } finally { first.child.stdin.end('COMMIT;\n'); }
  const winner = parse(await first.done), waiter = parse(await second.done);
  assert.equal(winner.ok, true);
  if (sameKey) assert.deepEqual(waiter, winner);
  else assert.equal(waiter.error, 'STALE_STATE');
  assert.equal(sql(`SELECT count(*) FROM public.tournament_seats WHERE tournament_id='${tour}' AND seat_number=${seat} AND is_active;`), '1');
  // Discarded response recovered on a separate connection, without a new key.
  const recovered = JSON.parse(sql(`SET ROLE authenticated; SET request.jwt.claim.sub='${owner}';
    SELECT public.get_floor_manual_player_receipt_v1('${tour}','${key}','${owner}');`));
  assert.deepEqual(recovered.result, winner);
  assert.equal(sql(`SELECT count(*) FROM public.table_operation_receipts WHERE actor_id='${owner}'
    AND operation_type='floor_add_manual_player_v1' AND request_id='${key}';`), '1');
}
assert.equal(sql(`SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${tour}';`), '2');
assert.equal(sql(`SELECT sum(chip_count) FROM public.tournament_chip_counts WHERE tournament_id='${tour}';`), '40000');

// Revocation while the caller is provably waiting on receipt OR context lock.
for (const contextWait of [false, true]) {
const key = randomUUID(), tag = randomUUID().slice(0, 8);
if (contextWait) sql(`INSERT INTO public.club_cashiers(club_id,user_id) VALUES ('${club}','${cashier}');`);
const lockName = `manual66_revoke_lock_${tag}`, callName = `manual66_revoke_call_${tag}`;
const lock = connection(lockName);
let caller;
try {
  lock.child.stdin.write(contextWait
    ? `SELECT 1 FROM public.tournaments WHERE id='${tour}' FOR UPDATE;\n`
    : `SELECT floor_private.floor_table_v3_lock_receipt('${cashier}','floor_add_manual_player_v1','${key}');\n`);
  await barrier(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${lockName}' AND state='idle in transaction');`, 'receipt coordinator lock missing');
  caller = connection(callName);
  const revision = Number(sql(`SELECT revision FROM public.table_sessions WHERE id='${session}';`));
  caller.child.stdin.end(`SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='${cashier}';
    ${intent(cashier, key, 3, revision)} COMMIT;\n`);
  await barrier(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity b JOIN pg_stat_activity a ON a.application_name='${lockName}'
    WHERE b.application_name='${callName}' AND b.wait_event_type='Lock' AND a.pid=ANY(pg_blocking_pids(b.pid)));`, 'revocation overlap missing');
  sql(`DELETE FROM public.club_cashiers WHERE club_id='${club}' AND user_id='${cashier}';`);
} finally { lock.child.stdin.end('COMMIT;\n'); }
assert.equal((await lock.done).code, 0);
assert.equal(parse(await caller.done).error, 'actor_not_allowed');
assert.equal(sql(`SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${tour}';`), '2');
assert.equal(sql(`SELECT count(*) FROM public.table_operation_receipts WHERE actor_id='${cashier}' AND request_id='${key}';`), '0');
console.log(`MANUAL66_AUTH_REVOKE_${contextWait ? 'CONTEXT' : 'RECEIPT'}_WAIT_PASS`);
}
console.log('MANUAL66_TWO_ACTOR_RECEIPT_RECOVERY_REVOKE_RUNTIME_PASS');

// A direct-core caller can know the outer UUID. Holding that different
// namespace must not block this wrapper after it acquires the tournament lock.
const coreKey = randomUUID(), coreTag = randomUUID().slice(0, 8);
const coreLockName = `manual66_core_lock_${coreTag}`;
const coreLock = connection(coreLockName);
let coreCaller;
try {
  coreLock.child.stdin.write(`SELECT floor_private.floor_table_v3_lock_receipt('${owner}','floor_assign_entry_to_seat','${coreKey}');\n`);
  await barrier(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${coreLockName}' AND state='idle in transaction');`, 'known core key not locked');
  coreCaller = connection(`manual66_core_caller_${coreTag}`);
  const revision = Number(sql(`SELECT revision FROM public.table_sessions WHERE id='${session}';`));
  coreCaller.child.stdin.end(`SET LOCAL lock_timeout='2s'; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='${owner}';
    ${intent(owner, coreKey, 3, revision)} COMMIT;\n`);
  // Intentionally await completion before releasing the known core mutex.
  // The old implementation reused coreKey here and timed out on this lock.
  assert.equal(parse(await coreCaller.done).ok, true);
} finally { coreLock.child.stdin.end('COMMIT;\n'); }
assert.equal((await coreLock.done).code, 0);
assert.equal(sql(`SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${tour}';`), '3');
console.log('MANUAL66_INTERNAL_CORE_MUTEX_ISOLATION_PASS');

// Public close wins under real locks; old incarnation cannot receive a player,
// even after the same physical asset is reopened with a new logical table.
const closePhysical = randomUUID();
sql(`INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status)
 VALUES ('${closePhysical}','${club}','Manual close TEST',79,'tournament','inactive','available');`);
const empty = JSON.parse(sql(`SET ROLE authenticated; SET request.jwt.claim.sub='${owner}';
 SELECT public.floor_open_tournament_table_v3('${tour}','${closePhysical}','manual','${randomUUID()}');`));
assert.equal(empty.ok, true);
const closeTag = randomUUID().slice(0, 8), closeName = `manual66_close_${closeTag}`, seatName = `manual66_after_close_${closeTag}`;
const closer = connection(closeName);
let afterClose;
try {
  closer.child.stdin.write(`SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='${owner}';
    SELECT public.close_tournament_table_v3('${empty.tournament_table_id}',1,'${randomUUID()}');\n`);
  await barrier(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${closeName}' AND state='idle in transaction');`, 'public close not held before commit');
  afterClose = connection(seatName);
  afterClose.child.stdin.end(`SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='${owner}';
    SELECT public.floor_add_manual_player_v1('${tour}','After close TEST','${empty.tournament_table_id}',1,
      '${empty.table_session_id}',1,1,'${randomUUID()}','${owner}'); COMMIT;\n`);
  await barrier(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity b JOIN pg_stat_activity a ON a.application_name='${closeName}'
    WHERE b.application_name='${seatName}' AND b.wait_event_type='Lock' AND a.pid=ANY(pg_blocking_pids(b.pid)));`, 'close versus seating overlap missing');
} finally { closer.child.stdin.end('COMMIT;\n'); }
assert.equal(parse(await closer.done).ok, true);
assert.equal(parse(await afterClose.done).error, 'table_session_mismatch');
const reopened = JSON.parse(sql(`SET ROLE authenticated; SET request.jwt.claim.sub='${owner}';
 SELECT public.floor_open_tournament_table_v3('${tour}','${closePhysical}','manual','${randomUUID()}');`));
assert.equal(reopened.ok, true);
assert.notEqual(reopened.table_session_id, empty.table_session_id);
assert.notEqual(reopened.tournament_table_id, empty.tournament_table_id);
const stale = JSON.parse(sql(`SET ROLE authenticated; SET request.jwt.claim.sub='${owner}';
 SELECT public.floor_add_manual_player_v1('${tour}','Reopened stale TEST','${reopened.tournament_table_id}',1,
   '${empty.table_session_id}',1,1,'${randomUUID()}','${owner}');`));
assert.equal(stale.error, 'table_session_mismatch');
assert.equal(sql(`SELECT count(*) FROM public.tournament_seats WHERE table_session_id IN ('${empty.table_session_id}','${reopened.table_session_id}');`), '0');
assert.equal(sql(`SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${tour}';`), '3');
console.log('MANUAL66_PUBLIC_CLOSE_REOPEN_TRUE_OVERLAP_PASS');
