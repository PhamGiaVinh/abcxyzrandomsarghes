import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadClassifier,createShadow,normalizeSource,shadowSql,validateShadowTarget} from './tracker-hud-shadow.mjs';
const classifier=await loadClassifier();
const header={kind:'header',snapshot:'10:11:',readOnly:true,isolation:'repeatable read',version:classifier.PUBLIC_HUD_PROJECTION_VERSION,backfillComplete:true,handsDone:true,resultsDone:true,pendingJobs:0,barriers:0};
const hand={handId:'hand',status:'completed',isVoided:false,buttonSeat:1,boardCardCount:0,
 players:[{player_id:'a',seat_number:1,starting_stack:1000},{player_id:'b',seat_number:2,starting_stack:1000}],
 actions:[['a','post_sb',50],['b','post_bb',100],['a','call',50],['b','check',0]].map(([player_id,action_type,action_amount],action_order)=>({player_id,action_type,action_amount,action_order,street:'preflop'}))};
function stored(c){return {numerators:c.numerators,denominators:c.denominators,missing_proof:c.missingProof,public_hands:c.publicHands,observed_hands:c.handsObserved,omitted_hands:c.omittedHands};}
function records(publicEligible=true){const rows=classifier.classifyPublicHudHand({...hand,settlement:null});
 const metadata={played_at:null,hand_number:1,table_id:null,session_id:null},evidence={policyEligible:true,latest:null,publicVerified:null};
 return [header,{kind:'hand',id:'hand',tournamentId:'tour',sourceRevision:'2',fingerprint:'proof2',publicEligible,hand,proof:null,
  metadata,evidence,projected:rows.map(c=>({...stored(c),...metadata,settlement_evidence:evidence,player_id:c.playerId,tournament_id:'tour',source_revision:2,source_fingerprint:'proof2'}))},
 ...rows.map(c=>({kind:'tour',value:{...stored(c),tournament_id:'tour',player_id:c.playerId,included:publicEligible,publicEligible}})),
 ...rows.map(c=>({kind:'player',value:{...stored(publicEligible?c:classifier.emptyPublicHudCounters()),player_id:c.playerId,winnings:'0',result_count:0}})),{kind:'end'}];}
function run(rows){const s=createShadow(classifier);rows.forEach(row=>s.accept(row));return s.finish();}
test('compares every contribution and both totals from canonical raw classifiers',()=>{const r=run(records());assert.equal(r.passed,true);assert.equal(r.sourceHands,1);assert.equal(r.contributions,2);});
test('retains excluded tour contributions while excluding them from lifetime public totals',()=>{assert.equal(run(records(false)).passed,true);});
test('detects per-hand corruption even when the aggregate is corrupted identically',()=>{const rows=structuredClone(records());rows[1].projected[0].numerators[0]++;
 rows[2].value.numerators[0]++;rows[4].value.numerators[0]++;const r=run(rows);assert.equal(r.passed,false);assert.ok(r.examples.some(e=>e.code==='hand_counters'));assert.ok(r.examples.every(e=>/^[a-f0-9]{64}$/.test(e.entityHash)));});
test('detects missing and orphan contributions plus stale source proof',()=>{const rows=structuredClone(records());rows[1].projected[0].source_fingerprint='old';rows[1].projected.push({...rows[1].projected[0],player_id:'orphan'});
 const r=run(rows);assert.equal(r.passed,false);assert.ok(r.examples.some(e=>e.code==='hand_source_identity'));assert.ok(r.examples.some(e=>e.code==='hand_player_coverage'));});
test('detects missing aggregate rows',()=>{const rows=records().filter(row=>!(row.kind==='player'&&row.value.player_id==='a'));assert.ok(run(rows).examples.some(e=>e.code==='missing_player_total'));});
test('detects stale replay metadata and settlement evidence despite matching counters',()=>{
 const rows=records();rows[1].projected[0].hand_number=99;
 rows[1].projected[1].settlement_evidence={...rows[1].evidence,policyEligible:false};
 const r=run(rows);for(const code of ['hand_history_metadata','hand_settlement_evidence'])assert.ok(r.examples.some(e=>e.code===code));
});
test('sums verified winnings exactly beyond safe JavaScript integer totals',()=>{
 const rows=records(),prize='9007199254740991';rows.splice(2,0,...[1,2].map(id=>({kind:'result',id,source:{player_id:'a',verified_by_admin:true,prize},projected:{player_id:'a',prize}})));
 const p=rows.find(row=>row.kind==='player'&&row.value.player_id==='a');p.value.winnings=(BigInt(prize)*2n).toString();p.value.result_count=2;
 assert.equal(run(rows).passed,true);p.value.winnings='18014398509481984';assert.equal(run(rows).passed,false);
});
test('denies unfinished backfill, live pending work and incomplete streams',()=>{
 for(const change of [{backfillComplete:false},{pendingJobs:1},{barriers:1},{readOnly:false}])assert.throws(()=>run([{...header,...change},{kind:'end'}]));
 assert.throws(()=>run(records().slice(0,-1)),/Incomplete/);
});
test('matches malformed-proof unknown handling and keeps SQL strictly read-only',()=>{
 assert.equal(normalizeSource({hand,proof:{schemaVersion:'settlement-outcome-v1',status:'verified',pots:[{winnerIds:'bad'}],handRanks:[]}}).settlement,null);
 assert.match(shadowSql,/REPEATABLE READ READ ONLY/);assert.match(shadowSql,/ROLLBACK/);assert.doesNotMatch(shadowSql,/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/);
});
test('detects stale displayed result metadata even when winnings match',()=>{
 const rows=records(),metadata={tournament_name:'Tour',event_date:'2026-11-05',position:1,total_entries:100};
 rows.splice(2,0,{kind:'result',id:'result',source:{player_id:'a',verified_by_admin:true,prize:'100',...metadata},projected:{player_id:'a',prize:'100',...metadata,position:2}});
 const player=rows.find(r=>r.kind==='player'&&r.value.player_id==='a');player.value.winnings='100';player.value.result_count=1;
 assert.ok(run(rows).examples.some(e=>e.code==='result_contribution'));
});
test('requires exact marked Actions fixture for a container server interface',()=>{
 const env={PGDATABASE:'vinpoker_hud_test_ci',PGPORT:'5432',GITHUB_ACTIONS:'true'};
 const row={database:env.PGDATABASE,currentUser:'postgres',serverVersion:170006,serverAddress:'172.17.0.2/32',databaseComment:'vinpoker-hud-shadow-isolated-ci'};
 assert.equal(validateShadowTarget(row,env,true),'marked-isolated-actions-container');
 for(const change of [{databaseComment:null},{database:'other'},{serverVersion:160000},{currentUser:'anon'}])assert.throws(()=>validateShadowTarget({...row,...change},env,true));
 assert.throws(()=>validateShadowTarget(row,{...env,GITHUB_ACTIONS:'false'},true));
 assert.throws(()=>validateShadowTarget(row,{...env,PGPORT:'55441'},true));
 assert.equal(validateShadowTarget({...row,serverAddress:'127.0.0.1/32',databaseComment:null},{...env,GITHUB_ACTIONS:'false'},true),'native-loopback');
});
