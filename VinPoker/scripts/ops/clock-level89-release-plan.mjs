import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {canonicalSqlText,scanMigrationSource} from './ops-1359-release-gate.mjs';
import {receiptSql} from './floor-37-47-protected-apply.mjs';

export function loadMigration(){
 const version='20270128000089',name='clock_start_level_readiness_v1';
 const filename=`${version}_${name}.sql`,hash='1f4b7d21014fe561110de19c17ea26d94485c09fba02a80ed16d07019cc6de92';
 const sql=canonicalSqlText(readFileSync(new URL(`../../supabase/migrations/${filename}`,import.meta.url),'utf8'));
 if(createHash('sha256').update(sql).digest('hex')!==hash||scanMigrationSource(sql).mode!=='outer-transaction')throw Error('Exact clock89 SQL drift');
 return {version,name,filename,hash,sql};
}
function objectCheck(digest){return `DO $clock89_object$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid='public.floor_start_tournament_clock(uuid)'::regprocedure
 AND md5(replace(replace(pg_get_functiondef(p.oid),chr(13)||chr(10),chr(10)),chr(13),chr(10)))='${digest}' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef
 AND p.proconfig=ARRAY['search_path=public']::text[]
 AND p.proacl::text='{postgres=X/postgres,authenticated=X/postgres}')
 THEN RAISE EXCEPTION 'clock89_function_or_privilege_drift'; END IF; END $clock89_object$;`;}
function absent(){const item=loadMigration();return `DO $clock89_ledger$ BEGIN
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${item.version}' OR name='${item.name}')
 THEN RAISE EXCEPTION 'clock89_ledger_collision'; END IF; END $clock89_ledger$;`;}
export function preflightSql(){return `BEGIN READ ONLY;${absent()}${objectCheck('08f586e2fab1dc164e1f2f67ea669514')}
 SELECT json_build_object('database',current_database(),'actor',current_user,'existing',0)::text;COMMIT;`;}
export function atomicSql(){const item=loadMigration(),scan=scanMigrationSource(item.sql),tag='$clock89_source$';
 if(item.sql.includes(tag))throw Error('Clock89 receipt delimiter collision');
 return `BEGIN;SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='60s';SELECT pg_advisory_xact_lock(280000,3747);
 ${absent()}${objectCheck('08f586e2fab1dc164e1f2f67ea669514')}
 ${item.sql.slice(scan.insertAfterBegin,scan.insertBeforeCommit)}
 ${objectCheck('334593a0dc61985dc7acd97a4d124ef6')}
 INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
 VALUES('${item.version}','${item.name}',ARRAY[${tag}${item.sql}${tag}]::text[]);COMMIT;`;}
export function postcheckSql(){const item=loadMigration();return `BEGIN READ ONLY;${objectCheck('334593a0dc61985dc7acd97a4d124ef6')}
 DO $clock89_receipt$ BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='${item.version}' OR name='${item.name}')<>1
 OR NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${item.version}' AND name='${item.name}'
 AND cardinality(statements)=1 AND encode(extensions.digest(convert_to(replace(replace(statements[1],E'\\r\\n',E'\\n'),E'\\r',E'\\n'),'UTF8'),'sha256'),'hex')='${item.hash}')
 THEN RAISE EXCEPTION 'clock89_receipt_drift'; END IF; END $clock89_receipt$;COMMIT;`;}
export function executePackage(transport,report=()=>{}){
 const baseline=transport.json(preflightSql());
 classifyPreflight(baseline);
 const item=loadMigration();
 try{transport.execute(atomicSql());}catch{
  let status='unavailable';try{const r=transport.json(receiptSql(item));status=r.count===1&&r.exact===true?'committed-exact':r.count===0?'not-recorded':'drift';}catch{}
  report(`STOP ${item.version} ${status}; no retry or downstream deploy`);throw Error('Clock89 apply outcome requires review');
 }
 try{
  const r=transport.json(receiptSql(item));if(r.count!==1||r.exact!==true)throw Error('Exact clock89 receipt postcheck failed');
  transport.execute(postcheckSql());
 }catch{
  report(`STOP ${item.version} commit-acknowledged/postcheck-unverified; no retry or downstream deploy`);
  throw Error('Clock89 acknowledged commit requires postcheck review');
 }
 report('CLOCK89_COMMITTED_EXACT_OBJECT_POSTCHECK_PASS');
}
export function classifyPreflight(baseline){
 if(baseline?.database!=='postgres'||baseline.actor!=='postgres'||baseline.existing!==0)throw Error('Exact clock89 baseline required');
}
