import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonicalSqlText,buildAtomicMigrationQuery} from './ops-1359-release-gate.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export const PROJECT='orlesggcjamwuknxwcpk';
export const MANIFEST_HASH='13616e361af1c8552a23cccd7c109224d0e42076bbc669261b34a6a3c24955d6';
export const REENTRY_MANIFEST_HASH='d0470bcef03ba4ba9dd330856aa8dc36472712d6e733c82e6987c87914c93856';
export const CORRECTION_MANIFEST_HASH='f4f0599614d980ae7b00e42ed513d147339e3d64bc656252f75a87800e8f88db';
const correctionSignature='public._tracker_correction_uat_context(uuid,uuid,uuid,text)';
const sha=s=>createHash('sha256').update(canonicalSqlText(s)).digest('hex');
export function loadPackage(root=ROOT){
 const raw=readFileSync(resolve(root,'scripts/ops/tracker-hud-20261104-manifest.json'),'utf8');
 if(sha(raw)!==MANIFEST_HASH)throw Error('Reviewed manifest hash differs');
 const manifest=JSON.parse(raw);
 if(manifest.projectRef!==PROJECT||manifest.migrations.length!==31)throw Error('Release scope differs');
 const entries=manifest.migrations.map(e=>{
  const sql=canonicalSqlText(readFileSync(resolve(root,e.path),'utf8'));
  if(sha(sql)!==e.sha256)throw Error('Migration checksum differs: '+e.version);
  return {...e,sql};
 });
 return {manifest,entries};
}
export function loadReentryPackage(root=ROOT){
 const base=loadPackage(root);
 const raw=readFileSync(resolve(root,'scripts/ops/tracker-hud-reentry-20261107-manifest.json'),'utf8');
 if(sha(raw)!==REENTRY_MANIFEST_HASH)throw Error('Reviewed supplement manifest hash differs');
 const manifest=JSON.parse(raw),entry=manifest.migrations[0];
 if(manifest.projectRef!==PROJECT||manifest.baseManifest.sha256!==MANIFEST_HASH||manifest.migrations.length!==1||entry.order!==32||entry.version!=='20261107013500')throw Error('Supplement scope differs');
 const sql=canonicalSqlText(readFileSync(resolve(root,entry.path),'utf8'));
 if(sha(sql)!==entry.sha256||sha(readFileSync(resolve(root,manifest.recovery.path),'utf8'))!==manifest.recovery.sha256)throw Error('Supplement source or recovery checksum differs');
 return {base,manifest,entry:{...entry,sql}};
}
export function loadCorrectionPackage(root=ROOT){
 const reentry=loadReentryPackage(root);
 const raw=readFileSync(resolve(root,'scripts/ops/tracker-correction-hand-lock-20261107-manifest.json'),'utf8');
 if(sha(raw)!==CORRECTION_MANIFEST_HASH)throw Error('Reviewed correction manifest hash differs');
 const manifest=JSON.parse(raw),entry=manifest.migrations[0];
 if(manifest.projectRef!==PROJECT||manifest.baseManifest.sha256!==MANIFEST_HASH||manifest.reentryManifest.sha256!==REENTRY_MANIFEST_HASH||manifest.migrations.length!==1||entry.order!==33||entry.version!=='20261107045330')throw Error('Correction supplement scope differs');
 const sql=canonicalSqlText(readFileSync(resolve(root,entry.path),'utf8'));
 if(sha(sql)!==entry.sha256||sha(readFileSync(resolve(root,manifest.recovery.path),'utf8'))!==manifest.recovery.sha256)throw Error('Correction source or recovery checksum differs');
 return {base:{...reentry.base,entries:[...reentry.base.entries,reentry.entry]},manifest,entry:{...entry,sql}};
}
const receiptMatch=e=>`version='${e.version}' AND name='${e.name}' AND cardinality(statements)=1 AND encode(extensions.digest(convert_to(statements[1],'UTF8'),'sha256'),'hex')='${e.sha256}'`;
const activeCorrectionCalls=`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend' AND state IN('active','idle in transaction') AND query ~* '(undo_tracker_last_action_v1|report_tracker_wrong_action_v1|get_tracker_undo_receipt_v1|cancel_tracker_undo_intent_v1|_tracker_correction_uat_context)'`;
const correctionActivityVisible=`SELECT current_setting('track_activities')='on' AND (EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND rolsuper) OR pg_has_role(current_user,'pg_read_all_stats','USAGE')) AND NOT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND state='disabled')`;
export function correctionStateSql(pkg){return `SELECT json_build_object('baseline',(${stateSql(pkg.entries).trim().replace(/;$/,'')})::json,
 'receiptsMatch',(${pkg.entries.map(e=>`EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE ${receiptMatch(e)})`).join(' AND ')}),
 'supplementAbsent',NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261107045330' OR name='tracker_correction_hand_lock_order_v1'),
 'activeCorrectionCalls',(${activeCorrectionCalls}),
 'activityVisible',(${correctionActivityVisible}),
 'object',(${reentryPostcheckSql(correctionSignature).trim().replace(/;$/,'')})::json)::text;`;}
export function validateCorrectionState(row,pkg,manifest){
 validateState({...row.baseline,applied:0},pkg);
 if(Number(row.baseline.applied)!==32||row.receiptsMatch!==true||row.supplementAbsent!==true)throw Error('Correction requires all32 exact receipts and absent supplement; no automatic resume');
 if(row.activityVisible!==true)throw Error('Correction activity visibility unavailable');
 if(row.activeCorrectionCalls!==0)throw Error('Correction calls have not drained');
 validateReentryPostcheck(row.object,{postcheck:manifest.precheck});
}
export function reentryStateSql(pkg){
 return `SELECT json_build_object('baseline',(${stateSql().trim().replace(/;$/,'').replace(')::text',')')}),
 'receiptsMatch',(${pkg.entries.map(e=>`EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE ${receiptMatch(e)})`).join(' AND ')}),
 'supplementAbsent',NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261107013500' OR name='cashier_app_reentry_transport_v1'),
 'objectAbsent',to_regprocedure('public.cashier_app_reentry_transport_v1(uuid,uuid)') IS NULL)::text;`;
}
export function validateReentryState(row,pkg){
 validateState({...row.baseline,applied:0},pkg);
 if(Number(row.baseline.applied)!==31||row.receiptsMatch!==true||row.supplementAbsent!==true||row.objectAbsent!==true)throw Error('Supplement requires all31 exact receipts and absent supplement; no automatic resume');
}
export function reentryPostcheckSql(signature='public.cashier_app_reentry_transport_v1(uuid,uuid)'){
 if(!['public.cashier_app_reentry_transport_v1(uuid,uuid)',correctionSignature].includes(signature))throw Error('Unreviewed function postcheck target');
 return `SELECT json_build_object('bodyMd5',md5(replace(p.prosrc,chr(13),'')),'owner',pg_get_userbyid(p.proowner),
 'securityInvoker',NOT p.prosecdef,'volatile',p.provolatile,'searchPath',p.proconfig,
 'executeRoles',(SELECT json_agg(role_name ORDER BY role_name) FROM (SELECT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END role_name FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE') roles),
 'grantOptions',(SELECT count(*) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.is_grantable))::text
 FROM pg_proc p WHERE p.oid=to_regprocedure('${signature}');`;}
export function validateReentryPostcheck(row,manifest){
 const expected=manifest.postcheck;
 for(const key of ['bodyMd5','owner','securityInvoker','volatile','searchPath','executeRoles'])if(JSON.stringify(row?.[key])!==JSON.stringify(expected[key]))throw Error('Supplement object postcheck differs: '+key);
 if(Number(row?.grantOptions)!==0)throw Error('Supplement unexpected grant option');
}
const fingerprint=`md5(string_agg(version||':'||coalesce(name,'')||':'||md5(coalesce(array_to_string(statements,E'\\n'),'')),E'\\n' ORDER BY version))`;
function releaseNamespace(entries=[]){
 const extra=entries.filter(e=>e.order>31).map(e=>{if(!/^\d{14}$/.test(e.version))throw Error('Invalid supplemental ledger version');return `'${e.version}'`;});
 return `(version BETWEEN '20261104001500' AND '20261104003400' OR version IN ('20261105044028','20261105072714','20261105200303','20261105203358','20261105213000','20261106010000','20261106025221','20261106105930','20261106111519','20261106144208','20261106184814')${extra.length?' OR version IN ('+extra.join(',')+')':''})`;
}
export function stateSql(entries=[]){return `SELECT json_build_object('rows',count(*),'fingerprint',${fingerprint},
 'applied',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE ${releaseNamespace(entries)}),
 'spectatorPaused',NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='public-spectator-v2-dispatch' AND active))::text
 FROM supabase_migrations.schema_migrations WHERE NOT ${releaseNamespace(entries)};`;}
export function validateState(row,pkg){
 if(Number(row.rows)!==pkg.manifest.baselineLedgerRows||row.fingerprint!==pkg.manifest.baselineLedgerFingerprint)throw Error('Baseline ledger changed; review a new package');
 if(Number(row.applied)!==0)throw Error('Existing or partial receipt requires review; automatic resume forbidden');
 if(row.spectatorPaused!==true)throw Error('Existing spectator dispatcher must be paused before applying');
}
export function atomicQuery(entry,pkg){
 const query=buildAtomicMigrationQuery(entry,entry.sql),seam='END $ops1359_guard$;\n';
 const offset=query.indexOf(seam)+seam.length;
 if(offset<seam.length||query.indexOf(seam)!==query.lastIndexOf(seam))throw Error('Atomic builder framing differs');
 const expectedRows=pkg.manifest.baselineLedgerRows+entry.order-1;
 const prefixGuards=pkg.entries.filter(e=>e.order<entry.order).map(e=>`IF NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE ${receiptMatch(e)}) THEN RAISE EXCEPTION 'HUD release prior receipt differs';END IF;`).join('\n');
 const guard=`LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
 DO $hud_release_guard$ BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>${expectedRows}
 OR (SELECT ${fingerprint} FROM supabase_migrations.schema_migrations WHERE NOT ${releaseNamespace(pkg.entries)})<>'${pkg.manifest.baselineLedgerFingerprint}'
 OR EXISTS(SELECT 1 FROM cron.job WHERE jobname='public-spectator-v2-dispatch' AND active)
 THEN RAISE EXCEPTION 'HUD release baseline or paused dispatcher changed';END IF;
 ${prefixGuards}
 ${entry.order===33?`IF (${correctionActivityVisible}) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Correction activity visibility unavailable';END IF;
 IF (${activeCorrectionCalls})<>0 THEN RAISE EXCEPTION 'Correction calls have not drained';END IF;`:''}
 END $hud_release_guard$;
 SELECT pg_advisory_xact_lock(20261104,1);
 `;
 return query.slice(0,offset)+guard+query.slice(offset);
}
export function validateRecovery(r,now=Date.now()){
 if(r.projectRef!==PROJECT||r.producerExit!==0||r.fullArchiveStreamReadbackExit!==0||!Number.isSafeInteger(r.bytes)||r.bytes<=0||!/^[a-f0-9]{64}$/.test(r.sha256)||!r.privateStorage||!r.restoreProcedure||r.interveningWritesAssessed!==true)throw Error('Verified private recovery receipt required');
 const age=now-Date.parse(r.snapshotStart);if(!Number.isFinite(age)||age<0||age>3600000)throw Error('Recovery point older than one hour; reassess before apply');
}
export function validateCorrectionMaintenance(r,sourceSha,now=Date.now()){
 if(r.projectRef!==PROJECT||r.sourceSha!==sourceSha||r.acceptNewCorrectionCalls!==false||r.correctionPauseVerified!==true||r.inFlightCalls!==0||!/^[a-f0-9]{64}$/.test(r.pauseEvidenceSha256??'')||!r.resumeProcedure)throw Error('Verified paused and drained correction maintenance receipt required');
 const age=now-Date.parse(r.observedAt);if(!Number.isFinite(age)||age<0||age>300000)throw Error('Correction maintenance observation older than five minutes');
}
function query(sql){
 const p=spawnSync(process.env.PSQL_BIN||'psql',['-X','-qAt','-w','-v','ON_ERROR_STOP=1','-f','-'],{input:sql,encoding:'utf8',maxBuffer:1024*1024});
 if(p.error||p.status!==0)throw Error('Database command failed; inspect stderr privately, no automatic retry');
 return p.stdout.trim();
}
function run(){
 const mode=process.argv[2];if(!['plan','apply','plan-reentry','apply-reentry','plan-correction','apply-correction'].includes(mode))throw Error('Usage: tracker-hud-20261104-release.mjs plan|apply|plan-reentry|apply-reentry|plan-correction|apply-correction');
 const correction=mode.endsWith('-correction');
 const supplement=correction?loadCorrectionPackage():mode.endsWith('-reentry')?loadReentryPackage():null;
 const pkg=supplement?.base??loadPackage();
 if(process.env.PGHOST!==`db.${PROJECT}.supabase.co`||process.env.PGPORT!=='5432'||process.env.PGUSER!=='postgres'||process.env.PGDATABASE!=='postgres'||process.env.PGSSLMODE!=='require'||!process.env.PGPASSWORD)throw Error('Exact private production connection required');
 if(correction)validateCorrectionState(JSON.parse(query(correctionStateSql(pkg))),pkg,supplement.manifest);
 else if(supplement)validateReentryState(JSON.parse(query(reentryStateSql(pkg))),pkg);
 else validateState(JSON.parse(query(stateSql())),pkg);
 if(mode.startsWith('plan')){console.log(JSON.stringify({mode,manifestHash:MANIFEST_HASH,supplementManifestHash:supplement?REENTRY_MANIFEST_HASH:undefined,correctionManifestHash:correction?CORRECTION_MANIFEST_HASH:undefined,migrations:supplement?1:31}));return;}
 const confirmation=correction?'APPLY_33_'+MANIFEST_HASH+'_'+REENTRY_MANIFEST_HASH+'_'+CORRECTION_MANIFEST_HASH:supplement?'APPLY_32_'+MANIFEST_HASH+'_'+REENTRY_MANIFEST_HASH:'APPLY_31_'+MANIFEST_HASH;
 if(process.env.CONFIRM_TRACKER_HUD_APPLY!==confirmation)throw Error('Exact owner-approved package confirmation absent');
 const sourceSha=execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();
 if(!/^[a-f0-9]{40}$/.test(process.env.TRACKER_HUD_APPROVED_SHA??'')||sourceSha!==process.env.TRACKER_HUD_APPROVED_SHA||execFileSync('git',['status','--porcelain'],{cwd:ROOT,encoding:'utf8'}).trim())throw Error('Clean exact approved source required');
 validateRecovery(JSON.parse(readFileSync(process.env.TRACKER_HUD_RECOVERY_RECEIPT,'utf8')));
 if(correction)validateCorrectionMaintenance(JSON.parse(readFileSync(process.env.TRACKER_CORRECTION_MAINTENANCE_RECEIPT,'utf8')),sourceSha);
 const reportPath=process.env.TRACKER_HUD_APPLY_REPORT;if(!reportPath)throw Error('Durable nonsecret receipt path required');
 const report={project:PROJECT,sourceSha,manifestHash:MANIFEST_HASH,supplementManifestHash:supplement?REENTRY_MANIFEST_HASH:undefined,correctionManifestHash:correction?CORRECTION_MANIFEST_HASH:undefined,status:'RUNNING',committed:[]};
 writeFileSync(reportPath,JSON.stringify(report,null,2),{flag:'wx'});
 for(const e of supplement?[supplement.entry]:pkg.entries){
  try{
   query(atomicQuery(e,pkg));
   const receipt=JSON.parse(query(`SELECT json_build_object('name',name,'statements',cardinality(statements),'hash',encode(extensions.digest(convert_to(statements[1],'UTF8'),'sha256'),'hex'))::text FROM supabase_migrations.schema_migrations WHERE version='${e.version}';`));
   if(receipt.name!==e.name||receipt.hash!==e.sha256||receipt.statements!==1)throw Error('Exact receipt postcheck differs');
   if(supplement)validateReentryPostcheck(JSON.parse(query(reentryPostcheckSql(correction?correctionSignature:undefined))),supplement.manifest);
   report.committed.push({version:e.version,name:e.name,sha256:e.sha256});writeFileSync(reportPath,JSON.stringify(report,null,2));
  }catch{
   report.status='STOPPED_PARTIAL_OR_UNCONFIRMED_NO_RETRY';report.stoppedAt=e.version;writeFileSync(reportPath,JSON.stringify(report,null,2));throw Error('STOP at '+e.version+'; review exact receipts before any further action');
  }
 }
 report.status=correction?'CORRECTION_RECEIPT_AND_OBJECT_VERIFIED_CONTROLLED_RESUMPTION_STILL_REQUIRED':supplement?'SUPPLEMENT_ATOMIC_RECEIPT_AND_OBJECT_VERIFIED_EDGE_DEPLOY_STILL_REQUIRED':'THIRTY_ONE_ATOMIC_RECEIPTS_VERIFIED_OBJECT_POSTCHECK_STILL_REQUIRED';writeFileSync(reportPath,JSON.stringify(report,null,2));console.log(report.status);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{run();}catch(e){console.error(e.message);process.exitCode=1;}}
