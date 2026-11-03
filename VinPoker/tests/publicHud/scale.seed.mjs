import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync} from 'node:fs';
import {build} from 'esbuild';
import {tmpdir,cpus,totalmem} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {initialize,sql,jsonSql} from './nativeDb.mjs';
import {measureFixtureWriterTransactions,cleanupCommittedWriterFixture} from './scale.write.native.mjs';
import {nativeWorkerClient} from './nativeRpc.mjs';
const count=Number(process.env.PUBLIC_HUD_SCALE_HANDS??'10000');
if(![100,1000,10000,100000,1000000].includes(count))throw Error('Unsupported synthetic scale');
const temp=mkdtempSync(path.join(tmpdir(),'hud-scale-classifier-'));
await build({entryPoints:['supabase/functions/_shared/publicHudContribution.ts'],outfile:path.join(temp,'classifier.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'silent'});
const {classifyPublicHudHand}=await import(pathToFileURL(path.join(temp,'classifier.mjs')));
const players=['30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002'];
const hand={handId:'template',status:'completed',isVoided:false,buttonSeat:1,boardCardCount:0,settlement:null,
 players:players.map((player_id,i)=>({player_id,seat_number:i+1,starting_stack:1000})),
 actions:[['post_sb',50,0],['post_bb',100,1],['raise',250,0],['fold',0,1]].map(([action_type,action_amount,p],i)=>({player_id:players[p],street:'preflop',action_type,action_amount,action_order:i+1}))};
const template=classifyPublicHudHand(hand);
assert.equal(template.length,2);assert.equal(template[0].handsObserved,1);
const start=Date.now();
let baselineWriter;
initialize({seedHistoricalSource(){
 sql(readFileSync('tests/publicHud/spectator-generation.fixture.sql','utf8'));
 sql(readFileSync('tests/publicHud/scale-runtime.fixture.sql','utf8'));
 sql(readFileSync('tests/publicHud/scale.clock-readers.fixture.sql','utf8'));
 sql(`CREATE FUNCTION public.fixture_scale_uuid(prefix text,n bigint) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT (prefix||'-0000-4000-8000-'||lpad(to_hex(n),12,'0'))::uuid $$;
  INSERT INTO public.tournaments(id) SELECT public.fixture_scale_uuid('10000000',i) FROM generate_series(1,20) i;
  INSERT INTO public.table_sessions(id,tournament_id) SELECT public.fixture_scale_uuid('60000000',i),public.fixture_scale_uuid('10000000',i) FROM generate_series(1,20) i;
  INSERT INTO public.tournament_tables(id,tournament_id,table_session_id) SELECT public.fixture_scale_uuid('50000000',i),public.fixture_scale_uuid('10000000',i),public.fixture_scale_uuid('60000000',i) FROM generate_series(1,20) i;
  INSERT INTO public.tournament_levels(id,tournament_id) SELECT public.fixture_scale_uuid('70000000',i),public.fixture_scale_uuid('10000000',i) FROM generate_series(1,20) i;
  INSERT INTO public.tournament_entries(id,tournament_id,player_id) SELECT public.fixture_scale_uuid('80000000',i*2+k),public.fixture_scale_uuid('10000000',i),public.fixture_scale_uuid('30000000',k) FROM generate_series(1,20) i CROSS JOIN generate_series(1,2) k;
  INSERT INTO public.tournament_seats(id,tournament_id,player_id,entry_id,player_name) SELECT public.fixture_scale_uuid('90000000',i*2+k),public.fixture_scale_uuid('10000000',i),public.fixture_scale_uuid('30000000',k),public.fixture_scale_uuid('80000000',i*2+k),'SCALE TEST '||k FROM generate_series(1,20) i CROSS JOIN generate_series(1,2) k;
  INSERT INTO public.tournament_chip_counts(tournament_id,player_id) SELECT public.fixture_scale_uuid('10000000',i),public.fixture_scale_uuid('30000000',k) FROM generate_series(1,20) i CROSS JOIN generate_series(1,2) k;
  INSERT INTO public.game_tables(id,club_id) SELECT public.fixture_scale_uuid('a0000000',i),'40000000-0000-4000-8000-000000000001' FROM generate_series(1,20) i;
  UPDATE public.tournament_tables tt SET game_table_id=public.fixture_scale_uuid('a0000000',i) FROM generate_series(1,20) i WHERE tt.id=public.fixture_scale_uuid('50000000',i);
  UPDATE public.table_sessions ts SET game_table_id=tt.game_table_id,club_id='40000000-0000-4000-8000-000000000001' FROM public.tournament_tables tt WHERE tt.table_session_id=ts.id;
  UPDATE public.tournament_seats s SET tournament_table_id=tt.id,table_id=tt.id,table_session_id=tt.table_session_id,seat_number=CASE WHEN s.player_id=public.fixture_scale_uuid('30000000',1) THEN 1 ELSE 2 END FROM public.tournament_tables tt WHERE tt.tournament_id=s.tournament_id;
  UPDATE public.tournament_entries e SET seat_number=s.seat_number FROM public.tournament_seats s WHERE s.entry_id=e.id;
  UPDATE public.tournaments SET clock_started_at=clock_timestamp();
  INSERT INTO public.tournament_hands(id,tournament_id,tournament_table_id,table_session_id,hand_number,hand_time,created_at,tracker_small_blind,tracker_big_blind,tracker_level_number,tracker_bba,pot_size)
   SELECT public.fixture_scale_uuid('20000000',n),public.fixture_scale_uuid('10000000',1+(n-1)%20),public.fixture_scale_uuid('50000000',1+(n-1)%20),public.fixture_scale_uuid('60000000',1+(n-1)%20),n,
    CASE WHEN n%17=0 THEN NULL ELSE to_timestamp(1700000000+floor(n/60)) END,to_timestamp(1700000000+n),50,100,1,0,350 FROM generate_series(1,${count}) n;
  INSERT INTO public.hand_players(hand_id,tournament_id,player_id,seat_number,starting_stack,player_name)
   SELECT h.id,h.tournament_id,public.fixture_scale_uuid('30000000',k),k,1000,'SCALE TEST '||k FROM public.tournament_hands h CROSS JOIN generate_series(1,2) k;
  INSERT INTO public.hand_actions(hand_id,player_id,street,action_type,action_amount,action_order)
   SELECT h.id,public.fixture_scale_uuid('30000000',a.p),'preflop',a.kind,a.amount,a.ord FROM public.tournament_hands h
    CROSS JOIN (VALUES(1,'post_sb',50,1),(2,'post_bb',100,2),(1,'raise',250,3),(2,'fold',0,4)) a(p,kind,amount,ord);
  INSERT INTO spectator_projection_v2.entity_markers(tournament_id,component,entity_key)
   SELECT tournament_id,'tables',id::text FROM public.tournament_hands;
 `);
 // Install the existing source trigger paths only after historical fixture load.
 // Nothing disables RLS, changes BYPASSRLS or suppresses live trigger execution.
 const baseline=readFileSync('supabase/pending-migrations/20270115000000_public_spectator_realtime_v2.sql','utf8');
 const triggers=baseline.slice(baseline.indexOf('DROP TRIGGER IF EXISTS spectator_v2_tournaments_dirty'),baseline.indexOf('-- Bootstrap existing events'));
 sql(triggers);
 for(const [begin,end] of [['CREATE OR REPLACE FUNCTION public.claim_public_spectator_projection_v2','CREATE OR REPLACE FUNCTION public.get_public_spectator_projection_source_v2'],['CREATE OR REPLACE FUNCTION public.fail_public_spectator_projection_v2','CREATE OR REPLACE FUNCTION public.get_public_tournament_viewer_snapshot_v2']])sql(baseline.slice(baseline.indexOf(begin),baseline.indexOf(end)));
},afterSourceTriggers(){baselineWriter=measureFixtureWriterTransactions({commit:true});cleanupCommittedWriterFixture();}});
sql(readFileSync('supabase/migrations/20261104001900_public_spectator_compact_generations.sql','utf8'));
sql(readFileSync('supabase/migrations/20261104002100_public_current_hand_bounded.sql','utf8'));
console.log(JSON.stringify({phase:'source-ready',hands:count,elapsedMs:Date.now()-start}));
const vectors=template.map(c=>`('${c.playerId}'::uuid,ARRAY[${c.numerators}],ARRAY[${c.denominators}],ARRAY[${c.missingProof}])`).join(',');
sql(`CREATE TEMP TABLE fixture_counter_template(player_id uuid,n bigint[],d bigint[],m bigint[]);
 INSERT INTO fixture_counter_template VALUES ${vectors};
 INSERT INTO tracker_analytics_v1.hand_contributions(hand_id,player_id,tournament_id,version,source_fingerprint,settlement_evidence,
  source_revision,played_at,hand_number,table_id,session_id,numerators,denominators,missing_proof,public_hands,observed_hands,omitted_hands)
 SELECT h.id,c.player_id,h.tournament_id,'public-hud-projection-v1',tracker_analytics_v1.hand_fingerprint(h.id),
  '{"policyEligible":true,"latest":null,"publicVerified":null}',h.source_revision,h.hand_time,h.hand_number,h.tournament_table_id,h.table_session_id,c.n,c.d,c.m,1,1,0
 FROM public.tournament_hands h CROSS JOIN fixture_counter_template c;
 INSERT INTO tracker_analytics_v1.tournament_totals(tournament_id,player_id,version,included,numerators,denominators,missing_proof,public_hands,observed_hands,omitted_hands)
 SELECT h.tournament_id,c.player_id,'public-hud-projection-v1',true,
  ARRAY(SELECT v*h.n FROM unnest(c.n) v),ARRAY(SELECT v*h.n FROM unnest(c.d) v),ARRAY(SELECT v*h.n FROM unnest(c.m) v),h.n,h.n,0
 FROM (SELECT tournament_id,count(*) n FROM public.tournament_hands GROUP BY tournament_id) h CROSS JOIN fixture_counter_template c;
 INSERT INTO tracker_analytics_v1.player_totals(player_id,version,numerators,denominators,missing_proof,public_hands,observed_hands,omitted_hands)
 SELECT player_id,'public-hud-projection-v1',ARRAY(SELECT v*${count} FROM unnest(n) v),ARRAY(SELECT v*${count} FROM unnest(d) v),ARRAY(SELECT v*${count} FROM unnest(m) v),${count},${count},0 FROM fixture_counter_template;
 INSERT INTO spectator_projection_v2.publications(tournament_id,component,source_vector,payload)
 SELECT t.id,'ranking','{}',jsonb_build_object('items',(SELECT jsonb_agg(jsonb_build_object('playerId',c.player_id,'name',s.player_name,'avatarUrl',NULL,'chips',c.chip_count))
  FROM public.tournament_chip_counts c JOIN public.tournament_seats s ON s.tournament_id=c.tournament_id AND s.player_id=c.player_id WHERE c.tournament_id=t.id),'bigBlind',100) FROM public.tournaments t;
 ANALYZE public.tournament_hands;ANALYZE public.hand_players;ANALYZE public.hand_actions;ANALYZE tracker_analytics_v1.hand_contributions;ANALYZE tracker_analytics_v1.player_totals;
`);
const incrementalWriter=measureFixtureWriterTransactions({commit:true});cleanupCommittedWriterFixture();
await build({entryPoints:['supabase/functions/public-hud-projector-v1/worker.ts'],outfile:path.join(temp,'worker.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'silent'});
const {processPublicHudJobs}=await import(pathToFileURL(path.join(temp,'worker.mjs')));
for(let i=0;i<20&&Number(sql('SELECT count(*) FROM tracker_analytics_v1.jobs;'))>0;i++){
 const result=await processPublicHudJobs(nativeWorkerClient,80,Date.now()+10000);assert.equal(result.failed,0);
}
assert.equal(sql('SELECT count(*) FROM tracker_analytics_v1.jobs;'),'0');
assert.equal(Number(sql('SELECT count(*) FROM public.tournament_hands;')),count);
for(const row of template){
 const total=jsonSql(`SELECT to_jsonb(t) FROM tracker_analytics_v1.player_totals t WHERE player_id='${row.playerId}';`);
 assert.equal(total.public_hands,count);assert.equal(total.observed_hands,count);
 for(const [field,key] of [['numerators','numerators'],['denominators','denominators'],['missing_proof','missingProof']])assert.deepEqual(total[field],row[key].map(v=>v*count));
}
sql("UPDATE tracker_analytics_v1.config SET backfill_started_at=clock_timestamp(),backfill_complete=true,hands_done=true,results_done=true,enabled=true,worker_enabled=true WHERE singleton;");
const report={kind:'SYNTHETIC_PREBUILT_READ_FIXTURE_NOT_MILLION_HAND_BACKFILL_PROOF',handsPerPlayer:count,players:2,tournaments:20,
 seedMs:Date.now()-start,node:process.version,platform:process.platform,cpus:cpus().length,memoryBytes:totalmem(),postgres:sql('SHOW server_version;'),
 databaseBytes:Number(sql('SELECT pg_database_size(current_database());')),sourceHands:Number(sql('SELECT count(*) FROM public.tournament_hands;')),
 writer:{kind:'NATIVE_FIXTURE_SOURCE_TRANSACTION_NOT_FLOOR_AUTH_E2E',baseline:baselineWriter,incremental:incrementalWriter,p95OverheadPercent:(incrementalWriter.p95Ms/baselineWriter.p95Ms-1)*100}};
if(process.env.PUBLIC_HUD_SCALE_SEED_REPORT)writeFileSync(process.env.PUBLIC_HUD_SCALE_SEED_REPORT,JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
