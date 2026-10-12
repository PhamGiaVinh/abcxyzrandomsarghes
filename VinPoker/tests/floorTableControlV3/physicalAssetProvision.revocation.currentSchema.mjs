import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

// Actual retained-schema authorization, no remote connection or helper doubles.
assert.equal(process.env.PGHOST, '127.0.0.1');
assert.match(process.env.PGDATABASE ?? '', /^vinpoker_ops_asset63_/);
const expectVulnerable = process.argv.includes('--expect-vulnerable');
const receiptReplay = process.argv.includes('--receipt-replay');
function sql(input) {
  const r = spawnSync('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'],
    { input, encoding: 'utf8', timeout: 5000 });
  assert.equal(r.status, 0, r.stderr || String(r.error));
  return r.stdout.trim();
}
assert.equal(sql("SELECT inet_server_addr()='127.0.0.1'::inet AND current_setting('server_version_num')::int BETWEEN 170000 AND 179999;"), 't');
const actor = randomUUID(), club = randomUUID(), key = randomUUID();
sql(`INSERT INTO auth.users(id) VALUES ('${actor}');
 INSERT INTO public.clubs(id,name,region) VALUES ('${club}','Asset revoke local TEST','TEST');
 INSERT INTO public.club_dealer_controls(club_id,user_id) VALUES ('${club}','${actor}');
 DELETE FROM public.game_tables WHERE club_id='${club}' AND table_number IS NULL AND table_name='Bàn 21';`);
if (receiptReplay) {
  const seeded = JSON.parse(sql(`SET ROLE authenticated; SET request.jwt.claim.sub='${actor}';
    SELECT public.declare_club_physical_table_v1('${club}',21,'${key}','${actor}');`));
  assert.equal(seeded.ok,true);
}
function connection(name) {
  const child = spawn('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1']);
  let out = '', err = '';
  const timer = setTimeout(() => child.kill(), 20000);
  const result = new Promise((resolve, reject) => {
    child.stdout.on('data', value => { out += value; });
    child.stderr.on('data', value => { err += value; });
    child.on('error', reject);
    child.on('close', code => { clearTimeout(timer); resolve({code,out,err}); });
  });
  child.stdin.write(`SET application_name='${name}'; BEGIN;
 SET LOCAL statement_timeout='12s'; SET LOCAL idle_in_transaction_session_timeout='12s';\n`);
  return {child,result};
}
async function barrier(query, message) {
  const deadline = Date.now()+5000;
  while (Date.now()<deadline) {
    if (sql(query)==='t') return;
    await new Promise(resolve => setTimeout(resolve,50));
  }
  assert.fail(message);
}
const tag = randomUUID().slice(0,8), lockName = `asset_revoke_lock_${tag}`, callName = `asset_revoke_call_${tag}`;
const lock = connection(lockName);
let call;
try {
  lock.child.stdin.write(receiptReplay
    ? `SELECT floor_private.floor_table_v3_lock_receipt('${actor}','declare_physical_table_v1','${key}');\n`
    : `SELECT 1 FROM public.clubs WHERE id='${club}' FOR UPDATE;\n`);
  await barrier(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${lockName}' AND state='idle in transaction');`, 'club lock not acquired');
  call = connection(callName);
  call.child.stdin.end(`SET LOCAL ROLE authenticated;
 SET LOCAL request.jwt.claim.sub='${actor}';
 SELECT public.declare_club_physical_table_v1('${club}',21,'${key}','${actor}'); COMMIT;\n`);
  await barrier(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity b JOIN pg_stat_activity a
 ON a.application_name='${lockName}' WHERE b.application_name='${callName}'
 AND b.wait_event_type='Lock' AND a.pid=ANY(pg_blocking_pids(b.pid)));`, 'exact backend overlap not observed');
  sql(`DELETE FROM public.club_dealer_controls WHERE club_id='${club}' AND user_id='${actor}';`);
  assert.equal(sql(`SELECT public.is_club_dealer_control('${actor}','${club}');`),'f');
} finally { lock.child.stdin.end('COMMIT;\n'); }
assert.equal((await lock.result).code,0);
assert.ok(call);
const result = await call.result;
assert.equal(result.code,0,result.err);
const payload = JSON.parse(result.out.split('\n').find(line => line.startsWith('{')));
const assets = sql(`SELECT count(*) FROM public.game_tables WHERE club_id='${club}' AND table_number=21;`);
const receipts = sql(`SELECT count(*) FROM public.table_operation_receipts WHERE request_id='${key}' AND actor_id='${actor}';`);
if (expectVulnerable) {
  assert.equal(payload.ok,true);
  assert.equal(assets,'1'); assert.equal(receipts,'1');
  console.log('ASSET63_REVOKED_CONTROL_COMMITTED_AFTER_LOCK_REPRODUCED');
} else {
  assert.equal(payload.error,'actor_not_allowed');
  assert.equal(assets,receiptReplay?'1':'0'); assert.equal(receipts,receiptReplay?'1':'0');
  console.log(receiptReplay ? 'ASSET65_REVOKED_RECEIPT_REPLAY_DENIED_PASS' : 'ASSET65_REVOKE_WHILE_WAITING_DENIED_PASS');
}
