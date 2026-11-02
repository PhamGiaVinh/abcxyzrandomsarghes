import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createHash} from 'node:crypto';
assert.equal(process.env.VINPOKER_D2_HELD848_ROLLBACK,'1');
const install=process.argv.includes('--install-owned849');
assert.equal(process.argv.length,install?3:2);
if(install)assert.equal(process.env.VINPOKER_D2_HELD849_INSTALL,'1');
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_checkout814_race_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('wsl',args,{input:q,encoding:'utf8',timeout:20000,maxBuffer:2e6}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),'vinpoker_checkout814_race_local|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');
assert.equal(sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'VINPOKER_CHECKOUT814_OWNED_LOCAL_CLONE_SOURCE_vinpoker_fnb719_gate_local_HEAD_ef6a26948');
assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink');"),'0');
const tables=['tournaments','tournament_entries','tournament_seats','table_sessions','tournament_tables','cashier_buyin_movements','chip_inventory_ledger','chip_bank_ledger','chip_bag','multi_day_final_adjustments_v1','multi_day_final_stack_revisions_v1','multi_day_final_requests_v1','multi_day_package_release_v1','centerpoint_tournament_ops_release','dealer_attendance','club_floors'];
const factsQuery=`SELECT md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')})::text)`;
const facts=()=>sql(factsQuery+';');
const before=facts(),definition=sql("SELECT md5(pg_get_functiondef('public.multi_day_final_roster_v1(uuid)'::regprocedure));");
const floorActor=randomUUID();
let candidate=readFileSync('supabase/migrations/20270128000294_d2_held_seed_read_v1.sql','utf8').replaceAll('\r','');
const sourceHash=createHash('sha256').update(candidate).digest('hex');
if(install)assert.equal(sourceHash,'92db7550567b3e5fd75f2578d7d6efb3324ad74601b9b7407fc51bc404d58f02');
assert.equal(candidate.match(/^BEGIN;$/gm)?.length,1);assert.equal(candidate.match(/^COMMIT;$/gm)?.length,1);
candidate=candidate.replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,'');
const claims=id=>`SELECT set_config('request.jwt.claim.sub','${id}',true);SELECT set_config('request.jwt.claims','{"sub":"${id}","role":"authenticated"}',true);SET LOCAL ROLE authenticated;`;
const output=sql(`BEGIN;SET LOCAL statement_timeout='10s';
 ${claims('ba3e052f-27d5-4da5-b832-0b5d9cecbf2f')}
 RESET ROLE;
 CREATE TEMP TABLE before848 AS SELECT public.multi_day_final_roster_v1('e6551af0-e6d0-4fb0-9342-fdd7465fcaf2') value;
 ${candidate}
 DO $$ DECLARE old jsonb;value jsonb;item jsonb;denied boolean:=false;count_rows integer;BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
   EXECUTE 'SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version=''20270128000294''' INTO count_rows;
   ASSERT count_rows=0,'294 local ledger collision';
  END IF;
  SELECT b.value INTO STRICT old FROM before848 b;
  PERFORM set_config('role','authenticated',true);
  value:=public.multi_day_final_roster_v1('e6551af0-e6d0-4fb0-9342-fdd7465fcaf2');
  ASSERT value-'heldSeedAdjustments'=old,'read extension changed source hash or existing fields';
  ASSERT jsonb_array_length(value->'heldSeedAdjustments')=1;
  item:=value->'heldSeedAdjustments'->0;
  ASSERT item->>'status'='OWNER_APPROVED_HELD' AND item->'liveStackChanged'='false'::jsonb;
  ASSERT (item->>'priorSeedStack')::bigint=20001 AND (item->>'proposedSeedStack')::bigint=20002 AND (item->>'deltaChips')::bigint=1;
  ASSERT item->>'entryId'=value->'players'->0->>'entryId' AND item->>'seatId'=value->'players'->0->>'seatId';
  ASSERT NOT (item ?| ARRAY['actorId','reason','evidenceRef','sourceBags','payloadHash']);
  PERFORM set_config('request.jwt.claim.sub','675fe35e-60a8-4452-bb90-e79486d54da6',true);
  PERFORM set_config('request.jwt.claims','{"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"}',true);
  BEGIN PERFORM public.multi_day_final_roster_v1('e6551af0-e6d0-4fb0-9342-fdd7465fcaf2');EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
  ASSERT denied,'foreign club owner read held seed data';
  value:=public.multi_day_final_roster_v1('dbb49f8d-7d47-4c2c-afd9-f57062c9971d');
  ASSERT value->'heldSeedAdjustments'='[]'::jsonb,'foreign event imported canary held row';
  PERFORM set_config('role','none',true);
 END $$;
 INSERT INTO auth.users(id) VALUES('${floorActor}');
 INSERT INTO public.club_floors(club_id,user_id) VALUES('399956aa-7858-422a-ad34-ca7ee52ff64d','${floorActor}');
 ${claims(floorActor)}
 DO $$ DECLARE value jsonb;BEGIN
  value:=public.multi_day_final_roster_v1('e6551af0-e6d0-4fb0-9342-fdd7465fcaf2');
  ASSERT jsonb_array_length(value->'heldSeedAdjustments')=1,'existing Floor read authority lost';
 END $$;
 RESET ROLE;SET LOCAL request.jwt.claim.sub='';SET LOCAL request.jwt.claims='{"role":"anon"}';SET LOCAL ROLE anon;
 DO $$ DECLARE denied boolean:=false;BEGIN
  BEGIN PERFORM public.multi_day_final_roster_v1('e6551af0-e6d0-4fb0-9342-fdd7465fcaf2');EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
  ASSERT denied,'anonymous gained private roster access';
 END $$;
 RESET ROLE;ROLLBACK;
 SELECT 'D2_HELD848_NATIVE_OWNER_FLOOR_FOREIGN_ANON_EMPTY_SCOPE_SOURCE_HASH_UNCHANGED_ROLLBACK_PASS';`);
assert.ok(output.includes('D2_HELD848_NATIVE_OWNER_FLOOR_FOREIGN_ANON_EMPTY_SCOPE_SOURCE_HASH_UNCHANGED_ROLLBACK_PASS'));
assert.equal(facts(),before);
assert.equal(sql("SELECT md5(pg_get_functiondef('public.multi_day_final_roster_v1(uuid)'::regprocedure));"),definition);
assert.equal(sql(`SELECT count(*) FROM auth.users WHERE id='${floorActor}';`),'0');
console.log('D2_HELD848_NATIVE_READ_CANDIDATE_AUTHORITY_SOURCE_HASH_DATA_DEFINITION_RESTORED_PASS');
if(install){
 assert.equal(sql("SELECT to_regclass('private.d2_held849_install') IS NULL;"),'t','849 install consumed; inspect retained backup, never reset');
 sql(`BEGIN;SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='10s';
  CREATE TABLE private.d2_held849_install(id boolean PRIMARY KEY DEFAULT true CHECK(id),old_definition text NOT NULL,old_catalog jsonb NOT NULL,installed_digest text,source_sha256 text NOT NULL,business_hash text NOT NULL);
  ALTER TABLE private.d2_held849_install ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON private.d2_held849_install FROM PUBLIC,anon,authenticated,service_role;
  INSERT INTO private.d2_held849_install(old_definition,old_catalog,source_sha256,business_hash)
   SELECT pg_get_functiondef(oid),jsonb_build_object('owner',proowner,'acl',proacl,'config',proconfig),'${sourceHash}','${before}'
   FROM pg_proc WHERE oid='public.multi_day_final_roster_v1(uuid)'::regprocedure;
  ${candidate}
  UPDATE private.d2_held849_install SET installed_digest=md5(pg_get_functiondef('public.multi_day_final_roster_v1(uuid)'::regprocedure)) WHERE id;
  DO $$ BEGIN ASSERT (${factsQuery})='${before}','reader install changed business facts';END $$;
  COMMIT;`);
 const installed=sql("SELECT installed_digest FROM private.d2_held849_install WHERE id;");
 assert.notEqual(installed,definition);
 // Rehearse exact predecessor restoration without leaving the installed body.
 sql(`BEGIN;SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='10s';
  DO $$DECLARE body text;BEGIN
   SELECT old_definition INTO STRICT body FROM private.d2_held849_install WHERE id;EXECUTE body;
   ASSERT md5(pg_get_functiondef('public.multi_day_final_roster_v1(uuid)'::regprocedure))='${definition}';
   PERFORM set_config('request.jwt.claim.sub','ba3e052f-27d5-4da5-b832-0b5d9cecbf2f',true);
   PERFORM set_config('request.jwt.claims','{"sub":"ba3e052f-27d5-4da5-b832-0b5d9cecbf2f","role":"authenticated"}',true);
   PERFORM set_config('role','authenticated',true);
   ASSERT NOT(public.multi_day_final_roster_v1('e6551af0-e6d0-4fb0-9342-fdd7465fcaf2') ? 'heldSeedAdjustments');
  END $$;
  ROLLBACK;`);
 assert.equal(sql("SELECT md5(pg_get_functiondef('public.multi_day_final_roster_v1(uuid)'::regprocedure));"),installed);
 assert.equal(sql("SELECT jsonb_build_object('owner',proowner,'acl',proacl,'config',proconfig)=(SELECT old_catalog FROM private.d2_held849_install WHERE id) FROM pg_proc WHERE oid='public.multi_day_final_roster_v1(uuid)'::regprocedure;"),'t');
 assert.equal(facts(),before);
 console.log('D2_HELD849_OWNED_ONLY_READER_INSTALLED_EXACT_BACKUP_RECOVERY_ROLLBACK_METADATA_DATA_UNCHANGED_PASS',installed);
}
