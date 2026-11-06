import {sanitizeWriterNestedPlans,writerCaptureFailureKind} from './scale.failures.mjs';
import {execFileSync} from 'node:child_process';
import {jsonSql,pgbench,sql} from './nativeDb.mjs';
export function measureFixtureWriter(){
 return jsonSql(`${process.env.PUBLIC_HUD_PROFILE_FUNCTIONS==='1'?"SET track_functions='all';":''}BEGIN;CREATE TEMP TABLE fixture_write_samples(ms numeric);GRANT INSERT ON fixture_write_samples TO service_role;
  SET LOCAL request.jwt.claim.role='service_role';SET LOCAL ROLE service_role;
  DO $$ DECLARE started timestamptz; BEGIN FOR i IN 1..110 LOOP
   started:=clock_timestamp();PERFORM public.fixture_complete_scale_hand_v1('10000000-0000-4000-8000-000000000001',2000000000+i);
   IF i>10 THEN INSERT INTO fixture_write_samples VALUES(extract(epoch FROM clock_timestamp()-started)*1000);END IF;
  END LOOP;END $$;
  RESET ROLE;SELECT jsonb_build_object('p50Ms',percentile_cont(.5) WITHIN GROUP(ORDER BY ms),'p95Ms',percentile_cont(.95) WITHIN GROUP(ORDER BY ms),'maxMs',max(ms)) FROM fixture_write_samples;
  ROLLBACK;`);
}
export function measureFixtureWriterTransactions({commit=false,orderedTransactions=false}={}){
 const ending=commit?'COMMIT':'ROLLBACK';
 const configuration=orderedTransactions?jsonSql(`SELECT jsonb_build_object('fsync',current_setting('fsync'),'fullPageWrites',current_setting('full_page_writes'),'synchronousCommit',current_setting('synchronous_commit'),'pgbenchProtocol','prepared','clients',1,'threads',1,'connection','loopback; one persistent connection per arm','commit',${commit});`):null;
 const pressureBefore=writerPressureSnapshot();
 const measured=pgbench("BEGIN;\nSET LOCAL request.jwt.claim.role='service_role';\nSET LOCAL ROLE service_role;\nSELECT public.fixture_complete_scale_hand_v1('10000000-0000-4000-8000-000000000001',2000000001);\n"+ending+";\n",{orderedTransactions});
 const samples=orderedTransactions?measured.samples:measured;
 const pressureAfter=writerPressureSnapshot();
 if(samples.length!==200||samples.some(n=>!Number.isFinite(n)))throw Error('Invalid pgbench fixture samples');
 if(orderedTransactions&&(measured.transactions.length!==220||measured.transactions.filter(t=>!t.warmup).length!==200))throw Error('Invalid ordered writer samples');
 return {p50Ms:samples[99],p95Ms:samples[189],maxMs:samples.at(-1),samples:samples.length,...(orderedTransactions?{configuration,orderedTransactions:measured.transactions}:{}),transaction:`BEGIN/source writer/${ending}; one transaction per sample`,pressureBefore,pressureAfter};
}
// Separate observer sessions surround both benchmarks symmetrically. No reset,
// forced checkpoint or waiting for quiet: graded transaction samples stay intact.
// Statistics may lag; disabled I/O timing and missing observations are explicit.
function writerPressureSnapshot(){
 try{return jsonSql(`SELECT jsonb_build_object(
 'observedAt',clock_timestamp(),'trackIoTiming',current_setting('track_io_timing'),
 'checkpointer',(SELECT to_jsonb(s) FROM pg_stat_checkpointer s),
 'wal',(SELECT to_jsonb(s) FROM pg_stat_wal s),
 'bgwriter',(SELECT to_jsonb(s) FROM pg_stat_bgwriter s),
 'io',(SELECT jsonb_agg(to_jsonb(s)) FROM pg_stat_io s),
 'activity',(SELECT jsonb_agg(to_jsonb(s)) FROM
 (SELECT backend_type,state,wait_event_type,count(*) AS sessions FROM pg_stat_activity
 WHERE pid<>pg_backend_pid() GROUP BY backend_type,state,wait_event_type) s));`);}
 catch{return {unavailable:true};}
}
export function cleanupCommittedWriterFixture(){
 const scope="h.tournament_id='10000000-0000-4000-8000-000000000001' AND h.hand_number=2000000001";
 if(sql(`SELECT count(*) FROM public.tournament_hands h WHERE ${scope};`)!=='220')throw Error('Committed benchmark fixture count mismatch');
 sql(`BEGIN;DELETE FROM public.hand_actions a USING public.tournament_hands h WHERE a.hand_id=h.id AND ${scope};
 DELETE FROM public.hand_players p USING public.tournament_hands h WHERE p.hand_id=h.id AND ${scope};
 DELETE FROM public.tournament_hands h WHERE ${scope};COMMIT;`);
}

export function writerDiagnosticAdminTarget(env){
 const comparison=env.PUBLIC_HUD_WRITER_DIAGNOSTIC==='isolated-comparison-admin';
 if(env.PUBLIC_HUD_WRITER_DIAGNOSTIC&&!comparison)throw Error('writer_diagnostic_scope_required');
 if(!comparison&&env.PUBLIC_HUD_ISOLATED_STACK!=='vinpoker-hud-scale')return null;
 const project=env.PUBLIC_HUD_STACK_PROJECT;
 if(env.PUBLIC_HUD_LOCAL_PORT!=='54322'||!/^hud-scale-[a-z0-9-]+$/.test(project??''))throw Error('writer_diagnostic_scope_required');
 if(comparison){
  const match=project.match(/^hud-scale-([a-z0-9]+)-([a-z0-9]+)$/);
  if(!match||env.PUBLIC_HUD_ISOLATED_STACK||env.PUBLIC_HUD_LOCAL_DATABASE!==`vinpoker_hud_test_pair_${match[1]}_${match[2]}`)
   throw Error('writer_diagnostic_scope_required');
  return {project,database:env.PUBLIC_HUD_LOCAL_DATABASE,marker:'vinpoker-hud-writer-control-disposable'};
 }
 if(env.PUBLIC_HUD_LOCAL_DATABASE!=='postgres')throw Error('writer_diagnostic_scope_required');
 return {project,database:'postgres',marker:'vinpoker-hud-scale-disposable'};
}
export function diagnoseFixtureWriter(){
 try{
  const query=`BEGIN;LOAD 'auto_explain';SET LOCAL client_min_messages='warning';SET LOCAL auto_explain.log_level='warning';SET LOCAL auto_explain.log_min_duration=0;SET LOCAL auto_explain.log_analyze=on;SET LOCAL auto_explain.log_nested_statements=on;SET LOCAL auto_explain.log_format='json';
   SET LOCAL request.jwt.claim.role='service_role';SET LOCAL ROLE service_role;
   SELECT public.fixture_complete_scale_hand_v1('10000000-0000-4000-8000-000000000001',2000000002);
   RESET ROLE;ROLLBACK;DO $$ BEGIN RAISE EXCEPTION 'writer_plan_capture';END $$;`;
  const target=writerDiagnosticAdminTarget(process.env);
  if(target){
   // LOAD is administrative in the Supabase image. Existing local admin only;
   // the instrumented business call still runs as service_role in the query.
   // Check the marker inside the selected container before loading anything.
   const guard=`DO $$ BEGIN IF current_database()<>'${target.database}' OR shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database') IS DISTINCT FROM '${target.marker}' THEN RAISE EXCEPTION 'writer_diagnostic_scope_required';END IF;END $$;`;
   execFileSync('docker',['exec','-i','-e','PGPASSWORD=postgres',`supabase_db_${target.project}`,'psql','-U','supabase_admin','-d',target.database,'-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:guard+query,encoding:'utf8',stdio:'pipe',maxBuffer:8*1024*1024});
  }else sql(query,{captureFailure:true});
 }catch(error){const result=sanitizeWriterNestedPlans(error?.stderr);return {kind:'SANITIZED_ROLLED_BACK_WRITER_PLANS_NOT_GRADED_LATENCY',captureFailureKind:writerCaptureFailureKind(error,result.capturedPlans),...result};}
 return {kind:'SANITIZED_ROLLED_BACK_WRITER_PLANS_NOT_GRADED_LATENCY',capturedPlans:0,scans:[]};
}
