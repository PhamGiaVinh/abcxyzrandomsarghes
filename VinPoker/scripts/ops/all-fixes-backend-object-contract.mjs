import {createHash} from 'node:crypto';
import {deriveObjectScope,catalogSnapshotSql} from './protected-nine-object-contract.mjs';
export function backendObjectScope(sql){
 const scope=deriveObjectScope([{sql}]);
 const names=[...sql.matchAll(/\b((?:public|private|floor_private|storage)\.[a-z_][a-z_0-9]*)\s*\(/gi)].map(x=>x[1].toLowerCase());
 scope.functionNames=[...new Set([...scope.functionNames,...names])].sort();
 const tables=[...sql.matchAll(/\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-z_][a-z_0-9]*\.[a-z_][a-z_0-9]*)/gi)].map(x=>x[1].toLowerCase());
 scope.tableNames=[...new Set([...scope.tableNames,...tables])].sort();return scope;
}
export function backendSnapshotSql(scope){
 const base=catalogSnapshotSql(scope).trim().replace(/;$/,'');
 const names=scope.tableNames.map(x=>"'"+x.replaceAll("'","''")+"'").join(',')||'NULL';
 const list=values=>values.map(x=>"'"+x.replaceAll("'","''")+"'").join(',')||'NULL';
 return `WITH core AS (${base}), cols AS (
 SELECT n.nspname||'.'||c.relname AS relation,a.attname AS name,a.attnum AS position,
 format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS not_null,
 a.attidentity::text AS identity,a.attgenerated::text AS generated,
 coalesce(pg_get_expr(d.adbin,d.adrelid),'') AS default_expression
 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE a.attnum>0 AND NOT a.attisdropped AND n.nspname||'.'||c.relname IN (${names})
 ), trigger_states AS (
 SELECT n.nspname||'.'||c.relname AS relation,t.tgname AS name,t.tgenabled::text AS enabled
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE NOT t.tgisinternal AND t.tgname IN (${list(scope.triggerNames)})
 ), index_states AS (
 SELECT n.nspname||'.'||c.relname AS name,i.indisvalid AS valid,i.indisready AS ready,i.indislive AS live
 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relname IN (${list(scope.indexNames)})
 ), table_properties AS (
 SELECT n.nspname||'.'||c.relname AS name,pg_get_userbyid(c.relowner) AS owner,c.relkind::text AS kind
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname||'.'||c.relname IN (${names})
 ), function_properties AS (
 SELECT n.nspname||'.'||p.proname AS name,pg_get_function_identity_arguments(p.oid) AS args,
 l.lanname AS language,p.prokind::text AS kind,p.proisstrict AS strict,p.proparallel::text AS parallel,
 p.proleakproof AS leakproof,p.proretset AS returns_set,pg_get_function_result(p.oid) AS result,
 p.procost AS cost,p.prorows AS rows,coalesce(pg_get_expr(p.proargdefaults,0),'') AS defaults
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
 WHERE n.nspname||'.'||p.proname IN (${list(scope.functionNames)})
 ) SELECT (core.contract::jsonb||jsonb_build_object(
 'columns',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY relation,position) FROM cols x),'[]'::jsonb),
 'trigger_states',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY relation,name) FROM trigger_states x),'[]'::jsonb),
 'index_states',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY name) FROM index_states x),'[]'::jsonb),
 'table_properties',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY name) FROM table_properties x),'[]'::jsonb),
 'function_properties',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY name,args) FROM function_properties x),'[]'::jsonb)
 ))::text AS contract FROM core;`;
}
export const backendLedgerSnapshotSql=`WITH ledger AS (
 SELECT version,name,encode(extensions.digest(replace(array_to_string(statements,E'\\n'),E'\\r\\n',E'\\n'),'sha256'),'hex') AS normalized_sql_sha256
 FROM supabase_migrations.schema_migrations
 ) SELECT jsonb_agg(to_jsonb(ledger) ORDER BY version)::text AS contract FROM ledger;`;
export function backendLedgerGuard(expected,label){
 if(!/^[a-f0-9]{64}$/.test(expected)||!['pre','post'].includes(label))throw Error('Invalid ledger contract identity');
 const query=backendLedgerSnapshotSql.trim().replace(/;$/,'');
 return `DO $backend_ledger$ DECLARE actual text; BEGIN SELECT contract INTO STRICT actual FROM (${query}) q;
 IF encode(extensions.digest(convert_to(actual,'UTF8'),'sha256'),'hex')<>'${expected}' THEN RAISE EXCEPTION 'backend_${label}_ledger_contract_drift'; END IF; END $backend_ledger$;`;
}
export const backendContractHash=text=>createHash('sha256').update(text.trim(),'utf8').digest('hex');
export function backendContractGuard(scope,expected,label){
 if(!/^[a-f0-9]{64}$/.test(expected)||!['pre','post'].includes(label))throw Error('Invalid contract guard identity');
 const query=backendSnapshotSql(scope).trim().replace(/;$/,'');
 return `DO $backend_contract$ DECLARE actual text; BEGIN SELECT contract INTO STRICT actual FROM (${query}) q;
 IF encode(extensions.digest(convert_to(actual,'UTF8'),'sha256'),'hex')<>'${expected}' THEN RAISE EXCEPTION 'backend_${label}_catalog_contract_drift'; END IF; END $backend_contract$;`;
}
