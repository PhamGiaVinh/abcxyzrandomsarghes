import assert from 'node:assert/strict';
import test from 'node:test';
import {loadReentryPackage,validateReentryState,validateReentryPostcheck,atomicQuery,validateRecovery,PROJECT} from './tracker-hud-20261104-release.mjs';

const pkg=loadReentryPackage();
const state=()=>({baseline:{rows:pkg.base.manifest.baselineLedgerRows,fingerprint:pkg.base.manifest.baselineLedgerFingerprint,applied:31,spectatorPaused:true},receiptsMatch:true,supplementAbsent:true,objectAbsent:true});
test('supplement pins unchanged31 package and exact32 source/recovery',()=>{
 assert.equal(pkg.base.entries.length,31);assert.equal(pkg.entry.order,32);
 assert.doesNotThrow(()=>validateReentryState(state(),pkg.base));
 assert.equal((atomicQuery(pkg.entry,pkg.base).match(/cardinality\(statements\)=1/g)??[]).length,31);
});
for(const [name,mutate] of [
 ['partial receipts',s=>s.baseline.applied=30],['extra statement or changed receipt',s=>s.receiptsMatch=false],
 ['existing32',s=>s.supplementAbsent=false],['existing RPC',s=>s.objectAbsent=false],
 ['baseline drift',s=>s.baseline.fingerprint='changed'],['unpaused dispatcher',s=>s.baseline.spectatorPaused=false],
])test('rejects '+name,()=>{const s=state();mutate(s);assert.throws(()=>validateReentryState(s,pkg.base));});
test('exact postimage and ACL required',()=>{
 const good={...pkg.manifest.postcheck,grantOptions:0};
 assert.doesNotThrow(()=>validateReentryPostcheck(good,pkg.manifest));
 for(const patch of [{bodyMd5:'changed'},{securityInvoker:false},{executeRoles:['PUBLIC','postgres','service_role']},{grantOptions:1},{searchPath:null}, {owner:'service_role'}])assert.throws(()=>validateReentryPostcheck({...good,...patch},pkg.manifest));
 assert.throws(()=>validateReentryPostcheck(null,pkg.manifest));
});
test('recovery must be fresh, verified and private',()=>{
 const now=Date.now(),good={projectRef:PROJECT,producerExit:0,fullArchiveStreamReadbackExit:0,bytes:1,sha256:'a'.repeat(64),privateStorage:'private',restoreProcedure:'documented',interveningWritesAssessed:true,snapshotStart:new Date(now).toISOString()};
 assert.doesNotThrow(()=>validateRecovery(good,now));
 for(const patch of [{snapshotStart:new Date(now-3600001).toISOString()},{fullArchiveStreamReadbackExit:1},{interveningWritesAssessed:false}])assert.throws(()=>validateRecovery({...good,...patch},now));
});
