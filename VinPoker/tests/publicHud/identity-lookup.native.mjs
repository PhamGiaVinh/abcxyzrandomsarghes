import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {sql,jsonSql} from './nativeDb.mjs';

const started=Date.now();
const migration=readFileSync('supabase/migrations/20261104002800_public_hud_identity_ordered_lookup.sql','utf8');
const recovery=readFileSync('tests/publicHud/identity-lookup.forward-rollback.sql','utf8');
const withoutTransaction=s=>s.replace(/^BEGIN;\r?\n/m,'').replace(/COMMIT;\s*$/,'');
const metadata=()=>jsonSql(`SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_proc p
 WHERE p.oid IN ('tracker_analytics_v1.public_context(uuid,uuid)'::regprocedure,
 'public.get_public_player_hud_summary_v1(uuid,uuid,text)'::regprocedure);`);
const beforeMetadata=metadata();
// Scale seeding installs this index before measuring the incremental writer.
// Validate its exact recovery guard before temporarily removing it for parity.
if(sql("SELECT to_regclass('tracker_analytics_v1.hud_identity_latest') IS NULL;")!=='t')sql(recovery);
const scope=jsonSql(`SELECT jsonb_build_object('player',player_id,'tour',tournament_id,'hands',count(*))
 FROM tracker_analytics_v1.hand_contributions GROUP BY player_id,tournament_id ORDER BY count(*) DESC LIMIT 1;`);
const context=`tracker_analytics_v1.public_context('${scope.tour}','${scope.player}')`;
const summary=`public.get_public_player_hud_summary_v1('${scope.tour}','${scope.player}')`;
const noRanking=`UPDATE spectator_projection_v2.publications SET payload=jsonb_set(payload,'{items}','[]') WHERE tournament_id='${scope.tour}' AND component='ranking';`;
// accessSnapshot includes PostgreSQL transaction visibility, which necessarily
// changes between these separate transactions; compare all public data fields.
const before=jsonSql(`BEGIN;${noRanking} SET LOCAL ROLE anon;SELECT ${summary}-'accessSnapshot';ROLLBACK;`);
sql(migration);
sql(migration); // An exact already-built index is safe; catalog drift is not.
assert.deepEqual(metadata(),beforeMetadata);
assert.deepEqual(jsonSql(`BEGIN;${noRanking} SET LOCAL ROLE anon;SELECT ${summary}-'accessSnapshot';ROLLBACK;`),before);
const query=`SELECT jsonb_build_object('name',hp.player_name,'avatarUrl',hp.avatar_url)
 FROM tracker_analytics_v1.hand_contributions c JOIN public.hand_players hp ON hp.hand_id=c.hand_id AND hp.player_id=c.player_id
 WHERE c.player_id='${scope.player}' AND c.tournament_id='${scope.tour}'
 ORDER BY c.played_at DESC NULLS LAST,c.hand_id DESC LIMIT 1`;
const plan=jsonSql(`EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) ${query}`);
const nodes=n=>[n,...(n.Plans??[]).flatMap(nodes)];
const walked=nodes(plan[0].Plan);
// PostgreSQL can correctly prefer a tiny sequential scan in the 100-hand
// connection probe. Require the bounded plan on the 10k/100k/1M fixtures.
const boundedPlanAsserted=scope.hands>=100;
if(boundedPlanAsserted){
 assert(walked.some(n=>n['Index Name']==='hud_identity_latest'));
 assert(!walked.some(n=>n['Node Type']==='Sort'||n['Node Type']==='Seq Scan'));
 assert(walked.filter(n=>n['Relation Name']==='hand_players').every(n=>n['Actual Rows']<=1));
}
const fallbackReads=jsonSql(`BEGIN;${noRanking}
 CREATE TEMP TABLE identity_raw_before AS SELECT relid,seq_tup_read,idx_tup_fetch FROM pg_stat_xact_user_tables WHERE schemaname='public' AND relname IN ('tournament_hands','hand_players','hand_actions');
 SET LOCAL ROLE anon;DO $$ BEGIN FOR i IN 1..20 LOOP PERFORM ${summary};END LOOP;END $$;RESET ROLE;
 SELECT jsonb_agg(jsonb_build_object('table',s.relname,'sequentialRows',s.seq_tup_read-b.seq_tup_read,'indexRows',s.idx_tup_fetch-b.idx_tup_fetch)) FROM pg_stat_xact_user_tables s JOIN identity_raw_before b USING(relid);ROLLBACK;`);
if(boundedPlanAsserted){
 for(const r of fallbackReads){assert.equal(r.sequentialRows,0);assert(r.indexRows<=20*8,`${r.table} fallback must read bounded source rows`);}
}
// Force fallback for every source scope and compare before/after index removal.
// Also exercise equal/null timestamps and a second algorithm version without
// changing the existing cross-version policy or inventing zero-hand counters.
const equivalence=jsonSql(`BEGIN;UPDATE spectator_projection_v2.publications SET payload=jsonb_set(payload,'{items}','[]') WHERE component='ranking';
 UPDATE tracker_analytics_v1.hand_contributions SET played_at=CASE WHEN hand_number%3=0 THEN NULL ELSE '2030-01-01'::timestamptz END WHERE hand_number<=40;
 INSERT INTO tracker_analytics_v1.hand_contributions SELECT (jsonb_populate_record(NULL::tracker_analytics_v1.hand_contributions,to_jsonb(c)||jsonb_build_object('version','identity-test-other-version'))).* FROM tracker_analytics_v1.hand_contributions c WHERE hand_number<=40 AND hand_number%19=0;
 CREATE TEMP TABLE expected_identity AS SELECT player_id,tournament_id,tracker_analytics_v1.public_context(tournament_id,player_id) identity FROM (SELECT DISTINCT player_id,tournament_id FROM tracker_analytics_v1.hand_contributions) s;
 ${withoutTransaction(recovery)}
 SELECT jsonb_build_object('scopes',count(*),'mismatches',count(*) FILTER(WHERE identity IS DISTINCT FROM tracker_analytics_v1.public_context(tournament_id,player_id))) FROM expected_identity;ROLLBACK;`);
assert(equivalence.scopes>0);assert.equal(equivalence.mismatches,0);
assert.equal(sql(`BEGIN;UPDATE public.tournaments SET deleted_at=clock_timestamp() WHERE id='${scope.tour}';SELECT ${context} IS NULL;ROLLBACK;`),'t');
assert.equal(sql(`BEGIN;${withoutTransaction(recovery)} SELECT to_regclass('tracker_analytics_v1.hud_identity_latest') IS NULL;ROLLBACK;`),'t');
assert.throws(()=>sql(`BEGIN;DROP INDEX tracker_analytics_v1.hud_identity_latest;CREATE INDEX hud_identity_latest ON tracker_analytics_v1.hand_contributions(player_id);${withoutTransaction(migration)} ROLLBACK;`),/catalog drift/);
assert.deepEqual(metadata(),beforeMetadata);
const report={kind:'NATIVE_HUD_IDENTITY_ORDERED_FALLBACK',passed:true,nativeSetupAndParityMs:Date.now()-started,scopes:equivalence.scopes,scopeHands:scope.hands,boundedPlanAsserted,planMs:plan[0]['Execution Time'],plan,fallbackReads,fallbackSummaryCalls:20,indexBytes:Number(sql("SELECT pg_relation_size('tracker_analytics_v1.hud_identity_latest');")),checks:['anonymous-fallback-json','function-oid-acl-unchanged','null-and-equal-timestamps','cross-version-equivalence','deleted-tour-denied','exact-idempotency','drift-denied','index-only-recovery',...(boundedPlanAsserted?['ordered-single-row-source-lookup','bounded-anonymous-summary-raw-reads']:[])]};
if(process.env.PUBLIC_HUD_IDENTITY_PLAN_REPORT)writeFileSync(process.env.PUBLIC_HUD_IDENTITY_PLAN_REPORT,JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,plan:undefined}));
