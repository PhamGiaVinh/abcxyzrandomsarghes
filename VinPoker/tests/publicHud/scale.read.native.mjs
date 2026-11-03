import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {sql,jsonSql} from './nativeDb.mjs';
const tour='10000000-0000-4000-8000-000000000001',player='30000000-0000-4000-8000-000000000001';
const lines=sql(`BEGIN;
 CREATE TEMP TABLE hud_read_samples(ms numeric);GRANT INSERT ON hud_read_samples TO anon;
 SET LOCAL ROLE anon;
 DO $$ DECLARE started timestamptz; BEGIN FOR i IN 1..50 LOOP
  started:=clock_timestamp();PERFORM public.get_public_player_hud_summary_v1('${tour}','${player}');
  INSERT INTO hud_read_samples VALUES(extract(epoch FROM clock_timestamp()-started)*1000);
 END LOOP;END $$;
 RESET ROLE;
 SELECT jsonb_build_object('p50Ms',percentile_cont(.5) WITHIN GROUP(ORDER BY ms),'p95Ms',percentile_cont(.95) WITHIN GROUP(ORDER BY ms),'maxMs',max(ms)) FROM hud_read_samples;
 SELECT coalesce(jsonb_agg(jsonb_build_object('table',relname,'sequentialRows',seq_tup_read,'indexRows',idx_tup_fetch)),'[]')
  FROM pg_stat_xact_user_tables WHERE schemaname='public' AND relname IN ('tournament_hands','hand_players','hand_actions');
 ROLLBACK;`).split('\n').map(JSON.parse);
assert.equal(lines.length,2);
for(const row of lines[1]){assert.equal(row.sequentialRows,0);assert.equal(row.indexRows,0);}
const read=(time=null,hand=null)=>jsonSql(`SET ROLE anon;SELECT public.get_public_player_hud_history_v1('${tour}','${player}',${time?`'${time}'`:'NULL'},${hand?`'${hand}'`:'NULL'});`);
const first=read();assert.ok(first.handHistory.length<=50);
assert.equal(sql(`SELECT EXISTS(SELECT played_at FROM tracker_analytics_v1.hand_contributions WHERE player_id='${player}' AND tournament_id='${tour}' AND played_at IS NOT NULL GROUP BY played_at HAVING count(*)>1);`),'t');
if(first.nextCursor){
 const second=read(first.nextCursor.playedAt,first.nextCursor.handId);
 assert.equal(second.handHistory.some(h=>first.handHistory.some(old=>old.handId===h.handId)),false);
}
const nulls=read(null,'ffffffff-ffff-ffff-ffff-ffffffffffff');
assert.equal(nulls.handHistory.every(h=>h.playedAt===null&&h.endingStack===null),true);
const explain=jsonSql(`SET ROLE anon;EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) SELECT public.get_public_player_hud_summary_v1('${tour}','${player}');`);
const summary=jsonSql(`SET ROLE anon;SELECT public.get_public_player_hud_summary_v1('${tour}','${player}');`);
assert.equal(summary.state,'current');assert.equal(summary.coverageComplete,true);
const indexes=jsonSql(`SELECT jsonb_agg(jsonb_build_object('name',indexrelname,'bytes',pg_relation_size(indexrelid))) FROM pg_stat_user_indexes
 WHERE schemaname IN ('public','tracker_analytics_v1') AND relname IN ('tournament_hands','hand_players','hand_actions','hand_contributions','player_totals');`);
const report={kind:'NATIVE_SQL_NOT_HTTP_OR_WEBSOCKET_BENCHMARK',handsPerPlayer:summary.counters.publicHands,...lines[0],rawHistoryReads:lines[1],explain,indexes,
 databaseBytes:Number(sql('SELECT pg_database_size(current_database());')),historyChecks:['max-50','keyset-no-overlap','equal-timestamps','null-timestamp-cursor','unverified-stack-remains-unknown']};
if(process.env.PUBLIC_HUD_SCALE_READ_REPORT)writeFileSync(process.env.PUBLIC_HUD_SCALE_READ_REPORT,JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
