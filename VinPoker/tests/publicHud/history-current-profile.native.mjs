// Read-only attribution of the final seeded history function, not a capacity gate.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {sql} from './nativeDb.mjs';
const nativeFixture=process.env.PUBLIC_HUD_HISTORY_PROFILE_FIXTURE==='history-plans-ci';
if(nativeFixture){
 assert.equal(process.env.PUBLIC_HUD_LOCAL_DATABASE,'vinpoker_hud_test_history_plans_ci');
 assert.equal(process.env.PUBLIC_HUD_LOCAL_PORT,'5432');
 assert.equal(process.env.PUBLIC_HUD_ISOLATED_STACK,undefined);
}else{
 assert.equal(process.env.PUBLIC_HUD_ISOLATED_STACK,'vinpoker-hud-scale');
 assert.equal(process.env.PUBLIC_HUD_LOCAL_PORT,'54322');
}
assert.equal(sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),
 nativeFixture?'vinpoker-hud-history-profile-isolated-ci':'vinpoker-hud-scale-disposable');
const signature='public.get_public_player_hud_history_v1(uuid,uuid,timestamptz,uuid)';
const metadata=JSON.parse(sql(`SELECT jsonb_build_object('definitionMd5',md5(replace(pg_get_functiondef(p.oid),chr(13),'')),
 'config',p.proconfig,'stable',p.provolatile='s','definer',p.prosecdef,
 'numericStrict',(SELECT proisstrict FROM pg_proc WHERE oid='tracker_analytics_v1.safe_integer(jsonb)'::regprocedure))
 FROM pg_proc p WHERE p.oid='${signature}'::regprocedure;`));
assert.ok(metadata.stable&&metadata.definer&&metadata.numericStrict,'Current history contract differs');
let report;
try{
 report=JSON.parse(sql(`\\set VERBOSITY sqlstate
 BEGIN READ ONLY;
 SET LOCAL statement_timeout='30s';SET LOCAL track_functions='all';SET LOCAL ROLE anon;
 DO $profile$ DECLARE value jsonb;initial jsonb;cursor_time timestamptz;cursor_hand uuid;
 started timestamptz;samples jsonb:='[]';mode text;sample_ms numeric; BEGIN
 initial:=public.get_public_player_hud_history_v1('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',NULL,NULL);
 IF initial->>'access' IS DISTINCT FROM 'public' OR initial->>'state' IS DISTINCT FROM 'current' OR jsonb_typeof(initial->'handHistory') IS DISTINCT FROM 'array' OR jsonb_array_length(initial->'handHistory') IS DISTINCT FROM 50 OR jsonb_typeof(initial->'nextCursor') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'representative_history_page_missing';END IF;
 cursor_time:=(initial->'nextCursor'->>'playedAt')::timestamptz;cursor_hand:=(initial->'nextCursor'->>'handId')::uuid;
 IF cursor_hand IS NULL THEN RAISE EXCEPTION 'representative_history_cursor_missing';END IF;
 FOREACH mode IN ARRAY ARRAY['first','next'] LOOP
  FOR i IN 1..30 LOOP
   started:=clock_timestamp();
   value:=public.get_public_player_hud_history_v1('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
    CASE WHEN mode='next' THEN cursor_time END,CASE WHEN mode='next' THEN cursor_hand END);
   sample_ms:=extract(epoch FROM clock_timestamp()-started)*1000;
   IF value->>'access' IS DISTINCT FROM 'public' OR value->>'state' IS DISTINCT FROM 'current' OR jsonb_typeof(value->'handHistory') IS DISTINCT FROM 'array' OR jsonb_array_length(value->'handHistory') IS DISTINCT FROM 50 THEN RAISE EXCEPTION 'sample_history_page_missing';END IF;
   samples:=samples||jsonb_build_array(jsonb_build_object('mode',mode,'ms',sample_ms,'rows',jsonb_array_length(value->'handHistory'),
    'knownStacks',(SELECT count(*) FROM jsonb_array_elements(value->'handHistory') row WHERE row->'endingStack'<>'null'::jsonb)));
  END LOOP;
 END LOOP;
 PERFORM set_config('app.hud_history_profile',samples::text,true);
 END $profile$;
 -- Only the measured API calls run as anon. Private function identifiers and
 -- diagnostic statistics are inspected by the original fixture administrator.
 RESET ROLE;
 SELECT jsonb_build_object('samples',current_setting('app.hud_history_profile')::jsonb,'functions',
  (SELECT coalesce(jsonb_agg(jsonb_build_object('name',funcname,'calls',calls,'totalMs',total_time,'selfMs',self_time)),'[]')
   FROM pg_stat_xact_user_functions WHERE funcid IN ('${signature}'::regprocedure,
    'tracker_analytics_v1.safe_integer(jsonb)'::regprocedure,'tracker_analytics_v1.public_context(uuid,uuid)'::regprocedure)));
 ROLLBACK;`,{captureFailure:true}));
}catch(reason){
 const state=/ERROR:\s+([0-9A-Z]{5})\b/.exec(String(reason?.stderr??''))?.[1]??'UNKNOWN';
 writeFileSync('output/hud-scale/history-current-profile.json',JSON.stringify({kind:'READ_ONLY_FINAL_SEEDED_HISTORY_FUNCTION_ATTRIBUTION',
  status:'failed',sqlstate:state,qualification:false,productionChanged:false,metadata},null,2));
 throw Error('Read-only current history profiling failed (SQLSTATE '+state+'); raw SQL diagnostics withheld');
}
assert.equal(report.samples.length,60);
assert.ok(report.functions.some(row=>row.name==='get_public_player_hud_history_v1'&&row.calls>=61),'Function timing unavailable');
writeFileSync('output/hud-scale/history-current-profile.json',JSON.stringify({kind:'READ_ONLY_FINAL_SEEDED_HISTORY_FUNCTION_ATTRIBUTION',nativeFixture,
 qualification:false,productionChanged:false,metadata,...report,scope:'Single native session with track_functions enabled. Includes one initial cursor read; not HTTP concurrency or production latency.'},null,2));
