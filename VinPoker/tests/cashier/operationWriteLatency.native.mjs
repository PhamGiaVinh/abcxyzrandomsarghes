import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {execFileSync} from 'node:child_process';

// Reuse the paid journey's real policies, writers, triggers and receipts. Every
// probe rolls back; the subsequent integration journey retains its exact state.
export function measurePaidTourOperationWrites(sql,fixture,reportPath){
 assert.equal(sql('SELECT current_database();'),'vinpoker_ops_cash115_qualified_c');
 for(const key of ['actor','club','tour'])assert.match(fixture[key],/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
 const {actor,club,tour}=fixture;
 const auth=`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';`;
 const fingerprint=()=>sql(`SELECT md5(jsonb_build_object(
  'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s WHERE tournament_id='${tour}'),
  'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e WHERE tournament_id='${tour}'),
  'cash',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.cashier_buyin_movements c WHERE tournament_id='${tour}'),
  'sessions',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.table_sessions s WHERE tournament_id='${tour}'),
  'dealers',(SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM public.dealers d WHERE club_id='${club}'),
  'attendance',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id WHERE d.club_id='${club}'))::text);`);
 const before=fingerprint();
 const cases=[['Dealer check-in and exact retry',`
  DECLARE shift uuid;dealer uuid;key uuid;r jsonb;repeated jsonb;
  BEGIN
   SELECT id INTO STRICT shift FROM public.dealer_shifts WHERE club_id='${club}' LIMIT 1;
   FOR i IN 1..120 LOOP
    dealer:=gen_random_uuid();key:=gen_random_uuid();
    INSERT INTO public.dealers(id,club_id,user_id,full_name,status) VALUES(dealer,'${club}',NULL,'Latency TEST '||dealer::text,'active');
    PERFORM set_config('role','authenticated',true);
    started:=clock_timestamp();r:=public.operator_check_in_dealer_v1(dealer,'${club}',shift,key);
    IF i>20 THEN samples:=samples||jsonb_build_array(extract(epoch FROM clock_timestamp()-started)*1000);END IF;
    IF r->>'outcome' IS DISTINCT FROM 'checked_in' OR r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'latency_checkin_failed';END IF;
    started:=clock_timestamp();repeated:=public.operator_check_in_dealer_v1(dealer,'${club}',shift,key);
    IF i>20 THEN retries:=retries||jsonb_build_array(extract(epoch FROM clock_timestamp()-started)*1000);END IF;
    IF repeated IS DISTINCT FROM r THEN RAISE EXCEPTION 'latency_checkin_replay_changed';END IF;
    PERFORM set_config('role','none',true);
    IF (SELECT count(*) FROM public.dealer_attendance WHERE dealer_id=dealer AND status='checked_in')<>1 THEN RAISE EXCEPTION 'latency_checkin_duplicate';END IF;
   END LOOP;
  END;`],['Floor seat move and exact retry',`
  DECLARE entry uuid;source record;target record;seat integer;key uuid;r jsonb;repeated jsonb;
  BEGIN
   SELECT entry_id INTO STRICT entry FROM public.tournament_seats WHERE tournament_id='${tour}' AND is_active ORDER BY id LIMIT 1;
   FOR i IN 1..120 LOOP
    SELECT t.id,t.table_session_id,s.revision,s.control_epoch INTO STRICT source
     FROM public.tournament_seats p JOIN public.tournament_tables t ON t.id=p.tournament_table_id
     JOIN public.table_sessions s ON s.id=t.table_session_id WHERE p.entry_id=entry AND p.is_active;
    SELECT t.id,t.table_session_id,s.revision,s.control_epoch INTO STRICT target
     FROM public.tournament_tables t JOIN public.table_sessions s ON s.id=t.table_session_id
     WHERE t.tournament_id='${tour}' AND t.id<>source.id AND t.status='active' AND s.closed_at IS NULL ORDER BY t.id LIMIT 1;
    SELECT n INTO STRICT seat FROM generate_series(1,9) n WHERE NOT EXISTS(
     SELECT 1 FROM public.tournament_seats p WHERE p.tournament_table_id=target.id AND p.is_active AND p.seat_number=n) ORDER BY n LIMIT 1;
    key:=gen_random_uuid();PERFORM set_config('role','authenticated',true);
    started:=clock_timestamp();r:=public.move_player_seat_v4(entry,source.id,source.table_session_id,target.id,target.table_session_id,seat,
     source.revision,target.revision,source.control_epoch,target.control_epoch,'TEST latency move',key);
    IF i>20 THEN samples:=samples||jsonb_build_array(extract(epoch FROM clock_timestamp()-started)*1000);END IF;
    IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'latency_move_failed';END IF;
    started:=clock_timestamp();repeated:=public.move_player_seat_v4(entry,source.id,source.table_session_id,target.id,target.table_session_id,seat,
     source.revision,target.revision,source.control_epoch,target.control_epoch,'TEST latency move',key);
    IF i>20 THEN retries:=retries||jsonb_build_array(extract(epoch FROM clock_timestamp()-started)*1000);END IF;
    IF repeated IS DISTINCT FROM r THEN RAISE EXCEPTION 'latency_move_replay_changed';END IF;
    PERFORM set_config('role','none',true);
    IF NOT EXISTS(SELECT 1 FROM public.tournament_seats WHERE entry_id=entry AND is_active AND tournament_table_id=target.id AND seat_number=seat)
     OR (SELECT count(*) FROM public.tournament_seats WHERE tournament_id='${tour}' AND is_active)<>8
     OR (SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id='${tour}' AND is_active)<>160000 THEN RAISE EXCEPTION 'latency_move_conservation_failed';END IF;
   END LOOP;
  END;`]];
 const results=[];
 for(const [operation,block] of cases){
  const raw=JSON.parse(sql(`BEGIN;SET LOCAL statement_timeout='30s';${auth}
   DO $bench$ DECLARE started timestamptz;samples jsonb:='[]';retries jsonb:='[]';BEGIN
    ${block}
    PERFORM set_config('vinpoker.operation_write_latency',jsonb_build_object('first',samples,'retry',retries)::text,true);
   END $bench$;SELECT current_setting('vinpoker.operation_write_latency');ROLLBACK;`));
  for(const [path,samples] of Object.entries(raw)){
   assert.equal(samples.length,100);assert.ok(samples.every(value=>Number.isFinite(value)&&value>=0));
   const ordered=[...samples].sort((a,b)=>a-b);
   results.push({operation,path,samplesMs:samples,p50Ms:ordered[49],p95Ms:ordered[94],p99Ms:ordered[98],maxMs:ordered[99]});
  }
  assert.equal(fingerprint(),before,'Rollback must preserve the existing paid journey');
 }
 const report={kind:'AUTHENTICATED_POSTGRESQL_WRITER_CALL_LATENCY_NOT_COMMIT_HTTP_REALTIME_OR_UI',sha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),fixture:{club,tour,actor,activeSeats:8},warmupPerOperation:20,gradedPerOperation:100,concurrency:1,results,rollbackStateUnchanged:true,qualification:false,limitations:'Fixture owner role; warm calls inside one rolled-back transaction per operation. Excludes commit, HTTP, scheduler, Realtime, screen rendering and concurrent staff; not full operational acceptance.'};
 mkdirSync(dirname(reportPath),{recursive:true});writeFileSync(reportPath,JSON.stringify(report,null,2));
 return report;
}
