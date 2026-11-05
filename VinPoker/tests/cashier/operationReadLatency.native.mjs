import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
export function measurePaidTourOperationReads(sql,fixture,reportPath){
 assert.equal(sql('SELECT current_database();'),'vinpoker_ops_cash115_qualified_c');
 for(const key of ['actor','club','tour'])assert.match(fixture[key],/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
 const {actor,club,tour}=fixture;
 const businessDate=sql("SELECT (clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;");
 assert.match(businessDate,/^\d{4}-\d{2}-\d{2}$/);
 const fixtureState=JSON.parse(sql(`BEGIN READ ONLY;SELECT jsonb_build_object(
  'activeSeats',(SELECT count(*) FROM public.tournament_seats WHERE tournament_id='${tour}' AND is_active),
  'checkedInDealers',(SELECT count(*) FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id WHERE d.club_id='${club}' AND a.status='checked_in'));
  ROLLBACK;`));
 assert.equal(fixtureState.activeSeats,8);assert.equal(fixtureState.checkedInDealers,4);
 const cases=[
  ['Floor inventory',`SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM public.get_floor_tournament_table_inventory_v1('${tour}') r`],
  ['Cashier worklist',`SELECT to_jsonb(public.cashier_tour_worklist_v1('${club}','${tour}','','all',0,50))`],
  ['Dealer assignments',`SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM public.get_table_assignments_with_next('${club}') r`],
  ['Dealer health',`SELECT to_jsonb(public.get_dealer_swing_health(ARRAY['${club}'::uuid]))`],
  ['Floor tracker alerts',`SELECT to_jsonb(public.list_tracker_floor_alerts('${tour}',NULL))`],
  ['Tournament chip inventory',`SELECT to_jsonb(public.get_current_chip_inventory('${tour}'))`],
  ['Finance business-date summary',`SELECT to_jsonb(public.get_club_finance_summary_v2('${businessDate}'::date,'${businessDate}'::date,'${club}'))`],
 ];
 const results=[];
 for(const [operation,query] of cases){
  const raw=sql(`BEGIN READ ONLY;SET LOCAL statement_timeout='30s';
   SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';SET LOCAL ROLE authenticated;
   DO $bench$ DECLARE started timestamptz;payload jsonb;samples jsonb:='[]';BEGIN
    FOR i IN 1..120 LOOP
     started:=clock_timestamp();${query} INTO payload;
     IF payload IS NULL OR payload->>'error' IS NOT NULL THEN RAISE EXCEPTION 'operation_read_latency_invalid_result';END IF;
     ${operation==='Cashier worklist'?"IF payload->>'ok' IS DISTINCT FROM 'true' OR coalesce(jsonb_array_length(payload->'rows'),0)<1 THEN RAISE EXCEPTION 'operation_read_latency_empty_cashier_fixture';END IF;":''}
     IF i>20 THEN samples:=samples||jsonb_build_array(extract(epoch FROM clock_timestamp()-started)*1000);END IF;
    END LOOP;
    PERFORM set_config('vinpoker.operation_read_latency',samples::text,true);
   END $bench$;
   SELECT current_setting('vinpoker.operation_read_latency');ROLLBACK;`);
  const samples=JSON.parse(raw);assert.equal(samples.length,100);assert.ok(samples.every(value=>Number.isFinite(value)&&value>=0));
  const ordered=[...samples].sort((a,b)=>a-b);
  results.push({operation,samplesMs:samples,p50Ms:ordered[49],p95Ms:ordered[94],p99Ms:ordered[98],maxMs:ordered.at(-1)});
 }
 const report={kind:'AUTHENTICATED_POSTGRESQL_READ_LATENCY_NOT_HTTP_OR_UI',sha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),fixtureSchemaAdditions:['20270128000264_finance_summary_business_dates_v2.sql'],businessDate,fixture:{club,tour,actor,...fixtureState,phase:'paid roster and check-in complete; before initial dealer assignment'},warmupPerOperation:20,gradedPerOperation:100,concurrency:1,actorScope:'fixture owner; separate Floor/Cashier/dealer role and tenant tests still required',transaction:'one read-only transaction per operation; warm repeated reads in same connection',results,qualification:false};
 mkdirSync(dirname(reportPath),{recursive:true});writeFileSync(reportPath,JSON.stringify(report,null,2));
 return report;
}
