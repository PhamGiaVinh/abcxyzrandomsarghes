import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {spawnSync} from 'node:child_process';
assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGPORT,'55441');assert.equal(process.env.PGUSER,'postgres');
assert.ok(['vinpoker_ops_history99_rollback','vinpoker_ops_history99_qualified'].includes(process.env.PGDATABASE));
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
function run(input){return spawnSync('psql',['-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8'});}
function sql(input){const result=run(input);assert.equal(result.status,0,result.stderr);return result.stdout.trim();}
assert.equal(sql("SELECT current_setting('server_version_num')::int BETWEEN 170000 AND 179999 AND inet_server_addr()='127.0.0.1'::inet;"),'t');
const signature='public.resolve_tracker_historical_display_intent_v1(uuid,uuid,uuid,text,bigint,text,text)';
const snapshot=()=>sql("SELECT jsonb_agg(jsonb_build_object('oid',oid,'def',pg_get_functiondef(oid),'acl',proacl,'config',proconfig,'owner',proowner) ORDER BY oid) FROM pg_proc WHERE oid IN ('public.get_tracker_historical_display_commit_receipt(uuid,uuid,uuid,text,bigint,text,text)'::regprocedure,'public.commit_tracker_historical_display_outcome_v2(uuid,uuid,text,bigint,text,text,text,text,jsonb,uuid)'::regprocedure);");
const before=snapshot();assert.equal(sql(`SELECT to_regprocedure('${signature}') IS NULL;`),'t');
const source=readFileSync('supabase/migrations/20270128000099_tracker_historical_intent_resolution_v1.sql','utf8').replaceAll('\r\n','\n');
assert.equal((source.match(/^COMMIT;$/gm)??[]).length,1);
const fault=run(source.replace(/^COMMIT;$/m,()=>"DO $$ BEGIN RAISE EXCEPTION 'history99_precommit_fault'; END $$;\nCOMMIT;"));
assert.notEqual(fault.status,0);assert.match(fault.stderr,/history99_precommit_fault/);
assert.equal(sql(`SELECT to_regprocedure('${signature}') IS NULL;`),'t');assert.equal(snapshot(),before);
const applied=run(source);assert.equal(applied.status,0,applied.stderr);assert.equal(snapshot(),before);
assert.equal(sql(`SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=""','lock_timeout=3s'] FROM pg_proc p WHERE oid='${signature}'::regprocedure;`),'t');
console.log('HISTORY99_ADDITIVE_DDL_ROLLBACK_APPLY_PRESERVES_WRITER_READER_PASS');
