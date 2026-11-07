import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {contextQuery,validateContext,restoreContextSql} from './recovery-database-context.mjs';
const fixture={version:1,database:'postgres',owner:'postgres',acl:[
 {grantee:null,grantor:'postgres',privilege:'CONNECT',grantable:false},
 {grantee:'postgres',grantor:'postgres',privilege:'CREATE',grantable:false},
]};
test('database context rejects unknown target/version/owner, grant chains and ambiguous ACLs',()=>{
 validateContext(fixture);
 for(const change of [{version:2},{owner:'supabase_admin'},{database:'other'},{acl:[]},{extra:true},
  {acl:[{...fixture.acl[0],grantor:'other'}]},{acl:[{...fixture.acl[0],grantable:true}]},
  {acl:[{...fixture.acl[0],privilege:'SUPERUSER'}]},{acl:[fixture.acl[0],fixture.acl[0]]}]){
  assert.throws(()=>validateContext({...fixture,...change}));
 }
});
test('restore quotes role names, scopes revocation and verifies exact effective context before commit',()=>{
 const sql=restoreContextSql({...fixture,acl:[...fixture.acl,{grantee:'quoted"role',grantor:'postgres',privilege:'TEMPORARY',grantable:true}]});
 for(const text of ['BEGIN;','current_database()<>\'postgres\'','ALTER DATABASE "postgres" OWNER TO postgres','SET LOCAL ROLE postgres','TO "quoted""role" WITH GRANT OPTION','recovery_database_context_postcheck_differs','COMMIT;'])assert.ok(sql.includes(text),text);
 assert.doesNotMatch(sql,/ALTER ROLE|CREATE ROLE|PASSWORD|CASCADE|UPDATE pg_database|GRANT.*ON ALL/);
});
test('actual PostgreSQL restores database owner, PUBLIC privileges and grant option after drift',{
 skip:process.env.RECOVERY_CONTEXT_NATIVE!=='1',
},()=>{
 const windows=process.platform==='win32';
 const suffix=process.env.GITHUB_RUN_ID??String(Date.now());assert.match(suffix,/^\d+$/);
 const db='vinpoker_hud_test_recovery_context_'+suffix;
 const query=(database,input)=>{
  const args=windows?['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE='+database,'psql']:[];
  try{return execFileSync(windows?'wsl':'psql',[...args,'-X','-qAt','-w','-v','ON_ERROR_STOP=1'],{
   input,encoding:'utf8',stdio:'pipe',env:{...process.env,PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',PGDATABASE:database},
  }).trim();}catch{throw Error('Owned native database context query failed; raw diagnostics withheld');}
 };
 query('postgres',`CREATE DATABASE "${db}" OWNER postgres;COMMENT ON DATABASE "${db}" IS 'owned-recovery-context-native';`);
 try{
  query(db,`REVOKE TEMPORARY ON DATABASE "${db}" FROM PUBLIC;GRANT CREATE ON DATABASE "${db}" TO pg_read_all_stats WITH GRANT OPTION;`);
  const original=JSON.parse(query(db,contextQuery));validateContext(original,db);
  query(db,`ALTER DATABASE "${db}" OWNER TO pg_read_all_stats;GRANT CONNECT ON DATABASE "${db}" TO pg_monitor;`);
  const drifted=JSON.parse(query(db,contextQuery));assert.notDeepEqual(drifted,original);
  const missingRole={...original,acl:[...original.acl,{grantee:'recovery_missing_'+suffix,grantor:'postgres',privilege:'CONNECT',grantable:false}]};
  assert.throws(()=>query(db,restoreContextSql(missingRole,db)));assert.deepEqual(JSON.parse(query(db,contextQuery)),drifted);
  assert.throws(()=>query(db,restoreContextSql({...original,acl:[...original.acl].reverse()},db)));
  assert.deepEqual(JSON.parse(query(db,contextQuery)),drifted,'Postcheck failure must roll back owner and ACL mutations');
  query(db,restoreContextSql(original,db));assert.deepEqual(JSON.parse(query(db,contextQuery)),original);
  query(db,restoreContextSql(original,db));assert.deepEqual(JSON.parse(query(db,contextQuery)),original);
 }finally{
  assert.equal(query(db,"SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'owned-recovery-context-native');
  query('postgres',`DROP DATABASE "${db}";`);
 }
});
