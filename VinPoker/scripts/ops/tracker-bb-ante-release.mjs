import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildAtomicMigrationQuery, canonicalSqlText } from './ops-1359-release-gate.mjs';
import { psqlEnvironment, receiptSql, validateContext } from './floor-37-47-protected-apply.mjs';
import { validateConsumerReceipt } from './tracker-bb-ante-consumers.mjs';

// Reviewed consumer/SQL revision; the runner can be added in a later commit.
export const releaseSha = '3c6e2080a0afd2f611693ff13b280d368df886a3';
export const edgeConsumers = Object.freeze([
  'tournament-live-update', 'tournament-live-resettle', 'tournament-live-resettle-commit',
  'tournament-historical-settlement', 'tournament-historical-settlement-worker',
  'tournament-historical-settlement-dispatcher',
]);
const items = [
  { action: 'APPLY', version: '20270128000350', name: 'tracker_bb_ante_atomic_v1', hash: '40facc8f4e09daa07a36ab7d07a3f99433d84c6d40de15d70e58f280632f83c1' },
  { action: 'APPLY', version: '20270128000351', name: 'tracker_bb_ante_settlement_v1', hash: '54821b77d5033cf64d7244653954d0a43793281276626cab77939f478ce363bd' },
];
const signatures = [
  'public.record_hand(uuid,uuid,integer,timestamptz,jsonb,jsonb,jsonb,jsonb,integer,uuid)',
  'public.commit_tournament_settlement_outcome(uuid,uuid,bigint,text,bigint,text,text,text,jsonb,jsonb,jsonb,jsonb)',
  'public.get_public_tournament_hand_v2(uuid,uuid)',
  'floor_private.snapshot_tracker_hand_blinds()',
];
// Exact production metadata observed through a read-only SQL Editor preflight.
// The public reader includes the plan-cache wrapper from20261104002200.
const oldHashes = ['62ed37150e497f2d17eabfb305df245b', 'b6a5e93807c3ca7117506639536562ad', 'eae66e8c287d78489e8facea7303f7b9', '81554940f984d3349149cdeed959626e'];
const newHashes = ['5cce390d5b970846feac276785ab63d9', 'bf33a1c0e9c10ab38e2314939a0caecd', 'f72e77c775b7b195dad149284f542533', '8aeffecdfd90bafded96474ed9562dc4'];
const sqlString = value => `'${value.replaceAll("'", "''")}'`;
const hash = value => createHash('sha256').update(value).digest('hex');

export function qualifySourceTrees(releaseRoot, runnerRoot, resumeRun = '', git = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], {encoding:'utf8'})) {
  assert.ok(resumeRun === '' || resumeRun === '45398872397', 'Unrecognized resume run');
  const paths = ['src','api','public','index.html','ops.html','package.json','package-lock.json','vite.config.ts','vercel.json','supabase/config.toml','supabase/functions',
    'supabase/migrations/20270128000350_tracker_bb_ante_atomic_v1.sql','supabase/migrations/20270128000351_tracker_bb_ante_settlement_v1.sql'];
  assert.equal(git(releaseRoot, ['status','--porcelain','--untracked-files=all','--',...paths]).trim(), '', 'Immutable release tree is dirty');
  // Activation-only never deploys the runner application. Qualify the separate
  // pinned release checkout; current live consumer/alias checks still run later.
  // Keep the stricter runner equality check for the original deploy path.
  if (resumeRun === '') git(runnerRoot, ['diff','--exit-code',releaseSha,'HEAD','--',...paths]);
}

export function preparePackage(root) {
  return items.map(item => {
    const source = canonicalSqlText(readFileSync(resolve(root, 'supabase/migrations', `${item.version}_${item.name}.sql`)));
    assert.equal(hash(source), item.hash, `Reviewed migration differs: ${item.version}`);
    return { ...item, atomic: buildAtomicMigrationQuery(item, source) };
  });
}

export function catalogSql(phase, post = false) {
  assert.ok(items.some(item => item.version === phase.version));
  const active = phase.version.endsWith('351') && post;
  const hashes = active ? newHashes : oldHashes;
  const definitions = signatures.map((signature, index) => `(SELECT md5(replace(pg_get_functiondef(to_regprocedure(${sqlString(signature)})),chr(13),''))=${sqlString(hashes[index])})`).join(' AND ');
  const targets = signatures.map(signature => `to_regprocedure(${sqlString(signature)})`).join(',');
  const dormantInstalled = post || phase.version.endsWith('351');
  const objects = dormantInstalled ? `
    has_function_privilege('authenticated',to_regprocedure('public.post_tracker_blinds_v1(uuid,uuid,uuid)'),'EXECUTE')
    AND NOT has_function_privilege('anon',to_regprocedure('public.post_tracker_blinds_v1(uuid,uuid,uuid)'),'EXECUTE')
    AND (SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('floor_private.tracker_blind_receipts350'))
    AND NOT has_table_privilege('authenticated',to_regclass('floor_private.tracker_blind_receipts350'),'SELECT')
    AND (SELECT count(*)=2 FROM pg_trigger WHERE tgname IN ('trg_guard_tracker_blind_batch350','trg_guard_tracker_ante_rule350') AND tgenabled='O')
    ${active ? `AND (SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('floor_private.tracker_bb_ante_originals351'))
      AND NOT has_table_privilege('authenticated',to_regclass('floor_private.tracker_bb_ante_originals351'),'SELECT')
      AND NOT has_function_privilege('authenticated',to_regprocedure('floor_private.tracker_manual_pots_match350(jsonb,jsonb,integer,uuid)'),'EXECUTE')
      AND NOT has_function_privilege('anon',to_regprocedure('floor_private.tracker_manual_payouts_match350(jsonb,jsonb,jsonb,uuid)'),'EXECUTE')` : ''}`
    : `to_regprocedure('public.post_tracker_blinds_v1(uuid,uuid,uuid)') IS NULL
       AND NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.tournament_hands'::regclass AND attname='tracker_big_blind_ante_only' AND NOT attisdropped)`;
  return `BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
SELECT json_build_object(
 'database',current_database(),'actor',current_user,
 'pending',(SELECT count(*)=${post ? 1 : 0} FROM supabase_migrations.schema_migrations WHERE version='${phase.version}' OR name='${phase.name}'),
 'definitions',(${definitions}),
 'objects',(${objects}),
 'metadata',(SELECT json_agg(json_build_array(oid,proowner,proacl,prosecdef,provolatile,proconfig) ORDER BY oid) FROM pg_proc WHERE oid IN (${targets}))
);COMMIT;`;
}

export function applyPhase(phase, transport, report = () => {}) {
  const pre = transport.json(catalogSql(phase));
  assert.ok(pre?.database === 'postgres' && pre.actor === 'postgres' && pre.pending === true && pre.definitions === true && pre.objects === true && pre.metadata?.length === signatures.length, 'Tracker BB ante preflight differs');
  // Activation requires the exact dormant350 receipt, never a guessed schema.
  if (phase.version.endsWith('351')) {
    const dormant = transport.json(receiptSql(items[0]));
    assert.ok(dormant.count === 1 && dormant.exact === true, 'Dormant350 exact receipt differs');
  }
  try { transport.execute(phase.atomic); }
  catch {
    let outcome = 'unknown';
    try {
      const receipt = transport.json(receiptSql(phase));
      outcome = receipt.count === 1 && receipt.exact === true ? 'committed-exact' : receipt.count === 0 ? 'not-recorded' : 'drift';
    } catch { /* Never retry a writer with an unknown outcome. */ }
    report(`TRACKER_BBA_STOP ${phase.version} receipt=${outcome}`);
    throw Error('Tracker BB ante apply outcome requires review');
  }
  const receipt = transport.json(receiptSql(phase));
  assert.ok(receipt.count === 1 && receipt.exact === true, 'Tracker BB ante exact receipt differs');
  const post = transport.json(catalogSql(phase, true));
  assert.ok(post.database === 'postgres' && post.actor === 'postgres' && post.pending === true && post.definitions === true && post.objects === true, 'Tracker BB ante postcheck differs');
  assert.deepEqual(post.metadata, pre.metadata, 'Tracker BB ante function metadata differs');
  report(`TRACKER_BBA_COMMITTED_EXACT ${phase.version}`);
}

async function main() {
  const mode = process.argv[2];
  assert.ok(['verify-source', 'qualify-source-tree', 'preflight', 'apply350', 'activate351'].includes(mode));
  const env = process.env;
  const root = resolve(env.RELEASE_SOURCE_ROOT ?? '.');
  const revision = path => execFileSync('git', ['-C', path, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.equal(revision(root), releaseSha);
  const phases = preparePackage(root);
  if (mode === 'verify-source') { console.log('TRACKER_BBA_REVIEWED_SOURCE_PASS'); return; }
  if (mode === 'qualify-source-tree') {
    qualifySourceTrees(root, fileURLToPath(new URL('../..',import.meta.url)), env.RESUME_CONSUMER_RUN_ID);
    console.log('TRACKER_BBA_IMMUTABLE_RUNTIME_TREE_PASS'); return;
  }
  assert.equal(env.GITHUB_EVENT_NAME, 'workflow_dispatch');
  assert.equal(env.GITHUB_REPOSITORY, 'PhamGiaVinh/abcxyzrandomsarghes');
  assert.equal(env.RELEASE_SHA, releaseSha);
  assert.equal(revision(process.cwd()), env.GITHUB_SHA);
  validateContext(env, JSON.parse(readFileSync(env.RECOVERY_RECEIPT_PATH, 'utf8')));
  const receipt = JSON.parse(readFileSync(env.RECOVERY_RECEIPT_PATH, 'utf8'));
  assert.equal(receipt.databaseOwnerAndEffectiveAclMatch, true);
  const query = sql => {
    const child = spawnSync('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], {
      input: sql, encoding: 'utf8', env: psqlEnvironment(env), timeout: 150000, maxBuffer: 512000,
    });
    if (child.error || child.status !== 0) throw Error('Private PostgreSQL command failed');
    return child.stdout.trim();
  };
  const transport = { execute: query, json: sql => JSON.parse(query(sql)) };
  if (mode === 'preflight') { console.log(JSON.stringify(transport.json(catalogSql(phases[0])))); return; }
  assert.equal(env.CONFIRM_TRACKER_BBA, `APPLY_TRACKER_BBA_350_351_${releaseSha}`);
  if (mode === 'activate351') {
    // The protected workflow must record successful deployment of every consumer
    // from this revision before it may activate new-cohort chip rules.
    const consumers = JSON.parse(readFileSync(env.CONSUMER_RECEIPT_PATH, 'utf8'));
    validateConsumerReceipt(consumers);
    assert.equal(consumers.sourceSha, releaseSha);
    assert.equal(consumers.frontend.projectId, 'prj_wLBZF7nG5O2bffM9Qu1v2rgMuMwk');
    assert.equal(consumers.frontend.hostname, 'vinpoker.vercel.app');
    assert.equal(consumers.frontend.readyState, 'READY');
    assert.match(consumers.frontend.deploymentId, /^dpl_[a-zA-Z0-9]+$/);
    assert.deepEqual([...consumers.edgeFunctions].sort(), [...edgeConsumers].sort());
    assert.equal(consumers.edgeVerified, true);
  }
  applyPhase(phases[mode === 'apply350' ? 0 : 1], transport, console.log);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { await main(); }
  catch { console.error('TRACKER_BBA_STOP inspect exact source, consumers and receipt before any retry'); process.exitCode = 1; }
}
