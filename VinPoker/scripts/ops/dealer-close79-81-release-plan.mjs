import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {loadMigration,atomicSql as atomic79,preflightSql as preflight79} from './dealer-close79-release-plan.mjs';
import {canonicalSqlText,scanMigrationSource} from './ops-1359-release-gate.mjs';
export function loadPackage(){
 const first=loadMigration(),version='20270128000081',name='dealer_close_forecast_slots_v1';
 const sql=canonicalSqlText(readFileSync(new URL(`../../supabase/migrations/${version}_${name}.sql`,import.meta.url),'utf8'));
 const hash='accba5a8dd0873dd4de5d3c24d42abfbb6e3c519991f76ce02bcb3a7c5c70ff8';
 if(createHash('sha256').update(sql).digest('hex')!==hash||scanMigrationSource(sql).mode!=='outer-transaction')throw Error('Exact81 SQL drift');
 return [first,{version,name,hash,sql}];
}
function absent81(){return `DO $absent81$ BEGIN IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations
 WHERE version='20270128000081' OR name='dealer_close_forecast_slots_v1') THEN RAISE EXCEPTION 'close81_ledger_collision'; END IF;END $absent81$;`;}
function finalObject(){return `DO $final7981$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_proc p
 WHERE p.oid='public.operator_close_club_table_v2(uuid,bigint,uuid)'::regprocedure
 AND md5(pg_get_functiondef(p.oid))='cda0bd0e9eb9ee15fe3cdf5c36fcc238'
 AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef AND p.proconfig=ARRAY['search_path=""']::text[]
 AND p.proacl::text='{postgres=X/postgres,authenticated=X/postgres}') THEN RAISE EXCEPTION 'close7981_final_object_drift';END IF;END $final7981$;`;}
export function preflightSql(){return preflight79().replace(/COMMIT;\s*$/,`${absent81()}COMMIT;`);}
export function atomicSql(){const [,last]=loadPackage(),scan=scanMigrationSource(last.sql),tag='$source81$';
 if(last.sql.includes(tag))throw Error('81 receipt delimiter collision');
 const sql=atomic79();if(!/COMMIT;\s*$/.test(sql))throw Error('79 transaction boundary drift');
 // Both original-source receipts and final object commit together. No window
 // exposes79 without its forecast repair; any81 error rolls79 and receipt back.
 return sql.replace(/COMMIT;\s*$/,`${absent81()}${last.sql.slice(scan.insertAfterBegin,scan.insertBeforeCommit)}${finalObject()}
 INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
 VALUES('${last.version}','${last.name}',ARRAY[${tag}${last.sql}${tag}]::text[]);COMMIT;`);
}
export function receiptSql(){const items=loadPackage();const matches=items.map(m=>`EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations
 WHERE version='${m.version}' AND name='${m.name}' AND cardinality(statements)=1
 AND encode(extensions.digest(convert_to(replace(replace(statements[1],E'\\r\\n',E'\\n'),E'\\r',E'\\n'),'UTF8'),'sha256'),'hex')='${m.hash}')`);
 return `SELECT json_build_object('count',(SELECT count(*) FROM supabase_migrations.schema_migrations
 WHERE version IN ('20270128000079','20270128000081') OR name IN ('dealer_close_next_reservation_v1','dealer_close_forecast_slots_v1')),
 'exact',${matches.join(' AND ')})::text;`;}
export function postcheckSql(){return `BEGIN READ ONLY;${finalObject()}
 DO $receipts7981$ DECLARE proof json;BEGIN SELECT (${receiptSql().replace(/^SELECT /,'').replace(/;$/,'')}) INTO proof;
 IF (proof->>'count')::int<>2 OR (proof->>'exact')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'close7981_receipt_drift';END IF;END $receipts7981$;COMMIT;`;}
