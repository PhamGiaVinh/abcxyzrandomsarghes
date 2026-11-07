import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sql,jsonSql} from './nativeDb.mjs';

const database=process.env.PUBLIC_HUD_LOCAL_DATABASE;
assert.match(database??'',/^vinpoker_hud_test_handover_fixture_[a-z0-9_]+$/);
assert.deepEqual(process.argv.slice(2),['--initialize']);
assert.equal(sql('SELECT current_database()'),database);
assert.equal(sql("SELECT to_regclass('public.dealer_attendance') IS NULL AND to_regnamespace('floor_private') IS NULL"),'t');
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8').replaceAll('\r\n','\n');
const shell=read('../../scripts/ops/cashier-tour-real-e2e.sh');
const shift=shell.match(/INSERT INTO public\.dealer_shifts\(id,club_id,tour_name,start_time,end_time\)\nVALUES\('ad530000[\s\S]*?;\n/);
const attendance=shell.match(/INSERT INTO public\.dealer_attendance\(id,dealer_id,shift_id,shift_date,status,check_in_time,current_state,pre_assigned_table_id,pre_assigned_at\)[\s\S]*?;\n/);
assert.ok(shift&&attendance,'Exact new fixture initializers required');
const source=read('../../supabase/migrations/20270128000222_dealer_pool_club_operating_day_v1.sql');
const matcher=source.match(/CREATE FUNCTION floor_private\.dealer_pool_attendance_matches_v1\([\s\S]*?\$\$;/);
assert.ok(matcher);
sql(`CREATE SCHEMA floor_private;
 CREATE TABLE public.dealers(id uuid PRIMARY KEY,club_id uuid,deleted_at timestamptz,status text);
 CREATE TABLE public.dealer_shifts(id uuid PRIMARY KEY,club_id uuid,tour_name text,start_time time,end_time time,closed_at timestamptz,archived_at timestamptz);
 CREATE TABLE public.dealer_attendance(id uuid PRIMARY KEY,dealer_id uuid,shift_id uuid,shift_date date,status text,check_in_time timestamptz,check_out_time timestamptz,current_state text,pre_assigned_table_id uuid,pre_assigned_at timestamptz);
 ${matcher[0]}`);
const club='ad500000-0000-4000-8000-000000000001';
const times=['2026-11-06T16:59:59Z','2026-11-06T17:00:01Z','2026-11-06T18:30:00Z','2026-11-07T15:30:00Z'];
for(const at of times){
 const initialize=(shift[0]+attendance[0]).replaceAll('now()',"(SELECT at FROM fixture_clock)");
 const result=jsonSql(`BEGIN;
 CREATE TEMP TABLE fixture_clock AS SELECT '${at}'::timestamptz AS at;
 CREATE TEMP TABLE handover_latency AS SELECT
  '01000000-0000-4000-8000-000000000001'::uuid outgoing_dealer,'01000000-0000-4000-8000-000000000002'::uuid incoming_dealer,
  '02000000-0000-4000-8000-000000000001'::uuid outgoing_attendance,'02000000-0000-4000-8000-000000000002'::uuid incoming_attendance,
  '03000000-0000-4000-8000-000000000001'::uuid table_id;
 INSERT INTO public.dealers SELECT outgoing_dealer,'${club}'::uuid,NULL::timestamptz,'active' FROM handover_latency
 UNION ALL SELECT incoming_dealer,'${club}',NULL,'active' FROM handover_latency;
 ${initialize}
 SELECT jsonb_build_object('current',bool_and(floor_private.dealer_pool_attendance_matches_v1(d.id,d.club_id,c.at)),
  'after50Minutes',bool_and(floor_private.dealer_pool_attendance_matches_v1(d.id,d.club_id,c.at+interval '50 minutes')),
  'checkinNotFuture',bool_and(a.check_in_time<=c.at AND (a.pre_assigned_at IS NULL OR a.pre_assigned_at<=c.at)),
  'wrongClubDenied',bool_and(NOT floor_private.dealer_pool_attendance_matches_v1(d.id,'ffffffff-ffff-4fff-8fff-ffffffffffff',c.at)))
 FROM public.dealers d JOIN public.dealer_attendance a ON a.dealer_id=d.id CROSS JOIN fixture_clock c;
 ROLLBACK;`);
 assert.deepEqual(result,{current:true,after50Minutes:true,checkinNotFuture:true,wrongClubDenied:true},at);
}
const denied=jsonSql(`BEGIN;CREATE TEMP TABLE fixture_clock AS SELECT '2026-11-06T17:00:01Z'::timestamptz at;
 INSERT INTO public.dealers VALUES('01000000-0000-4000-8000-000000000001','${club}',NULL,'active');
 INSERT INTO public.dealer_attendance(id,dealer_id,status,check_in_time,current_state) VALUES('02000000-0000-4000-8000-000000000001','01000000-0000-4000-8000-000000000001','checked_in','2026-11-06T16:00:01Z','pre_assigned');
 SELECT to_jsonb(NOT floor_private.dealer_pool_attendance_matches_v1(d.id,d.club_id,c.at)) FROM public.dealers d CROSS JOIN fixture_clock c;ROLLBACK;`);
assert.equal(denied,true,'The previous unbound fixture must remain ineligible');
console.log(JSON.stringify({kind:'REAL_PG_HANDOVER_FIXTURE_CURRENT_OPERATING_DAY',samples:times.length,exactFixtureSql:true,actualCurrentMatcher:true,localMidnightAndOvernight:true,currentAnd50MinutesEligible:true,unboundAndCrossClubDenied:true,qualification:false,productionChanged:false}));
