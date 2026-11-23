import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildAtomicMigrationQuery, canonicalSqlText } from './ops-1359-release-gate.mjs';
import { psqlEnvironment, receiptSql, validateContext } from './floor-37-47-protected-apply.mjs';

export const sourceSha = '12a4677c37cb61dda55ae77a5735f0f558e83994';
const item = {
  action: 'APPLY',
  version: '20270128000348',
  name: 'manual_stale_shift_resolution',
  hash: "c221fa3c3481dea710e9c94567bb683df4093eae4340cbd4f2e900f8d5ead370",
};
const hash = value => createHash('sha256').update(value).digest('hex');

export function prepare348(root) {
  const source = canonicalSqlText(readFileSync(resolve(root, 'supabase/migrations', item.version + '_' + item.name + '.sql')));
  assert.equal(hash(source), item.hash, 'Reviewed migration differs');
  const atomic = buildAtomicMigrationQuery(item, source);
  assert.equal(hash(atomic), "d8b851464c726c303d4a124ade988e105927ff59abda8a3357cee4a30fcd79c1", 'Atomic SQL differs');
  return atomic;
}

const catalogSql = post => `
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SELECT json_build_object(
  'database',current_database(),'actor',current_user,
  'ledgerCount',(SELECT count(*) FROM supabase_migrations.schema_migrations
    WHERE version='${item.version}' OR name='${item.name}'),
  'definitions',${post ? "(SELECT md5(replace(pg_get_functiondef(oid),chr(13),''))='c9e42f8b4e641a057234e0cbc91c463c' AND prosecdef AND has_function_privilege('authenticated',oid,'EXECUTE') AND NOT has_function_privilege('anon',oid,'EXECUTE') FROM pg_proc WHERE oid=to_regprocedure('public.resolve_stale_dealer_shift_v1(uuid,uuid,uuid,integer,text,timestamptz,timestamptz)'))" : "to_regprocedure('public.resolve_stale_dealer_shift_v1(uuid,uuid,uuid,integer,text,timestamptz,timestamptz)') IS NULL"},
  'metadata',(SELECT json_agg(json_build_array(oid,proowner,proacl,prosecdef,provolatile,proconfig)) FROM pg_proc WHERE oid=to_regprocedure('floor_private.guard_dealer_assignment_acquisition()'))
);
COMMIT;`;

export function apply348(atomic, transport, report) {
  const pre = transport.json(catalogSql(false));
  assert.ok(pre?.database === 'postgres' && pre.actor === 'postgres' && pre.ledgerCount === 0 &&
    pre.definitions === true && pre.metadata?.length === 1, 'SWING348 preflight differs');
  try {
    transport.execute(atomic);
  } catch {
    let outcome = 'unknown';
    try {
      const receipt = transport.json(receiptSql(item));
      outcome = receipt.count === 1 && receipt.exact === true ? 'committed-exact' : receipt.count === 0 ? 'not-recorded' : 'drift';
    } catch { /* Database outcome stays unknown. */ }
    report('SWING348_STOP receipt=' + outcome);
    throw new Error('SWING348 apply outcome requires review');
  }
  const receipt = transport.json(receiptSql(item));
  assert.ok(receipt.count === 1 && receipt.exact === true, 'SWING348 exact receipt differs');
  const post = transport.json(catalogSql(true));
  assert.ok(post.definitions === true && post.ledgerCount === 1, 'SWING348 deployed definition differs');
  assert.deepEqual(post.metadata, pre.metadata, 'SWING348 function metadata differs');
  report('SWING348_COMMITTED_EXACT_AND_POSTCHECK_PASS');
}

function main() {
  const mode = process.argv[2];
  assert.ok(mode === 'verify-source' || mode === 'apply');
  const env = process.env;
  const root = resolve(env.RELEASE_SOURCE_ROOT);
  const revision = path => execFileSync('git', ['-C', path, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.equal(revision(root), sourceSha);
  const atomic = prepare348(root);
  if (mode === 'verify-source') {
    console.log('SWING348_SOURCE_AND_ATOMIC_HASH_PASS');
    return;
  }
  assert.equal(env.GITHUB_EVENT_NAME, 'workflow_dispatch');
  assert.equal(env.GITHUB_REPOSITORY, 'PhamGiaVinh/abcxyzrandomsarghes');
  assert.equal(env.RELEASE_SHA, sourceSha);
  assert.equal(env.CONFIRM_SWING_348, 'APPLY_SWING_348_' + sourceSha);
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
  apply348(atomic, { execute: query, json: sql => JSON.parse(query(sql)) }, console.log);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { main(); }
  catch { console.error('SWING348_STOP inspect reviewed receipt before any retry'); process.exitCode = 1; }
}
