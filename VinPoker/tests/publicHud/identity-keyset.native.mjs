import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {sql,jsonSql} from './nativeDb.mjs';
const started=Date.now();
const signature='tracker_analytics_v1.public_context(uuid,uuid)';
const migration=readFileSync('supabase/migrations/20261104003000_public_hud_identity_membership_keyset.sql','utf8');
const recovery=readFileSync('tests/publicHud/identity-keyset.forward-rollback.sql','utf8');
const body=s=>s.replace(/^BEGIN;\r?\n/m,'').replace(/COMMIT;\s*$/,'');
const hash=()=>sql(`SELECT md5(replace(pg_get_functiondef('${signature}'::regprocedure),chr(13),''));`);
const previous='d72e037647d90f1470ae73c47ac4f8ad';
if(hash()!==previous)sql(recovery);
assert.equal(hash(),previous);
const metadata=()=>jsonSql(`SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid='${signature}'::regprocedure;`);
const before=metadata(),noRanking="UPDATE spectator_projection_v2.publications SET payload=jsonb_set(payload,'{items}','[]') WHERE component='ranking';";
const parity=jsonSql(`BEGIN;${noRanking}CREATE TEMP TABLE expected_context AS SELECT player_id,tournament_id,tracker_analytics_v1.public_context(tournament_id,player_id) identity FROM (SELECT DISTINCT player_id,tournament_id FROM tracker_analytics_v1.hand_contributions) s;${body(migration)}SELECT jsonb_build_object('scopes',count(*),'mismatches',count(*) FILTER(WHERE identity IS DISTINCT FROM tracker_analytics_v1.public_context(tournament_id,player_id))) FROM expected_context;ROLLBACK;`);
assert(parity.scopes>0);assert.equal(parity.mismatches,0);
const tour='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',fake='f3333333-0000-4000-8000-000000000002';
const valid=sql(`SELECT id FROM public.tournament_hands WHERE tournament_id='${tour}' ORDER BY id DESC LIMIT 1;`);
const invalid=sql(`SELECT id FROM public.tournament_hands WHERE tournament_id='${other}' ORDER BY id LIMIT 1;`);
const insert=(hand,entry)=>`INSERT INTO public.hand_players(hand_id,tournament_id,player_id,entry_number,seat_number,starting_stack) VALUES(${hand?`'${hand}'`:'NULL'},'${tour}','${fake}',${entry},9,1000);`;
for(const [name,changes,allowed] of [
 ['invalid-prefix-then-valid',insert(invalid,1)+insert(invalid,2)+insert(valid,1)+insert(null,1),true],
 ['invalid-and-null-only',insert(invalid,1)+insert(invalid,2)+insert(null,1),false],
 ['null-only',insert(null,1),false],
]){
 const context=`tracker_analytics_v1.public_context('${tour}','${fake}')`;
 const result=jsonSql(`BEGIN;${noRanking}${changes}CREATE TEMP TABLE expected_context AS SELECT ${context} identity;${body(migration)}SELECT jsonb_build_object('expected',identity,'actual',${context}) FROM expected_context;ROLLBACK;`);
 assert.deepEqual(result.actual,result.expected,name);assert.equal(result.actual!==null,allowed,name);
}
sql(migration);assert.deepEqual(metadata(),before);
// Reproduce the CI source layout (players physically grouped), not just the
// interleaved local seed. CLUSTER and every source-layout change roll back.
const large=Number(sql('SELECT count(*) FROM public.tournament_hands;'))>=10000;
const layoutStarted=Date.now();
const reads=jsonSql(`BEGIN;CLUSTER public.hand_players USING idx_hud_player_tournament_hand;ANALYZE public.hand_players;${noRanking}
 CREATE TEMP TABLE raw_before AS SELECT relid,seq_tup_read,idx_tup_fetch FROM pg_stat_xact_user_tables WHERE schemaname='public' AND relname IN('tournament_hands','hand_players','hand_actions');
 SET LOCAL ROLE anon;DO $$ BEGIN FOR i IN 1..20 LOOP PERFORM public.get_public_player_hud_summary_v1('10000000-0000-4000-8000-000000000012','30000000-0000-4000-8000-000000000002');END LOOP;END $$;RESET ROLE;
 SELECT jsonb_agg(jsonb_build_object('table',s.relname,'sequentialRows',s.seq_tup_read-b.seq_tup_read,'indexRows',s.idx_tup_fetch-b.idx_tup_fetch)) FROM pg_stat_xact_user_tables s JOIN raw_before b USING(relid);ROLLBACK;`);
const isolatedPhysicalLayoutMs=Date.now()-layoutStarted;
if(large)for(const r of reads){assert.equal(r.sequentialRows,0,JSON.stringify(reads));assert(r.indexRows<=20*8,JSON.stringify(reads));}
const replacement=hash();
assert.throws(()=>sql(migration),/preimage differs/);
assert.equal(sql(`BEGIN;${body(recovery)}SELECT md5(replace(pg_get_functiondef('${signature}'::regprocedure),chr(13),''));ROLLBACK;`),previous);
assert.deepEqual(metadata(),before);
const report={kind:'NATIVE_HUD_KEYSET_MEMBERSHIP_PARITY_AND_PHYSICAL_LAYOUT',passed:true,nativeSetupAndParityMs:Date.now()-started,isolatedPhysicalLayoutMs,scopes:parity.scopes,boundedPhysicalLayoutAsserted:large,sourceReads:reads,summaryCalls:20,replacementHash:replacement,metadataUnchanged:true,recoveryExact:true,cases:['source-scope-parity','invalid-prefix-skipped','duplicate-entry-parent-check','null-hand-denied','invalid-only-denied','physically-grouped-participants']};
if(process.env.PUBLIC_HUD_IDENTITY_KEYSET_REPORT)writeFileSync(process.env.PUBLIC_HUD_IDENTITY_KEYSET_REPORT,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
