import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
assert.equal(process.env.VINPOKER_NATIVE_DB_TEST,'1');
const sql=(input)=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',timeout:30000,maxBuffer:2e6}).trim();
assert.equal(sql(`SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||(current_setting('server_version_num')::int/10000);`),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441|17');
const migration=readFileSync('supabase/migrations/20270128000223_chip_bank_adjust_receipt_v2.sql','utf8');
assert.equal(createHash('sha256').update(migration).digest('hex'),'d69ab7ff481b10b5e40f9b1c0701493b5dda573e1e39f6d0ab85a32a0b468f3e');
assert.equal(sql(`SELECT to_regclass('floor_private.bank272_fixture') IS NULL AND to_regclass('floor_private.bank272_definition_backup') IS NULL;`),'t','never recreate/reset retained bank canary');
assert.equal(sql(`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND state<>'idle';`),'0','stop owned API and all active queries before local DDL');
const candidate=migration.replace(/^BEGIN;\s*$/m,'').replace(/^COMMIT;\s*$/m,'');
sql(`BEGIN;
 CREATE TABLE floor_private.bank272_definition_backup AS SELECT pg_get_functiondef(p.oid) AS definition,p.proacl AS acl,
   p.proowner AS owner,md5(pg_get_functiondef(p.oid)) AS definition_md5 FROM pg_proc p
   WHERE p.oid='public.chip_ops_bank_adjust(uuid,uuid,text,bigint,uuid,integer,text)'::regprocedure;
 ALTER TABLE floor_private.bank272_definition_backup ENABLE ROW LEVEL SECURITY;
 REVOKE ALL ON floor_private.bank272_definition_backup FROM PUBLIC,anon,authenticated,service_role;
 DO $$ BEGIN ASSERT (SELECT count(*) FROM floor_private.bank272_definition_backup)=1;
 ASSERT (SELECT definition_md5 FROM floor_private.bank272_definition_backup)='da643ca448cb56633268c8b377895b19';
 ASSERT NOT EXISTS(SELECT 1 FROM auth.users WHERE id IN('e2720000-0000-4000-8000-000000000001','e2720000-0000-4000-8000-000000000002'));
 END $$;
 CREATE TABLE floor_private.bank272_fixture(fixture jsonb NOT NULL,baseline text NOT NULL,source_sha text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
 ALTER TABLE floor_private.bank272_fixture ENABLE ROW LEVEL SECURITY;
 REVOKE ALL ON floor_private.bank272_fixture FROM PUBLIC,anon,authenticated,service_role;
 INSERT INTO floor_private.bank272_fixture(fixture,source_sha,baseline) SELECT
  '{"actor":"e2720000-0000-4000-8000-000000000001","otherActor":"e2720000-0000-4000-8000-000000000002","club":"e2720000-0000-4000-8000-000000000010","tour":"e2720000-0000-4000-8000-000000000020","set":"e2720000-0000-4000-8000-000000000030","denom":"e2720000-0000-4000-8000-000000000040"}'::jsonb,
  'd69ab7ff481b10b5e40f9b1c0701493b5dda573e1e39f6d0ab85a32a0b468f3e',
  md5(jsonb_build_array(
   (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
   (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x),
   (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x),
   (SELECT jsonb_agg(to_jsonb(x) ORDER BY club_id,denomination_id) FROM public.chip_bank x),
   (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bank_ledger x),
   (SELECT jsonb_agg(to_jsonb(x) ORDER BY actor_id,request_key) FROM floor_private.chip_mutation_receipts x)
  )::text);
 ${candidate}
 INSERT INTO auth.users(id) VALUES('e2720000-0000-4000-8000-000000000001'),('e2720000-0000-4000-8000-000000000002');
 INSERT INTO public.clubs(id,owner_id,name,region) VALUES('e2720000-0000-4000-8000-000000000010','e2720000-0000-4000-8000-000000000001','Bank272 isolated TEST','TEST');
 INSERT INTO public.club_chip_masters(club_id,user_id,granted_by) VALUES('e2720000-0000-4000-8000-000000000010','e2720000-0000-4000-8000-000000000002','e2720000-0000-4000-8000-000000000001');
 INSERT INTO public.tournaments(id,club_id,name,status,live_status) VALUES('e2720000-0000-4000-8000-000000000020','e2720000-0000-4000-8000-000000000010','Bank272 isolated TEST','live','playing');
 INSERT INTO public.chip_set(id,club_id,name) VALUES('e2720000-0000-4000-8000-000000000030','e2720000-0000-4000-8000-000000000010','Bank272 isolated TEST');
 INSERT INTO public.chip_set_denomination(id,chip_set_id,club_id,value) VALUES('e2720000-0000-4000-8000-000000000040','e2720000-0000-4000-8000-000000000030','e2720000-0000-4000-8000-000000000010',100);
 DO $$ BEGIN ASSERT NOT coalesce((SELECT auto_swing_enabled FROM public.club_settings WHERE club_id='e2720000-0000-4000-8000-000000000010'),false); END $$;
 COMMIT;`);
console.log('BANK272_LOCAL_CANDIDATE223_AND_ISOLATED_ZERO_BANK_CANARY_PREPARED_NO_LEDGER_REPLAY');
console.log(sql(`SELECT fixture FROM floor_private.bank272_fixture;`));
