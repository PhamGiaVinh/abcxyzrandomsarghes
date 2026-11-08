import test from 'node:test';
import assert from 'node:assert/strict';
import {loadDispatchPackage,validateDispatchState,validateDispatcherObjects,dispatchStateSql} from './tracker-hud-dispatch-url-20261107-release.mjs';
import {atomicQuery} from './tracker-hud-20261104-release.mjs';
const pkg=loadDispatchPackage();
const good=()=>({baseline:{rows:763,fingerprint:pkg.base.manifest.baselineLedgerFingerprint,applied:34,spectatorPaused:true},receiptsMatch:true,supplementAbsent:true});
test('supplement35 preserves exact34 prefix and atomic receipt guards',()=>{
 assert.equal(pkg.base.entries.length,34);assert.equal(pkg.entry.order,35);
 const q=atomicQuery(pkg.entry,pkg.base);assert.ok(q.includes('<>797'));assert.ok(q.includes('LOCK TABLE supabase_migrations.schema_migrations'));assert.ok(q.includes('$ops1359_receipt$'+pkg.entry.sql+'$ops1359_receipt$'));
 for(const entry of pkg.base.entries)assert.ok(q.includes(entry.sha256));
 assert.ok(dispatchStateSql(pkg).includes("version='20261107151500'"));
 assert.equal(pkg.manifest.releaseReady,true);
});
test('dispatcher supplement rejects partial/drifted/unpaused state and ambiguous resume',()=>{
 validateDispatchState(good(),pkg);
 for(const mutate of [r=>r.baseline.rows++,r=>r.baseline.fingerprint='changed',r=>r.baseline.applied=33,r=>r.baseline.spectatorPaused=false,r=>r.receiptsMatch=false,r=>r.supplementAbsent=false]){const row=good();mutate(row);assert.throws(()=>validateDispatchState(row,pkg));}
});
test('both exact dispatcher definitions and least-privilege ACLs are required',()=>{
 const expected=[pkg.manifest.postcheck,pkg.manifest.spectatorPostcheck];const rows=()=>expected.map(p=>({...p,grantOptions:0}));validateDispatcherObjects(rows(),expected);
 for(const mutate of [r=>r.pop(),r=>r[0].definitionMd5='drift',r=>r[1].executeRoles=[...r[1].executeRoles,'authenticated'],r=>r[0].grantOptions=1,r=>r[0].securityDefiner=false]){const actual=rows();mutate(actual);assert.throws(()=>validateDispatcherObjects(actual,expected));}
});
