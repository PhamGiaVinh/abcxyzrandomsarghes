import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {canonicalSqlText,scanMigrationSource} from './ops-1359-release-gate.mjs';
import {receiptSql} from './floor-37-47-protected-apply.mjs';
export function loadMigration(){
  const version='20270128000069',name='chip_issuance_exact_intent_v1',filename=`${version}_${name}.sql`;
  const hash='c92283d9084afe9dd68c1967e80366f3af9fe55cea1589b04f67239df8374b5f';
  const sql=canonicalSqlText(readFileSync(new URL(`../../supabase/migrations/${filename}`,import.meta.url),'utf8'));
  if(createHash('sha256').update(sql).digest('hex')!==hash||scanMigrationSource(sql).mode!=='outer-transaction')throw Error('Exact69 SQL drift');
  return {version,name,filename,hash,sql};
}
export function baselinePredicate(){return `
  EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000068'
    AND name='floor_restore_canonical_tuple_v1' AND cardinality(statements)=1
    AND encode(extensions.digest(convert_to(replace(replace(statements[1],E'\\r\\n',E'\\n'),E'\\r',E'\\n'),'UTF8'),'sha256'),'hex')='f7441afd63f5bbbb6c54d2b006c3e6c1d7f119003699c6594e54eb3749c4ff5c')
  AND EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.chip_ops_set_issuance(uuid,integer)')
    AND md5(replace(prosrc,chr(13),''))='e0fb34ec86462d73d7d95121f8ae5b3a'
    AND proowner='postgres'::regrole AND prosecdef AND proconfig=ARRAY['search_path=""']::text[]
    AND proacl::text='{postgres=X/postgres,authenticated=X/postgres}')
  AND NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.stack_template_issuance'::regclass
    AND attname='revision' AND NOT attisdropped)
  AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE (n.nspname='public' AND p.proname IN ('get_chip_issuance_state_v1','chip_ops_set_issuance_v2','get_chip_issuance_receipt_v1'))
       OR (n.nspname='floor_private' AND p.proname IN ('chip_issuance_core69','chip_issuance_revision69')))
  AND NOT has_table_privilege('authenticated','public.stack_template_issuance','INSERT,UPDATE,DELETE')`;}
export function preflightSql(){const i=loadMigration();return `BEGIN READ ONLY;SET LOCAL statement_timeout='10s';
  SELECT json_build_object('database',current_database(),'actor',current_user,
    'existing',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='${i.version}' OR name='${i.name}'),
    'baseline',(${baselinePredicate()}))::text;COMMIT;`;}
export function classifyPreflight(r){if(r?.database!=='postgres'||r.actor!=='postgres'||r.existing!==0||r.baseline!==true)throw Error('Exact69 precondition drift');}
export function postcheckSql(){
  const sql=loadMigration().sql,start=sql.indexOf('DO $postcheck$ BEGIN'),end=sql.indexOf('END $postcheck$;',start);
  if(start<0||end<0)throw Error('Exact69 postcheck seam drift');
  return sql.slice(start,end+'END $postcheck$;'.length);
}
export function atomicSql(item=loadMigration()){
  const pin=loadMigration();if(['version','name','filename','hash','sql'].some(k=>item[k]!==pin[k]))throw Error('Exact69 allowlist mismatch');
  const scan=scanMigrationSource(item.sql),tag='$issuance69_receipt$';if(item.sql.includes(tag))throw Error('Delimiter collision');
  const guard=`SET LOCAL lock_timeout='5s';SELECT pg_advisory_xact_lock(280000,3747);
    DO $issuance69_guard$ BEGIN IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${item.version}' OR name='${item.name}')
      OR NOT COALESCE((${baselinePredicate()}),false) THEN RAISE EXCEPTION 'issuance69_precondition_drift';END IF;END $issuance69_guard$;`;
  const receipt=`INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
    VALUES('${item.version}','${item.name}',ARRAY[${tag}${item.sql}${tag}]::text[]);`;
  return item.sql.slice(0,scan.insertAfterBegin)+'\n'+guard+'\n'+item.sql.slice(scan.insertAfterBegin,scan.insertBeforeCommit)
    +'\n'+receipt+'\n'+item.sql.slice(scan.insertBeforeCommit);
}
export function executePackage(transport,report=()=>{}){
  classifyPreflight(transport.json(preflightSql()));const i=loadMigration();
  try{transport.execute(atomicSql(i));}catch{
    let observed='unavailable';try{const r=transport.json(receiptSql(i));observed=r.count===1&&r.exact===true?'committed-exact':r.count===0?'not-recorded':'drift';}catch{/* unknown */}
    report(`ISSUANCE69 receipt=${observed}; no retry`);throw Error('Exact69 apply outcome requires review');
  }
  const r=transport.json(receiptSql(i));if(r.count!==1||r.exact!==true)throw Error('Exact69 receipt postcheck failed');
  transport.execute(postcheckSql());report(`COMMITTED_EXACT ${i.version} ${i.hash}`);report('ISSUANCE69_OBJECT_POSTCHECK_PASS');
}
