import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {canonicalSqlText,scanMigrationSource} from './ops-1359-release-gate.mjs';
import {receiptSql} from './floor-37-47-protected-apply.mjs';
export function loadMigration(){
 const version='20270128000079',name='dealer_close_next_reservation_v1';
 const filename=`${version}_${name}.sql`,hash='ae8293a00b54d322e4e83dc36783094376a34691c20f3658de234e289d11bc66';
 const sql=canonicalSqlText(readFileSync(new URL(`../../supabase/migrations/${filename}`,import.meta.url),'utf8'));
 if(createHash('sha256').update(sql).digest('hex')!==hash||scanMigrationSource(sql).mode!=='outer-transaction')throw Error('Exact close79 SQL drift');
 return {version,name,filename,hash,sql};
}
function objectCheck(digest){return `DO $close79_object$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid='public.operator_close_club_table_v2(uuid,bigint,uuid)'::regprocedure
 AND md5(pg_get_functiondef(p.oid))='${digest}' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef
 AND p.proconfig=ARRAY['search_path=""']::text[]
 AND p.proacl::text='{postgres=X/postgres,authenticated=X/postgres}')
 THEN RAISE EXCEPTION 'close79_function_or_privilege_drift'; END IF; END $close79_object$;`;}
function absent(){const item=loadMigration();return `DO $close79_ledger$ BEGIN
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${item.version}' OR name='${item.name}')
 THEN RAISE EXCEPTION 'close79_ledger_collision'; END IF; END $close79_ledger$;`;}
export function preflightSql(){return `BEGIN READ ONLY;${absent()}${objectCheck('7724e5d9abd44d876f990e2521830582')}
 SELECT json_build_object('database',current_database(),'actor',current_user,'existing',0)::text;COMMIT;`;}
export function atomicSql(){const item=loadMigration(),scan=scanMigrationSource(item.sql),tag='$close79_source$';
 if(item.sql.includes(tag))throw Error('Close79 receipt delimiter collision');
 return `BEGIN;SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='60s';SELECT pg_advisory_xact_lock(280000,3747);
 ${absent()}${objectCheck('7724e5d9abd44d876f990e2521830582')}
 ${item.sql.slice(scan.insertAfterBegin,scan.insertBeforeCommit)}
 ${objectCheck('70b3e4bb3bc85973152e8ed21fae4438')}
 INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
 VALUES('${item.version}','${item.name}',ARRAY[${tag}${item.sql}${tag}]::text[]);COMMIT;`;}
export function postcheckSql(){const item=loadMigration();return `BEGIN READ ONLY;${objectCheck('70b3e4bb3bc85973152e8ed21fae4438')}
 DO $close79_receipt$ BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='${item.version}' OR name='${item.name}')<>1
 OR NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${item.version}' AND name='${item.name}'
 AND cardinality(statements)=1 AND encode(extensions.digest(convert_to(replace(replace(statements[1],E'\\r\\n',E'\\n'),E'\\r',E'\\n'),'UTF8'),'sha256'),'hex')='${item.hash}')
 THEN RAISE EXCEPTION 'close79_receipt_drift'; END IF; END $close79_receipt$;COMMIT;`;}
export function executePackage(transport,report=()=>{}){
 classifyPreflight(transport.json(preflightSql()));const item=loadMigration();
 try{transport.execute(atomicSql());}catch{
  let status='unavailable';try{const r=transport.json(receiptSql(item));status=r.count===1&&r.exact===true?'committed-exact':r.count===0?'not-recorded':'drift';}catch{}
  report(`STOP ${item.version} ${status}; no retry or downstream deploy`);throw Error('Close79 apply outcome requires review');
 }
 try{
  const r=transport.json(receiptSql(item));if(r.count!==1||r.exact!==true)throw Error('Exact close79 receipt postcheck failed');
  transport.execute(postcheckSql());
 }catch{
  report(`STOP ${item.version} commit-acknowledged/postcheck-unverified; no retry or downstream deploy`);
  throw Error('Close79 acknowledged commit requires postcheck review');
 }
 report('CLOSE79_COMMITTED_EXACT_OBJECT_POSTCHECK_PASS');
}
export function classifyPreflight(baseline){
 if(baseline?.database!=='postgres'||baseline.actor!=='postgres'||baseline.existing!==0)throw Error('Exact close79 baseline required');
}
