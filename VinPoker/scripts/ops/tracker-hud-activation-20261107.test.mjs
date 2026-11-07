import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {buildActivationSql} from './tracker-hud-activation-20261107.mjs';
import {loadCorrectionPackage} from './tracker-hud-20261104-release.mjs';
const sha='a'.repeat(40),phases=['configure-url','start-workers','enable-reads'];
test('activation generator refuses ambiguous phase or SHA before producing SQL',()=>{
 for(const phase of ['apply','enable-reads;SELECT 1',''])assert.throws(()=>buildActivationSql(phase,sha));
 for(const value of ['',sha+'0',"';SELECT 1",sha.toUpperCase()])assert.throws(()=>buildActivationSql('configure-url',value));
});
test('every phase checks exact full33 receipts and supplemental ACLs before mutation',()=>{
 const p=loadCorrectionPackage(),entries=[...p.base.entries,p.entry];
 for(const phase of phases){const s=buildActivationSql(phase,sha);assert.equal(s.match(/activation_prior_receipt_differs/g).length,33);for(const e of entries){assert.ok(s.includes(e.sha256));assert.ok(s.includes("version='"+e.version+"'"));}
  assert.ok(s.includes(p.base.manifest.baselineLedgerFingerprint));assert.ok(s.includes('<>796'));
  assert.ok(s.indexOf('activation_context_not_approved')<s.indexOf('LOCK TABLE'));assert.ok(s.indexOf('activation_supplement_object_differs')<s.indexOf('END $activation_package$'));
  assert.ok(s.includes('a.is_grantable'));assert.ok(s.includes('array_agg(DISTINCT r.rolname'));
  assert.doesNotMatch(s,/UPDATE public\.|DELETE FROM|INSERT INTO public\.|GRANT |TRUNCATE|schema_migrations\s+SET/i);
 }
});
test('worker start preserves disabled reads and cutover requires completed work plus shadow',()=>{
 const w=buildActivationSql('start-workers',sha),r=buildActivationSql('enable-reads',sha);
 assert.ok(w.includes("username='postgres'"));assert.ok(w.includes("schedule='1 second'"));assert.ok(w.includes('SET worker_enabled=true'));assert.ok(!w.includes('SET enabled=true'));
 assert.ok(w.includes('database=current_database()'));
 assert.ok(r.indexOf('activation_backfill_shadow_prerequisite_differs')<r.indexOf('SET enabled=true'));
 for(const table of ['jobs','job_players','visibility_barriers','visibility_work'])assert.ok(r.includes('EXISTS(SELECT 1 FROM tracker_analytics_v1.'+table+')'));
 assert.ok(r.includes('verified_shadow_sha256'));assert.ok(r.includes("interval '5 minutes'"));
});
test('CLI prepares immutable hashed files only and refuses overwriting a prior package',t=>{
 const dir=mkdtempSync(join(tmpdir(),'hud-activation-artifacts-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const script=fileURLToPath(new URL('./tracker-hud-activation-20261107.mjs',import.meta.url));
 const first=spawnSync(process.execPath,[script,dir,sha],{encoding:'utf8'});assert.equal(first.status,0,first.stderr);
 const manifest=JSON.parse(readFileSync(join(dir,'manifest.json'),'utf8'));assert.equal(manifest.productionChanged,false);assert.equal(manifest.artifacts.length,3);
 for(const a of manifest.artifacts)assert.equal(createHash('sha256').update(readFileSync(join(dir,a.file))).digest('hex'),a.sha256);
 assert.notEqual(spawnSync(process.execPath,[script,dir,sha],{encoding:'utf8'}).status,0);
});
