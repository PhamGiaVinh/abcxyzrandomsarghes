// Loopback-only component proof. Does not connect to Supabase or prove live schema parity.
import { readFileSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const psql = process.env.PSQL_BIN || 'psql';
const args = ['-X', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', '6543', '-U', 'postgres', '-d', 'finance_free_test_component'];
function sql(text, ok = true) {
  const r = spawnSync(psql, args, { input: text, encoding: 'utf8' });
  if (ok) assert.equal(r.status, 0, r.stderr);
  else assert.notEqual(r.status, 0, 'Expected guarded rejection');
  return r;
}
const repairPath = 'scripts/production/repairs/repair_free_felt_test_finance_20261124.sql';
const setup = `
CREATE SCHEMA auth; CREATE SCHEMA floor_private;
DO $$ BEGIN
IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid$$;
CREATE TABLE clubs(id uuid,owner_id uuid);
CREATE TABLE club_accountants(club_id uuid,user_id uuid);
CREATE TABLE user_roles(user_id uuid,role text);
INSERT INTO clubs VALUES('22222222-2222-2222-2222-222222222222','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
CREATE TABLE tournaments(id uuid PRIMARY KEY,club_id uuid,name text,status text,created_at timestamptz,start_time timestamptz,registration_closed_at timestamptz);
CREATE TABLE tournament_registrations(id uuid PRIMARY KEY,tournament_id uuid,club_id uuid,player_id uuid,status text,created_at timestamptz,confirmed_at timestamptz,buy_in bigint,total_pay bigint,platform_fixed_fee bigint,price_snapshot jsonb,cashier_paid_at timestamptz,reference_code text);
CREATE TABLE cashier_buyin_movements(registration_id uuid,purpose text,direction text,applied_amount bigint);
CREATE TABLE cashier_refund_requests(registration_id uuid,status text,amount bigint);
CREATE TABLE payment_settlements(tournament_registration_id uuid);
CREATE TABLE satellite_ticket_value_transfers(registration_id uuid);
CREATE TABLE floor_private.tour_revenue_buy_close_v1(tournament_id uuid,snapshot jsonb);
CREATE TABLE tournament_hands(id integer,tournament_id uuid,hand_time timestamptz);
CREATE TABLE hand_actions(id integer,hand_id integer,action text);
CREATE TABLE hand_players(id integer,hand_id integer,stack bigint);
INSERT INTO tournaments VALUES('5a51bec5-4da0-4dd9-861a-cc4e7678478c','22222222-2222-2222-2222-222222222222','TEST — Felt UAT (compact)','live','2026-07-03 01:41:58.17781+07',NULL,NULL);
INSERT INTO tournament_registrations SELECT CASE n WHEN 1 THEN '5ccba4ae-82de-4f5c-a0f0-327dd7655779'::uuid ELSE 'a339364c-3f70-4b70-9257-9d73cd180915'::uuid END,'5a51bec5-4da0-4dd9-861a-cc4e7678478c','22222222-2222-2222-2222-222222222222',('00000000-0000-0000-0000-00000000000'||n)::uuid,'confirmed', CASE n WHEN 1 THEN '2026-07-24 18:43:49.723826+07'::timestamptz ELSE '2026-07-24 18:43:50.71677+07'::timestamptz END,'2026-07-24 18:43:49.981128+07',1000000,0,0,NULL,NULL,NULL FROM generate_series(1,2)n;
INSERT INTO tournament_hands SELECT n,'5a51bec5-4da0-4dd9-861a-cc4e7678478c','2026-07-03 02:02:15.987+07' FROM generate_series(1,31)n;
`;
sql(setup);
sql(readFileSync('supabase/migrations/20261029092203_owner_tour_rake_live_read_v1.sql', 'utf8'));
const original = readFileSync('supabase/migrations/20270115000003_cashier_tour_money_v1.sql', 'utf8');
const guard = original.slice(original.indexOf('CREATE OR REPLACE FUNCTION public.cashier_paid_registration_guard_v1()'), original.indexOf('-- Existing player UPDATE RLS'));
sql(guard + `CREATE TRIGGER paid_guard BEFORE UPDATE ON tournament_registrations FOR EACH ROW EXECUTE FUNCTION cashier_paid_registration_guard_v1();`);
const finance = readFileSync('supabase/migrations/20270128000324_owner_staff_inactive_closed_pt_projection_v1.sql','utf8');
const start = finance.indexOf('  if exists (select 1 from jsonb_array_elements(v_tour_receipts) receipt');
assert.ok(start>=0);
const dateGuard = finance.slice(start,finance.indexOf('  end if;',start)+'  end if;'.length);
sql(`CREATE FUNCTION test_report_date_guard() RETURNS void LANGUAGE plpgsql AS $$DECLARE v_tour_receipts jsonb; BEGIN v_tour_receipts:=get_owner_tour_rake_live_v1('22222222-2222-2222-2222-222222222222')->'tours'; ${dateGuard} END $$;`);
assert.match(sql('SELECT test_report_date_guard();',false).stderr,/finance_report_event_start_unavailable/);
sql(`DO $$ DECLARE r jsonb; BEGIN r:=get_owner_tour_rake_live_v1('22222222-2222-2222-2222-222222222222')#>'{tours,0}'; ASSERT (r->>'unavailableBuys')::int=2; ASSERT r->'rake'='null'::jsonb; END $$;`);
const repair = readFileSync(repairPath, 'utf8'); // RED: missing before implementation
const preimage = sql(`SET TIME ZONE 'UTC'; COPY (SELECT md5(jsonb_agg(to_jsonb(r) ORDER BY r.id)::text) FROM tournament_registrations r) TO STDOUT;`).stdout.trim().split('\n').at(-1).trim();
assert.match(preimage,/^[a-f0-9]{32}$/);
const ack = `SET vinpoker.free_test_repair_ack='PREPARE_FREE_FELT_2_REGISTRATIONS_20261124'; SET vinpoker.free_test_expected_preimage_md5='${preimage}';\n`;
const rollback = readFileSync('scripts/production/repairs/rollback_free_felt_test_finance_20261124.sql', 'utf8');
sql(repair, false); // No acknowledgment must reject.
const locker=spawn(psql,args,{stdio:['pipe','pipe','pipe']});
await new Promise((resolve,reject)=>{
  let text='';
  locker.stdout.on('data',data=>{text+=data; if(text.includes('FREE_TEST_LOCK_HELD')) resolve();});
  locker.once('error',reject);
  locker.once('exit',code=>reject(Error(`Lock holder exited early: ${code}`)));
  locker.stdin.write("BEGIN; LOCK TABLE cashier_buyin_movements IN ROW EXCLUSIVE MODE; SELECT 'FREE_TEST_LOCK_HELD';\n");
});
assert.match(sql(ack+repair,false).stderr,/could not obtain lock/);
locker.stdin.end('ROLLBACK;\n');
await new Promise(resolve=>locker.once('exit',resolve));
sql(`CREATE FUNCTION test_null_buyin() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN NEW.buy_in:=NULL; RETURN NEW; END$$; CREATE TRIGGER test_null BEFORE UPDATE ON tournament_registrations FOR EACH ROW EXECUTE FUNCTION test_null_buyin();`);
assert.match(sql(ack + repair, false).stderr, /unexpected_update_effect/);
sql('DROP TRIGGER test_null ON tournament_registrations;');
sql(`CREATE FUNCTION test_mutate_history() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN UPDATE tournament_hands SET hand_time=hand_time+interval '1 second' WHERE id=1; RETURN NEW; END$$; CREATE TRIGGER test_history AFTER UPDATE ON tournament_registrations FOR EACH ROW EXECUTE FUNCTION test_mutate_history();`);
assert.match(sql(ack + repair, false).stderr, /history_changed/);
sql('DROP TRIGGER test_history ON tournament_registrations;');
sql(`CREATE FUNCTION test_payment() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN INSERT INTO cashier_buyin_movements VALUES(NEW.id,'buyin','in',1); RETURN NEW; END$$; CREATE TRIGGER test_payment AFTER UPDATE ON tournament_registrations FOR EACH ROW EXECUTE FUNCTION test_payment();`);
assert.match(sql(ack + repair, false).stderr, /post_update_money_evidence/);
sql(`DO $$BEGIN ASSERT (SELECT count(*) FROM cashier_buyin_movements)=0; ASSERT (SELECT count(*) FROM tournament_registrations WHERE buy_in=1000000)=2; ASSERT to_regclass('floor_private.free_felt_finance_20261124_backup') IS NULL; END$$; DROP TRIGGER test_payment ON tournament_registrations;`);
sql(`INSERT INTO cashier_buyin_movements VALUES('5ccba4ae-82de-4f5c-a0f0-327dd7655779','buyin','in',1);`);
assert.match(sql(ack + repair, false).stderr, /money_evidence/);
sql('TRUNCATE cashier_buyin_movements;'); // disposable fixture only
sql(`UPDATE tournament_registrations SET price_snapshot='{}' WHERE id='5ccba4ae-82de-4f5c-a0f0-327dd7655779';`);
assert.match(sql(ack + repair, false).stderr, /registration_drift/);
sql('ALTER TABLE tournament_registrations DISABLE TRIGGER paid_guard; UPDATE tournament_registrations SET price_snapshot=NULL; ALTER TABLE tournament_registrations ENABLE TRIGGER paid_guard;');
sql(ack + repair);
sql('SELECT test_report_date_guard();');
sql(`DO $$ DECLARE r jsonb; BEGIN r:=get_owner_tour_rake_live_v1('22222222-2222-2222-2222-222222222222')#>'{tours,0}'; ASSERT (r->>'unavailableBuys')::int=0; ASSERT (r->>'rake')::numeric=0; ASSERT (r->>'serviceFee')::numeric=0; ASSERT (r->>'collected')::numeric=0; ASSERT (SELECT count(*) FROM tournament_hands)=31; ASSERT (SELECT start_time IS NULL FROM tournaments); ASSERT (SELECT count(*) FROM floor_private.free_felt_finance_20261124_backup)=2; ASSERT NOT has_table_privilege('authenticated','floor_private.free_felt_finance_20261124_backup','SELECT'); END $$;`);
assert.match(sql(ack + repair, false).stderr, /already_prepared/);
sql(`UPDATE tournament_registrations SET reference_code='LATER-EDIT' WHERE id='5ccba4ae-82de-4f5c-a0f0-327dd7655779';`);
assert.match(sql(ack + rollback, false).stderr, /rollback_drift/);
sql(`UPDATE tournament_registrations SET reference_code=NULL;`);
sql(`CREATE TRIGGER test_payment AFTER UPDATE ON tournament_registrations FOR EACH ROW EXECUTE FUNCTION test_payment();`);
assert.match(sql(ack + rollback, false).stderr, /post_update_money_evidence/);
sql(`DO $$BEGIN ASSERT (SELECT count(*) FROM cashier_buyin_movements)=0; ASSERT (SELECT count(*) FROM tournament_registrations WHERE buy_in=0)=2; END$$; DROP TRIGGER test_payment ON tournament_registrations;`);
sql(ack + rollback);
sql(`DO $$ BEGIN ASSERT (SELECT count(*) FROM tournament_registrations WHERE buy_in=1000000)=2; ASSERT (SELECT count(*) FROM tournament_hands)=31; ASSERT (SELECT count(*) FROM floor_private.free_felt_finance_20261124_backup WHERE rolled_back_at IS NOT NULL)=2; END $$;`);
console.log('PASS: original unavailable receipt reproduced; acknowledgment, money, drift and repeat guards; zero-fee classifier; 31 hands preserved; private backup; guarded rollback. Component-only, not live qualification.');
