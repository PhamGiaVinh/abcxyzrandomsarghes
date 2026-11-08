import assert from 'node:assert/strict';
import {sql,jsonSql} from './nativeDb.mjs';
import {loadClassifier,createShadow,shadowSql} from '../../scripts/ops/tracker-hud-shadow.mjs';
// Only the owned tiny native fixture: never corrupt a source/load/production DB.
assert.match(process.env.PUBLIC_HUD_LOCAL_DATABASE??'',/^vinpoker_hud_test_(ci|shadow_[a-z0-9_]+)$/);
assert.ok(Number(sql('SELECT count(*) FROM public.tournament_hands;'))<=1000);
const classifier=await loadClassifier();
const read=()=>{const s=createShadow(classifier);sql(shadowSql).split('\n').filter(Boolean).forEach(line=>s.accept(JSON.parse(line)));return s.finish();};
const fingerprint=()=>sql(`SELECT md5(jsonb_build_object(
 'hands',(SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM public.tournament_hands h),
 'contributions',(SELECT jsonb_agg(to_jsonb(c) ORDER BY hand_id,player_id,version) FROM tracker_analytics_v1.hand_contributions c),
 'players',(SELECT jsonb_agg(to_jsonb(p) ORDER BY player_id,version) FROM tracker_analytics_v1.player_totals p),
 'tours',(SELECT jsonb_agg(to_jsonb(t) ORDER BY tournament_id,player_id,version) FROM tracker_analytics_v1.tournament_totals t),
 'results',(SELECT jsonb_agg(to_jsonb(r) ORDER BY result_id,version) FROM tracker_analytics_v1.result_contributions r))::text);`);
const before=fingerprint(),original=read();assert.equal(original.passed,true);assert.ok(original.sourceHands>0);assert.equal(fingerprint(),before);
const row=jsonSql('SELECT to_jsonb(c) FROM tracker_analytics_v1.hand_contributions c ORDER BY hand_id,player_id LIMIT 1;');
for(const id of [row.hand_id,row.player_id,row.tournament_id])assert.match(id,/^[0-9a-f-]{36}$/);
const amend=direction=>sql(`BEGIN;
 UPDATE tracker_analytics_v1.hand_contributions SET numerators[1]=numerators[1]+${direction} WHERE hand_id='${row.hand_id}' AND player_id='${row.player_id}';
 UPDATE tracker_analytics_v1.tournament_totals SET numerators[1]=numerators[1]+${direction} WHERE tournament_id='${row.tournament_id}' AND player_id='${row.player_id}';
 UPDATE tracker_analytics_v1.player_totals SET numerators[1]=numerators[1]+${direction} WHERE player_id='${row.player_id}';COMMIT;`);
amend(1);
try{const corrupt=read();assert.equal(corrupt.complete,true);assert.equal(corrupt.passed,false);
 for(const code of ['hand_counters','tour_counters','player_counters'])assert.ok(corrupt.examples.some(e=>e.code===code));
}finally{amend(-1);}
assert.equal(fingerprint(),before);assert.equal(read().passed,true);
sql(`UPDATE tracker_analytics_v1.hand_contributions SET hand_number=hand_number+1 WHERE hand_id='${row.hand_id}' AND player_id='${row.player_id}';`);
try{const stale=read();assert.equal(stale.passed,false);assert.ok(stale.examples.some(e=>e.code==='hand_history_metadata'));}
finally{sql(`UPDATE tracker_analytics_v1.hand_contributions SET hand_number=hand_number-1 WHERE hand_id='${row.hand_id}' AND player_id='${row.player_id}';`);}
assert.equal(fingerprint(),before);assert.equal(read().passed,true);
const result=jsonSql('SELECT to_jsonb(r) FROM tracker_analytics_v1.result_contributions r ORDER BY result_id LIMIT 1;');
assert.match(result.result_id,/^[0-9a-f-]{36}$/);assert.ok(result.position===null||Number.isSafeInteger(result.position));
sql(`UPDATE tracker_analytics_v1.result_contributions SET position=coalesce(position,0)+1 WHERE result_id='${result.result_id}';`);
try{const stale=read();assert.equal(stale.passed,false);assert.ok(stale.examples.some(e=>e.code==='result_contribution'));}
finally{sql(`UPDATE tracker_analytics_v1.result_contributions SET position=${result.position===null?'NULL':result.position} WHERE result_id='${result.result_id}';`);}
assert.equal(fingerprint(),before);assert.equal(read().passed,true);
console.log(JSON.stringify({kind:'REAL_POSTGRESQL_READ_ONLY_SHADOW_WITH_RESTORED_SYNTHETIC_CORRUPTION',passed:true,sourceHands:original.sourceHands,contributions:original.contributions,
 checks:['repeatable-read-read-only','canonical-raw-classifiers','all-hand-contributions','tour-and-player-totals','verified-winnings','equal-corruption-detected','source-and-derived-fingerprint-restored']}));
