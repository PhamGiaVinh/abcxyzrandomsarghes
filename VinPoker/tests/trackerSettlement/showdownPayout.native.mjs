// Canonical payout snapshot/engine/apply continuation; isolated native DB only.
import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {computePayouts} from '../../supabase/functions/_shared/payoutEngine.ts';
import {sql,jsonSql} from '../publicHud/nativeDb.mjs';
const db='vinpoker_hud_test_showdown_20261107b',tour='de780003-0000-4000-8000-000000000001',owner='de780000-0000-4000-8000-000000000001';
assert.equal(process.env.PUBLIC_HUD_LOCAL_DATABASE,db);
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),db+'|127.0.0.1|55441');
assert.equal(sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'vinpoker-owned-showdown-20261107b');
assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));"),'f');
const output=process.env.NATIVE_SHOWDOWN_PAYOUT_REPORT;
assert.match(output??'',/^D:\/Quy-trinh-hud-scale-evidence\/showdown-payout-[a-z0-9-]+\.json$/);assert.equal(existsSync(output),false);
const q=v=>"'"+String(v).replaceAll("'","''")+"'",val=v=>v===null?'NULL':typeof v==='object'?q(JSON.stringify(v))+'::jsonb':typeof v==='number'||typeof v==='boolean'?String(v):q(v);
const report={phase:'preflight',passed:false,productionChanged:false,driverSha256:createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex'),limits:'Actual canonical PostgreSQL authenticated RPCs and shared Edge payout engine. Simulated JWT GUC; no GoTrue/AuthHTTP or Edge transport. Payout configuration only, not prize payment or tour closing.'};
const save=()=>writeFileSync(output,JSON.stringify(report,null,2)+'\n');
const rpc=(name,args)=>{assert.match(name,/^[a-z][a-z0-9_]+$/);report.lastRpc=name;save();const params=Object.entries(args).map(([k,v])=>{assert.match(k,/^p_[a-z0-9_]+$/);return k+'=>'+val(v);}).join(',');return JSON.parse(sql('\\set VERBOSITY verbose\nBEGIN;SET LOCAL request.jwt.claim.sub='+q(owner)+';SET LOCAL request.jwt.claims='+q(JSON.stringify({sub:owner,role:'authenticated'}))+';SET LOCAL ROLE authenticated;SELECT public.'+name+'('+params+');COMMIT;',{captureFailure:true}));};
save();try{
 assert.equal(sql('SELECT count(*) FROM public.tournament_payout_runs WHERE tournament_id='+q(tour)+';'),'0','One-shot scenario: preserve existing payout runs');
 assert.equal(sql('SELECT count(*) FROM public.tournament_hands WHERE tournament_id='+q(tour)+" AND hand_number=880003 AND status='completed';"),'1');
 const prepare={p_tournament_id:tour,p_itm_percent:0.2,p_archetype:'DAILY',p_min_cash_x:1,p_rounding_unit:1000,p_prize_pool_override:null,p_override_reason:null,p_regenerate:false,p_reason:'isolated canonical full tour acceptance',p_custom_percents:null};
 report.phase='prepare';save();const run=rpc('prepare_payout_snapshot',prepare);assert.equal(run.status,'prepared');assert.equal(run.entries_snapshot,3);assert.equal(run.prize_pool_snapshot,18000000);assert.equal(run.rake_snapshot,600000);
 report.phase='engine';save();const result=computePayouts({entries:run.entries_snapshot,prizePool:run.prize_pool_snapshot,floor:run.effective_floor,itmPercent:run.itm_percent,archetype:run.archetype,roundingUnit:run.rounding_unit});
 const rows=result.rows.map(r=>({position:r.position,amount:r.amount}));assert.deepEqual(rows,[{position:1,amount:18000000}]);
 report.phase='apply';save();const applied=rpc('apply_payout_run',{p_run_id:run.run_id,p_rows:rows,p_prize_pool:run.prize_pool_snapshot,p_itm_places:result.itmPlaces,p_effective_floor:result.effectiveFloor,p_warnings:result.warnings,p_engine_version:result.engineVersion,p_alpha_version:result.alphaVersion});assert.equal(applied.status,'applied');
 const state=jsonSql('SELECT jsonb_build_object(\'appliedRuns\',(SELECT count(*) FROM public.tournament_payout_runs WHERE tournament_id='+q(tour)+" AND status='applied'),'rows',(SELECT jsonb_agg(jsonb_build_object('position',position,'amount',amount) ORDER BY position) FROM public.tournament_prizes WHERE tournament_id="+q(tour)+"),'closedBuy',(SELECT registration_closed_at IS NOT NULL FROM public.tournaments WHERE id="+q(tour)+"),'chips',(SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id="+q(tour)+" AND is_active));");
 assert.deepEqual(state,{appliedRuns:1,rows,closedBuy:true,chips:60000});
 const retry=rpc('prepare_payout_snapshot',prepare);assert.equal(retry.run_id,run.run_id);assert.equal(retry.status,'already_applied');
 report.state=state;report.snapshot={entries:3,pool:18000000,rakePerEntry:600000};report.prepareRetrySameRun=true;report.phase='canonical-payout-applied';report.passed=true;save();console.log(JSON.stringify(report));
}catch(error){report.failedPhase=report.phase;report.phase='failed';report.sqlstate=String(error.stderr??'').match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1]??null;report.assertionCode=error.code??null;save();console.log(JSON.stringify(report));process.exitCode=1;}
