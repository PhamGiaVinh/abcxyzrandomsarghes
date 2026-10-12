import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { canonicalSqlText, scanMigrationSource } from './ops-1359-release-gate.mjs';
import { receiptSql } from './floor-37-47-protected-apply.mjs';

// Exact package only; transport/credentials/owner recovery gate remain separate.
export function loadMigration() {
  const version = '20270128000064', name = 'dealer_swing_scoped_stop_v1';
  const filename = `${version}_${name}.sql`, hash = '043a0ab740c5ec489b049ee1b95f41257eca5c4b5194e417242340c486ffec17';
  const sql = canonicalSqlText(readFileSync(new URL(`../../supabase/migrations/${filename}`, import.meta.url), 'utf8'));
  if (createHash('sha256').update(sql).digest('hex') !== hash || scanMigrationSource(sql).mode !== 'outer-transaction') throw Error('Exact64 SQL drift');
  return { version, name, filename, hash, sql };
}
export function dependencyPredicate() {
  const helpers = [
    ['floor_private.floor_table_v3_lock_receipt(uuid,text,uuid)', '1eb5c322975f7c8b1ab836c4e0a6b579', 'search_path=""'],
    ['floor_private.floor_table_v3_existing_receipt(uuid,text,uuid)', 'b36883a4b7e4249af756400c2849cffc', 'search_path=""'],
    ['floor_private.floor_table_v3_save_receipt(uuid,text,uuid,text,jsonb)', '908e103b6531f09540f4edb5d09e35ee', 'search_path=""'],
    ['public.is_club_dealer_control(uuid,uuid)', '3186459824aedc075cda311b80bf97ad', 'search_path=public'],
    ['public.is_club_admin(uuid,uuid)', '4ff34cf067c878cf6c3f114f20a95f4e', 'search_path=public'],
    ['public.has_role(uuid,public.app_role)', '187a79a40c4f51499677e49b6aa4e456', 'search_path=public'],
  ].map(([signature, digest, path]) => `(SELECT count(*)=1 AND bool_and(COALESCE(
    md5(replace(pg_get_functiondef(p.oid),chr(13),''))='${digest}' AND p.proowner='postgres'::regrole
    AND p.prosecdef AND p.proconfig=ARRAY['${path}']::text[],false)) FROM pg_proc p WHERE p.oid=to_regprocedure('${signature}'))`);
  return [...helpers,
    `(SELECT count(*)=2 FROM pg_attribute WHERE attrelid='public.club_settings'::regclass AND NOT attisdropped
      AND attnotnull AND ((attname='club_id' AND atttypid='uuid'::regtype) OR (attname='auto_swing_enabled' AND atttypid='boolean'::regtype)))`,
    `EXISTS(SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=i.indkey[0]
      WHERE i.indrelid='public.club_settings'::regclass AND i.indisunique AND i.indisvalid
      AND i.indnkeyatts=1 AND i.indpred IS NULL AND i.indexprs IS NULL AND a.attname='club_id')`,
    `NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.club_settings'::regclass AND NOT tgisinternal)`,
  ].join(' AND ');
}
export function preflightSql() {
  const i = loadMigration();
  return `BEGIN READ ONLY;SET LOCAL statement_timeout='10s';SELECT json_build_object(
    'database',current_database(),'actor',current_user,'existing',(SELECT count(*) FROM supabase_migrations.schema_migrations
      WHERE version='${i.version}' OR name='${i.name}'),'baseline',(${dependencyPredicate()}),
    'new_rpc_absent',NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='operator_stop_dealer_swing_v1'),
    'namespace_absent',NOT EXISTS(SELECT 1 FROM public.table_operation_receipts WHERE operation_type='operator_stop_swing_v1'))::text;COMMIT;`;
}
export function classifyPreflight(r) {
  if (r?.database !== 'postgres' || r.actor !== 'postgres' || r.existing !== 0 || r.baseline !== true || r.new_rpc_absent !== true || r.namespace_absent !== true) throw Error('Exact64 precondition drift');
}
export function postcheckSql() {
  return `DO $stop64_postcheck$ BEGIN IF NOT COALESCE((${dependencyPredicate()}),false) OR NOT EXISTS(
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.operator_stop_dealer_swing_v1(uuid,uuid,uuid)')
      AND md5(replace(pg_get_functiondef(p.oid),chr(13),''))='32558a200e5c94c5bfcf0687b2a97ed2'
      AND p.proowner='postgres'::regrole AND p.prosecdef AND p.provolatile='v'
      AND p.proconfig=ARRAY['search_path=""','lock_timeout=5s']::text[]
      AND p.proacl::text='{postgres=X/postgres,authenticated=X/postgres}'
      AND has_function_privilege('authenticated',p.oid,'EXECUTE')
      AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
      AND NOT has_function_privilege('service_role',p.oid,'EXECUTE')) THEN
    RAISE EXCEPTION 'stop64_object_postcheck_failed'; END IF; END $stop64_postcheck$;`;
}
export function atomicSql(item = loadMigration()) {
  const pinned = loadMigration();
  if (['version', 'name', 'filename', 'hash', 'sql'].some(k => item[k] !== pinned[k])) throw Error('Exact64 allowlist mismatch');
  const scan = scanMigrationSource(item.sql), tag = '$stop64_receipt$';
  if (item.sql.includes(tag)) throw Error('Delimiter collision');
  const guard = `SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='120s';SELECT pg_advisory_xact_lock(280000,3747);
    DO $stop64_guard$ BEGIN IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations
      WHERE version='${item.version}' OR name='${item.name}') OR NOT COALESCE((${dependencyPredicate()}),false)
      THEN RAISE EXCEPTION 'stop64_precondition_drift';END IF;END $stop64_guard$;`;
  const receipt = `INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
    VALUES('${item.version}','${item.name}',ARRAY[${tag}${item.sql}${tag}]::text[]);`;
  return item.sql.slice(0, scan.insertAfterBegin) + '\n' + guard + '\n' + item.sql.slice(scan.insertAfterBegin, scan.insertBeforeCommit) + receipt + '\n' + item.sql.slice(scan.insertBeforeCommit);
}
export function executePackage(transport, report = () => {}) {
  classifyPreflight(transport.json(preflightSql()));
  const item = loadMigration();
  try { transport.execute(atomicSql(item)); } catch {
    let observed = 'unavailable';
    try { const r = transport.json(receiptSql(item)); observed = r.count === 1 && r.exact === true ? 'committed-exact' : r.count === 0 ? 'not-recorded' : 'drift'; } catch { /* Unknown remains unknown. */ }
    report(`STOP64 receipt=${observed}; no retry`);
    throw Error('Exact64 apply outcome requires review');
  }
  const r = transport.json(receiptSql(item));
  if (r.count !== 1 || r.exact !== true) throw Error('Exact64 receipt postcheck failed');
  transport.execute(postcheckSql());
  report(`COMMITTED_EXACT ${item.version} ${item.hash}`);
  report('STOP64_OBJECT_POSTCHECK_PASS');
}
