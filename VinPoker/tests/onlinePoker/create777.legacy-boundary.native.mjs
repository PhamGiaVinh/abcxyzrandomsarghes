import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
assert.equal(process.env.VINPOKER_ONLINE777_NATIVE,'1');
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_fnb719_gate_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('wsl',args,{input:q,encoding:'utf8',timeout:30000,maxBuffer:2e6}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),'vinpoker_fnb719_gate_local|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');
assert.equal(sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'VINPOKER_FNB719_OWNED_LOCAL_CLONE_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink');"),'0');
assert.equal(sql('SELECT count(*) FROM public.online_poker_config;'),'0');
assert.equal(sql("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20270128000288';"),'0');
const protectedNames=JSON.parse(sql("SELECT jsonb_agg(tablename ORDER BY tablename) FROM pg_tables WHERE schemaname='public' AND (tablename LIKE 'fnb\\_%' ESCAPE '\\' OR tablename IN('online_poker_tables','online_poker_seats','cashier_buyin_movements','tournament_prize_payments','tournament_entries','tournament_seats'));"));
const proof=()=>sql(`SELECT md5(jsonb_build_array(${protectedNames.map(n=>`(SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM public."${n.replaceAll('"','""')}" t)`).join(',')},(SELECT jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text) FROM private.online_create_requests_v1 r),(SELECT proacl::text FROM pg_proc WHERE oid='public.op_create_open_table(text,bigint,bigint,bigint,integer)'::regprocedure))::text);`);
const before=proof();
const migration=readFileSync(new URL('../../supabase/migrations/20270128000288_online_create_legacy_boundary_v1.sql',import.meta.url),'utf8');
assert.equal((migration.match(/^BEGIN;$/gm)||[]).length,1);assert.equal((migration.match(/^COMMIT;$/gm)||[]).length,1);
const body=process.argv.includes('--candidate')?migration.replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,''):'';
try{
 console.log(sql(`BEGIN;SET LOCAL statement_timeout='10s';${body}
 INSERT INTO public.online_poker_config(id,enabled) VALUES(true,true);
 SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
 SET LOCAL request.jwt.claims='{"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"}';
 SET LOCAL ROLE authenticated;
 DO $test$ DECLARE r jsonb; lookup jsonb; BEGIN
   BEGIN
     PERFORM public.op_create_open_table('LOCAL777-SHOULD-DENY',25,50,5000,9);
     RAISE EXCEPTION 'LEGACY_UNKEYED_CREATE_STILL_ALLOWED';
   EXCEPTION WHEN insufficient_privilege THEN NULL; END;
   r:=public.op_create_open_table_v2('LOCAL777-KEYED',25,50,5000,9,'ade3a1c1-3ac9-4a3a-b901-6e5b3cdad7b8');
   ASSERT r->>'outcome'='ok';
   lookup:=public.op_get_create_receipt_v1('ade3a1c1-3ac9-4a3a-b901-6e5b3cdad7b8');
   ASSERT lookup->>'outcome'='found' AND lookup->'receipt'->>'table_id'=r->>'table_id';
   ASSERT public.op_create_open_table_v2('LOCAL777-KEYED',25,50,5000,9,'ade3a1c1-3ac9-4a3a-b901-6e5b3cdad7b8')->>'replayed'='true';
 END $test$;
 RESET ROLE;SET LOCAL ROLE service_role;
 DO $test$ BEGIN
   BEGIN PERFORM public.op_create_open_table('LOCAL777-SERVICE-DENY',25,50,5000,9);RAISE EXCEPTION 'LEGACY_SERVICE_STILL_ALLOWED';
   EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 END $test$;
 RESET ROLE;SET LOCAL ROLE anon;
 DO $test$ BEGIN
   BEGIN PERFORM public.op_create_open_table('LOCAL777-ANON-DENY',25,50,5000,9);RAISE EXCEPTION 'LEGACY_ANON_STILL_ALLOWED';
   EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 END $test$;
 RESET ROLE;
 DO $test$ BEGIN
   ASSERT (SELECT count(*)=1 FROM public.online_poker_tables WHERE name='LOCAL777-KEYED');
   ASSERT (SELECT count(*)=1 FROM public.online_poker_seats WHERE table_id IN(SELECT id FROM public.online_poker_tables WHERE name='LOCAL777-KEYED'));
 END $test$;
 ROLLBACK;SELECT 'ONLINE777_ACTUAL_ROLE_DENIAL_KEYED_CREATE_REPLAY_RECEIPT_ROLLBACK_PASS';`));
}finally{
 assert.equal(proof(),before,'protected business/online/receipt/ACL delta after transaction');
 assert.equal(sql('SELECT count(*) FROM public.online_poker_config;'),'0');
 console.log('ONLINE777_ROLLBACK_PRESERVED_ALL_ONLINE_FNB_FINANCIAL_ENTRIES_SEATS_RECEIPTS_ACL_CONFIG');
}
