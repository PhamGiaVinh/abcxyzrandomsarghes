import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const entry=fileURLToPath(new URL('./prepare-prize-close-runtime-dependencies.mjs',import.meta.url));
test('prize fixture builder refuses ambiguous target before writing output',()=>{
 for(const args of [[],['relative/prize-close-dependencies.sql'],[join(tmpdir(),'other.sql')]])assert.notEqual(spawnSync(process.execPath,[entry,...args],{encoding:'utf8'}).status,0);
});
test('prize fixture reconstructs exact four current APIs under owned guards only',t=>{
 const dir=mkdtempSync(join(tmpdir(),'prize-dependencies-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'prize-close-dependencies.sql').replaceAll('\\','/');const result=spawnSync(process.execPath,[entry,path],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
 const meta=JSON.parse(result.stdout);assert.equal(meta.functions,4);assert.equal(meta.productionChanged,false);const sql=readFileSync(path,'utf8');
 assert.ok(sql.indexOf('prize_dependency_owned_context_required')<sql.indexOf('CREATE TABLE'));
 assert.ok(sql.indexOf('prize_dependency_catalog_collision')<sql.indexOf('CREATE TABLE'));
 assert.ok(sql.includes("current_database()<>'postgres'"));assert.ok(sql.includes("current-full34-only"));
 assert.equal((sql.match(/CREATE FUNCTION /g)||[]).length,4);assert.equal((sql.match(/CREATE TABLE /g)||[]).length,1);
 for(const hash of ['0ff8786f320a9435e75e764b737b191e','13e7c254ebf5eabe622246759d772c0c','5e7f9c0fbeb616b0473bbacd8e4202fe','bab738dd1a069939fd960067effa4cfe','ef13f8bf6a3c811f4be1e78fd6283281'])assert.ok(sql.includes(hash));
 assert.ok(sql.includes('ENABLE ROW LEVEL SECURITY'));assert.ok(sql.includes('a.grantee=0 OR a.is_grantable OR a.grantor<>p.proowner'));assert.doesNotMatch(sql,/DROP |CREATE OR REPLACE FUNCTION|ALTER ROLE|BYPASSRLS|schema_migrations/i);
 assert.notEqual(spawnSync(process.execPath,[entry,path],{encoding:'utf8'}).status,0,'Prior SQL output must remain immutable');assert.equal(existsSync(path),true);
});
