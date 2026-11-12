// Read-only sampler self-test in the marked owned comparison database. This
// artificial sleep is not a source-writer arm or a qualification measurement.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {pgbench} from './nativeDb.mjs';
import {writerWaitDiagnosticEnabled} from './scale.write.protocol.mjs';
assert.equal(writerWaitDiagnosticEnabled(process.env),true);
const result=pgbench('SELECT pg_sleep(0.01);\n',{orderedTransactions:true});
const observation=result.waitDiagnostic;
assert.equal(observation?.available,true,'Writer wait sampler did not produce evidence');
assert.equal(observation.exitedBeforeStop,false,'Writer wait sampler exited early');
const sleepSamples=observation.samples.filter(row=>row.backends.some(backend=>backend.waitEvent==='PgSleep')).length;
assert.ok(sleepSamples>0,'Sampler did not observe the reserved backend wait');
writeFileSync('output/hud-scale/writer-wait-observer-native.json',JSON.stringify({
 kind:'READONLY_WRITER_WAIT_OBSERVER_SELF_TEST_NOT_QUALIFICATION',qualification:false,
 artificialSleepSeconds:.01,transactions:result.transactions.length,sleepSamples,observation,
},null,2));
