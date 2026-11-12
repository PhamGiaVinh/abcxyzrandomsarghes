import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {sql,jsonSql} from './nativeDb.mjs';
import {pendingSourceProbeEnabled,writerWaitDiagnosticEnabled} from './scale.write.protocol.mjs';
const sha256=value=>createHash('sha256').update(value).digest('hex');
export const writerSourceFunctions=()=>{
 // enqueue is called indirectly by hand_changed; direct trigger hashes alone
 // would miss a different marking implementation in the comparison database.
 assert.equal(sql("SELECT md5(replace(pg_get_functiondef('tracker_analytics_v1.enqueue(text,uuid,boolean)'::regprocedure),chr(13),''));"),'0650893a716858e40a966b9c9dd2a460','Canonical candidate enqueue required');
 return jsonSql(`SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',replace(pg_get_functiondef(p.oid),chr(13),'')) ORDER BY p.oid::regprocedure::text) FROM pg_proc p WHERE p.oid IN('public.fixture_complete_scale_hand_v1(uuid,integer)'::regprocedure,'tracker_analytics_v1.enqueue(text,uuid,boolean)'::regprocedure) OR p.oid IN(SELECT tgfoid FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN('public.tournament_hands'::regclass,'public.hand_players'::regclass,'public.hand_actions'::regclass));`);
};
const inputs=['tests/publicHud/scale.seed.mjs','tests/publicHud/scale-runtime.fixture.sql','tests/publicHud/spectator-generation.fixture.sql','tests/publicHud/scale.clock-readers.fixture.sql','tests/publicHud/scale.write.native.mjs','tests/publicHud/nativeDb.mjs','tests/publicHud/scale.write.protocol.mjs','tests/publicHud/scale.write.identity.mjs','tests/publicHud/writer-control.native.mjs','tests/publicHud/writer-evidence.native.mjs'];
export function currentWriterIdentity(){
 const database=process.env.PUBLIC_HUD_LOCAL_DATABASE;
 assert.match(database??'',/^vinpoker_hud_test_pair_[0-9]+_[0-9]+$/);
 assert.equal(sql('SELECT current_database();'),database);
 return {...currentWriterCodeIdentity(),runId:process.env.GITHUB_RUN_ID,runAttempt:process.env.GITHUB_RUN_ATTEMPT,database,
  sourceHands:Number(sql('SELECT count(*) FROM public.tournament_hands;'))};
}
export function currentWriterCodeIdentity(){
 const pendingSourceProbe=pendingSourceProbeEnabled(process.env);
 const candidateInputs=process.env.PUBLIC_HUD_SOURCE_GENERATION_PROBE==='1'?[...inputs,'supabase/migrations/20270128000342_nonblocking_spectator_source_generation.sql']:inputs;
 if(pendingSourceProbe)candidateInputs.push('supabase/migrations/20270128000343_spectator_pending_source_outcome.sql');
 if(writerWaitDiagnosticEnabled(process.env))candidateInputs.push('tests/publicHud/writer.wait.observer.py','tests/publicHud/writer-wait-observer.native.mjs');
 const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 assert.equal(sha,process.env.GITHUB_SHA,'Default checkout must match the current workflow SHA');
 return {sha,
  manifestSha256:sha256(readFileSync('scripts/ops/tracker-hud-20261104-manifest.json')),
  fixtureInputsSha256:sha256(JSON.stringify(candidateInputs.map(file=>[file,sha256(readFileSync(file))]))),
  sourceFunctionsSha256:sha256(JSON.stringify(writerSourceFunctions()))};
}
