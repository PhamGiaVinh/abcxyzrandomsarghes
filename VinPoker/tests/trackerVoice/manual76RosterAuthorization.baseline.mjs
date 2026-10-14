// Source30 authorization reproduction only. Not full live roster parity:
// production additionally resolves display names with tournament_entry_display_v1.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
assert.equal(process.platform,'win32');
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
const source=readFileSync('supabase/migrations/20270128000030_tracker_roster_intent_fence_v1.sql','utf8').replaceAll('\r\n','\n');
const start=source.indexOf('CREATE FUNCTION public.get_tracker_roster_snapshot_v1(');
const end=source.indexOf('\n\nCREATE FUNCTION public.set_tracker_table_roster_seat_v2(',start);
assert.ok(start>0&&end>start);
const sql=`BEGIN;
DO $$ BEGIN IF current_database()<>'vinpoker_manual76_read_20261014' OR current_user<>'postgres' OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR inet_server_port()<>55464 OR (SELECT count(*) FROM public.clubs)<>2 OR to_regprocedure('public.get_tracker_roster_snapshot_v1(uuid,uuid,uuid,bigint)') IS NOT NULL THEN RAISE EXCEPTION 'owned_missing_roster_clone_required'; END IF; END $$;
${source.slice(start,end)}
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','81200000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"81200000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ DECLARE context jsonb; denied jsonb; BEGIN
 context:=public.get_tracker_hand_input_tables_v4('85000000-0000-4000-8000-000000000001');
 IF context->>'ok' IS DISTINCT FROM 'true' OR jsonb_array_length(context->'tables')<>1 THEN RAISE EXCEPTION 'assigned_dealer_context_fixture_invalid'; END IF;
 denied:=public.get_tracker_roster_snapshot_v1('85000000-0000-4000-8000-000000000001',(context->'tables'->0->>'tournament_table_id')::uuid,(context->'tables'->0->>'table_session_id')::uuid,(context->'tables'->0->>'control_epoch')::bigint);
 IF denied->>'error' IS DISTINCT FROM 'actor_not_authorized' THEN RAISE EXCEPTION 'roster_baseline_denial_not_reproduced: %',denied; END IF;
END $$;
ROLLBACK;`;
const result=spawnSync('wsl',['-d','PokerVision-P16-4C-Eval','--','psql','-X','-w','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55464','-U','postgres','-d','vinpoker_manual76_read_20261014'],{input:sql,encoding:'utf8',timeout:45000});
assert.equal(result.status,0,result.stderr);
console.log('ASSIGNED_DEALER_V4_CONTEXT_ALLOWED_V1_ROSTER_DENIED_SOURCE30_BASELINE_REPRODUCED_NOT_ACCEPTANCE');
