import assert from 'node:assert/strict';
import {loadPackage,preflightSql,classifyPreflight} from './spectator342344-release-plan.mjs';
import {validateLedger} from './spectator342344-release-context.mjs';
import {executePackage,pausedSql,classifyPaused,inspectOutcome} from './spectator342344-protected-apply.mjs';

const dispatchDefinition='cf705ee6551a85a61724228ede8f7945';
const workerUrl='https://orlesggcjamwuknxwcpk.supabase.co/functions/v1/public-spectator-projector-v2';
const job=(id,name,command,active)=>`(SELECT count(*)=1 AND bool_and(jobid=${id} AND ${active?'active':'NOT active'} AND schedule='1 second' AND database='postgres' AND username='postgres' AND md5(command)='${command}') FROM cron.job WHERE jobname='${name}')`;
const expected=(active)=>`${job(52,'public-spectator-v2-dispatch','6a58054106472023a5314bd491f485da',active)} AND ${job(55,'public-hud-projection-v1-dispatch','91fa9918a394fedb11200da51cd02dc9',true)} AND md5(pg_get_functiondef(to_regprocedure('public.dispatch_public_spectator_projection_v2()')))='${dispatchDefinition}'`;
export const ledgerSql="BEGIN READ ONLY;SET LOCAL statement_timeout='10s';SELECT COALESCE(json_agg(json_build_object('version',version,'name',name) ORDER BY version),'[]'::json)::text FROM supabase_migrations.schema_migrations;COMMIT;";
export function activeSql(){return `BEGIN READ ONLY;SET LOCAL statement_timeout='10s';SELECT json_build_object('exact',COALESCE((${expected(true)}),false))::text;COMMIT;`;}
export function pauseSql(){
 return `BEGIN ISOLATION LEVEL SERIALIZABLE;SET LOCAL lock_timeout='1s';SET LOCAL statement_timeout='10s';
 DO $pause$ DECLARE v_hud_xmin text; v_before_xmin text; BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'dispatcher_actor_drift';END IF;
 SELECT xmin::text INTO STRICT v_hud_xmin FROM cron.job WHERE jobid=55;
 IF NOT COALESCE((${expected(true)}),false) THEN RAISE EXCEPTION 'dispatcher_preimage_drift';END IF;
 SELECT xmin::text INTO STRICT v_before_xmin FROM cron.job WHERE jobid=52;
 PERFORM cron.alter_job(52,active:=false);
 IF NOT COALESCE((${expected(false)}),false) OR NOT EXISTS(SELECT 1 FROM cron.job WHERE jobid=55 AND xmin::text=v_hud_xmin)
 OR EXISTS(SELECT 1 FROM cron.job WHERE jobid=52 AND xmin::text=v_before_xmin)
 THEN RAISE EXCEPTION 'dispatcher_pause_postimage_drift';END IF;
 END $pause$;
 SELECT json_build_object('paused',NOT active,'pauseXmin',xmin::text)::text FROM cron.job WHERE jobid=52;COMMIT;`;
}
export function resumeSql(pauseXmin){
 assert.match(pauseXmin??'',/^\d{1,20}$/,'Observed pause row version required');
 return `BEGIN ISOLATION LEVEL SERIALIZABLE;SET LOCAL lock_timeout='1s';SET LOCAL statement_timeout='10s';
 DO $resume$ DECLARE v_hud_xmin text; BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'dispatcher_actor_drift';END IF;
 SELECT xmin::text INTO STRICT v_hud_xmin FROM cron.job WHERE jobid=55;
 IF NOT COALESCE((${expected(false)}),false) OR NOT EXISTS(SELECT 1 FROM cron.job WHERE jobid=52 AND xmin::text='${pauseXmin}')
 THEN RAISE EXCEPTION 'dispatcher_pause_ownership_drift';END IF;
 PERFORM cron.alter_job(52,active:=true);
 IF NOT COALESCE((${expected(true)}),false) OR NOT EXISTS(SELECT 1 FROM cron.job WHERE jobid=55 AND xmin::text=v_hud_xmin)
 THEN RAISE EXCEPTION 'dispatcher_resume_postimage_drift';END IF;
 END $resume$;
 SELECT json_build_object('resumed',COALESCE((${expected(true)}),false))::text;COMMIT;`;
}
export function drainSql(){
 return `BEGIN READ ONLY;SET LOCAL statement_timeout='10s';SELECT json_build_object(
 'leaseCount',(SELECT count(*) FROM spectator_projection_v2.work_groups WHERE claimed_until>clock_timestamp()),
 'queuedRequests',(SELECT count(*) FROM net.http_request_queue WHERE url='${workerUrl}'),
 'activeCalls',(SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND datname=current_database() AND state='active'
 AND query~'(absorb_public_spectator_generations_v2|flush_public_spectator_broadcast_v2|claim_public_spectator_projection_v2|get_public_spectator_projection_source_v2|publish_public_spectator_projection_v2|fail_public_spectator_projection_v2|dispatch_public_spectator_projection_v2)'))::text;COMMIT;`;
}
export async function releaseDatabase({mode,sourceRoot,transport,verifyPriorEdge,report=()=>{},sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=()=>performance.now()}){
 assert.ok(['plan','apply'].includes(mode));
 const pkg=loadPackage(sourceRoot);
 validateLedger(transport.json(ledgerSql),pkg.manifest,sourceRoot);
 classifyPreflight(transport.json(preflightSql()));
 assert.equal(transport.json(activeSql()).exact,true,'Dispatcher definition/config drift');
 await verifyPriorEdge();
 if(mode==='plan')return {kind:'EXACT_SPECTATOR342344_PLAN_VERIFIED',productionChanged:false};
 return applyAfterVerifiedPlan({sourceRoot,transport,verifyPriorEdge,report,sleep,now});
}
// Internal phase boundary; production callers enter through releaseDatabase.
// Kept separate so the bounded state machine can be tested with a fake clock.
export async function applyAfterVerifiedPlan({sourceRoot,transport,verifyPriorEdge,report,sleep,now}){
 let phase='pause';
 try{
  const paused=transport.json(pauseSql());
  assert.equal(paused.paused,true);assert.match(paused.pauseXmin??'',/^\d{1,20}$/);
  const started=now(),deadline=started+90000;
  const budget=(reserve=15000)=>assert.ok(now()<=deadline-reserve,'Bounded dispatcher pause budget exhausted');
  phase='drain';
  let quietSince=now();
  for(;;){
   budget(45000);
   const state=transport.json(pausedSql());
   assert.ok(state.paused===true&&state.hudPreserved===true,'Dispatcher changed during drain');
   const drain=transport.json(drainSql());
   for(const field of ['leaseCount','queuedRequests','activeCalls'])assert.ok(Number.isInteger(drain[field])&&drain[field]>=0,'Invalid drain observation');
   // Observed quiescence, not proof that every hosted HTTP request ended.
   // Recovered v12 uses an awaited5s server RPC deadline (including absorb/flush)
   // and aborts each RPC at its remaining budget. Caller8s timeout alone is NOT
   // server cancellation. Observe all DB RPCs/queue/leases for12quietseconds.
   // Arbitrarily late delivery remains possible:343's exclusive table lock and
   // active-lease guard reject a racing claim; exact fenced replies and the
   // unchanged individual getter keep late v12 execution compatible after apply.
   const quiet=state.leasesDrained===true&&drain.leaseCount===0&&drain.queuedRequests===0&&drain.activeCalls===0;
   if(!quiet)quietSince=now();
   if(quiet&&now()-quietSince>=12000)break;
   await sleep(500);
  }
  classifyPaused(transport.json(pausedSql()));
  phase='apply';
  const bounded={json:sql=>{budget();return transport.json(sql);},execute:sql=>{budget();return transport.execute(sql);}};
  const result=executePackage(sourceRoot,bounded,report);
  phase='verify-prior-worker';budget();await verifyPriorEdge();
  phase='resume';budget();assert.equal(transport.json(resumeSql(paused.pauseXmin)).resumed,true);
  assert.equal(transport.json(activeSql()).exact,true);
  report({kind:'SPECTATOR342344_RESUMED_WITH_VERIFIED_PRIOR_SINGLE_WORKER',pauseMs:now()-started});
  return {...result,dispatcherStillPaused:false,workerMode:'prior-v12-single'};
 }catch{
  let dispatcher='unavailable';
  try{dispatcher={paused:transport.json(pausedSql()).paused,exactActive:transport.json(activeSql()).exact};}catch{}
  report({kind:'SPECTATOR342344_PHASE_STOP_NO_AUTOMATIC_RETRY_OR_RESUME',phase,dispatcher,...inspectOutcome(sourceRoot,transport)});
  throw Error('Protected spectator phase stopped; inspect receipts and dispatcher state');
 }
}
