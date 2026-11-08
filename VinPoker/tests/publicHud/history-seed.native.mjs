import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {sql,jsonSql} from './nativeDb.mjs';
const read=file=>readFileSync(file,'utf8').replaceAll('\r\n','\n');
const prior=read('supabase/migrations/20261104002400_public_hud_history_ordered_page.sql');
const baseline=prior.slice(prior.indexOf('CREATE OR REPLACE FUNCTION'),prior.lastIndexOf('COMMIT;')).replace('), amounts AS (','), amounts AS MATERIALIZED (');
const migration=read('supabase/migrations/20261105200303_public_hud_history_unverified_seed_short_circuit.sql');
const body=migration.replace('BEGIN;','').replace(/COMMIT;\s*$/,'');
const reverse=read('tests/publicHud/history-seed.rollback.sql').replace('BEGIN;','').replace(/COMMIT;\s*$/,'');
const signature='public.get_public_player_hud_history_v1(uuid,uuid,timestamptz,uuid)';
const tour='10000000-0000-4000-8000-000000000001',player='30000000-0000-4000-8000-000000000001';
const call=cursor=>`public.get_public_player_hud_history_v1('${tour}','${player}',${cursor?.playedAt?`'${cursor.playedAt}'`:'NULL'},${cursor?`'${cursor.handId}'`:'NULL'})`;
const before=sql(`SELECT md5(replace(pg_get_functiondef('${signature}'::regprocedure),chr(13),''));`);
const page=jsonSql(`BEGIN;${baseline}SELECT ${call()};ROLLBACK;`);
assert.ok(page.handHistory.length>0);const hand=page.handHistory[0].handId;
const meta=`SELECT jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'config',proconfig,'definer',prosecdef,'volatile',provolatile) FROM pg_proc WHERE oid='${signature}'::regprocedure`;
const cases=[['first',''],['next','',page.nextCursor],['null-time','',{playedAt:null,handId:'ffffffff-ffff-ffff-ffff-ffffffffffff'}],
 ['void',`UPDATE public.tournament_hands SET is_voided=true WHERE id='${hand}';`],
 ['incomplete',`UPDATE public.tournament_hands SET status='in_progress' WHERE id='${hand}';`],
 ['missing-participant',`DELETE FROM public.hand_players WHERE hand_id='${hand}' AND player_id='${player}';`],
 ['withdrawn',`UPDATE public.tournaments SET deleted_at=now() WHERE id='${tour}';`],
 ['warming',`UPDATE tracker_analytics_v1.config SET backfill_complete=false WHERE singleton;`]];
const proofCases=[
 ['verified-win',1200,200,0,1200,200],['verified-loss',800,-200,0,800,-200],['verified-flat',1000,0,0,1000,0],
 ['verified-external-delta',1300,200,100,1300,200],['bad-conservation',1200,100,0,null,null],
 ['fractional-ending',1200.5,200.5,0,null,null],['string-ending','1200',200,0,null,null],
 ['negative-ending',-1,-1001,0,null,null],['missing-verified-proof',1200,200,0,null,null],
 ['malformed-pots',1200,200,0,null,null],['malformed-ranks',1200,200,0,null,null],
 ['duplicate-seed',1200,200,0,null,null],['source-revision-mismatch',1200,200,0,null,null],
 ];
for(const [name,end,delta,external,expectedEnd,expectedDelta]of proofCases){
 const proof={schemaVersion:'settlement-outcome-v1',status:'verified',pots:name==='malformed-pots'?[{winnerIds:'bad'}]:[],handRanks:name==='malformed-ranks'?[{playerId:7}]:[],players:[{playerId:player,startingStack:1000,endingStack:end,netDelta:delta,externalDelta:external}]};
 const duplicate=name==='duplicate-seed'?`INSERT INTO public.hand_players(hand_id,tournament_id,player_id,entry_number,starting_stack)VALUES('${hand}','${tour}','${player}',2,1000);`:'';
 // Clear only transaction-local projection markers to inspect a completed
 // projected fixture. Production invalidation/worker behavior is tested elsewhere.
 const change=`UPDATE public.hand_players SET starting_stack=1000 WHERE hand_id='${hand}' AND player_id='${player}';${duplicate}
 DELETE FROM public.tournament_settlement_outcomes WHERE hand_id='${hand}';
 INSERT INTO public.tournament_settlement_outcomes(hand_id,source_revision,settlement_revision,status,public_outcome)
 SELECT id,source_revision${name==='source-revision-mismatch'?'-1':''},999,'${name==='missing-verified-proof'?'pending':'verified'}','${JSON.stringify(proof)}'::jsonb FROM public.tournament_hands WHERE id='${hand}';
 DELETE FROM tracker_analytics_v1.job_players WHERE kind='hand' AND entity_id='${hand}';`;
 cases.push([name,change,undefined,[expectedEnd,expectedDelta]]);
}
for(const [name,change,cursor,expected]of cases){
 const result=jsonSql(`BEGIN;${baseline}${change}
 CREATE TEMP TABLE history_expected(payload jsonb);GRANT INSERT,SELECT ON history_expected TO anon;
 SET LOCAL ROLE anon;INSERT INTO history_expected SELECT ${call(cursor)};RESET ROLE;
 ${body} SET LOCAL ROLE anon;SELECT jsonb_build_object('equal',(SELECT payload FROM history_expected)=${call(cursor)},'payload',${call(cursor)});ROLLBACK;`);
 assert.equal(result.equal,true,name);
 if(expected){const row=result.payload.handHistory.find(r=>r.handId===hand);assert.ok(row,name+' row');assert.equal(row.endingStack,expected[0],name+' ending');assert.equal(row.netDelta,expected[1],name+' delta');}
}
const checks=jsonSql(`BEGIN;${baseline}CREATE TEMP TABLE history_meta AS ${meta};${body}
 SELECT jsonb_build_object('metadataUnchanged',(SELECT * FROM history_meta)=(${meta}),'definitionHash',md5(replace(pg_get_functiondef('${signature}'::regprocedure),chr(13),'')));ROLLBACK;`);
assert.equal(checks.metadataUnchanged,true);assert.equal(checks.definitionHash,'4f8894bc8dd9114663ace03f9b3225e3');
assert.throws(()=>sql(`BEGIN;${baseline}${body}${body}ROLLBACK;`),/preimage differs/);
assert.throws(()=>sql(`BEGIN;${baseline}${reverse}ROLLBACK;`),/preimage differs/);
assert.equal(sql(`BEGIN;${baseline}${body}${reverse}SELECT md5(replace(pg_get_functiondef('${signature}'::regprocedure),chr(13),''));ROLLBACK;`),'1a9b508726f30b94a830977ef6190f70');
assert.equal(sql(`SELECT md5(replace(pg_get_functiondef('${signature}'::regprocedure),chr(13),''));`),before);
const report={kind:'NATIVE_HISTORY_UNVERIFIED_SEED_PARITY',checks:cases.map(row=>row[0]),...checks,duplicateDenied:true,exactReverse:true,allTransactionsRolledBack:true,productionChanged:false,qualification:false};
if(process.env.PUBLIC_HUD_HISTORY_SEED_REPORT)writeFileSync(process.env.PUBLIC_HUD_HISTORY_SEED_REPORT,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
if(process.env.PUBLIC_HUD_HISTORY_SEED_APPLY==='isolated-native-only')sql(migration);
