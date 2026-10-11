import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {canonicalSqlText,scanMigrationSource} from './ops-1359-release-gate.mjs';
import {receiptSql} from './floor-37-47-protected-apply.mjs';

// Exact read-only roster package. No credentials or autonomous transport.
export function loadMigration(){
 const version='20270128000062',name='floor_roster_participation_integrity_v6';
 const filename=`${version}_${name}.sql`,hash='45fd420f2f0f1120c085843bd2503e92dddf5b764b1076ea3d7d1c00b5ad8e31';
 const sql=canonicalSqlText(readFileSync(new URL(`../../supabase/migrations/${filename}`,import.meta.url),'utf8'));
 if(createHash('sha256').update(sql).digest('hex')!==hash||scanMigrationSource(sql).mode!=='outer-transaction')throw Error('Exact62 SQL drift');
 return {version,name,filename,hash,sql};
}
export function dependencyPredicate(){return [
 ['public.get_floor_tournament_table_roster_v5(uuid)','4849ae19f6f74aadbde26ba4e86c2e8b'],
 ['floor_private.tournament_participation_v1(uuid)','3ec6dd6e4db2e8f75602d2c62a925910'],
 ['public.get_tournament_participation_v1(uuid)','1ccc9737417501817c4298cec9a69306'],
 ].map(([signature,digest])=>`(SELECT count(*)=1 AND bool_and(COALESCE(
 md5(replace(pg_get_functiondef(p.oid),chr(13),''))='${digest}'
 AND p.proowner='postgres'::regrole AND p.prosecdef
 AND p.proconfig=ARRAY['search_path=""']::text[],false))
 FROM pg_proc p WHERE p.oid=to_regprocedure('${signature}'))`).join(' AND ');}
export function preflightSql(){const i=loadMigration();return `BEGIN READ ONLY;SET LOCAL statement_timeout='10s';SELECT json_build_object(
 'database',current_database(),'actor',current_user,'existing',(SELECT count(*) FROM supabase_migrations.schema_migrations
 WHERE version='${i.version}' OR name='${i.name}'),'baseline',(${dependencyPredicate()}),
 'new_rpc_absent',to_regprocedure('public.get_floor_tournament_table_roster_v6(uuid)') IS NULL)::text;COMMIT;`;}
export function classifyPreflight(r){if(r?.database!=='postgres'||r.actor!=='postgres'||r.existing!==0||r.baseline!==true||r.new_rpc_absent!==true)throw Error('Exact62 precondition drift');}
export function postcheckSql(){return `DO $roster62_postcheck$ BEGIN
 IF NOT COALESCE((${dependencyPredicate()}),false) OR NOT EXISTS(
 SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.get_floor_tournament_table_roster_v6(uuid)')
 AND md5(replace(pg_get_functiondef(p.oid),chr(13),''))='e5425dc9b81a09d48206b3d270323069'
 AND p.proowner='postgres'::regrole AND p.prosecdef AND p.provolatile='s'
 AND p.proconfig=ARRAY['search_path=""']::text[]
 AND p.proacl::text='{postgres=X/postgres,authenticated=X/postgres}'
 AND has_function_privilege('authenticated',p.oid,'EXECUTE')
 AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
 AND NOT has_function_privilege('service_role',p.oid,'EXECUTE')) THEN
 RAISE EXCEPTION 'roster62_object_postcheck_failed'; END IF; END $roster62_postcheck$;`;}
export function atomicSql(item=loadMigration()){
 const pinned=loadMigration();if(['version','name','filename','hash','sql'].some(k=>item[k]!==pinned[k]))throw Error('Exact62 allowlist mismatch');
 const scan=scanMigrationSource(item.sql),tag='$roster62_receipt$';if(item.sql.includes(tag))throw Error('Delimiter collision');
 const guard=`SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='120s';SELECT pg_advisory_xact_lock(280000,3747);
 DO $roster62_guard$ BEGIN IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${item.version}' OR name='${item.name}')
 OR NOT COALESCE((${dependencyPredicate()}),false) THEN RAISE EXCEPTION 'roster62_precondition_drift';END IF;END $roster62_guard$;`;
 const receipt=`INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${item.version}','${item.name}',ARRAY[${tag}${item.sql}${tag}]::text[]);`;
 return item.sql.slice(0,scan.insertAfterBegin)+'\n'+guard+'\n'+item.sql.slice(scan.insertAfterBegin,scan.insertBeforeCommit)+receipt+'\n'+item.sql.slice(scan.insertBeforeCommit);
}
export function executePackage(transport,report=()=>{}){
 classifyPreflight(transport.json(preflightSql()));const item=loadMigration();
 try{transport.execute(atomicSql(item));}catch{
  let observed='unavailable';try{const r=transport.json(receiptSql(item));observed=r.count===1&&r.exact===true?'committed-exact':r.count===0?'not-recorded':'drift';}catch{}
  report(`STOP62 receipt=${observed}; no retry`);throw Error('Exact62 apply outcome requires review');
 }
 const r=transport.json(receiptSql(item));if(r.count!==1||r.exact!==true)throw Error('Exact62 receipt postcheck failed');
 transport.execute(postcheckSql());
 report(`COMMITTED_EXACT ${item.version} ${item.hash}`);
 report('ROSTER62_OBJECT_POSTCHECK_PASS');
}
