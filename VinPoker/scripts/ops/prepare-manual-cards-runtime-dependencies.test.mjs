import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const entry=fileURLToPath(new URL('./prepare-manual-cards-runtime-dependencies.mjs',import.meta.url));
test('manual cards fixture rejects ambiguous targets',()=>{
 for(const args of [[],['relative/manual-cards-dependencies.sql'],[join(tmpdir(),'other.sql')]])assert.notEqual(spawnSync(process.execPath,[entry,...args],{encoding:'utf8'}).status,0);
});
test('manual cards fixture preserves exact APIs and original authority postchecks',t=>{
 const dir=mkdtempSync(join(tmpdir(),'manual-cards-dependencies-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'manual-cards-dependencies.sql').replaceAll('\\','/');
 const result=spawnSync(process.execPath,[entry,path],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
 const sql=readFileSync(path,'utf8');assert.equal(JSON.parse(result.stdout).productionChanged,false);
 for(const guard of ['manual_cards_owned_fixture_required','manual_cards_fixture_catalog_collision','manual_cards_fixture_dependency_drift'])assert.ok(sql.indexOf(guard)<sql.indexOf('CREATE TABLE'));
 assert.equal((sql.match(/CREATE FUNCTION /g)||[]).length,5);assert.equal((sql.match(/CREATE TABLE /g)||[]).length,1);
 for(const hash of ['37faf2e637e06d255c0f9186d3a7e9e9','0e43636469573f0f9722639ca283f346','47b08ebea2d7909ae8e8d99864440560','29f9eeb5563d236d0c6de4cf8c0f98b9','53374e21fe6d323affa8a074402f4b85'])assert.ok(sql.includes(hash));
 assert.match(sql,/manual75_receipt_table_postcheck/);assert.match(sql,/manual75_function_postcheck/);
 assert.doesNotMatch(sql,/CREATE OR REPLACE|ALTER ROLE|BYPASSRLS|schema_migrations/i);
 assert.notEqual(spawnSync(process.execPath,[entry,path],{encoding:'utf8'}).status,0);
});
