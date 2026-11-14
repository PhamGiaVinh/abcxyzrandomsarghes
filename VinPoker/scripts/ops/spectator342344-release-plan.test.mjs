import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadPackage,classifyPreflight,preflightSql} from './spectator342344-release-plan.mjs';

const source=process.env.RELEASE_SOURCE_ROOT;
assert.ok(source,'Explicit qualified product source required');
test('exact source yields three separately transactional migration receipts',()=>{
 const {manifest,entries}=loadPackage(source);
 assert.equal(manifest.sourcePr,1646);
 assert.equal(entries.length,3);
 for(const entry of entries){
  assert.match(entry.atomic,/^--[\s\S]*BEGIN;/);
  assert.ok(entry.atomic.indexOf('INSERT INTO supabase_migrations.schema_migrations')<entry.atomic.lastIndexOf('COMMIT;'));
  assert.ok(entry.atomic.includes(`VALUES ('${entry.version}', '${entry.name}'`));
  assert.ok(entry.atomic.includes("SET LOCAL lock_timeout='1s'"));
  assert.ok(entry.atomic.includes("SET LOCAL statement_timeout='10s'"));
  assert.equal(entry.atomic.split('INSERT INTO supabase_migrations.schema_migrations').length,2);
 }
});
test('changed migration bytes are rejected before producing an apply package',()=>{
 const root=mkdtempSync(join(tmpdir(),'spectator-release-'));
 try{
  mkdirSync(join(root,'supabase/migrations'),{recursive:true});
  const {entries}=loadPackage(source);
  for(const e of entries)writeFileSync(join(root,e.path),readFileSync(join(source,e.path)));
  writeFileSync(join(root,entries[1].path),entries[1].source+'\n-- changed\n');
  assert.throws(()=>loadPackage(root),/Migration drift/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
const ready={database:'postgres',actor:'postgres',pending:0,floor345:true,marker:true,source:true,targetsAbsent:true,dispatcher:true};
test('only exact source and live dispatcher preflight is accepted',()=>{
 classifyPreflight(ready);
 for(const key of Object.keys(ready)){
  assert.throws(()=>classifyPreflight({...ready,[key]:null}),/drift/);
 }
 assert.throws(()=>classifyPreflight({...ready,pending:1}),/drift/);
 assert.throws(()=>classifyPreflight({...ready,actor:'service_role'}),/drift/);
});
test('preflight is read-only and retains the deployed Floor345 boundary',()=>{
 const sql=preflightSql();
 assert.match(sql,/^BEGIN READ ONLY;/);
 assert.ok(sql.includes("version='20270128000345'"));
 assert.ok(sql.includes("jobid=52 AND active AND schedule='1 second'"));
 assert.doesNotMatch(sql,/\b(UPDATE|DELETE|INSERT|ALTER|DROP|TRUNCATE)\b/);
});
