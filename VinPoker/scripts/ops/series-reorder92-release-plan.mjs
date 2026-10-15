import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {canonicalSqlText,scanMigrationSource} from './ops-1359-release-gate.mjs';
import {receiptSql} from './floor-37-47-protected-apply.mjs';
export function loadMigration(){
 const version='20270128000092',name='club_series_reorder_atomic_v1',hash='fdd9624de2d86252dff8472ba66a40fc55648f85cf297028633d0a3068100f54';
 const filename=`${version}_${name}.sql`,sql=canonicalSqlText(readFileSync(new URL(`../../supabase/migrations/${filename}`,import.meta.url),'utf8'));
 if(createHash('sha256').update(sql).digest('hex')!==hash||scanMigrationSource(sql).mode!=='outer-transaction')throw Error('Exact series92 SQL drift');
 return {version,name,filename,hash,sql};
}
const functions=[['reorder_club_series_images_v1','78b5386bb73998473023fe81ae5f1f6a'],['get_club_series_reorder_receipt_v1','6c947ab43f468f6bf02663b5907518c5']];
const normalizedDefinition="replace(replace(pg_get_functiondef(p.oid),chr(13)||chr(10),chr(10)),chr(13),chr(10))";
function dependencies(){return `DO $series92_dependencies$ BEGIN
 ${[
 ['floor_private.floor_table_v3_existing_receipt(uuid,text,uuid)','b36883a4b7e4249af756400c2849cffc'],
 ['floor_private.floor_table_v3_lock_receipt(uuid,text,uuid)','1eb5c322975f7c8b1ab836c4e0a6b579'],
 ['floor_private.floor_table_v3_save_receipt(uuid,text,uuid,text,jsonb)','908e103b6531f09540f4edb5d09e35ee'],
 ['public.has_role(uuid,public.app_role)','187a79a40c4f51499677e49b6aa4e456'],
 ].map(([signature,hash])=>`IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('${signature}') AND md5(${normalizedDefinition})='${hash}' AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text='${signature.startsWith('floor_private.')?'{postgres=X/postgres}':'{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres,anon=X/postgres}'}' AND p.proconfig=ARRAY['${signature.startsWith('floor_private.')?'search_path=""':'search_path=public'}']::text[]) THEN RAISE EXCEPTION 'series92_dependency_drift'; END IF;`).join('\n')}
 END $series92_dependencies$;`;}
function gallery(post=false){return `DO $series92_gallery$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.oid='public.club_series_images'::regclass AND c.relrowsecurity AND NOT c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
 AND c.relacl::text='{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=${post?'ardDxtm':'arwdDxtm'}/postgres,service_role=arwdDxtm/postgres}')
 OR (SELECT array_agg(attname::text||':'||format_type(atttypid,atttypmod) ORDER BY attnum) FROM pg_attribute WHERE attrelid='public.club_series_images'::regclass AND attnum>0 AND NOT attisdropped)
 IS DISTINCT FROM ARRAY['id:uuid','club_id:uuid','image_url:text','caption:text','position:integer','created_at:timestamp with time zone']::text[]
 OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.club_series_images'::regclass AND attnum>0 AND NOT attisdropped AND ${post?"CASE WHEN attname='position' THEN attacl IS NOT NULL ELSE attacl::text IS DISTINCT FROM '{authenticated=w/postgres}' END":"attacl IS NOT NULL"})
 OR (SELECT count(*) FROM pg_policy WHERE polrelid='public.club_series_images'::regclass)<>2
 OR NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.club_series_images'::regclass AND polname='club_series_images public read' AND polpermissive AND polcmd='r' AND polroles=ARRAY[0]::oid[])
 OR NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.club_series_images'::regclass AND polname='club_series_images manage' AND polpermissive AND polcmd='*' AND polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname='authenticated')])
 OR (SELECT md5(string_agg(pg_get_expr(polqual,polrelid)||coalesce(pg_get_expr(polwithcheck,polrelid),''),'|' ORDER BY polname)) FROM pg_policy WHERE polrelid='public.club_series_images'::regclass) IS DISTINCT FROM '80b1e335b44578158e60d5027f40ee9a'
 OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.club_series_images'::regclass AND NOT tgisinternal)
 ${post?"OR has_column_privilege('authenticated','public.club_series_images','position','UPDATE')":""}
 THEN RAISE EXCEPTION 'series92_gallery_or_privilege_drift'; END IF;
 END $series92_gallery$;`;}
function absent(){const item=loadMigration();return `DO $series92_absent$ BEGIN
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${item.version}' OR name='${item.name}')
 OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('reorder_club_series_images_v1','get_club_series_reorder_receipt_v1'))
 THEN RAISE EXCEPTION 'series92_catalog_collision'; END IF;END $series92_absent$;`;}
function objects(){return `DO $series92_objects$ BEGIN
 ${functions.map(([name,hash],i)=>`IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.${name}(uuid,jsonb,uuid[],uuid,uuid)') AND md5(${normalizedDefinition})='${hash}' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef AND p.proconfig=ARRAY['search_path=""'${i===0?",'lock_timeout=3s'":''}]::text[] AND p.proacl::text='{postgres=X/postgres,authenticated=X/postgres}') THEN RAISE EXCEPTION 'series92_object_or_acl_drift'; END IF;`).join('\n')}
 END $series92_objects$;`;}
export function preflightSql(){return `BEGIN READ ONLY;SET LOCAL statement_timeout='10s';${absent()}${dependencies()}${gallery()}SELECT json_build_object('database',current_database(),'actor',current_user,'existing',0)::text;COMMIT;`;}
export function atomicSql(){const item=loadMigration(),scan=scanMigrationSource(item.sql),tag='$series92_source$';if(item.sql.includes(tag))throw Error('Receipt delimiter collision');return `BEGIN;SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='60s';SELECT pg_advisory_xact_lock(280000,3747);${absent()}${dependencies()}${gallery()}
 ${item.sql.slice(scan.insertAfterBegin,scan.insertBeforeCommit)}${objects()}${gallery(true)}
 INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${item.version}','${item.name}',ARRAY[${tag}${item.sql}${tag}]::text[]);COMMIT;`;}
export function postcheckSql(){const item=loadMigration();return `BEGIN READ ONLY;SET LOCAL statement_timeout='10s';${dependencies()}${objects()}${gallery(true)}DO $series92_receipt$ BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='${item.version}' OR name='${item.name}')<>1 OR NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${item.version}' AND name='${item.name}' AND cardinality(statements)=1 AND encode(extensions.digest(convert_to(replace(replace(statements[1],E'\\r\\n',E'\\n'),E'\\r',E'\\n'),'UTF8'),'sha256'),'hex')='${item.hash}') THEN RAISE EXCEPTION 'series92_receipt_drift'; END IF;END $series92_receipt$;COMMIT;`;}
export function classifyPreflight(row){if(row?.database!=='postgres'||row.actor!=='postgres'||row.existing!==0)throw Error('Exact series92 baseline required');}
export function executePackage(transport,report=()=>{}){
 classifyPreflight(transport.json(preflightSql()));const item=loadMigration();
 try{transport.execute(atomicSql());}catch{
  let status='unavailable';try{const r=transport.json(receiptSql(item));status=r.count===1&&r.exact===true?'committed-exact':r.count===0?'not-recorded':'drift';}catch{}
  report(`STOP ${item.version} ${status}; no retry or downstream deploy`);throw Error('Series92 apply outcome requires review');
 }
 try{const r=transport.json(receiptSql(item));if(r.count!==1||r.exact!==true)throw Error('Receipt drift');transport.execute(postcheckSql());}
 catch{report(`STOP ${item.version} commit-acknowledged/postcheck-unverified; no retry or downstream deploy`);throw Error('Series92 acknowledged commit requires postcheck review');}
 report('SERIES92_COMMITTED_EXACT_OBJECT_POSTCHECK_PASS');
}
