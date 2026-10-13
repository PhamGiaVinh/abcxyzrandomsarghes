import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { canonicalSqlText, scanMigrationSource } from './ops-1359-release-gate.mjs';
import { receiptSql } from './floor-37-47-protected-apply.mjs';

export function loadMigration() {
  const version='20270128000066', name='floor_manual_seat_session_fence_v1';
  const filename=`${version}_${name}.sql`, hash='2da4583e6d695ec2e36779f31dc4d784142e85e6e29888ab1ae633010490d90b';
  const sql=canonicalSqlText(readFileSync(new URL(`../../supabase/migrations/${filename}`,import.meta.url),'utf8'));
  if(createHash('sha256').update(sql).digest('hex')!==hash || scanMigrationSource(sql).mode!=='outer-transaction') throw Error('Exact66 SQL drift');
  return {version,name,filename,hash,sql};
}
// Reuse the reviewed SQL's exact dependency gate, not another catalog interpretation.
export function preflightSql() {
  const i=loadMigration(), match=i.sql.match(/DO \$preflight\$[\s\S]*?END \$preflight\$;/g);
  if(match?.length!==1) throw Error('Exact66 preflight gate drift');
  return `BEGIN READ ONLY;SET LOCAL statement_timeout='10s';${match[0]}
    SELECT json_build_object('database',current_database(),'actor',current_user,
      'existing',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='${i.version}' OR name='${i.name}'),
      'namespace_absent',NOT EXISTS(SELECT 1 FROM public.table_operation_receipts WHERE operation_type='floor_add_manual_player_v1'))::text;COMMIT;`;
}
export function classifyPreflight(r) {
  if(r?.database!=='postgres'||r.actor!=='postgres'||r.existing!==0||r.namespace_absent!==true) throw Error('Exact66 precondition drift');
}
export function postcheckSql() {
  const expected=[
    ['public.floor_add_manual_player_v1(uuid,text,uuid,integer,uuid,bigint,bigint,uuid,uuid)','80ecdfe04808467e6e3c06f2383261a3'],
    ['public.get_floor_manual_player_receipt_v1(uuid,uuid,uuid)','f46813dd1f0da09386907c2d1869fcee'],
    ['public.floor_assign_player_to_seat(uuid,text,uuid,integer)','4e34096fdc1c4f105d15c33d7ae38088'],
    ['public.floor_assign_entry_to_seat(uuid,uuid,integer,bigint,uuid)','58d0372f88bc4a694182219bab178fe1'],
  ];
  return `DO $manual66_postcheck$ DECLARE r record; BEGIN
    FOR r IN SELECT * FROM (VALUES ${expected.map(([s,h])=>`('${s}','${h}')`).join(',')}) x(signature,digest) LOOP
      IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure(r.signature)
        AND md5(replace(p.prosrc,chr(13),''))=r.digest AND p.proowner='postgres'::regrole AND p.prosecdef
        AND p.proconfig=ARRAY['search_path=""']::text[]
        AND p.proacl::text='{postgres=X/postgres,authenticated=X/postgres}'
        AND has_function_privilege('authenticated',p.oid,'EXECUTE')
        AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
        AND NOT has_function_privilege('service_role',p.oid,'EXECUTE')) THEN
        RAISE EXCEPTION 'manual66_object_postcheck_failed: %',r.signature; END IF;
    END LOOP;
    IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN ('floor_add_manual_player_v1','get_floor_manual_player_receipt_v1'))<>2
      THEN RAISE EXCEPTION 'manual66_overload_postcheck_failed'; END IF;
  END $manual66_postcheck$;`;
}
export function atomicSql(item=loadMigration()) {
  const pinned=loadMigration();
  if(['version','name','filename','hash','sql'].some(k=>item[k]!==pinned[k])) throw Error('Exact66 allowlist mismatch');
  const scan=scanMigrationSource(item.sql), tag='$manual66_receipt$';
  if(item.sql.includes(tag)) throw Error('Delimiter collision');
  const guard=`SET LOCAL lock_timeout='5s';SELECT pg_advisory_xact_lock(280000,3747);
    DO $manual66_guard$ BEGIN IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations
      WHERE version='${item.version}' OR name='${item.name}')
      OR EXISTS(SELECT 1 FROM public.table_operation_receipts WHERE operation_type='floor_add_manual_player_v1')
      THEN RAISE EXCEPTION 'manual66_precondition_drift';END IF;END $manual66_guard$;`;
  const receipt=`INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
    VALUES('${item.version}','${item.name}',ARRAY[${tag}${item.sql}${tag}]::text[]);`;
  return item.sql.slice(0,scan.insertAfterBegin)+'\n'+guard+'\n'+item.sql.slice(scan.insertAfterBegin,scan.insertBeforeCommit)
    +postcheckSql()+'\n'+receipt+'\n'+item.sql.slice(scan.insertBeforeCommit);
}
export function executePackage(transport,report=()=>{}) {
  classifyPreflight(transport.json(preflightSql()));
  const i=loadMigration();
  try { transport.execute(atomicSql(i)); } catch {
    let observed='unavailable';
    try { const r=transport.json(receiptSql(i)); observed=r.count===1&&r.exact===true?'committed-exact':r.count===0?'not-recorded':'drift'; } catch { /* remains unknown */ }
    report(`MANUAL66 receipt=${observed}; no retry`); throw Error('Exact66 apply outcome requires review');
  }
  const r=transport.json(receiptSql(i));
  if(r.count!==1||r.exact!==true) throw Error('Exact66 receipt postcheck failed');
  transport.execute(postcheckSql()); report(`COMMITTED_EXACT ${i.version} ${i.hash}`); report('MANUAL66_OBJECT_POSTCHECK_PASS');
}
