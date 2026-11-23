import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildAtomicMigrationQuery, canonicalSqlText } from './ops-1359-release-gate.mjs';
import { psqlEnvironment, receiptSql, validateContext } from './floor-37-47-protected-apply.mjs';

export const sourceSha = 'e7569c4c5ce995bfcedfbf46a28da27cf85016fc';
const item = {
  action: 'APPLY',
  version: '20270128000347',
  name: 'dealer_relief_stale_outgoing_v1',
  hash: 'ed22e037fb62f5a4b7671058d16a8eb8c282c5478cdbd88f5f097f15ff645b86',
};
const hash = value => createHash('sha256').update(value).digest('hex');

export function prepare347(root) {
  const source = canonicalSqlText(readFileSync(resolve(root, 'supabase/migrations', item.version + '_' + item.name + '.sql')));
  assert.equal(hash(source), item.hash, 'Reviewed migration differs');
  const atomic = buildAtomicMigrationQuery(item, source);
  assert.equal(hash(atomic), '57faf6013904910cf1ce6b6b97975fd405fe64e10ba6d951f71c2a21076564ff', 'Atomic SQL differs');
  return atomic;
}

const catalogSql = post => `
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SELECT json_build_object(
  'database',current_database(),'actor',current_user,
  'ledgerCount',(SELECT count(*) FROM supabase_migrations.schema_migrations
    WHERE version='${item.version}' OR name='${item.name}'),
  'definitions',md5(replace(pg_get_functiondef(to_regprocedure('floor_private.guard_dealer_assignment_acquisition()')),chr(13),''))='${post ? 'e66d4def1d252eb419e7af6509b115da' : '59d94669c91e5a686543c1f7ece4ef2c'}',
  'metadata',(SELECT json_agg(json_build_array(oid,proowner,proacl,prosecdef,provolatile,proconfig)) FROM pg_proc WHERE oid=to_regprocedure('floor_private.guard_dealer_assignment_acquisition()'))
);
COMMIT;`;

export function apply347(atomic, transport, report) {
  const pre = transport.json(catalogSql(false));
  assert.ok(pre?.database === 'postgres' && pre.actor === 'postgres' && pre.ledgerCount === 0 &&
    pre.definitions === true && pre.metadata?.length === 1, 'SWING347 preflight differs');
  try {
    transport.execute(atomic);
  } catch {
    let outcome = 'unknown';
    try {
      const receipt = transport.json(receiptSql(item));
      outcome = receipt.count === 1 && receipt.exact === true ? 'committed-exact' : receipt.count === 0 ? 'not-recorded' : 'drift';
    } catch { /* Database outcome stays unknown. */ }
    report('SWING347_STOP receipt=' + outcome);
    throw new Error('SWING347 apply outcome requires review');
  }
  const receipt = transport.json(receiptSql(item));
  assert.ok(receipt.count === 1 && receipt.exact === true, 'SWING347 exact receipt differs');
  const post = transport.json(catalogSql(true));
  assert.ok(post.definitions === true && post.ledgerCount === 1, 'SWING347 deployed definition differs');
  assert.deepEqual(post.metadata, pre.metadata, 'SWING347 function metadata differs');
  report('SWING347_COMMITTED_EXACT_AND_POSTCHECK_PASS');
}

function main() {
  const mode = process.argv[2];
  assert.ok(mode === 'verify-source' || mode === 'apply');
  const env = process.env;
  const root = resolve(env.RELEASE_SOURCE_ROOT);
  const revision = path => execFileSync('git', ['-C', path, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.equal(revision(root), sourceSha);
  const atomic = prepare347(root);
  if (mode === 'verify-source') {
    console.log('SWING347_SOURCE_AND_ATOMIC_HASH_PASS');
    return;
  }
  assert.equal(env.GITHUB_EVENT_NAME, 'workflow_dispatch');
  assert.equal(env.GITHUB_REPOSITORY, 'PhamGiaVinh/abcxyzrandomsarghes');
  assert.equal(env.RELEASE_SHA, sourceSha);
  assert.equal(env.CONFIRM_SWING_347, 'APPLY_SWING_347_' + sourceSha);
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
  apply347(atomic, { execute: query, json: sql => JSON.parse(query(sql)) }, console.log);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { main(); }
  catch { console.error('SWING347_STOP inspect reviewed receipt before any retry'); process.exitCode = 1; }
}
