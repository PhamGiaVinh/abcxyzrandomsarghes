// Exact offline package, plus injected transport execution. No CLI/network path.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalSqlText, scanMigrationSource } from './ops-1359-release-gate.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const entries = [
  ['20270128000063','floor_physical_asset_provision_v1','8ee185c840976f58854ec006c8ab1d6d6d6f8d34077ecffd68e52a7ee62f697f'],
  ['20270128000065','floor_physical_asset_authority_commit_fence_v1','014718d85013b0b714afd96a300b7a80f38f45b031dc0ebef3740145f11682f6'],
];
export function loadPackage(sourceRoot = root) {
  return entries.map(([version,name,hash]) => {
    const sql = canonicalSqlText(readFileSync(resolve(sourceRoot,'supabase/migrations',`${version}_${name}.sql`),'utf8'));
    if (createHash('sha256').update(sql).digest('hex') !== hash) throw Error(`SQL drift ${version}`);
    const scan = scanMigrationSource(sql);
    if (scan.mode !== 'outer-transaction') throw Error(`Transaction shape ${version}`);
    return {version,name,hash,sql,scan};
  });
}
function dependencyGuard() {
  const functions = [
    ['floor_private.floor_table_v3_lock_receipt(uuid,text,uuid)','1eb5c322975f7c8b1ab836c4e0a6b579'],
    ['floor_private.floor_table_v3_existing_receipt(uuid,text,uuid)','b36883a4b7e4249af756400c2849cffc'],
    ['floor_private.floor_table_v3_save_receipt(uuid,text,uuid,text,jsonb)','908e103b6531f09540f4edb5d09e35ee'],
  ];
  const privateChecks = functions.map(([signature,hash]) => `IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid=pg_catalog.to_regprocedure('${signature}') AND p.proowner='postgres'::regrole
    AND p.prosecdef AND p.proconfig=ARRAY['search_path=""']::text[]
    AND md5(replace(replace(pg_catalog.pg_get_functiondef(p.oid),chr(13)||chr(10),chr(10)),chr(13),chr(10)))='${hash}'
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      WHERE a.privilege_type='EXECUTE' AND a.grantee<>p.proowner))
    THEN RAISE EXCEPTION 'asset_package_dependency_drift'; END IF;`).join('\n');
  const authorityChecks = [
    ['public.is_club_dealer_control(uuid,uuid)','3186459824aedc075cda311b80bf97ad'],
    ['public.is_club_admin(uuid,uuid)','4ff34cf067c878cf6c3f114f20a95f4e'],
    ['public.has_role(uuid,public.app_role)','187a79a40c4f51499677e49b6aa4e456'],
  ].map(([signature,hash])=>`IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid=pg_catalog.to_regprocedure('${signature}') AND p.proowner='postgres'::regrole
    AND p.prosecdef AND p.proconfig=ARRAY['search_path=public']::text[]
    AND md5(replace(replace(pg_catalog.pg_get_functiondef(p.oid),chr(13)||chr(10),chr(10)),chr(13),chr(10)))='${hash}')
    THEN RAISE EXCEPTION 'asset_package_authority_dependency_drift'; END IF;`).join('\n');
  return `${privateChecks}\n${authorityChecks}`;
}
export function atomicSql() {
  const pkg = loadPackage(), tag = '$asset_63_65_receipt$';
  if (pkg.some(item => item.sql.includes(tag))) throw Error('Receipt delimiter collision');
  const versions = pkg.map(item=>`'${item.version}'`).join(',');
  const names = pkg.map(item=>`'${item.name}'`).join(',');
  const guard = `DO $asset_63_65_guard$ BEGIN
    IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version IN (${versions}) OR name IN (${names}))
    THEN RAISE EXCEPTION 'asset_package_existing_receipt_stop'; END IF;
    ${dependencyGuard()}
    END $asset_63_65_guard$;`;
  const bodies = pkg.map(item=>item.sql.slice(item.scan.insertAfterBegin,item.scan.insertBeforeCommit)).join('\n');
  const receipts = pkg.map(item=>`INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
    VALUES('${item.version}','${item.name}',ARRAY[${tag}${item.sql}${tag}]::text[]);`).join('\n');
  return `BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='120s';
    SELECT pg_advisory_xact_lock(280000,3747);
    ${guard}\n${bodies}\n${receipts}\nCOMMIT;`;
}
export function postcheckSql() {
  const receipts = loadPackage().map(item=>`(SELECT count(*)=1 AND COALESCE(bool_and(name='${item.name}'
    AND cardinality(statements)=1 AND encode(extensions.digest(convert_to(
    replace(replace(statements[1],E'\\r\\n',E'\\n'),E'\\r',E'\\n'),'UTF8'),'sha256'),'hex')='${item.hash}'),false)
    FROM supabase_migrations.schema_migrations WHERE version='${item.version}')`).join(' AND ');
  return `BEGIN READ ONLY; SELECT json_build_object('receipts',(${receipts}),
    'object',COALESCE((SELECT p.proowner='postgres'::regrole AND p.prosecdef
    AND p.proconfig=ARRAY['search_path=""']::text[]
    AND md5(pg_catalog.pg_get_functiondef(p.oid))='c4c0bab3f601386c8b4f44d849c255df'
    AND has_function_privilege('authenticated',p.oid,'EXECUTE')
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      WHERE a.privilege_type='EXECUTE' AND a.grantee NOT IN (p.proowner,'authenticated'::regrole))
    AND (SELECT count(*) FROM pg_catalog.pg_proc q JOIN pg_catalog.pg_namespace n ON n.oid=q.pronamespace
      WHERE n.nspname='public' AND q.proname='declare_club_physical_table_v1')=1
    FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('public.declare_club_physical_table_v1(uuid,integer,uuid,uuid)')),false))::text; COMMIT;`;
}
export function executePackage(transport, report = ()=>{}) {
  try { transport.execute(atomicSql()); }
  catch {
    let observed='unavailable';
    try { const r=transport.json(postcheckSql()); observed=r.receipts===true&&r.object===true?'committed-exact':'not-qualified'; } catch {}
    report(`STOP asset63+65 outcome=${observed}; no retry`);
    throw Error('Asset package outcome requires review');
  }
  const result=transport.json(postcheckSql());
  if (result.receipts!==true || result.object!==true) throw Error('Asset package postcheck drift');
  report('ASSET63_65_COMMITTED_EXACT');
}
