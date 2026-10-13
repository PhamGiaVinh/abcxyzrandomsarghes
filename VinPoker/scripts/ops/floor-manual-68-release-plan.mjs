import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {canonicalSqlText,scanMigrationSource} from './ops-1359-release-gate.mjs';
import {receiptSql} from './floor-37-47-protected-apply.mjs';
export function loadMigration(){
  const version='20270128000068',name='floor_restore_canonical_tuple_v1',filename=`${version}_${name}.sql`;
  const hash='f7441afd63f5bbbb6c54d2b006c3e6c1d7f119003699c6594e54eb3749c4ff5c';
  const sql=canonicalSqlText(readFileSync(new URL(`../../supabase/migrations/${filename}`,import.meta.url),'utf8'));
  if(createHash('sha256').update(sql).digest('hex')!==hash||scanMigrationSource(sql).mode!=='outer-transaction')throw Error('Exact68 SQL drift');
  return {version,name,filename,hash,sql};
}
export function baselinePredicate(){
  return `EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000066'
    AND name='floor_manual_seat_session_fence_v1' AND cardinality(statements)=1
    AND encode(extensions.digest(convert_to(replace(replace(statements[1],E'\\r\\n',E'\\n'),E'\\r',E'\\n'),'UTF8'),'sha256'),'hex')='2da4583e6d695ec2e36779f31dc4d784142e85e6e29888ab1ae633010490d90b')
    AND EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000067'
      AND name='floor_manual_bust_restore_read_v1' AND cardinality(statements)=1
      AND encode(extensions.digest(convert_to(replace(replace(statements[1],E'\\r\\n',E'\\n'),E'\\r',E'\\n'),'UTF8'),'sha256'),'hex')='427ec7f078b6e7c258af3dd165d2ce7400155acae144140a045472bc1c8d6597')
    AND EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('floor_private.restore_busted_player_to_seat(uuid,uuid,integer,bigint,bigint,uuid,uuid)')
      AND md5(replace(prosrc,chr(13),''))='c8c66b3a511399fac6e05921a8791d91'
      AND proowner='postgres'::regrole AND prosecdef AND proconfig=ARRAY['search_path=""']::text[]
      AND proacl::text='{postgres=X/postgres}')
    AND to_regprocedure('public.get_current_floor_seat_ticket_v1(uuid,uuid,uuid)') IS NOT NULL
    AND EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.get_floor_restorable_entries_v3(uuid)')
      AND md5(replace(prosrc,chr(13),''))='6b2e72c175318f2f91a1a0b55966a1db'
      AND proowner='postgres'::regrole AND prosecdef AND proconfig=ARRAY['search_path=""']::text[]
      AND proacl::text='{postgres=X/postgres,authenticated=X/postgres}')
    AND EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('floor_private.tournament_entry_display_v1(uuid,uuid,uuid,integer)')
      AND md5(replace(prosrc,chr(13),''))='1fa4fcae06f56774b40913b83a6b239a'
      AND proowner='postgres'::regrole AND prosecdef AND proconfig=ARRAY['search_path=""']::text[])`;
}
export function preflightSql(){const i=loadMigration();return `BEGIN READ ONLY;SET LOCAL statement_timeout='10s';
  SELECT json_build_object('database',current_database(),'actor',current_user,
    'existing',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='${i.version}' OR name='${i.name}'),
    'baseline',(${baselinePredicate()}))::text;COMMIT;`;}
export function classifyPreflight(r){if(r?.database!=='postgres'||r.actor!=='postgres'||r.existing!==0||r.baseline!==true)throw Error('Exact68 precondition drift');}
export function postcheckSql(){return `DO $manual68_postcheck$ BEGIN IF NOT EXISTS(
  SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('floor_private.restore_busted_player_to_seat(uuid,uuid,integer,bigint,bigint,uuid,uuid)')
    AND md5(replace(prosrc,chr(13),''))='ca72a3aa2e2b1681407b6289bd8f4a2a'
    AND proowner='postgres'::regrole AND prosecdef AND proconfig=ARRAY['search_path=""']::text[]
    AND proacl::text='{postgres=X/postgres}'
    AND NOT has_function_privilege('authenticated',oid,'EXECUTE') AND NOT has_function_privilege('anon',oid,'EXECUTE')
    AND NOT has_function_privilege('service_role',oid,'EXECUTE')) THEN RAISE EXCEPTION 'manual68_object_postcheck_failed';END IF;END $manual68_postcheck$;`;}
export function atomicSql(item=loadMigration()){
  const pin=loadMigration();if(['version','name','filename','hash','sql'].some(k=>item[k]!==pin[k]))throw Error('Exact68 allowlist mismatch');
  const scan=scanMigrationSource(item.sql),tag='$manual68_receipt$';if(item.sql.includes(tag))throw Error('Delimiter collision');
  const guard=`SET LOCAL lock_timeout='5s';SELECT pg_advisory_xact_lock(280000,3747);
    DO $manual68_guard$ BEGIN IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${item.version}' OR name='${item.name}')
      OR NOT COALESCE((${baselinePredicate()}),false) THEN RAISE EXCEPTION 'manual68_precondition_drift';END IF;END $manual68_guard$;`;
  const receipt=`INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
    VALUES('${item.version}','${item.name}',ARRAY[${tag}${item.sql}${tag}]::text[]);`;
  return item.sql.slice(0,scan.insertAfterBegin)+'\n'+guard+'\n'+item.sql.slice(scan.insertAfterBegin,scan.insertBeforeCommit)
    +postcheckSql()+'\n'+receipt+'\n'+item.sql.slice(scan.insertBeforeCommit);
}
export function executePackage(transport,report=()=>{}){
  classifyPreflight(transport.json(preflightSql()));const i=loadMigration();
  try{transport.execute(atomicSql(i));}catch{
    let observed='unavailable';try{const r=transport.json(receiptSql(i));observed=r.count===1&&r.exact===true?'committed-exact':r.count===0?'not-recorded':'drift';}catch{/* stays unknown */}
    report(`MANUAL68 receipt=${observed}; no retry`);throw Error('Exact68 apply outcome requires review');
  }
  const r=transport.json(receiptSql(i));if(r.count!==1||r.exact!==true)throw Error('Exact68 receipt postcheck failed');
  transport.execute(postcheckSql());report(`COMMITTED_EXACT ${i.version} ${i.hash}`);report('MANUAL68_OBJECT_POSTCHECK_PASS');
}
