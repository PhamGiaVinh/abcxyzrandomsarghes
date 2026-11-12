import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writerDiagnosticAdminTarget} from './scale.write.native.mjs';
import {sourceGeneration342Profile,requireMatchedWriterQualification} from './scale.write.protocol.mjs';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
test('migration342 writer profile is explicit and pins exact migration bytes',()=>{
 const source=readFileSync(new URL('../../supabase/migrations/'+sourceGeneration342Profile.migration,import.meta.url),'utf8');
 assert.equal(createHash('sha256').update(source.replace(/\r\n?/g,'\n')).digest('hex'),sourceGeneration342Profile.sqlSha256);
 assert.throws(()=>requireMatchedWriterQualification({sourceGenerationCandidate:sourceGeneration342Profile.migration},{sha:'a'.repeat(40)}),/Explicit source generation/);
 assert.throws(()=>requireMatchedWriterQualification({},{sha:'a'.repeat(40)},{sourceGenerationProbe:true}),/Explicit source generation/);
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
