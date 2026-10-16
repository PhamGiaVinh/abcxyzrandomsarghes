import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const database='vinpoker_ops_cash115_qualified_c';
assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGPORT,'55441');assert.equal(process.env.PGUSER,'postgres');assert.equal(process.env.PGDATABASE,database);
for(const k of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[k]);
const prefix=process.platform==='win32'?['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${database}`,'psql']:[];
const binary=prefix.length?'wsl':'psql',flags=['-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=input=>execFileSync(binary,[...prefix,...flags],{input,encoding:'utf8',timeout:30000,stdio:['pipe','pipe','pipe']}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('server_version_num')::int/10000;"),database+'|127.0.0.1|55441|17');
const dir=sql('SHOW data_directory');assert.ok(dir==='/tmp/vinpoker-sol-local-20261016-0e79a729/data'||process.env.GITHUB_ACTIONS==='true'&&dir==='/var/lib/postgresql/data');
assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');"),'f');
if(process.argv.includes('--scope120')){
 const raw=readFileSync(new URL('../../supabase/migrations/20270128000120_tracker_hand_scope_revision_v1.sql',import.meta.url),'utf8').replaceAll('\r','');
 const old=raw.match(/old_trigger text:=\$old\$([\s\S]*?)\$old\$/)[1];
 const replacement=old.replace('UPDATE OF tournament_id, hand_number,','UPDATE OF tournament_id, table_id, tournament_table_id, table_session_id, hand_number,');
 const trigger=`SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid='public.tournament_hands'::regclass AND tgname='trg_tracker_hand_source_revision';`;
 assert.equal(sql(trigger),replacement);
 const fingerprint=`SELECT md5(jsonb_build_object('functions',(SELECT jsonb_agg(to_jsonb(p)||jsonb_build_object('definition',pg_get_functiondef(p.oid)) ORDER BY p.oid) FROM pg_proc p WHERE p.prokind='f' AND p.pronamespace IN ('public'::regnamespace,'floor_private'::regnamespace)),
 'triggers',(SELECT jsonb_agg(CASE WHEN t.tgrelid='public.tournament_hands'::regclass AND t.tgname='trg_tracker_hand_source_revision' THEN to_jsonb(t)-'oid' ELSE to_jsonb(t) END ORDER BY t.tgrelid,t.tgname) FROM pg_trigger t WHERE NOT t.tgisinternal))::text);`;
 const before=sql(fingerprint),body=raw.replace(/^BEGIN;$/m,'').replace(/COMMIT;\s*$/,'ROLLBACK;');
 const restore=`DROP TRIGGER trg_tracker_hand_source_revision ON public.tournament_hands;${old};\n`;
 const helper=sql("SELECT pg_get_functiondef('floor_private.bump_hand_identity_revision_v1()'::regprocedure);");
 const changed=helper.replace('BEGIN','BEGIN\n -- scope120 intentional drift');assert.notEqual(changed,helper);
 for(const [setup,code] of [[restore+changed+';\n','hand_scope120_dependency_drift'],
  [restore.replace(old,()=>old.replace('hand_number, ','')),'hand_scope120_trigger_drift']]){
  let failure='';try{sql(`BEGIN;${setup}${body}`);}catch(error){failure=String(error.stderr??error);}
  assert.ok(failure.includes(code),failure);assert.equal(sql(fingerprint),before);
 }
 const check=`DO $check$ BEGIN IF (${fingerprint.replace(/;$/,'')}) IS DISTINCT FROM '${before}' THEN RAISE EXCEPTION 'scope120_unexpected_catalog_delta';END IF;END;$check$;`;
 sql(`BEGIN;${restore}${body.replace(/ROLLBACK;\s*$/,()=>check+'ROLLBACK;')}`);assert.equal(sql(fingerprint),before);assert.equal(sql(trigger),replacement);
 console.log('SCOPE120_FUNCTION_TRIGGER_DRIFT_GUARDS_METADATA_ROLLBACK_PASS');process.exit(0);
}
if(process.argv.includes('--history119')){
 const worker='public.commit_tracker_historical_display_outcome_v2(uuid,uuid,text,bigint,text,text,text,text,jsonb,uuid)';
 const resolver='public.resolve_tracker_historical_display_intent_v1(uuid,uuid,uuid,text,bigint,text,text)';
 const raw=readFileSync(new URL('../../supabase/migrations/20270128000119_tracker_history_commit_lock_order_v1.sql',import.meta.url),'utf8').replaceAll('\r','');
 const old=raw.match(/old_block text:=\$old\$([\s\S]*?)\$old\$/)[1],next=raw.match(/new_block text:=\$new\$([\s\S]*?)\$new\$/)[1];
 const currentWorker=sql(`SELECT pg_get_functiondef('${worker}'::regprocedure);`).replaceAll('\r','');
 const currentResolver=sql(`SELECT pg_get_functiondef('${resolver}'::regprocedure);`).replaceAll('\r','');
 const oldWorker=currentWorker.replace(next,old),oldResolver=currentResolver.replace('SELECT t.club_id INTO club FROM public.tournaments t WHERE t.id=p_tournament_id; -- history119 plain authorization read','SELECT t.club_id INTO club FROM public.tournaments t WHERE t.id=p_tournament_id FOR SHARE;');
 const md5=v=>createHash('md5').update(v+'\n').digest('hex');
 // pg_get_functiondef carries a trailing newline that sql().trim() removes.
 assert.equal(md5(oldWorker),'fcf8dac1239f25742e1c9566d523aa25');assert.equal(md5(oldResolver),'6195d2299ba44449e13179f0e0874415');
 const fingerprint=`SELECT md5(coalesce(string_agg(to_jsonb(p)::text||pg_get_functiondef(p.oid),'' ORDER BY p.oid),'')) FROM pg_proc p WHERE p.prokind='f' AND p.pronamespace IN ('public'::regnamespace,'floor_private'::regnamespace);`;
 const before=sql(fingerprint),body=raw.replace(/^BEGIN;$/m,'').replace(/COMMIT;\s*$/,'ROLLBACK;');
 const setup=`${oldWorker};\n${oldResolver};\n`;
 for(const [source,code] of [[oldWorker,'history119_dependency_drift'],[oldResolver,'history119_resolver_dependency_drift']]){
  const changed=source.replace('BEGIN','BEGIN\n -- history119 intentional qualifier drift');assert.notEqual(source,changed);
  let failure='';try{sql(`BEGIN;${setup}${changed};\n${body}`);}catch(error){failure=String(error.stderr??error);}
  assert.ok(failure.includes(code),failure);assert.equal(sql(fingerprint),before);
 }
 // Recreate both reviewed old bodies and apply the candidate in one rollback-only
 // transaction. Compare ALL function metadata/ACL/settings/definitions afterward.
 const check=`DO $check$ BEGIN IF (${fingerprint.replace(/;$/,'')}) IS DISTINCT FROM '${before}' THEN RAISE EXCEPTION 'history119_metadata_or_unrelated_delta';END IF;END;$check$;`;
 sql(`BEGIN;${setup}${body.replace(/ROLLBACK;\s*$/,()=>check+'ROLLBACK;')}`);assert.equal(sql(fingerprint),before);
 console.log('HISTORY119_BOTH_DEPENDENCY_DRIFT_GUARDS_FULL_METADATA_ROLLBACK_PASS');
 process.exit(0);
}
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
