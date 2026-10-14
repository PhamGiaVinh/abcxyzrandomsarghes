import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {canonicalSqlText,scanMigrationSource} from './ops-1359-release-gate.mjs';
import {receiptSql} from './floor-37-47-protected-apply.mjs';
import {loadMigration as rest78} from './dealer-rest78-release-plan.mjs';
import {loadPackage as close7981} from './dealer-close79-81-release-plan.mjs';
export function loadMigration(){
 const version='20270128000080',name='dealer_operator_next_intent_v1',filename=`${version}_${name}.sql`;
 const hash='0b90049a0cb63242bc5a99dd078781a3987956146546377db4c936843433c4ce';
 const sql=canonicalSqlText(readFileSync(new URL(`../../supabase/migrations/${filename}`,import.meta.url),'utf8'));
 if(createHash('sha256').update(sql).digest('hex')!==hash||scanMigrationSource(sql).mode!=='outer-transaction')throw Error('Exact next80 SQL drift');
 return {version,name,filename,hash,sql};
}
function objectCheck(signature,digest,path='search_path=""',acl='{postgres=X/postgres,authenticated=X/postgres}'){return `DO $next80_object$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_proc p
 WHERE p.oid=to_regprocedure('${signature}') AND md5(pg_get_functiondef(p.oid))='${digest}'
 AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef AND p.proconfig=ARRAY['${path}']::text[]
 AND p.proacl::text='${acl}')
 THEN RAISE EXCEPTION 'next80_object_or_privilege_drift';END IF;END $next80_object$;`;}
function exactReceipt(item){return `DO $next80_receipt$ BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='${item.version}' OR name='${item.name}')<>1
 OR NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${item.version}' AND name='${item.name}'
 AND cardinality(statements)=1 AND encode(extensions.digest(convert_to(replace(replace(statements[1],E'\\r\\n',E'\\n'),E'\\r',E'\\n'),'UTF8'),'sha256'),'hex')='${item.hash}')
 THEN RAISE EXCEPTION 'next80_dependency_or_receipt_drift';END IF;END $next80_receipt$;`;}
function dependencies(){return [rest78(),...close7981()].map(exactReceipt).join('\n')
 +objectCheck('public.set_rotation_slot_dealer(uuid,integer,uuid,text)','54fe092e15f6b90b54a51d130fec32c9','search_path=public','{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}')
 +objectCheck('public.operator_close_club_table_v2(uuid,bigint,uuid)','cda0bd0e9eb9ee15fe3cdf5c36fcc238');}
function absent(){const item=loadMigration();return `DO $next80_absent$ BEGIN
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${item.version}' OR name='${item.name}')
 OR to_regprocedure('public.operator_plan_next_dealer_v1(uuid,uuid,integer,uuid,uuid)') IS NOT NULL
 OR to_regprocedure('public.get_dealer_next_intent_receipt_v1(uuid,uuid,integer,uuid,uuid)') IS NOT NULL
 THEN RAISE EXCEPTION 'next80_catalog_collision';END IF;END $next80_absent$;`;}
function finalObjects(){return objectCheck('public.operator_plan_next_dealer_v1(uuid,uuid,integer,uuid,uuid)','e0be4b77eb58641cfaf42f0d6e17ddb8')
 +objectCheck('public.get_dealer_next_intent_receipt_v1(uuid,uuid,integer,uuid,uuid)','9f78e155af0a22cbf256f71991f6d3e5');}
export function preflightSql(){return `BEGIN READ ONLY;${dependencies()}${absent()}
 SELECT json_build_object('database',current_database(),'actor',current_user,'existing',0)::text;COMMIT;`;}
export function atomicSql(){const item=loadMigration(),scan=scanMigrationSource(item.sql),tag='$next80_source$';
 if(item.sql.includes(tag))throw Error('Next80 receipt delimiter collision');
 return `BEGIN;SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='60s';SELECT pg_advisory_xact_lock(280000,3747);
 ${dependencies()}${absent()}${item.sql.slice(scan.insertAfterBegin,scan.insertBeforeCommit)}${finalObjects()}
 INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
 VALUES('${item.version}','${item.name}',ARRAY[${tag}${item.sql}${tag}]::text[]);COMMIT;`;}
export function postcheckSql(){return `BEGIN READ ONLY;${dependencies()}${finalObjects()}${exactReceipt(loadMigration())}COMMIT;`;}
export function classifyPreflight(baseline){
 if(baseline?.database!=='postgres'||baseline.actor!=='postgres'||baseline.existing!==0)throw Error('Exact next80 baseline required');
}
export function executePackage(transport,report=()=>{}){
 classifyPreflight(transport.json(preflightSql()));
 const item=loadMigration();
 try{transport.execute(atomicSql());}catch{
  let status='unavailable';try{const proof=transport.json(receiptSql(item));status=proof.count===1&&proof.exact===true?'committed-exact':proof.count===0?'not-recorded':'drift';}catch{}
  report(`STOP next80 ${status}; no retry or downstream deploy`);throw Error('Next80 outcome requires review');
 }
 try{const proof=transport.json(receiptSql(item));if(proof.count!==1||proof.exact!==true)throw Error('Next80 receipt drift');
  transport.execute(postcheckSql());}catch{
  report('STOP next80 commit-acknowledged/postcheck-unverified; no retry or downstream deploy');throw Error('Next80 postcheck requires review');
 }
 report('NEXT80_COMMITTED_EXACT_OBJECTS_POSTCHECK_PASS');
}
