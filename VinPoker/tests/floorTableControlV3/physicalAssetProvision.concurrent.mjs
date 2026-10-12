import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

// No connection strings or remote host allowed. Exact disposable fixture guard.
assert.ok(['127.0.0.1', '/var/run/postgresql'].includes(process.env.PGHOST));
assert.match(process.env.PGDATABASE ?? '', /^(vinpoker_asset_provision_\d{8}_\d{4}|vinpoker_ops_asset_provision_ci)$/);
const club = '00000000-0000-0000-0000-000000000010';
const dealer = '00000000-0000-0000-0000-000000000003';
const admin = '00000000-0000-0000-0000-000000000001';
function sql(query) {
  const r = spawnSync('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'],
    { input: query, encoding: 'utf8', timeout: 3000 });
  assert.equal(r.status, 0, r.stderr || String(r.error ?? 'psql failed'));
  return r.stdout.trim();
}
assert.equal(sql(`SELECT count(*) FROM public.table_operation_receipts
  WHERE operation_type='declare_physical_table_v1' AND request_id='00000000-0000-0000-0000-000000006304';`), '1');
assert.equal(sql(`SELECT count(*) FROM public.game_tables WHERE club_id='${club}' AND table_number IN (93,94);`), '0');

function tx(name, actor, number, key, hold, direct = false) {
  const child = spawn('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1']);
  let out = '', error = '';
  const timer = setTimeout(() => child.kill(), 20000);
  const result = new Promise((resolve, reject) => {
    child.stdout.on('data', x => { out += x; });
    child.stderr.on('data', x => { error += x; });
    child.on('error', reject);
    child.on('close', code => { clearTimeout(timer); resolve({ code, out, error }); });
  });
  child.stdin.write(`SET application_name='${name}';BEGIN;
    SET LOCAL statement_timeout='10s';SET LOCAL lock_timeout='8s';
    SET LOCAL idle_in_transaction_session_timeout='10s';SET LOCAL ROLE authenticated;
    SET LOCAL request.jwt.claim.sub='${actor}';
    ${direct ? `INSERT INTO public.game_tables(club_id,table_name,table_number,status,operational_status)
      VALUES ('${club}','Bàn ${number}',${number},'inactive','available')
      RETURNING jsonb_build_object('ok',true,'game_table_id',id);`
      : `SELECT public.declare_club_physical_table_v1('${club}',${number},'${key}','${actor}');`}\n`);
  if (!hold) child.stdin.end('COMMIT;\n');
  return { result, commit: () => child.stdin.end('COMMIT;\n') };
}
async function barrier(query, description) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (sql(query) === 't') return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail(`true overlap missing: ${description}`);
}
const parse = result => {
  assert.equal(result.code, 0, result.error);
  return JSON.parse(result.out.split('\n').find(x => x.startsWith('{')));
};
for (const sameReceipt of [false, true]) {
  const number = sameReceipt ? 94 : 93;
  const firstKey = randomUUID(), secondKey = sameReceipt ? firstKey : randomUUID();
  const tag = randomUUID().slice(0, 8), firstName = `asset_first_${tag}`, secondName = `asset_second_${tag}`;
  const first = tx(firstName, dealer, number, firstKey, true);
  let second;
  try {
    await barrier(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity
      WHERE application_name='${firstName}' AND state='idle in transaction');`, 'first RPC completed but uncommitted');
    second = tx(secondName, sameReceipt ? dealer : admin, number, secondKey, false);
    await barrier(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity b JOIN pg_stat_activity a
      ON a.application_name='${firstName}'
      WHERE b.application_name='${secondName}' AND b.wait_event_type='Lock'
        AND a.pid=ANY(pg_blocking_pids(b.pid)));`, 'second blocked by exact first backend');
    console.log(`PHYSICAL_ASSET_TRUE_OVERLAP_OBSERVED ${sameReceipt ? 'same-receipt' : 'two-actors'}`);
  } finally {
    first.commit();
  }
  const winner = parse(await first.result);
  assert.ok(second);
  const waiter = parse(await second.result);
  assert.equal(winner.ok, true);
  if (sameReceipt) assert.deepEqual(waiter, winner);
  else assert.equal(waiter.error, 'table_number_taken');
  assert.equal(sql(`SELECT count(*) FROM public.game_tables WHERE club_id='${club}' AND table_number=${number};`), '1');
  // New connection recovers a committed-but-discarded response using its original key.
  const recovered = JSON.parse(sql(`SET ROLE authenticated;
    SET request.jwt.claim.sub='${dealer}';
    SELECT public.declare_club_physical_table_v1('${club}',${number},'${firstKey}','${dealer}');`));
  assert.deepEqual(recovered, winner);
  assert.equal(sql(`SELECT count(*) FROM public.table_operation_receipts
    WHERE operation_type='declare_physical_table_v1' AND request_id='${firstKey}';`), '1');
}
console.log('PHYSICAL_ASSET_TWO_ACTOR_RECEIPT_RESPONSE_LOSS_PASS');
assert.equal(sql(`SELECT count(*) FROM public.game_tables WHERE club_id='${club}' AND table_number IN (98,99);`), '0');
for (const directFirst of [false, true]) {
  const number = directFirst ? 99 : 98;
  const key = randomUUID(), tag = randomUUID().slice(0,8);
  const firstName = `asset_direct_first_${tag}`, secondName = `asset_direct_second_${tag}`;
  const first = tx(firstName,dealer,number,key,true,directFirst);
  let second;
  try {
    await barrier(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity
      WHERE application_name='${firstName}' AND state='idle in transaction');`, 'first writer completed but uncommitted');
    second = tx(secondName,admin,number,key,false,!directFirst);
    await barrier(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity b JOIN pg_stat_activity a
      ON a.application_name='${firstName}' WHERE b.application_name='${secondName}'
      AND b.wait_event_type='Lock' AND a.pid=ANY(pg_blocking_pids(b.pid)));`, 'alternate writer blocked by exact first backend');
    console.log(`PHYSICAL_ASSET_DIRECT_INSERT_OVERLAP ${directFirst ? 'direct-first' : 'rpc-first'}`);
  } finally { first.commit(); }
  assert.equal(parse(await first.result).ok,true);
  assert.ok(second);
  const waiter = await second.result;
  if (directFirst) assert.equal(parse(waiter).error,'table_number_taken');
  else {
    assert.notEqual(waiter.code,0);
    assert.match(waiter.error,/uq_game_tables_club_table_number_v3/);
  }
  assert.equal(sql(`SELECT count(*) FROM public.game_tables WHERE club_id='${club}' AND table_number=${number};`),'1');
  assert.equal(sql(`SELECT count(*) FROM public.table_operation_receipts
    WHERE operation_type='declare_physical_table_v1' AND request_id='${key}';`),directFirst ? '0' : '1');
}
console.log('PHYSICAL_ASSET_DIRECT_INSERT_RLS_RACE_PASS');
// Unknown historical overload must abort the file before adding/replacing APIs.
// Only this guarded disposable database is modified; restore the tested API.
sql(`ALTER FUNCTION public.declare_club_physical_table_v1(uuid,integer,uuid,uuid)
  RENAME TO physical_asset_test_preserved_api;
  CREATE FUNCTION public.declare_club_physical_table_v1(text) RETURNS text
  LANGUAGE sql AS $$SELECT 'unknown fixture'::text$$;`);
const unknownBefore = sql(`SELECT md5(pg_get_functiondef('public.declare_club_physical_table_v1(text)'::regprocedure));`);
try {
  const preflight = spawnSync('psql', ['-X','-q','-v','ON_ERROR_STOP=1','-f',
    'supabase/migrations/20270128000063_floor_physical_asset_provision_v1.sql'],
    { encoding:'utf8', timeout:3000 });
  assert.notEqual(preflight.status,0);
  assert.match(preflight.stderr,/physical_asset_existing_overload_preflight_failed/);
  assert.equal(sql(`SELECT md5(pg_get_functiondef('public.declare_club_physical_table_v1(text)'::regprocedure));`),unknownBefore);
  assert.equal(sql(`SELECT to_regprocedure('public.declare_club_physical_table_v1(uuid,integer,uuid,uuid)') IS NULL;`),'t');
} finally {
  sql(`DROP FUNCTION public.declare_club_physical_table_v1(text);
    ALTER FUNCTION public.physical_asset_test_preserved_api(uuid,integer,uuid,uuid)
    RENAME TO declare_club_physical_table_v1;`);
}
console.log('PHYSICAL_ASSET_UNKNOWN_OVERLOAD_PREFLIGHT_PASS');
