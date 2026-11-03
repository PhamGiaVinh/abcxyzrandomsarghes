import {jsonSql,pgbench,sql} from './nativeDb.mjs';
export function measureFixtureWriter(){
 return jsonSql(`${process.env.PUBLIC_HUD_PROFILE_FUNCTIONS==='1'?"SET track_functions='all';":''}BEGIN;CREATE TEMP TABLE fixture_write_samples(ms numeric);GRANT INSERT ON fixture_write_samples TO service_role;
  SET LOCAL request.jwt.claim.role='service_role';SET LOCAL ROLE service_role;
  DO $$ DECLARE started timestamptz; BEGIN FOR i IN 1..110 LOOP
   started:=clock_timestamp();PERFORM public.fixture_complete_scale_hand_v1('10000000-0000-4000-8000-000000000001',2000000000+i);
   IF i>10 THEN INSERT INTO fixture_write_samples VALUES(extract(epoch FROM clock_timestamp()-started)*1000);END IF;
  END LOOP;END $$;
  RESET ROLE;SELECT jsonb_build_object('p50Ms',percentile_cont(.5) WITHIN GROUP(ORDER BY ms),'p95Ms',percentile_cont(.95) WITHIN GROUP(ORDER BY ms),'maxMs',max(ms)) FROM fixture_write_samples;
  ROLLBACK;`);
}
export function measureFixtureWriterTransactions({commit=false}={}){
 const ending=commit?'COMMIT':'ROLLBACK';
 const samples=pgbench("BEGIN;\nSET LOCAL request.jwt.claim.role='service_role';\nSET LOCAL ROLE service_role;\nSELECT public.fixture_complete_scale_hand_v1('10000000-0000-4000-8000-000000000001',2000000001);\n"+ending+";\n");
 if(samples.length!==200||samples.some(n=>!Number.isFinite(n)))throw Error('Invalid pgbench fixture samples');
 return {p50Ms:samples[99],p95Ms:samples[189],maxMs:samples.at(-1),samples:samples.length,transaction:`BEGIN/source writer/${ending}; one transaction per sample`};
}
export function cleanupCommittedWriterFixture(){
 const scope="h.tournament_id='10000000-0000-4000-8000-000000000001' AND h.hand_number=2000000001";
 if(sql(`SELECT count(*) FROM public.tournament_hands h WHERE ${scope};`)!=='220')throw Error('Committed benchmark fixture count mismatch');
 sql(`BEGIN;DELETE FROM public.hand_actions a USING public.tournament_hands h WHERE a.hand_id=h.id AND ${scope};
 DELETE FROM public.hand_players p USING public.tournament_hands h WHERE p.hand_id=h.id AND ${scope};
 DELETE FROM public.tournament_hands h WHERE ${scope};COMMIT;`);
}
