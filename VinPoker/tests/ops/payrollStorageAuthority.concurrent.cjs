// Run with PGHOST=127.0.0.1 PGPORT=5548 PGUSER=postgres and the disposable
// vinpoker_ops_r02_dealer_* PGDATABASE. Requires psql on PATH (or PSQL_BIN).
// Real concurrent sessions, real schema/helpers/RPCs; fixture rows are retained.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const env = { ...process.env, PGCONNECT_TIMEOUT: '5' };
for (const key of ['PGPASSWORD', 'PGSERVICE', 'PGSERVICEFILE', 'DATABASE_URL', 'SUPABASE_DB_URL']) delete env[key];
assert.equal(env.PGHOST, '127.0.0.1', 'local loopback only');
assert.equal(env.PGPORT, '5548', 'owned disposable cluster only');
assert.equal(env.PGUSER, 'postgres');
assert.match(env.PGDATABASE || '', /^vinpoker_ops_r02_dealer_[a-z0-9_]+$/);
const psql = process.env.PSQL_BIN || 'psql';
const args = ['-XwqAt', '-v', 'ON_ERROR_STOP=1'];
const sql = query => cp.execFileSync(psql, args, { env, input: query, encoding: 'utf8', maxBuffer: 2000000 }).trim();
assert.match(sql('SHOW data_directory;'), /^\/tmp\/vinpoker-/);
assert.equal(sql('SELECT current_database();'), env.PGDATABASE);
const fixtureSource = fs.readFileSync(path.join(__dirname, 'payrollStorageAuthority.native.sql'), 'utf8');
const seed = 'INSERT INTO auth.users' + fixtureSource.split('INSERT INTO auth.users')[1].split('SET LOCAL ROLE authenticated;')[0];
const claims = id => `SELECT set_config('request.jwt.claim.sub','${id}',true);SELECT set_config('request.jwt.claims','{"sub":"${id}","role":"authenticated"}',true);`;
const delay = () => new Promise(resolve => setTimeout(resolve, 25));
function connection() {
  const child = cp.spawn(psql, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
  const state = { child, out: '', error: '', code: undefined };
  child.stdout.on('data', data => state.out += data);
  child.stderr.on('data', data => state.error += data);
  state.done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => { state.code = code; resolve(code); });
  });
  return state;
}
async function waitFor(state, marker) {
  const deadline = Date.now() + 10000;
  while (!state.out.includes(marker)) {
    if (state.code !== undefined) throw new Error(state.error || `psql exited ${state.code}`);
    assert.ok(Date.now() < deadline, `missing real-session barrier: ${marker}`);
    await delay();
  }
}

async function scenario(operation) {
  const prefix = crypto.randomBytes(4).toString('hex');
  const id = n => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;
  assert.equal(sql(`SELECT count(*) FROM auth.users WHERE id::text LIKE '${prefix}-%';`), '0');
  const fixture = seed.replaceAll('17330000', prefix).replaceAll('r02-payroll-', `r02-race-${prefix}-`);
  sql(`BEGIN;${fixture}${operation === 'DELETE' ? `INSERT INTO public.payroll_adjustments(payroll_id,adjustment_type,amount_vnd,reason,created_by)VALUES('${id(41)}','BONUS',200000,'R02 race ${prefix}','${id(4)}');` : ''}COMMIT;`);
  const approver = connection();
  let editor;
  try {
    approver.child.stdin.write(`BEGIN;SET LOCAL ROLE authenticated;${claims(id(1))}SELECT public.transition_payroll_status_secure('${id(31)}','draft','submitted',NULL);SELECT public.transition_payroll_status_secure('${id(31)}','submitted','approved',NULL);SELECT 'APPROVAL_LOCK_HELD';\n`);
    await waitFor(approver, 'APPROVAL_LOCK_HELD');
    editor = connection();
    const mutation = operation === 'INSERT'
      ? `INSERT INTO public.payroll_adjustments(payroll_id,adjustment_type,amount_vnd,reason,created_by)VALUES('${id(41)}','BONUS',200000,'R02 race ${prefix}','${id(4)}');`
      : `DELETE FROM public.payroll_adjustments WHERE payroll_id='${id(41)}' AND reason='R02 race ${prefix}';`;
    editor.child.stdin.end(`BEGIN;SET LOCAL ROLE authenticated;${claims(id(4))}${mutation}COMMIT;SELECT 'EDITOR_COMMITTED';`);
    // Require PostgreSQL's actual lock wait, not an assumed delay.
    const deadline = Date.now() + 10000;
    while (sql(`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%R02 race ${prefix}%';`) !== '1') {
      assert.equal(editor.code, undefined, `editor completed before approval commit: ${editor.out} ${editor.error}`);
      assert.ok(Date.now() < deadline, 'editor did not wait on approval lock');
      await delay();
    }
    approver.child.stdin.end("COMMIT;SELECT 'APPROVAL_COMMITTED';\n");
    assert.equal(await approver.done, 0, approver.error);
    assert.equal(await editor.done, 3, 'late adjustment must fail');
    assert.match(editor.error, /payroll_adjustment_period_frozen/);
    assert.equal(sql(`SELECT status FROM public.payroll_periods WHERE id='${id(31)}';`), 'approved');
    const expectedCount = operation === 'INSERT' ? '0' : '1';
    assert.equal(sql(`SELECT count(*) FROM public.payroll_adjustments WHERE payroll_id='${id(41)}' AND reason='R02 race ${prefix}';`), expectedCount);
    assert.equal(sql(`SELECT net_pay_vnd FROM public.dealer_payroll WHERE id='${id(41)}';`), '5000000');
    return { operation, prefix, approvalLockObserved: true, editorDeniedAfterApproval: true, adjustmentCount: Number(expectedCount), savedNetVnd: 5000000 };
  } finally {
    if (!approver.child.stdin.writableEnded) approver.child.stdin.end('ROLLBACK;\n');
    if (editor && !editor.child.stdin.writableEnded) editor.child.stdin.end('ROLLBACK;\n');
    await Promise.allSettled([approver.done, ...(editor ? [editor.done] : [])]);
  }
}
module.exports = { sql, env, seed, claims, connection, waitFor, delay };
if (require.main === module) (async () => {
  const cases = [];
  for (const operation of ['INSERT', 'DELETE']) cases.push(await scenario(operation));
  console.log(JSON.stringify({ production: false, database: env.PGDATABASE, result: 'PASS', cases }));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
