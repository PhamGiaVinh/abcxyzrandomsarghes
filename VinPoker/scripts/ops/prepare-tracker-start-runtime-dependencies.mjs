import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {isAbsolute} from 'node:path';

// Disposable HTTP fixture preparation, never a production migration runner.
const output=process.argv[2];
assert.ok(output&&isAbsolute(output)&&process.argv.length===3,'absolute isolated output required');
const read=file=>readFileSync(new URL('../../supabase/migrations/'+file,import.meta.url),'utf8').replaceAll('\r\n','\n');
const md5=value=>createHash('md5').update(value).digest('hex');
const source=read('20270115000010_tracker_v3_hand_start_context.sql');
const match=source.match(/CREATE OR REPLACE FUNCTION public\.start_tracker_hand_v3\([\s\S]*?AS (\$[A-Za-z0-9_]*\$)([\s\S]*?)\1;/);
assert.ok(match,'canonical start source missing');
assert.equal(md5(match[2]),'e132f36a5c080c78f394a8ad3068857e','captured start source drift');
let body=match[2];
const physical='p_tournament_id, v_game_table_id, v_table.id, v_session.id,';
const logical='p_tournament_id, v_table.id, v_table.id, v_session.id,';
const lineage=read('20270128000028_tracker_roster_exact_session_v1.sql');
assert.ok(lineage.includes("needle := '"+physical+"'"));
assert.ok(lineage.includes("EXECUTE replace(definition, needle, '"+logical+"')"));
assert.equal(body.split(physical).length,2,'unique exact table lineage replacement required');
body=body.replace(physical,logical);
const snapshot=read('20270128000193_tracker_hand_seat_snapshot_v1.sql');
const old=snapshot.match(/marker:=\$old\$([\s\S]*?)\$old\$/)?.[1];
const replacement=snapshot.match(/replacement:=\$new\$([\s\S]*?)\$new\$/)?.[1];
assert.ok(old&&replacement);assert.equal(body.split(old).length,2,'unique seat snapshot replacement required');
body=body.replace(old,replacement);
assert.equal(md5(body),'5eadfdf57a2974e897563ad06258b1e8','current production start body drift');
const table=snapshot.match(/CREATE TABLE floor_private\.tracker_hand_seat_snapshots193 \([\s\S]*?\n\);/);
assert.ok(table,'exact snapshot table source required');
const signature='public.start_tracker_hand_v3(uuid,uuid,uuid,bigint,integer,timestamptz,uuid,integer)';
const sql=`BEGIN;SET LOCAL search_path=public;SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='20s';
DO $$ DECLARE p pg_proc%ROWTYPE;BEGIN
 IF current_user<>'postgres' OR current_setting('vinpoker.isolated_tracker_start_fixture',true) IS DISTINCT FROM 'cashier-current-tracker-v1'
 OR NOT EXISTS(SELECT 1 FROM public.clubs WHERE id='a2000000-0000-4000-8000-000000000001' AND name='Cashier Edge TEST')
 OR to_regclass('floor_private.tracker_hand_seat_snapshots193') IS NOT NULL THEN RAISE EXCEPTION 'tracker_start_requires_owned_empty_fixture';END IF;
 SELECT * INTO STRICT p FROM pg_proc WHERE oid='${signature}'::regprocedure;
 IF md5(replace(p.prosrc,chr(13),''))<>'e132f36a5c080c78f394a8ad3068857e' OR p.proowner<>'postgres'::regrole
 OR NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[] THEN RAISE EXCEPTION 'tracker_start_captured_contract_drift';END IF;
 IF md5(replace((SELECT prosrc FROM pg_proc WHERE oid='floor_private.floor_apply_tracker_moves_after_hand_v1()'::regprocedure),chr(13),''))<>'dc0726665bd5fba64e6e93368120482c'
 THEN RAISE EXCEPTION 'tracker_move_current_consumer_required';END IF;
 IF EXISTS(SELECT 1 FROM (VALUES
  ('trg_floor_apply_tracker_moves_after_hand_v1','public.tournament_hands','floor_private.floor_apply_tracker_moves_after_hand_v1()','932be1696736a450fac69b472085c070'),
  ('trg_floor_guard_pending_tracker_seat_v1','public.tournament_seats','floor_private.floor_guard_pending_tracker_seat_v1()','1b418cf0b298f119a9ce1746985c197b'),
  ('trg_00_floor_tracker_hand_session_v1','public.tournament_hands','floor_private.floor_tracker_hand_session_v1()','7909bcf6c010dcc96c42a963a1e49778')
 ) e(name,relation,signature,definition_hash) WHERE NOT EXISTS(SELECT 1 FROM pg_trigger t
  WHERE t.tgname=e.name AND t.tgrelid=e.relation::regclass AND t.tgfoid=e.signature::regprocedure
   AND NOT t.tgisinternal AND t.tgenabled='O' AND md5(replace(pg_get_triggerdef(t.oid),chr(13),''))=e.definition_hash))
 THEN RAISE EXCEPTION 'tracker_move_trigger_attachment_drift';END IF;
END $$;
${table[0]}
ALTER TABLE floor_private.tracker_hand_seat_snapshots193 OWNER TO postgres;
ALTER TABLE floor_private.tracker_hand_seat_snapshots193 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.tracker_hand_seat_snapshots193 FROM PUBLIC,anon,authenticated,service_role;
${match[0].replace(match[2],body)}
ALTER FUNCTION ${signature} OWNER TO postgres;
REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION ${signature} TO authenticated;
DO $$ DECLARE p pg_proc%ROWTYPE;BEGIN
 SELECT * INTO STRICT p FROM pg_proc WHERE oid='${signature}'::regprocedure;
 IF md5(replace(p.prosrc,chr(13),''))<>'5eadfdf57a2974e897563ad06258b1e8'
 OR md5(replace(pg_get_functiondef(p.oid),chr(13),''))<>'599d94b5e9acd99192008ba79f75cae6' OR NOT p.prosecdef
 OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[] OR p.proowner<>'postgres'::regrole
 OR has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('service_role',p.oid,'EXECUTE')
 OR NOT has_function_privilege('authenticated',p.oid,'EXECUTE') THEN RAISE EXCEPTION 'tracker_start_restored_contract_drift';END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='floor_private.tracker_hand_seat_snapshots193'::regclass)
 OR has_table_privilege('anon','floor_private.tracker_hand_seat_snapshots193','SELECT')
 OR has_table_privilege('authenticated','floor_private.tracker_hand_seat_snapshots193','SELECT')
 OR has_table_privilege('service_role','floor_private.tracker_hand_seat_snapshots193','SELECT') THEN RAISE EXCEPTION 'tracker_start_private_snapshot_exposed';END IF;
END $$;
NOTIFY pgrst,'reload schema';COMMIT;
`;
writeFileSync(output,sql);
