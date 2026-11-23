import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildAtomicMigrationQuery, canonicalSqlText } from './ops-1359-release-gate.mjs';
import { psqlEnvironment, receiptSql, validateContext } from './floor-37-47-protected-apply.mjs';

export const sourceSha = '8aa7fe30a4835827d89bdf5e0bf189563b69c908';
const item = {
  action: 'APPLY', version: '20261122122716', name: 'club_member_portraits_v1',
  hash: '4bf394e95d2723b2f4a1e764922ae7c0f197b2cb0cb2be3ab6257ba0c3b220ff',
};
const hash = value => createHash('sha256').update(value).digest('hex');
const origin = 'https://orlesggcjamwuknxwcpk.supabase.co';
const clubApi = 'public.club_player_portrait_v1(jsonb,text,uuid,uuid)';
const rosterApi = 'public.get_tracker_roster_with_portraits_v1(uuid,uuid,uuid,bigint)';
const postcheck = `
  EXISTS (SELECT 1 FROM storage.buckets WHERE id='club-player-portraits' AND public
    AND file_size_limit=131072 AND allowed_mime_types=ARRAY['image/jpeg'])
  AND EXISTS (SELECT 1 FROM floor_private.club_portrait_storage_origin WHERE singleton AND origin='${origin}')
  AND EXISTS (SELECT 1 FROM pg_class WHERE oid='floor_private.club_member_portrait_versions'::regclass AND relrowsecurity)
  AND NOT has_table_privilege('authenticated','floor_private.club_member_portrait_versions','SELECT')
  AND NOT has_table_privilege('anon','floor_private.club_member_portrait_versions','SELECT')
  AND has_function_privilege('authenticated','${clubApi}','EXECUTE') AND NOT has_function_privilege('anon','${clubApi}','EXECUTE')
  AND has_function_privilege('authenticated','${rosterApi}','EXECUTE') AND NOT has_function_privilege('anon','${rosterApi}','EXECUTE')
  AND (SELECT count(*)=6 FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
    AND policyname IN ('club_portrait_upload','club_portrait_upload_scope','club_portrait_no_anon_upload',
    'club_portrait_immutable','club_portrait_keep_snapshot','club_portrait_no_directory'))
  AND (SELECT count(*)=3 FROM pg_trigger WHERE tgenabled='O'
    AND ((tgrelid='storage.objects'::regclass AND tgname IN ('publish_club_portrait_jpeg','commit_club_portrait_object'))
      OR (tgrelid='public.hand_players'::regclass AND tgname='snapshot_club_player_portrait')))`;

export function preparePortrait(root) {
  const source = canonicalSqlText(readFileSync(resolve(root, 'supabase/pending-migrations', item.version + '_' + item.name + '.sql')));
  assert.equal(hash(source), item.hash, 'Portrait source mismatch');
  const atomic = buildAtomicMigrationQuery(item, source);
  assert.equal(hash(atomic),'8c4c90a35438845e162f0786a919373d9bdbf5bf1f162e11eb5420b7b3f2994f','Atomic source wrapper mismatch');
  assert.ok(atomic.endsWith('COMMIT;\n'));
  return atomic.slice(0,-8) + `
INSERT INTO floor_private.club_portrait_storage_origin(origin) VALUES ('${origin}');
DO $portrait_postcheck$ BEGIN
 IF (${postcheck}) IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'portrait_postcheck_failed'; END IF;
END $portrait_postcheck$;
NOTIFY pgrst, 'reload schema';
COMMIT;
`;
}

export const preflight = `BEGIN READ ONLY; SET LOCAL statement_timeout='5s';
 SELECT json_build_object('db',current_database(),'actor',current_user,
 'ready',to_regprocedure('public.get_tracker_roster_snapshot_v2(uuid,uuid,uuid,bigint)') IS NOT NULL
   AND to_regclass('public.hand_players') IS NOT NULL
   AND to_regclass('floor_private.club_member_portrait_versions') IS NULL
   AND to_regclass('floor_private.club_portrait_storage_origin') IS NULL
   AND to_regprocedure('${clubApi}') IS NULL AND to_regprocedure('${rosterApi}') IS NULL
   AND NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id='club-player-portraits')
   AND NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
     WHERE version='${item.version}' OR name='${item.name}'));
 COMMIT;`;

export function applyPortrait(atomic, transport, report) {
  const before = transport.json(preflight);
  assert.ok(before?.db === 'postgres' && before.actor === 'postgres' && before.ready === true, 'Portrait catalog preflight differs');
  try {
    transport.execute(atomic);
  } catch {
    let state = 'unknown';
    try {
      const receipt = transport.json(receiptSql(item));
      state = receipt.count===1 && receipt.exact===true ? 'committed-exact' : receipt.count===0 ? 'not-recorded' : 'drift';
    } catch { /* Retain unknown if DB is unavailable. */ }
    report('CLUB_PORTRAIT_1736_STOP receipt=' + state);
    throw new Error('Inspect the receipt before retrying');
  }
  const receipt = transport.json(receiptSql(item));
  assert.ok(receipt.count===1 && receipt.exact===true, 'Portrait receipt mismatch');
  const post = transport.json(`BEGIN READ ONLY; SET LOCAL statement_timeout='5s';
    SELECT json_build_object('verified',(${postcheck})); COMMIT;`);
  assert.equal(post.verified,true, 'Portrait postcheck mismatch');
  report('CLUB_PORTRAIT_1736_COMMITTED_EXACT_AND_POSTCHECK_PASS');
}

function main() {
  const mode = process.argv[2];
  assert.ok(mode === 'verify-source' || mode === 'apply');
  const env = process.env;
  const root = resolve(env.RELEASE_SOURCE_ROOT);
  const revision = path => execFileSync('git', ['-C', path, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.equal(revision(root), sourceSha);
  const atomic = preparePortrait(root);
  if (mode === 'verify-source') {
    console.log('CLUB_PORTRAIT_1736_SOURCE_AND_ATOMIC_HASH_PASS');
    return;
  }
  assert.equal(env.GITHUB_EVENT_NAME, 'workflow_dispatch');
  assert.equal(env.GITHUB_REPOSITORY, 'PhamGiaVinh/abcxyzrandomsarghes');
  assert.equal(env.RELEASE_SHA, sourceSha);
  assert.equal(env.CONFIRM_CLUB_PORTRAIT_1736, 'APPLY_CLUB_PORTRAIT_1736_' + sourceSha);
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
  applyPortrait(atomic, { execute: query, json: sql => JSON.parse(query(sql)) }, console.log);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { main(); }
  catch { console.error('CLUB_PORTRAIT_1736_STOP inspect reviewed receipt before any retry'); process.exitCode = 1; }
}
