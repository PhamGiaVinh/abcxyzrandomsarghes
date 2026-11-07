import assert from 'node:assert/strict';
import {existsSync,writeFileSync} from 'node:fs';
import {sql,sqlAsync,jsonSql,createSqlSessionPool} from '../publicHud/nativeDb.mjs';
const db='vinpoker_hud_test_showdown_20261107e',tour='de780003-0000-4000-8000-000000000001',owner='de780000-0000-4000-8000-000000000001';
assert.equal(process.env.PUBLIC_HUD_LOCAL_DATABASE,db);
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),db+'|127.0.0.1|55441');
assert.equal(sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'vinpoker-owned-showdown-20261107e');
assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));"),'f');
const output=process.env.NATIVE_PAYMENT_CLOSE_RACE_REPORT;
assert.match(output??'',/^D:\/Quy-trinh-hud-scale-evidence\/showdown-payment-close-race-[a-z0-9-]+\.json$/);assert.equal(existsSync(output),false);
const q=v=>"'"+String(v).replaceAll("'","''")+"'",val=v=>typeof v==='number'?String(v):q(v);
const auth="SET LOCAL request.jwt.claim.sub="+q(owner)+";SET LOCAL request.jwt.claims="+q(JSON.stringify({sub:owner,role:'authenticated'}))+";SET LOCAL ROLE authenticated;";
const call=(name,args)=>{assert.match(name,/^[a-z][a-z0-9_]+$/);return 'SELECT public.'+name+'('+Object.entries(args).map(([k,v])=>{assert.match(k,/^p_[a-z0-9_]+$/);return k+'=>'+val(v);}).join(',')+');';};
const rpc=(name,args)=>JSON.parse(sql("BEGIN;SET LOCAL statement_timeout='15s';"+auth+call(name,args)+'COMMIT;',{captureFailure:true}));
const report={phase:'preflight',passed:false,productionChanged:false,limits:'Owned native PostgreSQL and actual canonical authenticated RPCs; simulated JWT. One payment-before-close ordering with verified real lock contention. Not reverse ordering, HTTP/UI or capacity proof.'};
const save=()=>writeFileSync(output,JSON.stringify(report,null,2)+'\n');
const ok=r=>{assert.equal(r.ok,true);return r;};
async function until(predicate){const deadline=Date.now()+12000;while(!predicate()){assert.ok(Date.now()<deadline,'Lock observation deadline');await new Promise(r=>setTimeout(r,25));}}
let barrier=null,paymentJob=null,closeJob=null,locked=false;
save();try{
 assert.equal(sql('SELECT count(*) FROM public.tournament_prize_payments WHERE tournament_id='+q(tour)+';'),'0');assert.equal(sql('SELECT count(*) FROM public.tournament_close_report WHERE tournament_id='+q(tour)+';'),'0');
 const recipients=rpc('get_tournament_payout_recipients',{p_tournament_id:tour});assert.equal(recipients.places.length,1);const p=recipients.places[0];assert.equal(p.prizeAmount,18000000);
 const table=jsonSql('SELECT jsonb_build_object(\'entry\',s.entry_id,\'table\',t.id,\'session\',x.id,\'revision\',x.revision,\'epoch\',x.control_epoch) FROM public.tournament_seats s JOIN public.tournament_tables t ON t.id=s.tournament_table_id JOIN public.table_sessions x ON x.id=t.table_session_id WHERE s.tournament_id='+q(tour)+' AND s.is_active;');
 report.phase='release-table';save();ok(rpc('floor_free_sit_player_v1',{p_entry_id:table.entry,p_expected_revision:table.revision,p_expected_control_epoch:table.epoch,p_expected_chip_count:60000,p_request_id:'de780011-0000-4000-8000-000000000001',p_reason:'isolated race winner free sit'}));
 const revision=Number(sql('SELECT revision FROM public.table_sessions WHERE id='+q(table.session)+';'));ok(rpc('close_tournament_table_v4',{p_tournament_table_id:table.table,p_expected_revision:revision,p_request_id:'de780012-0000-4000-8000-000000000001'}));assert.equal(rpc('get_tournament_close_readiness_v1',{p_tournament_id:tour}).ready,true);
 const payment={p_tournament_id:tour,p_finished_place:1,p_method:'cash',p_expected_token:p.confirmationToken,p_request_id:'de780014-0000-4000-8000-000000000001'};
 barrier=createSqlSessionPool(1);await barrier.query('SELECT pg_advisory_lock(20261107,34);');locked=true;
 report.phase='hold-uncommitted-payment';save();
 paymentJob=sqlAsync("BEGIN;SET LOCAL application_name='owned_close_race_payment';SET LOCAL statement_timeout='20s';"+auth+call('record_tournament_prize_payment_v2',payment)+'SELECT pg_advisory_xact_lock(20261107,34);COMMIT;');void paymentJob.catch(()=>{});
 await until(()=>sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name='owned_close_race_payment' AND state='active' AND wait_event='advisory');")==='t');
 assert.equal(sql('SELECT count(*) FROM public.tournament_prize_payments WHERE tournament_id='+q(tour)+';'),'0','Payment still uncommitted from observer connection');
 report.phase='observe-close-blocked-by-payment';save();closeJob=sqlAsync("BEGIN;SET LOCAL application_name='owned_close_race_close';SET LOCAL statement_timeout='20s';"+auth+call('close_tournament',{p_tournament_id:tour,p_reason:'isolated payment versus close race'})+'COMMIT;');void closeJob.catch(()=>{});
 await until(()=>sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity c JOIN pg_stat_activity p ON p.pid=ANY(pg_blocking_pids(c.pid)) WHERE c.datname=current_database() AND c.application_name='owned_close_race_close' AND p.application_name='owned_close_race_payment' AND c.wait_event_type='Lock');")==='t');
 report.realPaymentUncommitted=true;report.realCloseWaitedForPayment=true;save();await barrier.query('SELECT pg_advisory_unlock(20261107,34);');locked=false;
 const [paid,closed]=await Promise.all([paymentJob,closeJob]);const paymentResult=ok(JSON.parse(paid)),closeResult=ok(JSON.parse(closed));assert.equal(paymentResult.prize_amount,18000000);assert.equal(closeResult.prize_total,18000000);assert.equal(closeResult.reconcile_delta,0);assert.equal(closeResult.reconciled,true);
 assert.deepEqual(rpc('record_tournament_prize_payment_v2',payment),paymentResult);assert.equal(rpc('close_tournament',{p_tournament_id:tour,p_reason:'isolated close retry'}).outcome,'already_closed');
 const state=jsonSql('SELECT jsonb_build_object(\'paidRows\',(SELECT count(*) FROM public.tournament_prize_payments WHERE tournament_id='+q(tour)+" AND status='paid'),'reports',(SELECT count(*) FROM public.tournament_close_report WHERE tournament_id="+q(tour)+"),'reportPrize',(SELECT prize_total FROM public.tournament_close_report WHERE tournament_id="+q(tour)+"));");assert.deepEqual(state,{paidRows:1,reports:1,reportPrize:18000000});report.final=state;report.phase='payment-before-close-race-passed';report.passed=true;save();console.log(JSON.stringify(report));
}catch(error){report.failedPhase=report.phase;report.phase='failed';report.assertionCode=error.code??null;save();console.log(JSON.stringify(report));process.exitCode=1;}
finally{if(locked&&barrier)await barrier.query('SELECT pg_advisory_unlock(20261107,34);').catch(()=>{});await Promise.allSettled([paymentJob,closeJob].filter(Boolean));if(barrier)await barrier.close();}
