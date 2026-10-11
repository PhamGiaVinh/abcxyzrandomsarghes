import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {canonicalSqlText,scanMigrationSource} from './ops-1359-release-gate.mjs';
import {receiptSql} from './floor-37-47-protected-apply.mjs';

// Exact LR01 package; no transport, credentials or automatic production execution.
export function loadMigration(){
 const version='20270128000060',name='tracker_legacy_reentry_retirement_v1';
 const filename=`${version}_${name}.sql`;
 const hash='9b366c60ecfcc20f9d51876a0cdf9ad59b7c528255277ffce889792ca921a067';
 const sql=canonicalSqlText(readFileSync(new URL(`../../supabase/migrations/${filename}`,import.meta.url),'utf8'));
 if(createHash('sha256').update(sql).digest('hex')!==hash||scanMigrationSource(sql).mode!=='outer-transaction')throw Error('Exact60 SQL drift');
 return {version,name,filename,hash,sql};
}
export function dependencyPredicate(){return `(SELECT count(*)=1 AND bool_and(COALESCE(
 md5(replace(pg_get_functiondef(p.oid),chr(13),''))='bf4cc09a5caae43bc9eb7c53e364a08b'
 AND NOT p.prosecdef AND p.proowner='postgres'::regrole AND p.proconfig IS NULL
 AND p.proacl::text='{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}',false))
 FROM pg_proc p WHERE p.oid=to_regprocedure('public.re_enter_tournament(uuid,uuid,integer)'))
 AND (SELECT count(*)=1 AND bool_and(COALESCE(
 md5(replace(pg_get_functiondef(p.oid),chr(13),''))='362ead3a68b64614fce7137363cb918c'
 AND p.prosecdef AND p.proowner='postgres'::regrole AND p.proconfig=ARRAY['search_path=public']::text[]
 AND p.proacl::text='{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
 AND has_function_privilege('authenticated',p.oid,'EXECUTE'),false))
 FROM pg_proc p WHERE p.oid=to_regprocedure('public.reenter_tournament_player(uuid,bigint,bigint,text)'))`;}
export function preflightSql(){const i=loadMigration();return `BEGIN READ ONLY;SET LOCAL statement_timeout='10s';SELECT json_build_object(
 'database',current_database(),'actor',current_user,'existing',(SELECT count(*) FROM supabase_migrations.schema_migrations
 WHERE version='${i.version}' OR name='${i.name}'),'baseline',(${dependencyPredicate()}))::text;COMMIT;`;}
export function classifyPreflight(r){if(r?.database!=='postgres'||r.actor!=='postgres'||r.existing!==0||r.baseline!==true)throw Error('Exact60 precondition drift');}
export function atomicSql(item=loadMigration()){
 const pinned=loadMigration();if(['version','name','filename','hash','sql'].some(k=>item[k]!==pinned[k]))throw Error('Exact60 allowlist mismatch');
 const scan=scanMigrationSource(item.sql),tag='$reentry60_receipt$';if(item.sql.includes(tag))throw Error('Delimiter collision');
 const guard=`SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='120s';SELECT pg_advisory_xact_lock(280000,3747);
 DO $reentry60_guard$ BEGIN IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${item.version}' OR name='${item.name}')
 OR NOT COALESCE((${dependencyPredicate()}),false) THEN RAISE EXCEPTION 'reentry60_precondition_drift';END IF;END $reentry60_guard$;`;
 const receipt=`INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${item.version}','${item.name}',ARRAY[${tag}${item.sql}${tag}]::text[]);`;
 return item.sql.slice(0,scan.insertAfterBegin)+'\n'+guard+'\n'+item.sql.slice(scan.insertAfterBegin,scan.insertBeforeCommit)+receipt+'\n'+item.sql.slice(scan.insertBeforeCommit);
}
export function executePackage(transport,report=()=>{}){
 classifyPreflight(transport.json(preflightSql()));const item=loadMigration();
 try{transport.execute(atomicSql(item));}catch{
  let observed='unavailable';try{const r=transport.json(receiptSql(item));observed=r.count===1&&r.exact===true?'committed-exact':r.count===0?'not-recorded':'drift';}catch{}
  report(`STOP60 receipt=${observed}; no retry`);throw Error('Exact60 apply outcome requires review');
 }
 const r=transport.json(receiptSql(item));if(r.count!==1||r.exact!==true)throw Error('Exact60 receipt postcheck failed');
 transport.execute(readFileSync(new URL('../../tests/floorProduction/legacyReentryRetirement.readonly-postcheck.sql',import.meta.url),'utf8'));
 report(`COMMITTED_EXACT ${item.version} ${item.hash}`);report('REENTRY60_OBJECT_POSTCHECK_PASS');
}
