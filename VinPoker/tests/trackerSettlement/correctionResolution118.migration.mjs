import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const database='vinpoker_ops_cash115_qualified_c';
assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGPORT,'55441');assert.equal(process.env.PGUSER,'postgres');assert.equal(process.env.PGDATABASE,database);
for(const k of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[k]);
const prefix=process.platform==='win32'?['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${database}`,'psql']:[];
const binary=prefix.length?'wsl':'psql',flags=['-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=input=>execFileSync(binary,[...prefix,...flags],{input,encoding:'utf8',timeout:30000,stdio:['pipe','pipe','pipe']}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('server_version_num')::int/10000;"),database+'|127.0.0.1|55441|17');
const dir=sql('SHOW data_directory');assert.ok(dir==='/tmp/vinpoker-sol-local-20261016-0e79a729/data'||process.env.GITHUB_ACTIONS==='true'&&dir==='/var/lib/postgresql/data');
assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');"),'f');
const resolver='public.resolve_tracker_correction_intent_v1(uuid,uuid,uuid,text,bigint,text,text,text)';
const commit='public.commit_tracker_hand_correction_outcome(uuid,uuid,bigint,text,bigint,text,text,text,jsonb,jsonb,jsonb,jsonb,text)';
assert.equal(sql(`SELECT to_regprocedure('${resolver}') IS NOT NULL;`),'t','run only after local candidate118 install');
const quote=v=>`'${v.replaceAll("'","''")}'`;
const fingerprint=`SELECT md5(coalesce(string_agg(to_jsonb(p)::text||pg_get_functiondef(p.oid),'' ORDER BY p.oid),''))
 FROM pg_proc p WHERE p.prokind='f' AND p.pronamespace IN ('public'::regnamespace,'floor_private'::regnamespace);`;
const before=sql(fingerprint),original=sql(`SELECT pg_get_functiondef('${commit}'::regprocedure);`);
const changed=original.replace('BEGIN','BEGIN\n -- candidate118 intentional qualification drift');assert.notEqual(changed,original);
const migration=readFileSync(new URL('../../supabase/migrations/20270128000118_tracker_correction_intent_resolution_v1.sql',import.meta.url),'utf8');
assert.equal((migration.match(/^BEGIN;$/gm)||[]).length,1);
const body=migration.replace(/^BEGIN;$/m,'').replace(/COMMIT;\s*$/,'ROLLBACK;');
// A failed ON_ERROR_STOP session rolls back the entire explicit transaction;
// no restoration by replacing source functions after the fact.
for(const [setup,code] of [
 [`DROP FUNCTION ${resolver};${changed};\n`,'correction_intent118_dependency_drift'],
 ['', 'correction_intent118_already_exists'],
]){
 let failure='';try{sql(`BEGIN;${setup}${body}`);}catch(error){failure=String(error.stderr??error);}
 assert.ok(failure.includes(code),code+' must fail before catalog mutation: '+failure);assert.equal(sql(fingerprint),before);
}
const check=`DO $$ BEGIN
 IF NOT has_function_privilege('service_role','${resolver}','EXECUTE')
 OR has_function_privilege('authenticated','${resolver}','EXECUTE') OR has_function_privilege('anon','${resolver}','EXECUTE') THEN RAISE EXCEPTION 'resolver118_bad_acl';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='${resolver}'::regprocedure AND prosecdef AND proconfig @> ARRAY['search_path=""','lock_timeout=3s']) THEN RAISE EXCEPTION 'resolver118_bad_config';END IF;
END $$;`;
sql(`BEGIN;DROP FUNCTION ${resolver};${body.replace(/ROLLBACK;\s*$/,()=>check+'ROLLBACK;')}`);assert.equal(sql(fingerprint),before);
assert.equal(sql(`SELECT pg_get_functiondef('${commit}'::regprocedure);`),original);
console.log('CORRECTION118_DRIFT_COLLISION_POSITIVE_ACL_FULL_CATALOG_ROLLBACK_PASS');
