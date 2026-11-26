import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildAtomicMigrationQuery, canonicalSqlText } from './ops-1359-release-gate.mjs';
import { psqlEnvironment, receiptSql, validateContext } from './floor-37-47-protected-apply.mjs';

export const sourceSha = '842441a990f8e2697b2511cd7d0d40916109856f';
const item = {
  action: 'APPLY',
  version: '20270128000349',
  name: 'dealer_shift_payroll_review',
  hash: "29f2e3fb662cb8a75b69ea1fd7f5928469c2d3d3163ef54d5de675dd4e61ca35",
};
const hash = value => createHash('sha256').update(value).digest('hex');

export function prepare349(root) {
  const source = canonicalSqlText(readFileSync(resolve(root, 'supabase/migrations', item.version + '_' + item.name + '.sql')));
  assert.equal(hash(source), item.hash, 'Reviewed migration differs');
  const atomic = buildAtomicMigrationQuery(item, source);
  assert.equal(hash(atomic), "317d1fb84f2d72de8722d1aabcef1f9a6eb782443d12a25d9b4957589269eb50", 'Atomic SQL differs');
  return atomic;
}

const catalogSql = post => `
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SELECT json_build_object(
  'database',current_database(),'actor',current_user,
  'ledgerCount',(SELECT count(*) FROM supabase_migrations.schema_migrations
    WHERE version='${item.version}' OR name='${item.name}'),
  'definitions',${post ? "(SELECT md5(replace(prosrc,chr(13),''))='43d21475e316e7188ba32af3f77592b7' AND provolatile='s' AND proconfig=ARRAY['search_path=\"\"'] AND prosecdef AND has_function_privilege('authenticated',oid,'EXECUTE') AND NOT has_function_privilege('anon',oid,'EXECUTE') FROM pg_proc WHERE oid=to_regprocedure('public.list_dealer_shift_payroll_reviews_v1(uuid,date,date)'))" : "to_regprocedure('public.list_dealer_shift_payroll_reviews_v1(uuid,date,date)') IS NULL"},
  'metadata',(SELECT json_agg(json_build_array(oid,proowner,proacl,prosecdef,provolatile,proconfig)) FROM pg_proc WHERE oid=to_regprocedure('public.resolve_stale_dealer_shift_v1(uuid,uuid,uuid,integer,text,timestamptz,timestamptz)'))
);
COMMIT;`;

export function apply349(atomic, transport, report) {
  const pre = transport.json(catalogSql(false));
  assert.ok(pre?.database === 'postgres' && pre.actor === 'postgres' && pre.ledgerCount === 0 &&
    pre.definitions === true && pre.metadata?.length === 1, 'SWING349 preflight differs');
  try {
    transport.execute(atomic);
  } catch {
    let outcome = 'unknown';
    try {
      const receipt = transport.json(receiptSql(item));
      outcome = receipt.count === 1 && receipt.exact === true ? 'committed-exact' : receipt.count === 0 ? 'not-recorded' : 'drift';
    } catch { /* Database outcome stays unknown. */ }
    report('SWING349_STOP receipt=' + outcome);
    throw new Error('SWING349 apply outcome requires review');
  }
  const receipt = transport.json(receiptSql(item));
  assert.ok(receipt.count === 1 && receipt.exact === true, 'SWING349 exact receipt differs');
  const post = transport.json(catalogSql(true));
  assert.ok(post.definitions === true && post.ledgerCount === 1, 'SWING349 deployed definition differs');
  assert.deepEqual(post.metadata, pre.metadata, 'SWING349 function metadata differs');
  report('SWING349_COMMITTED_EXACT_AND_POSTCHECK_PASS');
}

function main() {
  const mode = process.argv[2];
  assert.ok(mode === 'verify-source' || mode === 'apply');
  const env = process.env;
  const root = resolve(env.RELEASE_SOURCE_ROOT);
  const revision = path => execFileSync('git', ['-C', path, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.equal(revision(root), sourceSha);
  const atomic = prepare349(root);
  if (mode === 'verify-source') {
    console.log('SWING349_SOURCE_AND_ATOMIC_HASH_PASS');
    return;
  }
  assert.equal(env.GITHUB_EVENT_NAME, 'workflow_dispatch');
  assert.equal(env.GITHUB_REPOSITORY, 'PhamGiaVinh/abcxyzrandomsarghes');
  assert.equal(env.RELEASE_SHA, sourceSha);
  assert.equal(env.CONFIRM_SWING_349, 'APPLY_SWING_349_' + sourceSha);
  assert.equal(revision(process.cwd()), env.GITHUB_SHA);
  const receipt = JSON.parse(readFileSync(env.RECOVERY_RECEIPT_PATH, 'utf8'));
  validateContext(env, receipt);
  assert.equal(receipt.databaseOwnerAndEffectiveAclMatch, true);
  const query = sql => {
    const p = spawnSync('psql', ['-X','-qAt','-v','ON_ERROR_STOP=1'], {
      input: sql, encoding: 'utf8', env: psqlEnvironment(env), timeout: 150_000, maxBuffer: 512_000,
    });
    if (p.error || p.status !== 0) throw new Error('Private PostgreSQL command failed');
    return p.stdout.trim();
  };
  apply349(atomic, { execute: query, json: sql => JSON.parse(query(sql)) }, console.log);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { main(); }
  catch { console.error('SWING349_STOP inspect reviewed receipt before any retry'); process.exitCode = 1; }
}
