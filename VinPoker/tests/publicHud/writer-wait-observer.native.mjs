// Read-only sampler self-test in the marked owned comparison database. This
// artificial sleep is not a source-writer arm or a qualification measurement.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {pgbench} from './nativeDb.mjs';
import {writerWaitDiagnosticEnabled} from './scale.write.protocol.mjs';
assert.equal(writerWaitDiagnosticEnabled(process.env),true);
const result=pgbench('SELECT pg_sleep(0.01);\n',{orderedTransactions:true});
const observation=result.waitDiagnostic;
const sleepSamples=observation?.samples?.filter(row=>row.backends.some(backend=>backend.waitEvent==='PgSleep')).length??0;
const ring=observation?.databaseContainer?.during;
const graded=result.transactions.filter(row=>!row.warmup);
const epoch=row=>row.epochSeconds+row.epochMicros/1e6;
const first=epoch(graded[0])-graded[0].latencyMs/1000,last=epoch(graded.at(-1));
const overlapping=ring?.samples?.filter(row=>row.epochSeconds>=first&&row.epochSeconds<=last).length??0;
const bracketed=ring?.samples?.filter(row=>row.epochSeconds>=first&&row.receivedEpochSeconds<=last&&row.receivedEpochSeconds>=row.epochSeconds).length??0;
// Retain failed reader evidence before enforcing the smoke gate.
writeFileSync('output/hud-scale/writer-wait-observer-native.json',JSON.stringify({
 kind:'READONLY_WRITER_WAIT_OBSERVER_SELF_TEST_NOT_QUALIFICATION',qualification:false,
 artificialSleepSeconds:.01,transactions:result.transactions.length,sleepSamples,
 overlappingTickDispatches:overlapping,completeFramesBracketedByTransactions:bracketed,observation,
 limits:'Lifecycle smoke only; dispatch-to-receipt bounds sequential reads, not exact kernel read time or writer qualification',
},null,2));
assert.equal(ring?.readyBeforeArm,true,'Container reader was not ready before smoke transactions');
assert.equal(ring.available,true,'Container reader did not produce valid evidence');
assert.equal(ring.exitCode,0,'Container reader did not exit normally on EOF');
assert.equal(ring.forcedStop,false,'Container reader required forced shutdown');
assert.ok(overlapping>=2,'Container reader lacks tick dispatch overlap with smoke transactions');
assert.ok(bracketed>=2,'Container reader lacks complete frames bracketed by smoke transactions');
assert.equal(observation?.available,true,'Writer wait sampler did not produce evidence');
assert.equal(observation.exitedBeforeStop,false,'Writer wait sampler exited early');
assert.ok(sleepSamples>0,'Sampler did not observe the reserved backend wait');
