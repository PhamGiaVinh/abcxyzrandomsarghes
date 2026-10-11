import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {canonicalSqlText,scanMigrationSource} from './ops-1359-release-gate.mjs';
import {receiptSql} from './floor-37-47-protected-apply.mjs';

// Exact LS01 package; no credentials, transport or autonomous live execution.
export function loadMigration(){
 const version='20270128000061',name='tracker_legacy_stack_retirement_v1';
 const filename=`${version}_${name}.sql`,hash='a037ef4fe53edb058e833e6605180f710875ce04a15f1770022bbf559650c9d2';
 const sql=canonicalSqlText(readFileSync(new URL(`../../supabase/migrations/${filename}`,import.meta.url),'utf8'));
 if(createHash('sha256').update(sql).digest('hex')!==hash||scanMigrationSource(sql).mode!=='outer-transaction')throw Error('Exact61 SQL drift');
 return {version,name,filename,hash,sql};
}
export function dependencyPredicate(){return [
 ['public.update_stack(uuid,uuid,integer,integer)','b364161d7c5feab57691094af3be8aa3',false],
 ['public.bulk_update_stacks(uuid,jsonb)','8ddbdde2a6ea88050b44d275dd76ebad',false],
 ['public.set_tracker_table_roster_seat_v2(uuid,uuid,uuid,bigint,uuid,integer,text,integer,uuid,boolean,text,text)','a04bbb425ed15913bd8ee2368256f25a',true],
 ].map(([signature,digest,canonical])=>`(SELECT count(*)=1 AND bool_and(COALESCE(
 md5(replace(pg_get_functiondef(p.oid),chr(13),''))='${digest}'
 AND p.proowner='postgres'::regrole AND p.prosecdef=${canonical}
 AND ${canonical ? "p.proconfig=ARRAY['search_path=\"\"']::text[] AND p.proacl::text='{postgres=X/postgres,authenticated=X/postgres}'" : "p.proconfig IS NULL AND p.proacl::text='{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'"}
 AND has_function_privilege('authenticated',p.oid,'EXECUTE'),false))
 FROM pg_proc p WHERE p.oid=to_regprocedure('${signature}'))`).join(' AND ');}
export function preflightSql(){const i=loadMigration();return `BEGIN READ ONLY;SET LOCAL statement_timeout='10s';SELECT json_build_object(
 'database',current_database(),'actor',current_user,'existing',(SELECT count(*) FROM supabase_migrations.schema_migrations
 WHERE version='${i.version}' OR name='${i.name}'),'baseline',(${dependencyPredicate()}))::text;COMMIT;`;}
export function classifyPreflight(r){if(r?.database!=='postgres'||r.actor!=='postgres'||r.existing!==0||r.baseline!==true)throw Error('Exact61 precondition drift');}
export function atomicSql(item=loadMigration()){
 const pinned=loadMigration();if(['version','name','filename','hash','sql'].some(k=>item[k]!==pinned[k]))throw Error('Exact61 allowlist mismatch');
 const scan=scanMigrationSource(item.sql),tag='$stack61_receipt$';if(item.sql.includes(tag))throw Error('Delimiter collision');
 const guard=`SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='120s';SELECT pg_advisory_xact_lock(280000,3747);
 DO $stack61_guard$ BEGIN IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${item.version}' OR name='${item.name}')
 OR NOT COALESCE((${dependencyPredicate()}),false) THEN RAISE EXCEPTION 'stack61_precondition_drift';END IF;END $stack61_guard$;`;
 const receipt=`INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${item.version}','${item.name}',ARRAY[${tag}${item.sql}${tag}]::text[]);`;
 return item.sql.slice(0,scan.insertAfterBegin)+'\n'+guard+'\n'+item.sql.slice(scan.insertAfterBegin,scan.insertBeforeCommit)+receipt+'\n'+item.sql.slice(scan.insertBeforeCommit);
}
export function executePackage(transport,report=()=>{}){
 classifyPreflight(transport.json(preflightSql()));const item=loadMigration();
 try{transport.execute(atomicSql(item));}catch{
  let observed='unavailable';try{const r=transport.json(receiptSql(item));observed=r.count===1&&r.exact===true?'committed-exact':r.count===0?'not-recorded':'drift';}catch{}
  report(`STOP61 receipt=${observed}; no retry`);throw Error('Exact61 apply outcome requires review');
 }
 const r=transport.json(receiptSql(item));if(r.count!==1||r.exact!==true)throw Error('Exact61 receipt postcheck failed');
 transport.execute(readFileSync(new URL('../../tests/floorProduction/legacyStackIntegrity.readonly-postcheck.sql',import.meta.url),'utf8'));
 report(`COMMITTED_EXACT ${item.version} ${item.hash}`);report('STACK61_OBJECT_POSTCHECK_PASS');
}
