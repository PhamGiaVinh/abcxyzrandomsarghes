import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
// Reuse the canonical initial-registration fixture rather than hand-inserting
// entries, paid markers, price snapshots or seats. Caller owns local transport.
export function createPaidJourneyFixture(sql){
 const database=sql('SELECT current_database();');
 assert.ok(['vinpoker_ops_cash115_qualified_c','vinpoker_ops_reentry115_overlap'].includes(database));
 assert.equal(sql("SELECT host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('server_version_num')::int/10000;"),'127.0.0.1|55441|17');
 const dir=sql('SHOW data_directory');
 assert.ok(dir==='/tmp/vinpoker-sol-local-20261016-0e79a729/data'||process.env.GITHUB_ACTIONS==='true'&&dir==='/var/lib/postgresql/data');
 assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');"),'f');
 // Explicit no-network notification transport, not pg_net/push verification.
 sql(`CREATE SCHEMA IF NOT EXISTS net;
CREATE TABLE IF NOT EXISTS net.cash_ui_http_sink(id bigserial PRIMARY KEY,url text,body jsonb,headers jsonb);
REVOKE ALL ON SCHEMA net FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION net.http_post(url text,body jsonb DEFAULT '{}'::jsonb,params jsonb DEFAULT '{}'::jsonb,headers jsonb DEFAULT '{}'::jsonb,timeout_milliseconds integer DEFAULT 1000)
RETURNS bigint LANGUAGE sql AS 'INSERT INTO net.cash_ui_http_sink(url,body,headers) VALUES($1,$2,$4) RETURNING id';`);
 const name='cash115_fixture_'+randomUUID().replaceAll('-','');
 const raw=readFileSync(new URL('./cashPaymentIdentity.pg17.sql',import.meta.url),'utf8');
 const base=raw.replace(/CREATE FUNCTION pg_temp.fail_cash_receipt[\s\S]*?FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_cash_receipt\(\);/,'');
 assert.notEqual(base,raw);
 const marker=' -- CASH112_CONCURRENCY_FIXTURE_READY';assert.equal(base.split(marker).length,2);
 const setup=` DECLARE physical uuid; paid jsonb; BEGIN
 PERFORM set_config('role','none',true);
 INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status)
 SELECT gen_random_uuid(),club,'Paid journey TEST '||n,n,'tournament','inactive','available' FROM generate_series(1,2) n;
 IF (SELECT count(*) FROM public.game_tables WHERE club_id=club AND table_name LIKE 'Paid journey TEST %')<>2 THEN
  RAISE EXCEPTION 'fixture_exact_two_inventories_missing';END IF;
 FOR physical IN SELECT id FROM public.game_tables WHERE club_id=club AND table_name LIKE 'Paid journey TEST %' LOOP
  PERFORM set_config('role','authenticated',true);
  paid:=public.floor_open_tournament_table_v3(tour,physical,'manual',gen_random_uuid());
  IF paid->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'fixture_floor_open_failed: %',paid;END IF;
  PERFORM set_config('role','none',true);
 END LOOP;
 PERFORM set_config('role','authenticated',true);
 paid:=public.resolve_cashier_cash_buyin_intent_v1(jsonb_build_object('actor_id',owner_id,'club_id',club,'tournament_id',tour,
  'registration_id',registration,'amount',100000,'request_id',gen_random_uuid()),'record');
 IF paid->>'status'<>'recorded' OR paid->'result'->>'seating_state'<>'seated' THEN RAISE EXCEPTION 'fixture_paid_seat_failed: %',paid;END IF;
 PERFORM set_config('role','none',true);
 CREATE TABLE public.${name}(fixture jsonb);REVOKE ALL ON public.${name} FROM PUBLIC,anon,authenticated,service_role;
 INSERT INTO public.${name} VALUES(jsonb_build_object('actor',owner_id,'club',club,'tour',tour,'player',player_id,'registration',registration,'entry',paid->'result'->>'entry_id'));
 END;RETURN;
`;
 sql(base.replace(marker,setup+marker).replace(/ROLLBACK;\s*$/,'COMMIT;'));
 const fixture=JSON.parse(sql(`SELECT fixture FROM public.${name};`));
 assert.ok(fixture.entry);return fixture;
}
