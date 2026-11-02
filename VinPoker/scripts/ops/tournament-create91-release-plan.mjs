import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {canonicalSqlText,scanMigrationSource} from './ops-1359-release-gate.mjs';
import {receiptSql} from './floor-37-47-protected-apply.mjs';

// SQL builder only: no CLI, credentials, dispatch or production execution.
export function loadMigration(){
 const version='20270128000091',name='tournament_create_with_levels_atomic_v1';
 const filename=`${version}_${name}.sql`,hash='116a88485f116956602f9b7362bf39bb45efefe6aceaba5b7dbda03e59e56a15';
 const sql=canonicalSqlText(readFileSync(new URL(`../../supabase/migrations/${filename}`,import.meta.url),'utf8'));
 if(createHash('sha256').update(sql).digest('hex')!==hash||scanMigrationSource(sql).mode!=='outer-transaction')throw Error('Exact create91 SQL drift');
 return {version,name,filename,hash,sql};
}
const dependencies=[
 ['floor_private.floor_table_v3_existing_receipt(uuid,text,uuid)','b36883a4b7e4249af756400c2849cffc'],
 ['floor_private.floor_table_v3_lock_receipt(uuid,text,uuid)','1eb5c322975f7c8b1ab836c4e0a6b579'],
 ['floor_private.floor_table_v3_save_receipt(uuid,text,uuid,text,jsonb)','908e103b6531f09540f4edb5d09e35ee'],
 ['public.has_role(uuid,public.app_role)','187a79a40c4f51499677e49b6aa4e456'],
 ['public.is_club_dealer_control(uuid,uuid)','3186459824aedc075cda311b80bf97ad'],
];
function dependencyCheck(){return `DO $create91_dependencies$ BEGIN
 ${dependencies.map(([signature,hash])=>`IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('${signature}') AND md5(replace(replace(pg_get_functiondef(p.oid),chr(13)||chr(10),chr(10)),chr(13),chr(10)))='${hash}' AND pg_get_userbyid(p.proowner)='postgres') THEN RAISE EXCEPTION 'create91_dependency_drift'; END IF;`).join('\n')}
 END $create91_dependencies$;`;}
const newFunctions=[['create_tournament_with_levels_v1','b87bf65fa05663247953968dfba2e4c7'],['get_tournament_create_receipt_v1','370fc474f4095ebf6074bc9400b3cfb2']];
function absent(){const item=loadMigration();return `DO $create91_absent$ BEGIN
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${item.version}' OR name='${item.name}')
 ${newFunctions.map(([name])=>`OR to_regprocedure('public.${name}(uuid,jsonb,jsonb,uuid,uuid)') IS NOT NULL`).join('\n')}
 THEN RAISE EXCEPTION 'create91_catalog_collision'; END IF; END $create91_absent$;`;}
function objectCheck(){return `DO $create91_objects$ BEGIN
 ${newFunctions.map(([name,hash])=>`IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.${name}(uuid,jsonb,jsonb,uuid,uuid)') AND md5(pg_get_functiondef(p.oid))='${hash}' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef AND p.proconfig=ARRAY['search_path=""']::text[] AND p.proacl::text='{postgres=X/postgres,authenticated=X/postgres}') THEN RAISE EXCEPTION 'create91_object_or_acl_drift'; END IF;`).join('\n')}
 END $create91_objects$;`;}
export function preflightSql(){return `BEGIN READ ONLY;SET LOCAL statement_timeout='10s';${absent()}${dependencyCheck()}
 SELECT json_build_object('database',current_database(),'actor',current_user,'existing',0)::text;COMMIT;`;}
export function atomicSql(){const item=loadMigration(),scan=scanMigrationSource(item.sql),tag='$create91_source$';
 if(item.sql.includes(tag))throw Error('Create91 receipt delimiter collision');
 return `BEGIN;SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='60s';SELECT pg_advisory_xact_lock(280000,3747);
 ${absent()}${dependencyCheck()}
 ${item.sql.slice(scan.insertAfterBegin,scan.insertBeforeCommit)}
 ${objectCheck()}
 INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
 VALUES('${item.version}','${item.name}',ARRAY[${tag}${item.sql}${tag}]::text[]);COMMIT;`;}
export function postcheckSql(){const item=loadMigration();return `BEGIN READ ONLY;SET LOCAL statement_timeout='10s';${dependencyCheck()}${objectCheck()}
 DO $create91_receipt$ BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='${item.version}' OR name='${item.name}')<>1
 OR NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${item.version}' AND name='${item.name}' AND cardinality(statements)=1 AND encode(extensions.digest(convert_to(replace(replace(statements[1],E'\\r\\n',E'\\n'),E'\\r',E'\\n'),'UTF8'),'sha256'),'hex')='${item.hash}')
 THEN RAISE EXCEPTION 'create91_receipt_drift'; END IF; END $create91_receipt$;COMMIT;`;}
export function classifyPreflight(row){if(row?.database!=='postgres'||row.actor!=='postgres'||row.existing!==0)throw Error('Exact create91 baseline required');}
export function executePackage(transport,report=()=>{}){
 classifyPreflight(transport.json(preflightSql()));const item=loadMigration();
 try{transport.execute(atomicSql());}catch{
  let status='unavailable';try{const r=transport.json(receiptSql(item));status=r.count===1&&r.exact===true?'committed-exact':r.count===0?'not-recorded':'drift';}catch{}
  report(`STOP ${item.version} ${status}; no retry or downstream deploy`);throw Error('Create91 apply outcome requires review');
 }
 try{const r=transport.json(receiptSql(item));if(r.count!==1||r.exact!==true)throw Error('Receipt drift');transport.execute(postcheckSql());}
 catch{report(`STOP ${item.version} commit-acknowledged/postcheck-unverified; no retry or downstream deploy`);throw Error('Create91 acknowledged commit requires postcheck review');}
 report('CREATE91_COMMITTED_EXACT_OBJECT_POSTCHECK_PASS');
}
