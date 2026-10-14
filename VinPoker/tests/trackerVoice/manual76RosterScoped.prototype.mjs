// Disposable prototype: copy only reviewed reader dependencies, never replay
// migrations30/32 or their writers/triggers. All objects roll back.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const win=process.platform==='win32';
const port=win?'55464':'55441';
if(!win){assert.equal(process.platform,'linux');assert.equal(process.env.CI,'true');assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGPORT,port);assert.equal(process.env.PGUSER,'postgres');}
assert.ok(process.argv.length<=3);
const mode=process.argv[2]??'';assert.ok(['','--race','--race-red','--canonical77','--canonical77-race'].includes(mode));
const database=mode==='--canonical77-race'?'vinpoker_roster77_race_20261014':mode==='--canonical77'?'vinpoker_roster77_read_20261014':mode==='--race'?'vinpoker_manual76_roster_race_verified_20261014':mode==='--race-red'?'vinpoker_manual76_roster_race_red_20261014':'vinpoker_manual76_read_20261014';
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
const returnBoundary=" RETURN jsonb_build_object('ok',true,'tournament_table_id',t.id,'table_session_id',s.id,'control_epoch',s.control_epoch,'seats',rows);";
assert.equal(baseline.split(returnBoundary).length,2);
// Recheck after all lock waits and projection reads. A release/revoke committed
// while this VOLATILE reader waited must not disclose roster/tokens.
const finalCheck=` SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(floor_private.tracker_hand_input_context_v4(p_tournament_id)->'tables') context WHERE context->>'tournament_table_id'=p_tournament_table_id::text AND context->>'table_session_id'=p_table_session_id::text AND (context->>'control_epoch')::bigint=p_expected_epoch) INTO allowed_now;\n IF NOT coalesce(allowed_now,false) THEN RETURN jsonb_build_object('ok',false,'error','actor_not_authorized'); END IF;\n${returnBoundary}`;
const prototype=baseline.replaceAll('public.get_tracker_roster_snapshot_v1','floor_private.manual76_roster_prototype').replace(old,scoped)
 .replace('rows jsonb;','rows jsonb; allowed_now boolean;')
 .replace(returnBoundary,finalCheck);
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
let input=sql;
const migration=read('20270128000077_tracker_roster_scoped_read_v2.sql');
assert.match(migration,/\nBEGIN;\n/u);assert.match(migration,/COMMIT;\s*$/u);
const body=migration.replace('\nBEGIN;\n','\n').replace(/COMMIT;\s*$/u,'');
if(mode==='--canonical77'){
 const start=sql.indexOf(prototype);const end=sql.indexOf('SET LOCAL ROLE authenticated;',start);
 assert.ok(start>0&&end>start);
 input=(sql.slice(0,start)+body+'\n'+sql.slice(end))
  .replace("current_database()<>'vinpoker_manual76_read_20261014'",`current_database()<>'${database}'`)
  .replaceAll('public.manual76_roster_prototype','public.get_tracker_roster_snapshot_v2')
  .replace('ROLLBACK;',"RESET ROLE; SELECT p.oid::regprocedure,md5(replace(pg_get_functiondef(p.oid),chr(13),'')) FROM pg_proc p WHERE p.oid IN ('floor_private.tracker_roster_snapshot_v2(uuid,uuid,uuid,bigint)'::regprocedure,'public.get_tracker_roster_snapshot_v2(uuid,uuid,uuid,bigint)'::regprocedure); ROLLBACK;");
}else if(mode){
 input=sql.slice(0,sql.indexOf('SET LOCAL ROLE authenticated;')).replace("current_database()<>'vinpoker_manual76_read_20261014'",`current_database()<>'${database}'`);
 if(mode==='--canonical77-race')input=input.slice(0,input.indexOf(prototype))+body+'\n';
 if(mode==='--race-red')input=input.replace(finalCheck,returnBoundary);
 input+=`SET LOCAL statement_timeout='15s';
SELECT public.dblink_connect('release76','host=127.0.0.1 port=55464 user=postgres dbname=${database}');
SELECT public.dblink_exec('release76','BEGIN');
SELECT public.dblink_exec('release76',format('DO $lock$ BEGIN PERFORM 1 FROM public.game_tables WHERE id=%L::uuid FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION ''physical_lock_fixture_missing''; END IF; END $lock$;',(SELECT game_table_id FROM public.table_sessions WHERE id='83500000-0000-4000-8000-000000000001')));
SELECT public.dblink_send_query('release76',format($remote$
DO $wait$ DECLARE deadline timestamptz:=clock_timestamp()+interval '8 seconds'; BEGIN
 LOOP
  EXIT WHEN EXISTS(SELECT 1 FROM pg_stat_activity p WHERE p.pid=%s AND p.wait_event_type='Lock' AND pg_backend_pid()=ANY(pg_blocking_pids(p.pid)));
  IF clock_timestamp()>deadline THEN RAISE EXCEPTION 'actual_reader_lock_wait_not_observed'; END IF;
  PERFORM pg_sleep(0.02);
 END LOOP;
 UPDATE public.dealer_assignments SET released_at=clock_timestamp() WHERE table_session_id='83500000-0000-4000-8000-000000000001' AND status='assigned' AND released_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'assigned_fixture_missing'; END IF;
END $wait$; COMMIT;
$remote$,pg_backend_pid()));
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','81200000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"81200000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ DECLARE context jsonb; r jsonb; BEGIN
 context:=public.get_tracker_hand_input_tables_v4('85000000-0000-4000-8000-000000000001')->'tables'->0;
 IF context IS NULL THEN RAISE EXCEPTION 'dealer_fixture_missing_before_wait'; END IF;
 r:=public.manual76_roster_prototype('85000000-0000-4000-8000-000000000001',(context->>'tournament_table_id')::uuid,(context->>'table_session_id')::uuid,(context->>'control_epoch')::bigint);
 IF r->>'error' IS DISTINCT FROM 'actor_not_authorized' OR r ? 'seats' THEN RAISE EXCEPTION 'released_during_observed_wait_roster_disclosed: %',r; END IF;
END $$;
RESET ROLE;
SELECT * FROM public.dblink_get_result('release76') AS completed(status text);
SELECT * FROM public.dblink_get_result('release76') AS committed(status text);
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE table_session_id='83500000-0000-4000-8000-000000000001' AND released_at IS NOT NULL) THEN RAISE EXCEPTION 'remote_release_commit_not_verified'; END IF; END $$;
SELECT public.dblink_disconnect('release76');
ROLLBACK;`;
 if(mode==='--canonical77-race')input=input.replaceAll('public.manual76_roster_prototype','public.get_tracker_roster_snapshot_v2');
}
input=input.replaceAll('55464',port);
const args=['-X','-w','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',port,'-U','postgres','-d',database];
const r=spawnSync(win?'wsl':'psql',win?['-d','PokerVision-P16-4C-Eval','--','psql',...args]:args,{input,encoding:'utf8',timeout:45000});
assert.equal(r.status,0,r.stderr);
if(mode==='--canonical77')console.log(r.stdout);
console.log(mode==='--canonical77'?'ROSTER77_CANONICAL_DDL_POSTCHECK_ROLE_MATRIX_ROLLBACK_PASS':mode?'MANUAL76_ROSTER_RELEASE_DURING_OBSERVED_BACKEND_LOCK_WAIT_DENIED_PASS':'MANUAL76_SCOPED_ROSTER_PROTOTYPE_EXACT_LIVE_BODY_DEALER_STALE_SESSION_ROLLBACK_PASS_NOT_RELEASE');
