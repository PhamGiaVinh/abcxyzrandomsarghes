import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {canonicalSqlText,scanMigrationSource} from './ops-1359-release-gate.mjs';
import {receiptSql} from './floor-37-47-protected-apply.mjs';

export function loadMigration(){
 const version='20270128000078',name='dealer_next_plan_rest_floor_v1';
 const filename=`${version}_${name}.sql`,hash='fb855366059ca54debf10490ca90afffb789750c25d13073bf14354d8e55b1df';
 const sql=canonicalSqlText(readFileSync(new URL(`../../supabase/migrations/${filename}`,import.meta.url),'utf8'));
 if(createHash('sha256').update(sql).digest('hex')!==hash||scanMigrationSource(sql).mode!=='outer-transaction')throw Error('Exact rest78 SQL drift');
 return {version,name,filename,hash,sql};
}
function objectCheck(digest){return `DO $rest78_object$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid='public.set_rotation_slot_dealer(uuid,integer,uuid,text)'::regprocedure
 AND md5(pg_get_functiondef(p.oid))='${digest}' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef
 AND p.proconfig=ARRAY['search_path=public']::text[]
 AND p.proacl::text='{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}')
 THEN RAISE EXCEPTION 'rest78_function_or_privilege_drift'; END IF; END $rest78_object$;`;}
function absent(){const item=loadMigration();return `DO $rest78_ledger$ BEGIN
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${item.version}' OR name='${item.name}')
 THEN RAISE EXCEPTION 'rest78_ledger_collision'; END IF; END $rest78_ledger$;`;}
export function preflightSql(){return `BEGIN READ ONLY;${absent()}${objectCheck('d884133e9519953014d776d4af6a82ff')}
 SELECT json_build_object('database',current_database(),'actor',current_user,'existing',0)::text;COMMIT;`;}
export function atomicSql(){const item=loadMigration(),scan=scanMigrationSource(item.sql),tag='$rest78_source$';
 if(item.sql.includes(tag))throw Error('Rest78 receipt delimiter collision');
 return `BEGIN;SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='60s';SELECT pg_advisory_xact_lock(280000,3747);
 ${absent()}${objectCheck('d884133e9519953014d776d4af6a82ff')}
 ${item.sql.slice(scan.insertAfterBegin,scan.insertBeforeCommit)}
 ${objectCheck('54fe092e15f6b90b54a51d130fec32c9')}
 INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
 VALUES('${item.version}','${item.name}',ARRAY[${tag}${item.sql}${tag}]::text[]);COMMIT;`;}
export function postcheckSql(){const item=loadMigration();return `BEGIN READ ONLY;${objectCheck('54fe092e15f6b90b54a51d130fec32c9')}
 DO $rest78_receipt$ BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='${item.version}' OR name='${item.name}')<>1
 OR NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${item.version}' AND name='${item.name}'
 AND cardinality(statements)=1 AND encode(extensions.digest(convert_to(replace(replace(statements[1],E'\\r\\n',E'\\n'),E'\\r',E'\\n'),'UTF8'),'sha256'),'hex')='${item.hash}')
 THEN RAISE EXCEPTION 'rest78_receipt_drift'; END IF; END $rest78_receipt$;COMMIT;`;}
export function executePackage(transport,report=()=>{}){
 const baseline=transport.json(preflightSql());
 if(baseline?.database!=='postgres'||baseline.actor!=='postgres'||baseline.existing!==0)throw Error('Exact rest78 baseline required');
 const item=loadMigration();
 try{transport.execute(atomicSql());}catch{
  let status='unavailable';try{const r=transport.json(receiptSql(item));status=r.count===1&&r.exact===true?'committed-exact':r.count===0?'not-recorded':'drift';}catch{}
  report(`STOP ${item.version} ${status}; no retry or downstream deploy`);throw Error('Rest78 apply outcome requires review');
 }
 const r=transport.json(receiptSql(item));if(r.count!==1||r.exact!==true)throw Error('Exact rest78 receipt postcheck failed');
 transport.execute(postcheckSql());report('REST78_COMMITTED_EXACT_OBJECT_POSTCHECK_PASS');
}
