import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';

// Run after scopedStop.disposable.sql, exclusively on a local disposable DB.
assert.ok(['/var/run/postgresql', '127.0.0.1'].includes(process.env.PGHOST));
assert.ok(process.env.PGDATABASE?.startsWith('vinpoker_stop_'));
const club = '00000000-0000-0000-0000-000000000010';
const actor = '00000000-0000-0000-0000-000000000003';
const auth = `SET ROLE authenticated; SET request.jwt.claim.role='authenticated'; SET request.jwt.claim.sub='${actor}';`;
const worker = "SET request.jwt.claim.role='service_role'; SET request.headers='{}';";
const children = new Set();
function sql(query) {
  const r = spawnSync('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], { input: query, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}
function transaction(marker, query, hold = false) {
  const child = spawn('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1']);
  children.add(child);
  let out = '', error = '';
  const result = new Promise(resolve => {
    child.stdout.on('data', c => out += c);
    child.stderr.on('data', c => error += c);
    child.on('error', e => resolve({ code: -1, error: String(e), out }));
    child.on('close', code => { children.delete(child); resolve({ code, error, out }); });
  });
  child.stdin.write(`SET application_name='${marker}'; BEGIN; ${query}\n`);
  if (!hold) child.stdin.end('COMMIT;\n');
  return { result, commit: () => child.stdin.end('COMMIT;\n') };
}
async function barrier(marker, condition) {
  for (let i = 0; i < 100; i++) {
    if (sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${marker}' AND ${condition});`) === 't') return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail(`actual overlap missing: ${marker}`);
}
const held = "wait_event='ClientRead' AND xact_start IS NOT NULL";
const blocked = 'cardinality(pg_blocking_pids(pid))>0';
const call = key => `${auth} SELECT public.operator_stop_dealer_swing_v1('${club}','00000000-0000-0000-0000-${key}','${actor}');`;
const enable = () => sql(`UPDATE public.club_settings SET auto_swing_enabled=true WHERE club_id='${club}';`);
const parsed = r => { assert.equal(r.code, 0, r.error); return JSON.parse(r.out.split('\n').find(l => l.startsWith('{'))); };

try {
  // Reuse the actual existing fence body, not a lookalike. This proves its lock
  // primitive against Stop, not a full worker/assignment lifecycle.
  const source = readFileSync('supabase/migrations/20270128000022_dealer_assignment_off_commit_fence_v1.sql', 'utf8');
  const fence = source.match(/CREATE OR REPLACE FUNCTION floor_private\.assert_dealer_acquisition_intent\(p_club_id uuid\)[\s\S]*?\$function\$;/);
  assert.ok(fence, 'existing reviewed fence body must be found');
  sql(fence[0]);
  enable();
  const stop = transaction('stop_before_fence', call('000000006420'), true);
  await barrier('stop_before_fence', held);
  const late = transaction('fence_after_stop', `${worker} SELECT floor_private.assert_dealer_acquisition_intent('${club}');`);
  await barrier('fence_after_stop', blocked);
  stop.commit();
  assert.equal(parsed(await stop.result).current_state.auto_swing_enabled, false);
  const denied = await late.result;
  assert.notEqual(denied.code, 0);
  assert.match(denied.error, /AUTO_SWING_OFF/);

  enable();
  const acquiring = transaction('fence_before_stop', `${worker} SELECT floor_private.assert_dealer_acquisition_intent('${club}');`, true);
  await barrier('fence_before_stop', held);
  const waiting = transaction('stop_after_fence', call('000000006421'));
  await barrier('stop_after_fence', blocked);
  acquiring.commit();
  assert.equal((await acquiring.result).code, 0);
  assert.equal(parsed(await waiting.result).receipt.outcome, 'applied');

  enable();
  const first = transaction('stop_same_key_first', call('000000006422'), true);
  await barrier('stop_same_key_first', held);
  const repeat = transaction('stop_same_key_repeat', call('000000006422'));
  await barrier('stop_same_key_repeat', blocked);
  first.commit();
  assert.deepEqual(parsed(await first.result), parsed(await repeat.result));
  assert.equal(sql("SELECT count(*) FROM public.table_operation_receipts WHERE request_id='00000000-0000-0000-0000-000000006422';"), '1');

  enable();
  const lock = transaction('stop_revocation_holder', `SELECT club_id FROM public.club_settings WHERE club_id='${club}' FOR UPDATE;`, true);
  await barrier('stop_revocation_holder', held);
  const revoked = transaction('stop_revocation_waiter', call('000000006423'));
  await barrier('stop_revocation_waiter', blocked);
  sql(`DELETE FROM public.club_dealer_controls WHERE club_id='${club}' AND user_id='${actor}';`);
  lock.commit();
  assert.equal((await lock.result).code, 0);
  assert.equal(parsed(await revoked.result).error, 'actor_not_allowed');
  assert.equal(sql(`SELECT auto_swing_enabled FROM public.club_settings WHERE club_id='${club}';`), 't');
  assert.equal(sql("SELECT count(*) FROM public.table_operation_receipts WHERE request_id='00000000-0000-0000-0000-000000006423';"), '0');
  sql(`INSERT INTO public.club_dealer_controls(club_id,user_id) VALUES('${club}','${actor}');`);

  // Fail closed without replacing an unknown overload or adopting a previous
  // receipt namespace. Only explicit fixture objects are changed locally.
  const migration = readFileSync('supabase/migrations/20270128000064_dealer_swing_scoped_stop_v1.sql', 'utf8');
  const original = sql("SELECT pg_get_functiondef('public.operator_stop_dealer_swing_v1(uuid,uuid,uuid)'::regprocedure);");
  sql("CREATE FUNCTION public.operator_stop_dealer_swing_v1(text) RETURNS text LANGUAGE sql AS $$ SELECT 'UNKNOWN_FIXTURE_BODY'::text $$;");
  try {
    const failed = spawnSync('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], { input: migration, encoding: 'utf8' });
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /swing_stop_existing_overload_preflight_failed/);
    assert.equal(sql("SELECT public.operator_stop_dealer_swing_v1('fixture'::text);"), 'UNKNOWN_FIXTURE_BODY');
    assert.equal(sql("SELECT pg_get_functiondef('public.operator_stop_dealer_swing_v1(uuid,uuid,uuid)'::regprocedure);"), original);
  } finally {
    sql('DROP FUNCTION public.operator_stop_dealer_swing_v1(text);');
  }
  const receiptCount = sql("SELECT count(*) FROM public.table_operation_receipts WHERE operation_type='operator_stop_swing_v1';");
  sql('ALTER FUNCTION public.operator_stop_dealer_swing_v1(uuid,uuid,uuid) RENAME TO stop_original_fixture_v1;');
  try {
    const failed = spawnSync('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], { input: migration, encoding: 'utf8' });
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /swing_stop_existing_receipt_namespace_preflight_failed/);
    assert.equal(sql("SELECT count(*) FROM public.table_operation_receipts WHERE operation_type='operator_stop_swing_v1';"), receiptCount);
    assert.equal(sql("SELECT to_regprocedure('public.operator_stop_dealer_swing_v1(uuid,uuid,uuid)') IS NULL;"), 't');
  } finally {
    sql('ALTER FUNCTION public.stop_original_fixture_v1(uuid,uuid,uuid) RENAME TO operator_stop_dealer_swing_v1;');
  }
  assert.equal(sql("SELECT pg_get_functiondef('public.operator_stop_dealer_swing_v1(uuid,uuid,uuid)'::regprocedure);"), original);
  console.log('SCOPED_STOP_FENCE_BOTH_ORDERS_REPLAY_REVOCATION_TRUE_OVERLAP_PASS');
  console.log('SCOPED_STOP_UNKNOWN_OVERLOAD_RECEIPT_NAMESPACE_PREFLIGHT_PASS');
} finally {
  for (const child of children) child.kill();
}
