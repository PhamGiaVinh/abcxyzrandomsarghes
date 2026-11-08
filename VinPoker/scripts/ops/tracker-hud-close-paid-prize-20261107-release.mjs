import {productionQuery as query,validateProductionConnection} from './tracker-hud-production-query.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonicalSqlText} from './ops-1359-release-gate.mjs';
import {loadCorrectionPackage,stateSql,validateState,atomicQuery,validateRecovery,PROJECT,CORRECTION_MANIFEST_HASH} from './tracker-hud-20261104-release.mjs';
export const CLOSE_MANIFEST_HASH='e4d9141c380a97ada81806bad0723314cbb450dcb15938cde2b796cb991522a1';
const ROOT=fileURLToPath(new URL('../..',import.meta.url));
const sha=s=>createHash('sha256').update(canonicalSqlText(s)).digest('hex');
export function loadClosePackage(root=ROOT){
 const prior=loadCorrectionPackage(root),raw=readFileSync(resolve(root,'scripts/ops/tracker-hud-close-paid-prize-20261107-manifest.json'),'utf8');
 assert.equal(sha(raw),CLOSE_MANIFEST_HASH,'Reviewed close supplement manifest differs');
 const manifest=JSON.parse(raw),entry=manifest.migrations[0];
 assert.equal(manifest.projectRef,PROJECT);assert.equal(manifest.priorManifest.sha256,CORRECTION_MANIFEST_HASH);
 assert.equal(manifest.migrations.length,1);assert.equal(entry.order,34);assert.equal(entry.version,'20261107093000');
 const source=canonicalSqlText(readFileSync(resolve(root,entry.path),'utf8'));
 assert.equal(sha(source),entry.sha256);assert.equal(sha(readFileSync(resolve(root,manifest.recovery.path),'utf8')),manifest.recovery.sha256);
 return {base:{...prior.base,entries:[...prior.base.entries,prior.entry]},manifest,entry:{...entry,sql:source}};
}
export function closeObjectsSql(){return `SELECT coalesce(json_agg(row_to_json(x) ORDER BY x.signature),'[]'::json)::text FROM (
 SELECT 'public.'||p.proname||'('||replace(oidvectortypes(p.proargtypes),', ', ',')||')' AS signature,md5(replace(pg_get_functiondef(p.oid),chr(13),'')) AS "definitionMd5",
 pg_get_userbyid(p.proowner) AS owner,p.prosecdef AS "securityDefiner",p.provolatile AS volatile,p.proconfig AS "searchPath",
 (SELECT json_agg(role_name ORDER BY role_name) FROM (SELECT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END role_name FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE') roles) AS "executeRoles",
 (SELECT count(*) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.is_grantable) AS "grantOptions"
 FROM pg_proc p WHERE p.oid IN(to_regprocedure('public.close_tournament(uuid,text)'),to_regprocedure('public.get_tournament_close_readiness_v1(uuid)'))
 ) x;`;}
export function validateCloseObjects(rows,expected){
 assert.equal(rows.length,2,'Both close objects required');assert.equal(expected.length,2);
 for(const p of expected){const r=rows.find(r=>r.signature===p.signature);assert.ok(r,'Close object missing');for(const k of ['definitionMd5','owner','securityDefiner','volatile','searchPath','executeRoles'])assert.deepEqual(r[k],k==='executeRoles'?[...p[k]].sort():p[k],'Close object differs: '+k);assert.equal(Number(r.grantOptions),0);}
}
export function closeStateSql(pkg){
 const receipts=pkg.base.entries.map(e=>`EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${e.version}' AND name='${e.name}' AND cardinality(statements)=1 AND encode(extensions.digest(convert_to(statements[1],'UTF8'),'sha256'),'hex')='${e.sha256}')`).join(' AND ');
 return `SELECT json_build_object('baseline',(${stateSql(pkg.base.entries).trim().replace(/;$/,'')})::json,'receiptsMatch',(${receipts}),'supplementAbsent',NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261107093000' OR name='tournament_close_paid_prize_source_v1'))::text;`;
}
export function validateCloseState(row,pkg){
 validateState({...row.baseline,applied:0},pkg.base);
 assert.equal(Number(row.baseline.applied),33,'All33 exact prior receipts required');assert.equal(row.receiptsMatch,true);assert.equal(row.supplementAbsent,true,'No automatic resume');
}

function run(){
 const mode=process.argv[2];assert.ok(['plan','apply'].includes(mode),'Use plan or apply');const pkg=loadClosePackage();
 validateProductionConnection();
 validateCloseState(JSON.parse(query(closeStateSql(pkg))),pkg);validateCloseObjects(JSON.parse(query(closeObjectsSql())),pkg.manifest.prechecks);
 if(mode==='plan'){console.log(JSON.stringify({project:PROJECT,manifestHash:CLOSE_MANIFEST_HASH,priorReceipts:33,migrations:1,productionChanged:false}));return;}
 assert.equal(pkg.manifest.releaseReady,true,'Final qualification and package freeze remain pending');
 assert.equal(process.env.CONFIRM_TRACKER_HUD_APPLY,'APPLY_34_'+CLOSE_MANIFEST_HASH);
 const sourceSha=execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();assert.match(process.env.TRACKER_HUD_APPROVED_SHA??'',/^[a-f0-9]{40}$/);assert.equal(sourceSha,process.env.TRACKER_HUD_APPROVED_SHA);assert.equal(execFileSync('git',['status','--porcelain'],{cwd:ROOT,encoding:'utf8'}).trim(),'');
 validateRecovery(JSON.parse(readFileSync(process.env.TRACKER_HUD_RECOVERY_RECEIPT,'utf8')));
 const path=process.env.TRACKER_HUD_APPLY_REPORT;assert.ok(path);const report={project:PROJECT,sourceSha,manifestHash:CLOSE_MANIFEST_HASH,status:'RUNNING',committed:[]};writeFileSync(path,JSON.stringify(report,null,2),{flag:'wx'});
 try{query(atomicQuery(pkg.entry,pkg.base));const receipt=JSON.parse(query(`SELECT json_build_object('name',name,'statements',cardinality(statements),'hash',encode(extensions.digest(convert_to(statements[1],'UTF8'),'sha256'),'hex'))::text FROM supabase_migrations.schema_migrations WHERE version='20261107093000';`));assert.equal(receipt.name,pkg.entry.name);assert.equal(receipt.statements,1);assert.equal(receipt.hash,pkg.entry.sha256);validateCloseObjects(JSON.parse(query(closeObjectsSql())),pkg.manifest.postchecks);report.committed.push({version:pkg.entry.version,sha256:pkg.entry.sha256});report.status='CLOSE_SUPPLEMENT_ATOMIC_RECEIPT_AND_OBJECTS_VERIFIED';}
 catch{report.status='STOPPED_PARTIAL_OR_UNCONFIRMED_NO_RETRY';writeFileSync(path,JSON.stringify(report,null,2));throw Error('STOP supplement34; inspect exact receipt privately before further action');}
 writeFileSync(path,JSON.stringify(report,null,2));console.log(report.status);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{run();}catch(e){console.error(e.message);process.exitCode=1;}}
