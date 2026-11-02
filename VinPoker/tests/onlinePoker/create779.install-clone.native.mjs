// One-shot LOCAL owned-clone ACL install. No migration ledger or business writes.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
assert.equal(process.env.VINPOKER_ONLINE779_NATIVE,'1');
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_fnb719_gate_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('wsl',args,{input:q,encoding:'utf8',timeout:20000,maxBuffer:3e6,stdio:['pipe','pipe','pipe']}).trim();
const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),'vinpoker_fnb719_gate_local|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');
assert.equal(sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'VINPOKER_FNB719_OWNED_LOCAL_CLONE_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink');"),'0');
assert.equal(sql("SELECT to_regclass('floor_private.online779_acl') IS NULL;"),'t','consumed local install; preserve backup');
assert.equal(sql("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20270128000288';"),'0');
assert.equal(sql('SELECT count(*) FROM public.online_poker_config;'),'0');
assert.equal(sql("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend' AND state<>'idle';"),'0');
const signature='public.op_create_open_table(text,bigint,bigint,bigint,integer)';
const acl=()=>sql(`SELECT proacl::text FROM pg_proc WHERE oid=${quote(signature)}::regprocedure;`);
const oldAcl='{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}';
assert.equal(acl(),oldAcl,'unexpected ACL; do not guess recovery');
const metadata=()=>sql(`SELECT jsonb_build_object('oid',oid,'owner',proowner,'definition',pg_get_functiondef(oid),'config',proconfig,'definer',prosecdef) FROM pg_proc WHERE oid=${quote(signature)}::regprocedure;`);
const oldMetadata=metadata();
const tables=JSON.parse(sql("SELECT jsonb_agg(tablename ORDER BY tablename) FROM pg_tables WHERE schemaname='public' AND (tablename LIKE 'fnb\\_%' ESCAPE '\\' OR tablename IN('online_poker_tables','online_poker_seats','cashier_buyin_movements','tournament_prize_payments','tournament_entries','tournament_seats'));"));
const proof=()=>sql(`SELECT md5(jsonb_build_array(${tables.map(n=>`(SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM public."${n.replaceAll('"','""')}" t)`).join(',')},(SELECT jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text) FROM private.online_create_requests_v1 r))::text);`);
const before=proof();
const migration=readFileSync(new URL('../../supabase/migrations/20270128000288_online_create_legacy_boundary_v1.sql',import.meta.url),'utf8');
const sha256=createHash('sha256').update(migration).digest('hex');
sql(`CREATE TABLE floor_private.online779_acl(stage text PRIMARY KEY,evidence jsonb NOT NULL);ALTER TABLE floor_private.online779_acl ENABLE ROW LEVEL SECURITY;REVOKE ALL ON floor_private.online779_acl FROM PUBLIC,anon,authenticated,service_role;
 INSERT INTO floor_private.online779_acl VALUES('backup',jsonb_build_object('signature',${quote(signature)},'oldAcl',${quote(oldAcl)},'metadata',${quote(oldMetadata)}::jsonb,'protected',${quote(before)},'migrationSha256',${quote(sha256)}));`);
const record=(stage,value)=>sql(`INSERT INTO floor_private.online779_acl VALUES(${quote(stage)},${quote(JSON.stringify(value))}::jsonb);`);
try{
 sql(migration);
 assert.equal(acl(),'{postgres=X/postgres}');assert.equal(metadata(),oldMetadata);assert.equal(proof(),before);
 // Rehearse EXACT old grant recovery, observe it, then rollback. Do not leave
 // the unsafe grants enabled or run any business mutation during rehearsal.
 assert.equal(sql(`BEGIN;GRANT EXECUTE ON FUNCTION ${signature} TO authenticated,service_role;SELECT proacl::text FROM pg_proc WHERE oid=${quote(signature)}::regprocedure;ROLLBACK;`),oldAcl);
 assert.equal(acl(),'{postgres=X/postgres}');
 record('installed',{newAcl:acl(),protected:proof(),exactRecoveryRehearsed:true,metadataUnchanged:metadata()===oldMetadata,migrationSha256:sha256});
 console.log('ONLINE779_OWNED_CLONE_288_ACL_INSTALLED_EXACT_RECOVERY_ROLLBACK_BUSINESS_UNCHANGED_PASS');
}catch(error){record('failure',{message:String(error.message),currentAcl:acl(),protected:proof()});throw error;}
assert.equal(sql('SELECT count(*) FROM public.online_poker_config;'),'0');
assert.equal(sql("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20270128000288';"),'0');
