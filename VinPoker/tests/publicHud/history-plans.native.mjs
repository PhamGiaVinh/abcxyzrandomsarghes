import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {sql,jsonSql} from './nativeDb.mjs';
const signature='public.get_public_player_hud_history_v1(uuid,uuid,timestamptz,uuid)';
const migration=readFileSync('supabase/migrations/20261104002400_public_hud_history_ordered_page.sql','utf8');
const source=readFileSync('supabase/migrations/20261104001800_public_hud_read_contract.sql','utf8');
const original=source.slice(source.indexOf('CREATE FUNCTION public.get_public_player_hud_history_v1'),source.indexOf('REVOKE ALL ON ALL FUNCTIONS')).replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION');
const replacement=migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION'),migration.lastIndexOf('COMMIT;'));
const tour='10000000-0000-4000-8000-000000000001',player='30000000-0000-4000-8000-000000000001';
const meta=()=>jsonSql(`SELECT jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'config',proconfig,'definer',prosecdef,'volatile',provolatile) FROM pg_proc WHERE oid='${signature}'::regprocedure;`);
assert.equal(sql(`SELECT md5(pg_get_functiondef('${signature}'::regprocedure));`),'aacf00bc05c190a39e44c4078e2252dd');
const metadata=meta();
const call=(cursor=null)=>`public.get_public_player_hud_history_v1('${tour}','${player}',${cursor?.playedAt?`'${cursor.playedAt}'`:'NULL'},${cursor?`'${cursor.handId}'`:'NULL'})`;
const page=jsonSql(`SET ROLE anon;SELECT ${call()};`);assert.ok(page.handHistory.length>0);
const largeFixture=Number(sql('SELECT count(*) FROM public.tournament_hands;'))>=10000;
if(largeFixture)assert.ok(page.nextCursor,'Large fixture must exercise a real second page');
const hand=page.handHistory[0].handId;
const cases=[['first',''],['next','',page.nextCursor],['null','',{playedAt:null,handId:'ffffffff-ffff-ffff-ffff-ffffffffffff'}],
 ['void',`UPDATE public.tournament_hands SET is_voided=true WHERE id='${hand}';`],
 ['incomplete',`UPDATE public.tournament_hands SET status='in_progress' WHERE id='${hand}';`],
 ['missing-participant',`DELETE FROM public.hand_players WHERE hand_id='${hand}' AND player_id='${player}';`],
 ['invalid-prefix',`UPDATE public.tournament_hands SET is_voided=true WHERE id IN (SELECT hand_id FROM tracker_analytics_v1.hand_contributions WHERE player_id='${player}' AND tournament_id='${tour}' ORDER BY played_at DESC NULLS LAST,hand_id DESC LIMIT 100);`],
 ['all-invalid',`UPDATE public.tournament_hands SET is_voided=true WHERE tournament_id='${tour}';`],
 ['withdrawn',`UPDATE public.tournaments SET deleted_at=now() WHERE id='${tour}';`]];
for(const [name,change,cursor] of cases){
 const result=jsonSql(`BEGIN;${change}
 CREATE TEMP TABLE history_expected(payload jsonb);GRANT SELECT,INSERT ON history_expected TO anon;
 SET LOCAL ROLE anon;INSERT INTO history_expected SELECT ${call(cursor)};RESET ROLE;
 ${replacement}
 SET LOCAL ROLE anon;SELECT to_jsonb((SELECT payload FROM history_expected)=${call(cursor)});ROLLBACK;`);
 assert.equal(result,true,name+' changed public history');
}
sql(migration);assert.deepEqual(meta(),metadata);
assert.equal(sql(`BEGIN;${original}SELECT md5(pg_get_functiondef('${signature}'::regprocedure));ROLLBACK;`),'aacf00bc05c190a39e44c4078e2252dd','exact prior function recovery');
assert.throws(()=>sql(migration),/preimage differs/,'duplicate migration must stop');
const lines=sql(`BEGIN;CREATE TEMP TABLE history_samples(ms numeric);GRANT INSERT ON history_samples TO anon;
 SET LOCAL ROLE anon;DO $$ DECLARE started timestamptz;BEGIN FOR i IN 1..50 LOOP
 started:=clock_timestamp();PERFORM ${call()};INSERT INTO history_samples VALUES(extract(epoch FROM clock_timestamp()-started)*1000);
 END LOOP;END $$;RESET ROLE;
 SELECT jsonb_build_object('samples',count(*),'p95Ms',percentile_cont(.95) WITHIN GROUP(ORDER BY ms)) FROM history_samples;
 SELECT jsonb_agg(jsonb_build_object('table',relname,'indexRows',idx_tup_fetch,'sequentialRows',seq_tup_read))
 FROM pg_stat_xact_user_tables WHERE schemaname='public' AND relname IN ('tournament_hands','hand_players');ROLLBACK;`).split('\n').map(JSON.parse);
if(largeFixture)for(const row of lines[1]){assert.equal(row.sequentialRows,0);assert.ok(row.indexRows<=50*51*3,`${row.table} scanned beyond the page`);}
const report={kind:'NATIVE_HISTORY_ORDERED_PAGE_NOT_HTTP_CAPACITY',...lines[0],largeFixtureSourceBoundChecked:largeFixture,sourceReads:lines[1],checks:cases.map(c=>c[0]),metadataUnchanged:true,limits:['Invalid contribution prefixes still require source gates per candidate; returned page size does not bound invalid candidates']};
if(process.env.PUBLIC_HUD_HISTORY_PLAN_REPORT)writeFileSync(process.env.PUBLIC_HUD_HISTORY_PLAN_REPORT,JSON.stringify(report,null,2));
console.log(JSON.stringify(report));

