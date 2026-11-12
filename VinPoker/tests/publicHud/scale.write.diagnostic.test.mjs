import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writerDiagnosticAdminTarget} from './scale.write.native.mjs';
import {sourceGeneration342Profile,pendingSourceProfile,pendingSourceProbeEnabled,requireMatchedWriterQualification} from './scale.write.protocol.mjs';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
test('migration342 writer profile is explicit and pins exact migration bytes',()=>{
 const source=readFileSync(new URL('../../supabase/migrations/'+sourceGeneration342Profile.migration,import.meta.url),'utf8');
 assert.equal(createHash('sha256').update(source.replace(/\r\n?/g,'\n')).digest('hex'),sourceGeneration342Profile.sqlSha256);
 assert.throws(()=>requireMatchedWriterQualification({sourceGenerationCandidate:sourceGeneration342Profile.migration},{sha:'a'.repeat(40)}),/Explicit source generation/);
 assert.throws(()=>requireMatchedWriterQualification({},{sha:'a'.repeat(40)},{sourceGenerationProbe:true}),/Explicit source generation/);
});
test('pending source profile pins native-verified SQL and requires explicit generation mode',()=>{
 const source=readFileSync(new URL('../../supabase/migrations/'+pendingSourceProfile.migration,import.meta.url),'utf8');
 assert.equal(createHash('sha256').update(source.replace(/\r\n?/g,'\n')).digest('hex'),pendingSourceProfile.sqlSha256);
 assert.equal(pendingSourceProfile.definitionMd5,'6269d9fc1b2737f30b56a4bcdb42fb79');
 assert.equal(pendingSourceProbeEnabled({}),false);
 assert.equal(pendingSourceProbeEnabled({PUBLIC_HUD_PENDING_SOURCE_PROBE:'0'}),false);
 assert.equal(pendingSourceProbeEnabled({PUBLIC_HUD_PENDING_SOURCE_PROBE:'1',PUBLIC_HUD_SOURCE_GENERATION_PROBE:'1'}),true);
 for(const env of [{PUBLIC_HUD_PENDING_SOURCE_PROBE:'unknown'},{PUBLIC_HUD_PENDING_SOURCE_PROBE:'1'},
  {PUBLIC_HUD_PENDING_SOURCE_PROBE:'1',PUBLIC_HUD_SOURCE_GENERATION_PROBE:'0'}])assert.throws(()=>pendingSourceProbeEnabled(env),/pending source|generation342/);
});
const env={PUBLIC_HUD_LOCAL_PORT:'54322',PUBLIC_HUD_STACK_PROJECT:'hud-scale-123-1',
 PUBLIC_HUD_LOCAL_DATABASE:'vinpoker_hud_test_pair_123_1',PUBLIC_HUD_ISOLATED_STACK:'',
 PUBLIC_HUD_WRITER_DIAGNOSTIC:'isolated-comparison-admin'};
test('comparison instrumentation binds explicit mode,project and exact disposable database',()=>{
 assert.deepEqual(writerDiagnosticAdminTarget(env),{project:'hud-scale-123-1',database:'vinpoker_hud_test_pair_123_1',marker:'vinpoker-hud-writer-control-disposable'});
 for(const change of [{PUBLIC_HUD_LOCAL_PORT:'5432'},{PUBLIC_HUD_LOCAL_DATABASE:'postgres'},
  {PUBLIC_HUD_LOCAL_DATABASE:'vinpoker_hud_test_pair_124_1'},{PUBLIC_HUD_STACK_PROJECT:'production'},
  {PUBLIC_HUD_STACK_PROJECT:"hud-scale-x';--"},{PUBLIC_HUD_ISOLATED_STACK:'vinpoker-hud-scale'},
  {PUBLIC_HUD_WRITER_DIAGNOSTIC:'unknown'}])assert.throws(()=>writerDiagnosticAdminTarget({...env,...change}),/writer_diagnostic_scope_required/);
});
test('original isolated-stack marker is retained and normal native callers do not select admin',()=>{
 assert.equal(writerDiagnosticAdminTarget({}),null);
 assert.equal(writerDiagnosticAdminTarget({...env,PUBLIC_HUD_WRITER_DIAGNOSTIC:undefined}),null);
 assert.deepEqual(writerDiagnosticAdminTarget({...env,PUBLIC_HUD_WRITER_DIAGNOSTIC:undefined,
  PUBLIC_HUD_ISOLATED_STACK:'vinpoker-hud-scale',PUBLIC_HUD_LOCAL_DATABASE:'postgres'}),
 {project:'hud-scale-123-1',database:'postgres',marker:'vinpoker-hud-scale-disposable'});
});
