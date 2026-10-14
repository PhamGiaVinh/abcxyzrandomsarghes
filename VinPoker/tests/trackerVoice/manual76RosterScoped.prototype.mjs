// Disposable prototype: copy only reviewed reader dependencies, never replay
// migrations30/32 or their writers/triggers. All objects roll back.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
assert.equal(process.platform,'win32');
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
const read=file=>readFileSync(`supabase/migrations/${file}`,'utf8').replaceAll('\r\n','\n');
const s30=read('20270128000030_tracker_roster_intent_fence_v1.sql');
const s32=read('20270128000032_tournament_seat_display_preservation_v1.sql');
const slice=(source,start,end)=>{assert.equal(source.split(start).length,2);const a=source.indexOf(start);const b=source.indexOf(end,a);assert.ok(b>a);return source.slice(a,b);};
const token=slice(s30,'CREATE FUNCTION floor_private.tracker_roster_seat_token_v1(','\n\nCREATE FUNCTION public.get_tracker_roster_snapshot_v1(');
const display=slice(s32,'CREATE FUNCTION floor_private.tournament_entry_display_v1(','\n\n-- All existing immediate');
const baseline=slice(s30,'CREATE FUNCTION public.get_tracker_roster_snapshot_v1(','\n\nCREATE FUNCTION public.set_tracker_table_roster_seat_v2(')
 .replace("'seat',to_jsonb(q),","'seat',CASE WHEN q.id IS NULL THEN NULL ELSE to_jsonb(q)||jsonb_build_object('player_name',COALESCE(NULLIF(pg_catalog.btrim(q.player_name),''),floor_private.tournament_entry_display_v1(q.entry_id,q.player_id,q.tournament_id,q.entry_number)->>'player_name',q.player_name)) END,");
const old="IF a IS NULL OR c.id IS NULL OR NOT (public.is_club_tracker(a,c.club_id) OR public.is_club_floor(a,c.club_id)) THEN";
const scoped="IF a IS NULL OR c.id IS NULL OR coalesce(auth.jwt()->>'role','')<>'authenticated' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(floor_private.tracker_hand_input_context_v4(p_tournament_id)->'tables') context WHERE context->>'tournament_table_id'=p_tournament_table_id::text AND context->>'table_session_id'=p_table_session_id::text AND (context->>'control_epoch')::bigint=p_expected_epoch) THEN";
assert.equal(baseline.split(old).length,2);
const prototype=baseline.replaceAll('public.get_tracker_roster_snapshot_v1','floor_private.manual76_roster_prototype').replace(old,scoped);
const sql=`BEGIN;
DO $$ BEGIN IF current_database()<>'vinpoker_manual76_read_20261014' OR current_user<>'postgres' OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR inet_server_port()<>55464 OR (SELECT count(*) FROM public.clubs)<>2 OR to_regprocedure('public.get_tracker_roster_snapshot_v1(uuid,uuid,uuid,bigint)') IS NOT NULL THEN RAISE EXCEPTION 'owned76_roster_prototype_required'; END IF; END $$;
${token}\n${display}\n${baseline}
DO $$ BEGIN IF md5(replace(pg_get_functiondef('public.get_tracker_roster_snapshot_v1(uuid,uuid,uuid,bigint)'::regprocedure),chr(13),''))<>'9fecaf3e1287fbf1a6912bb1eebbd1b3' THEN RAISE EXCEPTION 'live_roster_body_parity_required'; END IF; END $$;
${prototype}
REVOKE ALL ON FUNCTION floor_private.manual76_roster_prototype(uuid,uuid,uuid,bigint) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION floor_private.manual76_roster_prototype(uuid,uuid,uuid,bigint) TO authenticated;
CREATE FUNCTION public.manual76_roster_prototype(p_tournament_id uuid,p_tournament_table_id uuid,p_table_session_id uuid,p_expected_epoch bigint) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' RETURN floor_private.manual76_roster_prototype(p_tournament_id,p_tournament_table_id,p_table_session_id,p_expected_epoch);
REVOKE ALL ON FUNCTION public.manual76_roster_prototype(uuid,uuid,uuid,bigint) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.manual76_roster_prototype(uuid,uuid,uuid,bigint) TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','81200000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"81200000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ DECLARE context jsonb; r jsonb; tt uuid; sid uuid; epoch bigint; BEGIN
 context:=public.get_tracker_hand_input_tables_v4('85000000-0000-4000-8000-000000000001')->'tables'->0;
 tt:=(context->>'tournament_table_id')::uuid;sid:=(context->>'table_session_id')::uuid;epoch:=(context->>'control_epoch')::bigint;
 r:=public.get_tracker_roster_snapshot_v1('85000000-0000-4000-8000-000000000001',tt,sid,epoch);
 IF r->>'error' IS DISTINCT FROM 'actor_not_authorized' THEN RAISE EXCEPTION 'baseline_not_reproduced'; END IF;
 r:=public.manual76_roster_prototype('85000000-0000-4000-8000-000000000001',tt,sid,epoch);
 IF r->>'ok' IS DISTINCT FROM 'true' OR r->>'table_session_id' IS DISTINCT FROM sid::text OR jsonb_array_length(r->'seats')<1 THEN RAISE EXCEPTION 'assigned_dealer_roster_failed: %',r; END IF;
 r:=public.manual76_roster_prototype('85000000-0000-4000-8000-000000000001',tt,sid,epoch-1);
 IF r->>'error' IS DISTINCT FROM 'actor_not_authorized' THEN RAISE EXCEPTION 'stale_epoch_exposed'; END IF;
 r:=public.manual76_roster_prototype('85000000-0000-4000-8000-000000000001',tt,'83500000-0000-4000-8000-000000000002',epoch);
 IF r->>'error' IS DISTINCT FROM 'actor_not_authorized' THEN RAISE EXCEPTION 'other_session_exposed'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','81300000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"81300000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ DECLARE context jsonb; r jsonb; BEGIN
 context:=public.get_tracker_hand_input_tables_v4('85000000-0000-4000-8000-000000000001')->'tables'->0;
 r:=public.manual76_roster_prototype('85000000-0000-4000-8000-000000000001',(context->>'tournament_table_id')::uuid,(context->>'table_session_id')::uuid,(context->>'control_epoch')::bigint);
 IF r->>'ok' IS DISTINCT FROM 'true' OR context->>'can_manual_cards' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'floor_read_without_manual_write_failed'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','81500000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"81500000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ DECLARE r jsonb; BEGIN
 r:=public.manual76_roster_prototype('85000000-0000-4000-8000-000000000001','83400000-0000-4000-8000-000000000001','83500000-0000-4000-8000-000000000001',1);
 IF r->>'error' IS DISTINCT FROM 'actor_not_authorized' THEN RAISE EXCEPTION 'outsider_roster_exposed'; END IF;
END $$;
RESET ROLE;
UPDATE public.dealer_assignments SET released_at=clock_timestamp() WHERE table_session_id='83500000-0000-4000-8000-000000000001' AND status='assigned';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','81200000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"81200000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ DECLARE r jsonb; BEGIN
 r:=public.manual76_roster_prototype('85000000-0000-4000-8000-000000000001','83400000-0000-4000-8000-000000000001','83500000-0000-4000-8000-000000000001',1);
 IF r->>'error' IS DISTINCT FROM 'actor_not_authorized' THEN RAISE EXCEPTION 'released_dealer_roster_exposed'; END IF;
END $$;
ROLLBACK;`;
const r=spawnSync('wsl',['-d','PokerVision-P16-4C-Eval','--','psql','-X','-w','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55464','-U','postgres','-d','vinpoker_manual76_read_20261014'],{input:sql,encoding:'utf8',timeout:45000});
assert.equal(r.status,0,r.stderr);
console.log('MANUAL76_SCOPED_ROSTER_PROTOTYPE_EXACT_LIVE_BODY_DEALER_STALE_SESSION_ROLLBACK_PASS_NOT_RELEASE');
