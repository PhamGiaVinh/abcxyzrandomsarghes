import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {sql,jsonSql} from './nativeDb.mjs';
const prior=readFileSync('supabase/migrations/20261104002400_public_hud_history_ordered_page.sql','utf8');
const baseline=prior.slice(prior.indexOf('CREATE OR REPLACE FUNCTION'),prior.lastIndexOf('COMMIT;'));
const migration=readFileSync('supabase/migrations/20261105072714_public_hud_history_amounts_materialized.sql','utf8');
const body=migration.replace(/^([\s\S]*?)BEGIN;/,'').replace(/COMMIT;\s*$/,'');
const tour='10000000-0000-4000-8000-000000000001',player='30000000-0000-4000-8000-000000000001';
const signature='public.get_public_player_hud_history_v1(uuid,uuid,timestamptz,uuid)';
const call=cursor=>`public.get_public_player_hud_history_v1('${tour}','${player}',${cursor?.playedAt?`'${cursor.playedAt}'`:'NULL'},${cursor?`'${cursor.handId}'`:'NULL'})`;
const page=jsonSql(`BEGIN;${baseline}SELECT ${call()};ROLLBACK;`);
assert.ok(page.handHistory.length>0);const hand=page.handHistory[0].handId;
const cases=[['first',''],['next','',page.nextCursor],['null-time','',{playedAt:null,handId:'ffffffff-ffff-ffff-ffff-ffffffffffff'}],
 ['void',`UPDATE public.tournament_hands SET is_voided=true WHERE id='${hand}';`],
 ['incomplete',`UPDATE public.tournament_hands SET status='in_progress' WHERE id='${hand}';`],
 ['missing-participant',`DELETE FROM public.hand_players WHERE hand_id='${hand}' AND player_id='${player}';`],
 ['withdrawn',`UPDATE public.tournaments SET deleted_at=now() WHERE id='${tour}';`],
 ['warming',`UPDATE tracker_analytics_v1.config SET backfill_complete=false WHERE singleton;`]];
// These transaction-local fixtures model a completed projection after proof changes.
const proofCases=[['verified-win',1000,1200,200,0,1200,200],['verified-loss',1000,800,-200,0,800,-200],['verified-flat',1000,1000,0,0,1000,0],['bad-conservation',1000,1200,100,0,null,null],['fractional-ending',1000,1200.5,200.5,0,null,null],['string-amount',1000,'1200',200,0,null,null]];
for(const [name,start,end,delta,external]of proofCases){
 const proof={schemaVersion:'settlement-outcome-v1',status:'verified',pots:[],handRanks:[],players:[{playerId:player,startingStack:start,endingStack:end,netDelta:delta,externalDelta:external}]};
 cases.push([name,`UPDATE public.hand_players SET starting_stack=1000 WHERE hand_id='${hand}' AND player_id='${player}';
 DELETE FROM public.tournament_settlement_outcomes WHERE hand_id='${hand}';
 INSERT INTO public.tournament_settlement_outcomes(hand_id,source_revision,settlement_revision,status,public_outcome)
 SELECT id,source_revision,999,'verified','${JSON.stringify(proof)}'::jsonb FROM public.tournament_hands WHERE id='${hand}';
 DELETE FROM tracker_analytics_v1.job_players WHERE kind='hand' AND entity_id='${hand}';`]);
}
for(const [name,change,cursor]of cases){
 if(name.startsWith('verified-')||proofCases.some(c=>c[0]===name)){
 const evidence=jsonSql(`BEGIN;${baseline}${change} SELECT ${call(cursor)};ROLLBACK;`);
 const row=evidence.handHistory.find(r=>r.handId===hand);assert.ok(row,name+' must expose fixture row');
 const expected=proofCases.find(c=>c[0]===name);assert.equal(row.endingStack,expected[5],name+' stack');assert.equal(row.netDelta,expected[6],name+' delta');
 }
 const equal=jsonSql(`BEGIN;${baseline}${change}
 CREATE TEMP TABLE history_expected(payload jsonb);GRANT INSERT,SELECT ON history_expected TO anon;
 SET LOCAL ROLE anon;INSERT INTO history_expected SELECT ${call(cursor)};RESET ROLE;
 ${body} SET LOCAL ROLE anon;SELECT to_jsonb((SELECT payload FROM history_expected)=${call(cursor)});ROLLBACK;`);
 assert.equal(equal,true,name);
}
const meta=`SELECT jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'config',proconfig,'definer',prosecdef,'volatile',provolatile) FROM pg_proc WHERE oid='${signature}'::regprocedure`;
const rollback=readFileSync('tests/publicHud/history-amounts.rollback.sql','utf8').replace(/^([\s\S]*?)BEGIN;/,'').replace(/COMMIT;\s*$/,'');
assert.equal(sql(`BEGIN;${baseline}${body}${rollback}SELECT md5(replace(pg_get_functiondef('${signature}'::regprocedure),chr(13),''));ROLLBACK;`),'7fcbf1a0c6ed5da9fedb5d83d699adf4');
const checks=jsonSql(`BEGIN;${baseline}CREATE TEMP TABLE history_meta AS ${meta};${body}
 SELECT jsonb_build_object('metadataUnchanged',(SELECT * FROM history_meta)=(${meta}),'definitionHash',md5(replace(pg_get_functiondef('${signature}'::regprocedure),chr(13),'')));ROLLBACK;`);
assert.equal(checks.metadataUnchanged,true);
assert.throws(()=>sql(`BEGIN;${baseline}${body}${body}ROLLBACK;`),/preimage differs/);
const report={kind:'NATIVE_HISTORY_AMOUNT_MATERIALIZATION_PARITY',qualification:false,checks:cases.map(c=>c[0]),...checks,duplicateDenied:true,exactRollback:true,productionChanged:false};
if(process.env.PUBLIC_HUD_HISTORY_AMOUNTS_REPORT)writeFileSync(process.env.PUBLIC_HUD_HISTORY_AMOUNTS_REPORT,JSON.stringify(report,null,2));console.log(JSON.stringify(report));


if(process.env.PUBLIC_HUD_HISTORY_AMOUNTS_APPLY==='isolated-native-only')sql(migration);
