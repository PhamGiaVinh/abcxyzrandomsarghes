import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildAtomicMigrationQuery, canonicalSqlText } from './ops-1359-release-gate.mjs';
import { psqlEnvironment, receiptSql, validateContext } from './floor-37-47-protected-apply.mjs';

export const sourceSha = 'e3c2640fdb6e20f3f1e180c476721424e23224e3';
const item = {
  action: 'APPLY',
  version: '20270128000346',
  name: 'public_hud_equivalent_status_fingerprint',
  hash: 'af996d72c2c30a2394dca2e1125caa0b0810000e4a89b304f0310e4fde235a0a',
};
const hash = value => createHash('sha256').update(value).digest('hex');

export function prepare346(root) {
  const source = canonicalSqlText(readFileSync(resolve(root, 'supabase/migrations', item.version + '_' + item.name + '.sql')));
  assert.equal(hash(source), item.hash, 'Reviewed migration differs');
  const atomic = buildAtomicMigrationQuery(item, source);
  assert.equal(hash(atomic), 'fcc2f3d2c361960d06983722cb0d5a7b69d5928930741f6e1c29e26fa7aa86e1', 'Atomic SQL differs');
  return atomic;
}

const catalogSql = post => `
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SELECT json_build_object(
  'database',current_database(),'actor',current_user,
  'ledgerCount',(SELECT count(*) FROM supabase_migrations.schema_migrations
    WHERE version='${item.version}' OR name='${item.name}'),
  'definitions', COALESCE(
    (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc
      WHERE oid=to_regprocedure('tracker_analytics_v1.hand_fingerprint(uuid)'))
       = '${post ? '30c14514ffa4d20111fcbd028d96c921' : '8fa662e5dbd073f9654183c90b2b5c5b'}'
    AND ${post
      ? "(SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('tracker_analytics_v1.visibility_changed()'))='ae3bba424a7cc0c9d9b8579c068a09fd'"
      : "md5(replace(pg_get_functiondef(to_regprocedure('tracker_analytics_v1.visibility_changed()')),chr(13),''))='1b3320cd0f08d14fde3f081c5b132246'"},
    false),
  'metadata',(SELECT json_agg(json_build_array(oid,proowner,proacl,prosecdef,provolatile,proconfig) ORDER BY oid)
    FROM pg_proc WHERE oid IN (
      to_regprocedure('tracker_analytics_v1.hand_fingerprint(uuid)'),
      to_regprocedure('tracker_analytics_v1.visibility_changed()')
    ))
);
COMMIT;`;

export function apply346(atomic, transport, report) {
  const pre = transport.json(catalogSql(false));
  assert.ok(pre?.database === 'postgres' && pre.actor === 'postgres' && pre.ledgerCount === 0 &&
    pre.definitions === true && pre.metadata?.length === 2, 'HUD346 preflight differs');
  try {
    transport.execute(atomic);
  } catch {
    let outcome = 'unknown';
    try {
      const receipt = transport.json(receiptSql(item));
      outcome = receipt.count === 1 && receipt.exact === true ? 'committed-exact' : receipt.count === 0 ? 'not-recorded' : 'drift';
    } catch { /* Database outcome stays unknown. */ }
    report('HUD346_STOP receipt=' + outcome);
    throw new Error('HUD346 apply outcome requires review');
  }
  const receipt = transport.json(receiptSql(item));
  assert.ok(receipt.count === 1 && receipt.exact === true, 'HUD346 exact receipt differs');
  const post = transport.json(catalogSql(true));
  assert.ok(post.definitions === true && post.ledgerCount === 1, 'HUD346 deployed definition differs');
  assert.deepEqual(post.metadata, pre.metadata, 'HUD346 function metadata differs');
  report('HUD346_COMMITTED_EXACT_AND_POSTCHECK_PASS');
}

function main() {
  const mode = process.argv[2];
  assert.ok(mode === 'verify-source' || mode === 'apply');
  const env = process.env;
  const root = resolve(env.RELEASE_SOURCE_ROOT);
  const revision = path => execFileSync('git', ['-C', path, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.equal(revision(root), sourceSha);
  const atomic = prepare346(root);
  if (mode === 'verify-source') {
    console.log('HUD346_SOURCE_AND_ATOMIC_HASH_PASS');
    return;
  }
  assert.equal(env.GITHUB_EVENT_NAME, 'workflow_dispatch');
  assert.equal(env.GITHUB_REPOSITORY, 'PhamGiaVinh/abcxyzrandomsarghes');
  assert.equal(env.RELEASE_SHA, sourceSha);
  assert.equal(env.CONFIRM_HUD_346, 'APPLY_HUD_346_' + sourceSha);
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
  apply346(atomic, { execute: query, json: sql => JSON.parse(query(sql)) }, console.log);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { main(); }
  catch { console.error('HUD346_STOP inspect reviewed receipt before any retry'); process.exitCode = 1; }
}
