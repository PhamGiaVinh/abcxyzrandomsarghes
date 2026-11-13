// Transactional disposable-fixture experiment. Never an apply/release runner.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {sql} from './nativeDb.mjs';
const jsonSql=query=>{
 try{return JSON.parse(sql('\\set VERBOSITY sqlstate\n'+query,{captureFailure:true}));}
 catch(reason){const state=/ERROR:\s+([0-9A-Z]{5})\b/.exec(String(reason?.stderr??''))?.[1]??'UNKNOWN';
  throw Error('History scope experiment failed (SQLSTATE '+state+'); raw SQL diagnostics withheld');}
};
assert.equal(process.env.PUBLIC_HUD_LOCAL_DATABASE,'vinpoker_hud_test_history_plans_ci');
assert.equal(process.env.PUBLIC_HUD_LOCAL_PORT,'5432');
assert.equal(sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'vinpoker-hud-history-profile-isolated-ci');
const signature='public.get_public_player_hud_history_v1(uuid,uuid,timestamptz,uuid)';
const original=sql(`SELECT replace(pg_get_functiondef('${signature}'::regprocedure),chr(13),'');`);
assert.equal(sql(`SELECT md5(replace(pg_get_functiondef('${signature}'::regprocedure),chr(13),''));`),'4f8894bc8dd9114663ace03f9b3225e3');
const marker='WITH page AS MATERIALIZED (';
const join='FROM public.tournament_hands h JOIN public.tournaments t ON t.id=h.tournament_id';
assert.equal(original.split(marker).length,2);assert.equal(original.split(join).length,2);
const candidate=original.replace(marker,`WITH tournament_scope AS MATERIALIZED (
    SELECT id,status,deleted_at FROM public.tournaments WHERE id=p_tournament_id
  ), page AS MATERIALIZED (`).replace(join,'FROM public.tournament_hands h JOIN tournament_scope t ON t.id=h.tournament_id');
const tour='10000000-0000-4000-8000-000000000001',player='30000000-0000-4000-8000-000000000001';
const quote=value=>value===null?'NULL':"'"+String(value).replaceAll("'","''")+"'";
const call=(cursor=null,scope=tour)=>`public.get_public_player_hud_history_v1('${scope}','${player}',${quote(cursor?.playedAt??null)},${quote(cursor?.handId??null)})`;
const page=jsonSql(`SET ROLE anon;SELECT ${call()};`);assert.equal(page.handHistory.length,50);assert.ok(page.nextCursor);
const hand=page.handHistory[0].handId;
const otherTour='10000000-0000-4000-8000-000000000002';
assert.equal(sql(`SELECT count(*) FROM public.tournaments WHERE id='${otherTour}';`),'1');
const cases=[['first','',null],['next','',page.nextCursor],['null-cursor','',{playedAt:null,handId:'ffffffff-ffff-ffff-ffff-ffffffffffff'}],
 ['hard-block',`SELECT tracker_analytics_v1.enqueue('hand','${hand}');UPDATE tracker_analytics_v1.job_players SET hard_block=true WHERE kind='hand' AND entity_id='${hand}' AND player_id='${player}';`],
 ['wrong-contribution-tour',`UPDATE tracker_analytics_v1.hand_contributions SET tournament_id='${otherTour}' WHERE hand_id='${hand}' AND player_id='${player}';`],
 ['wrong-source-tour',`UPDATE tracker_analytics_v1.hand_contributions SET tournament_id='${otherTour}' WHERE hand_id='${hand}' AND player_id='${player}';`,null,otherTour],
 ['withdrawn',`UPDATE public.tournaments SET deleted_at=clock_timestamp() WHERE id='${tour}';`],
 ['void',`UPDATE public.tournament_hands SET is_voided=true WHERE id='${hand}';`],
 ['incomplete',`UPDATE public.tournament_hands SET status='in_progress' WHERE id='${hand}';`],
 ['missing-participant',`DELETE FROM public.hand_players WHERE hand_id='${hand}' AND player_id='${player}';`],
 ['invalid-prefix',`UPDATE public.tournament_hands SET is_voided=true WHERE id IN (SELECT hand_id FROM tracker_analytics_v1.hand_contributions WHERE tournament_id='${tour}' AND player_id='${player}' ORDER BY played_at DESC NULLS LAST,hand_id DESC LIMIT 100);`],
 ['null-timestamp',`UPDATE tracker_analytics_v1.hand_contributions SET played_at=NULL WHERE hand_id='${hand}';`],
 ['tied-timestamps',`UPDATE tracker_analytics_v1.hand_contributions SET played_at='2030-01-01T00:00:00Z' WHERE tournament_id='${tour}' AND hand_id IN (SELECT hand_id FROM tracker_analytics_v1.hand_contributions WHERE tournament_id='${tour}' AND player_id='${player}' ORDER BY played_at DESC NULLS LAST,hand_id DESC LIMIT 3);`],
 ['absent-tour','',null,'10000000-0000-4000-8000-ffffffffffff']];
for(const kind of ['verified','malformed-pots','wrong-revision','duplicate-participant','status-change']){
 const proof={schemaVersion:'settlement-outcome-v1',status:'verified',pots:kind==='malformed-pots'?[{winnerIds:'bad'}]:[],handRanks:[],
  players:[{playerId:player,startingStack:1000,endingStack:1200,netDelta:200,externalDelta:0}]};
 const change=`UPDATE public.hand_players SET starting_stack=1000 WHERE hand_id='${hand}' AND player_id='${player}';
 ${kind==='duplicate-participant'?`INSERT INTO public.hand_players(hand_id,tournament_id,player_id,entry_number,starting_stack) VALUES('${hand}','${tour}','${player}',2,1000);`:''}
 ${kind==='status-change'?`UPDATE public.tournaments SET status='draft' WHERE id='${tour}';`:''}
 DELETE FROM public.tournament_settlement_outcomes WHERE hand_id='${hand}';
 INSERT INTO public.tournament_settlement_outcomes(hand_id,source_revision,settlement_revision,status,public_outcome)
 SELECT id,source_revision${kind==='wrong-revision'?'-1':''},999,'verified',${quote(JSON.stringify(proof))}::jsonb FROM public.tournament_hands WHERE id='${hand}';
 DELETE FROM tracker_analytics_v1.job_players WHERE kind='hand' AND entity_id='${hand}';`;
 cases.push([kind,change]);
}
const timings=[];
for(const [name,change,cursor,scope] of cases){
 const excluded=['hard-block','wrong-contribution-tour','wrong-source-tour','void','incomplete','missing-participant','invalid-prefix'].includes(name);
 const unknown=['malformed-pots','wrong-revision','duplicate-participant','status-change'].includes(name);
 const measured=['first','next','verified','invalid-prefix'].includes(name);
 const measure=label=>!measured?'':`DO $measure$ DECLARE started timestamptz;BEGIN FOR i IN 1..30 LOOP
 started:=clock_timestamp();PERFORM ${call(cursor,scope)};
 INSERT INTO scope_timing VALUES('${label}',extract(epoch FROM clock_timestamp()-started)*1000);
 END LOOP;END $measure$;`;
 const result=jsonSql(`BEGIN;SET LOCAL statement_timeout='15s';${change}
 CREATE TEMP TABLE scope_expected(payload jsonb);GRANT SELECT,INSERT ON scope_expected TO anon;
 CREATE TEMP TABLE scope_timing(variant text,ms numeric);GRANT SELECT,INSERT ON scope_timing TO anon;
 SET LOCAL ROLE anon;INSERT INTO scope_expected SELECT ${call(cursor,scope)};RESET ROLE;
 SET LOCAL ROLE anon;${measure('baseline-before')}RESET ROLE;
 ${candidate};
 SET LOCAL ROLE anon;${measure('candidate')}
 SELECT jsonb_build_object('equal',(SELECT payload FROM scope_expected) IS NOT DISTINCT FROM ${call(cursor,scope)},
 'verifiedExpected',CASE WHEN '${name}'='verified' THEN EXISTS(SELECT 1 FROM scope_expected e CROSS JOIN LATERAL jsonb_array_elements(e.payload->'handHistory') row WHERE row->>'handId'='${hand}' AND row->'endingStack'='1200'::jsonb) ELSE true END,
 'boundaryExpected',${excluded?`NOT EXISTS(SELECT 1 FROM scope_expected e CROSS JOIN LATERAL jsonb_array_elements(e.payload->'handHistory') row WHERE row->>'handId'='${hand}')`:unknown?`EXISTS(SELECT 1 FROM scope_expected e CROSS JOIN LATERAL jsonb_array_elements(e.payload->'handHistory') row WHERE row->>'handId'='${hand}' AND row->'endingStack'='null'::jsonb AND row->'netDelta'='null'::jsonb)`:'true'},
 'timings',(SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') FROM scope_timing t));ROLLBACK;`);
 assert.equal(result.equal,true,'History scope parity: '+name);assert.equal(result.verifiedExpected,true,'Verified fixture must exercise known stack');
 assert.equal(result.boundaryExpected,true,'History scope boundary: '+name);
 if(measured)timings.push({case:name,samples:result.timings});
}
assert.equal(sql(`SELECT md5(replace(pg_get_functiondef('${signature}'::regprocedure),chr(13),''));`),'4f8894bc8dd9114663ace03f9b3225e3');
writeFileSync('output/hud-scale/history-scope-experiment.json',JSON.stringify({kind:'TRANSACTIONAL_HISTORY_SCOPE_EXPERIMENT_NOT_CAPACITY',
 qualification:false,productionChanged:false,baselineHash:'4f8894bc8dd9114663ace03f9b3225e3',checks:cases.map(row=>row[0]),timings,
 scope:'Only fixture transactions replace the function; each transaction rolls back. Native AB timing includes first executions, is order-sensitive, and is not HTTP capacity or a qualification.'},null,2));
