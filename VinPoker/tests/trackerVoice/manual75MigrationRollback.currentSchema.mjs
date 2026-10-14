import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

assert.equal(process.env.PGHOST,'127.0.0.1');
assert.equal(process.env.PGPORT,'55464');
assert.equal(process.env.PGUSER,'postgres');
const database=process.argv.includes('--inactive-contract')?'vinpoker_manual_card75_inactive_20261014':process.argv.includes('--payload-contract')?'vinpoker_manual_card75_payload_20261014':'vinpoker_manual_card75_rollback_20261014';
assert.equal(process.env.PGDATABASE,database);
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS']) assert.ok(!process.env[key]);
assert.equal(process.platform,'win32','owned Windows/WSL rollback harness only');
assert.match(process.env.VINPOKER_TEST_WSL_DISTRO??'',/^[A-Za-z0-9_.-]+$/u);
const args=['-d',process.env.VINPOKER_TEST_WSL_DISTRO,'--','psql','-X','-w','-t','-A','-v','ON_ERROR_STOP=1',
 '-h',process.env.PGHOST,'-p',process.env.PGPORT,'-U',process.env.PGUSER,'-d',process.env.PGDATABASE];
const run=sql=>spawnSync('wsl',args,{input:sql.replaceAll('\r\n','\n'),encoding:'utf8'});
const guard=`DO $$ BEGIN
 IF current_database()<>'${database}' OR current_user<>'postgres'
 OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR inet_server_port()<>55464
 OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
 OR EXISTS(SELECT 1 FROM public.clubs) THEN RAISE EXCEPTION 'owned_manual75_rollback_clone_required'; END IF;
END $$;`;
const snapshot=`${guard}
SELECT json_build_object('functions',(
 SELECT md5(coalesce(string_agg(p.oid::regprocedure::text||pg_get_functiondef(p.oid)
  ||coalesce(p.proacl::text,'')||coalesce(p.proconfig::text,'')||p.proowner::text,'' ORDER BY p.oid),''))
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('public','floor_private') AND p.prokind='f'),
 'table',to_regclass('floor_private.tracker_manual_card_receipts_v1'),
 'writer',to_regprocedure('public.show_tracker_manual_cards_v1(uuid,uuid,bigint,bigint,text,jsonb)'),
 'reader',to_regprocedure('public.get_tracker_manual_card_receipt_v1(text,jsonb)'),
 'legacy_reader',to_regprocedure('public.get_tracker_manual_card_receipt_v1(text)'))::text;`;
function capture(){const r=run(snapshot);assert.equal(r.status,0,r.stderr);const line=r.stdout.split('\n').find(l=>l.startsWith('{'));assert.ok(line,r.stdout);return JSON.parse(line);}
const before=capture();
assert.equal(before.table,null);assert.equal(before.writer,null);assert.equal(before.reader,null);
assert.equal(before.legacy_reader,null);
const sql=readFileSync('supabase/migrations/20270128000075_tracker_manual_cards_receipts_v1.sql','utf8').replaceAll('\r\n','\n');
assert.equal((sql.match(/^COMMIT;$/gm)??[]).length,1);
assert.match(sql,/\nCOMMIT;\s*$/u);
const fault=sql.replace(/\nCOMMIT;\s*$/u,'\nSELECT 1/0 AS manual75_injected_commit_fault;\nCOMMIT;\n');
const failed=run(guard+'\n'+fault);
assert.notEqual(failed.status,0,'injected migration unexpectedly committed');
assert.match(failed.stderr,/division by zero/u);
assert.match(failed.stdout,/CREATE FUNCTION/u,'failure must occur after actual DDL');
assert.deepEqual(capture(),before,'failed transaction left function/ACL/catalog drift');
console.log('MANUAL75_FULL_MIGRATION_PRECOMMIT_ROLLBACK_PASS');
if(process.argv.includes('--apply-after-rollback')){
 const applied=run(guard+'\n'+sql);
 assert.equal(applied.status,0,applied.stderr);
 const after=capture();
 assert.equal(after.table,'floor_private.tracker_manual_card_receipts_v1');
 assert.equal(after.writer,'show_tracker_manual_cards_v1(uuid,uuid,bigint,bigint,text,jsonb)');
 assert.equal(after.reader,'get_tracker_manual_card_receipt_v1(text,jsonb)');
 assert.equal(after.legacy_reader,null);
 assert.notEqual(after.functions,before.functions);
 console.log('MANUAL75_FULL_MIGRATION_WITH_POSTCHECK_COMMIT_PASS');
}
