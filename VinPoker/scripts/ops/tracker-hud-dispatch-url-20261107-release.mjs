import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonicalSqlText} from './ops-1359-release-gate.mjs';
import {loadClosePackage,CLOSE_MANIFEST_HASH} from './tracker-hud-close-paid-prize-20261107-release.mjs';
import {stateSql,validateState,atomicQuery,validateRecovery,PROJECT} from './tracker-hud-20261104-release.mjs';
export const DISPATCH_URL_MANIFEST_HASH='9036be3b3165f44eee5c8c8c1f50c05948239561910eb3e0e97ea6fc61b886d9';
const ROOT=fileURLToPath(new URL('../..',import.meta.url));
const sha=text=>createHash('sha256').update(canonicalSqlText(text)).digest('hex');
export function loadDispatchPackage(root=ROOT){
 const prior=loadClosePackage(root),raw=readFileSync(resolve(root,'scripts/ops/tracker-hud-dispatch-url-20261107-manifest.json'),'utf8');
 assert.equal(sha(raw),DISPATCH_URL_MANIFEST_HASH);const manifest=JSON.parse(raw),entry=manifest.migrations[0];
 assert.equal(manifest.projectRef,PROJECT);assert.equal(manifest.priorManifest.sha256,CLOSE_MANIFEST_HASH);
 assert.equal(manifest.migrations.length,1);assert.equal(entry.order,35);assert.equal(entry.version,'20261107151500');
 const source=canonicalSqlText(readFileSync(resolve(root,entry.path),'utf8'));
 assert.equal(sha(source),entry.sha256);assert.equal(sha(readFileSync(resolve(root,manifest.recovery.path),'utf8')),manifest.recovery.sha256);
 return {base:{...prior.base,entries:[...prior.base.entries,prior.entry]},closeManifest:prior.manifest,manifest,entry:{...entry,sql:source}};
}
export function dispatcherObjectsSql(){return `SELECT coalesce(json_agg(row_to_json(x) ORDER BY x.signature),'[]'::json)::text FROM (
 SELECT 'public.'||p.proname||'()' AS signature,md5(replace(pg_get_functiondef(p.oid),chr(13),'')) AS "definitionMd5",
 pg_get_userbyid(p.proowner) AS owner,p.prosecdef AS "securityDefiner",p.provolatile AS volatile,p.proconfig AS "searchPath",
 (SELECT json_agg(role_name ORDER BY role_name) FROM (SELECT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END role_name FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE') roles) AS "executeRoles",
 (SELECT count(*) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.is_grantable) AS "grantOptions"
 FROM pg_proc p WHERE p.oid IN(to_regprocedure('public.dispatch_public_hud_projection_v1()'),to_regprocedure('public.dispatch_public_spectator_projection_v2()'))
 ) x;`;}
export function validateDispatcherObjects(rows,expected){
 assert.equal(rows.length,2);assert.equal(expected.length,2);
 for(const p of expected){const r=rows.find(r=>r.signature===p.signature);assert.ok(r);for(const k of ['definitionMd5','owner','securityDefiner','volatile','searchPath','executeRoles'])assert.deepEqual(r[k],k==='executeRoles'?[...p[k]].sort():p[k],'Dispatcher object differs: '+k);assert.equal(Number(r.grantOptions),0);}
}
export function dispatchStateSql(pkg){
 const receipts=pkg.base.entries.map(e=>`EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${e.version}' AND name='${e.name}' AND cardinality(statements)=1 AND encode(extensions.digest(convert_to(statements[1],'UTF8'),'sha256'),'hex')='${e.sha256}')`).join(' AND ');
 return `SELECT json_build_object('baseline',(${stateSql(pkg.base.entries).trim().replace(/;$/,'')})::json,'receiptsMatch',(${receipts}),'supplementAbsent',NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261107151500' OR name='public_hud_dispatch_project_url_v1'))::text;`;
}
export function validateDispatchState(row,pkg){
 validateState({...row.baseline,applied:0},pkg.base);assert.equal(Number(row.baseline.applied),34);assert.equal(row.receiptsMatch,true);assert.equal(row.supplementAbsent,true,'No automatic resume');
}
function query(sql){const p=spawnSync(process.env.PSQL_BIN||'psql',['-X','-qAt','-w','-v','ON_ERROR_STOP=1','-f','-'],{input:sql,encoding:'utf8',maxBuffer:1024*1024});if(p.error||p.status!==0)throw Error('Private database command failed; no automatic retry');return p.stdout.trim();}
function run(){
 const mode=process.argv[2];assert.ok(['plan','apply'].includes(mode));const pkg=loadDispatchPackage();
 assert.equal(process.env.PGHOST,'db.'+PROJECT+'.supabase.co');assert.equal(process.env.PGPORT,'5432');assert.equal(process.env.PGUSER,'postgres');assert.equal(process.env.PGDATABASE,'postgres');assert.equal(process.env.PGSSLMODE,'require');assert.ok(process.env.PGPASSWORD);
 validateDispatchState(JSON.parse(query(dispatchStateSql(pkg))),pkg);validateDispatcherObjects(JSON.parse(query(dispatcherObjectsSql())),[pkg.manifest.precheck,pkg.manifest.spectatorPostcheck]);
 if(mode==='plan'){console.log(JSON.stringify({project:PROJECT,manifestHash:DISPATCH_URL_MANIFEST_HASH,priorReceipts:34,migrations:1,productionChanged:false}));return;}
 assert.equal(pkg.manifest.releaseReady,true,'Full35 qualification and final freeze pending');assert.equal(process.env.CONFIRM_TRACKER_HUD_APPLY,'APPLY_35_'+DISPATCH_URL_MANIFEST_HASH);
 const sourceSha=execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();assert.match(process.env.TRACKER_HUD_APPROVED_SHA??'',/^[a-f0-9]{40}$/);assert.equal(sourceSha,process.env.TRACKER_HUD_APPROVED_SHA);assert.equal(execFileSync('git',['status','--porcelain'],{cwd:ROOT,encoding:'utf8'}).trim(),'');
 validateRecovery(JSON.parse(readFileSync(process.env.TRACKER_HUD_RECOVERY_RECEIPT,'utf8')));
 const path=process.env.TRACKER_HUD_APPLY_REPORT;assert.ok(path);const report={project:PROJECT,sourceSha,manifestHash:DISPATCH_URL_MANIFEST_HASH,status:'RUNNING',committed:[]};writeFileSync(path,JSON.stringify(report,null,2),{flag:'wx'});
 try{query(atomicQuery(pkg.entry,pkg.base));const receipt=JSON.parse(query(`SELECT json_build_object('name',name,'statements',cardinality(statements),'hash',encode(extensions.digest(convert_to(statements[1],'UTF8'),'sha256'),'hex'))::text FROM supabase_migrations.schema_migrations WHERE version='20261107151500';`));assert.equal(receipt.name,pkg.entry.name);assert.equal(receipt.statements,1);assert.equal(receipt.hash,pkg.entry.sha256);validateDispatcherObjects(JSON.parse(query(dispatcherObjectsSql())),[pkg.manifest.postcheck,pkg.manifest.spectatorPostcheck]);report.committed.push({version:pkg.entry.version,sha256:pkg.entry.sha256});report.status='DISPATCH_SUPPLEMENT_ATOMIC_RECEIPT_AND_OBJECTS_VERIFIED';}
 catch{report.status='STOPPED_PARTIAL_OR_UNCONFIRMED_NO_RETRY';writeFileSync(path,JSON.stringify(report,null,2));throw Error('STOP supplement35; inspect exact receipt privately before further action');}
 writeFileSync(path,JSON.stringify(report,null,2));console.log(report.status);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{run();}catch(e){console.error(e.message);process.exitCode=1;}}
