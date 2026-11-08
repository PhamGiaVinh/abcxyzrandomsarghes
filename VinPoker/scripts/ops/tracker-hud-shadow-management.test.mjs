import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {managementShadowSql} from './tracker-hud-shadow-management.mjs';
import {shadowSql,createShadow,loadClassifier} from './tracker-hud-shadow.mjs';

test('management shadow preserves all six canonical phases in one read-only snapshot',()=>{
 const sql=managementShadowSql();assert.match(sql,/BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
 assert.match(sql,/full_shadow_requires_direct_streaming_transport/);assert.match(sql,/ORDER BY phase/);assert.ok(sql.endsWith('ROLLBACK;'));
 assert.equal((sql.match(/shadow_phase_\d\(value\) AS/g)||[]).length,6);
 assert.doesNotMatch(sql,/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/);
 assert.ok(sql.indexOf('full_shadow_requires_direct_streaming_transport')<sql.indexOf('WITH shadow_phase_0'));
});
test('management envelope matches the original complete stream on real PostgreSQL', {skip:process.env.HUD_SHADOW_MANAGEMENT_NATIVE!=='1'},async()=>{
 assert.equal(process.env.GITHUB_ACTIONS,'true');const database=process.env.PUBLIC_HUD_LOCAL_DATABASE;assert.match(database??'',/^vinpoker_hud_test_[a-z0-9_]+$/);assert.equal(process.env.PGPASSWORD,'postgres');
 const pg=sql=>{const p=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1','-f','-'],{input:sql,encoding:'utf8',maxBuffer:16*1024*1024,env:{...process.env,PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',PGDATABASE:database}});assert.equal(p.status,0,'Native read-only shadow failed');return p.stdout.trim().split('\n').filter(Boolean).map(JSON.parse);};
 const original=pg(shadowSql),envelope=pg(managementShadowSql());
 const sort=rows=>rows.map(row=>{const x={...row};if(x.kind==='header')delete x.snapshot;return JSON.stringify(x);}).sort();
 assert.deepEqual(sort(envelope),sort(original));
 const classifier=await loadClassifier();for(const rows of [original,envelope]){const shadow=createShadow(classifier);for(const row of rows)shadow.accept(row);const r=shadow.finish();assert.equal(r.complete,true);assert.equal(r.passed,true);assert.equal(r.mismatches,0);}
});
