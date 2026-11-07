import test from 'node:test';
import assert from 'node:assert/strict';
import {loadClosePackage,validateCloseState,validateCloseObjects,closeStateSql,closeObjectsSql} from './tracker-hud-close-paid-prize-20261107-release.mjs';
import {atomicQuery} from './tracker-hud-20261104-release.mjs';
const pkg=loadClosePackage();
const good=()=>({baseline:{rows:pkg.base.manifest.baselineLedgerRows,fingerprint:pkg.base.manifest.baselineLedgerFingerprint,applied:33,spectatorPaused:true},receiptsMatch:true,supplementAbsent:true});
test('close supplement is separate migration34 after exact33 and pinned recovery',()=>{
 assert.equal(pkg.entry.order,34);assert.equal(pkg.base.entries.length,33);assert.equal(pkg.manifest.releaseReady,false);
 const s=closeStateSql(pkg);assert.equal((s.match(/cardinality\(statements\)=1/g)||[]).length,33);
 for(const e of pkg.base.entries)assert.ok(s.includes(e.sha256));
});
test('preflight rejects partial prefix, drift, active dispatcher and existing receipt',()=>{
 validateCloseState(good(),pkg);
 for(const applied of [0,31,32,34]){const r=good();r.baseline.applied=applied;assert.throws(()=>validateCloseState(r,pkg));}
 for(const [k,v] of [['rows',0],['fingerprint','changed'],['spectatorPaused',false]]){const r=good();r.baseline[k]=v;assert.throws(()=>validateCloseState(r,pkg));}
 for(const key of ['receiptsMatch','supplementAbsent']){const r=good();r[key]=false;assert.throws(()=>validateCloseState(r,pkg));}
});
test('postcheck requires exact bodies and metadata without public/grantable execute',()=>{
 const rows=()=>pkg.manifest.postchecks.map(r=>({...r,executeRoles:[...r.executeRoles].sort(),grantOptions:0}));
 validateCloseObjects(rows(),pkg.manifest.postchecks);assert.throws(()=>validateCloseObjects(rows().slice(1),pkg.manifest.postchecks));
 for(const [key,value] of [['definitionMd5','wrong'],['owner','authenticated'],['securityDefiner',false],['volatile','i'],['searchPath',['search_path=public, extensions']],['executeRoles',['PUBLIC']],['grantOptions',1]]){const r=rows();r[0][key]=value;assert.throws(()=>validateCloseObjects(r,pkg.manifest.postchecks));}
 assert.ok(closeObjectsSql().includes("a.grantee=0 THEN 'PUBLIC'"));
});
test('atomic apply fences baseline and all33 receipts before function changes and ledger',()=>{
 const s=atomicQuery(pkg.entry,pkg.base);assert.ok(s.includes('<>796'));assert.equal((s.match(/HUD release prior receipt differs/g)||[]).length,33);
 assert.ok(s.indexOf('LOCK TABLE supabase_migrations.schema_migrations')<s.indexOf('close_paid_prize_owner_required'));
 assert.ok(s.includes('pg_advisory_xact_lock(20261104,1)'));assert.ok(s.includes("status = ''paid''"));
});
