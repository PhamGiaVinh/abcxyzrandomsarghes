import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonicalSqlText,buildAtomicMigrationQuery} from './ops-1359-release-gate.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export const PROJECT='orlesggcjamwuknxwcpk';
export const MANIFEST_HASH='9e6045db4d6947323d7a3d2f38bad3309c43ccab203976fe6d1c062d07bf54ae';
const sha=s=>createHash('sha256').update(canonicalSqlText(s)).digest('hex');
export function loadPackage(root=ROOT){
 const raw=readFileSync(resolve(root,'scripts/ops/tracker-hud-20261104-manifest.json'),'utf8');
 if(sha(raw)!==MANIFEST_HASH)throw Error('Reviewed manifest hash differs');
 const manifest=JSON.parse(raw);
 if(manifest.projectRef!==PROJECT||manifest.migrations.length!==11)throw Error('Release scope differs');
 const entries=manifest.migrations.map(e=>{
  const sql=canonicalSqlText(readFileSync(resolve(root,e.path),'utf8'));
  if(sha(sql)!==e.sha256)throw Error('Migration checksum differs: '+e.version);
  return {...e,sql};
 });
 return {manifest,entries};
}
const fingerprint=`md5(string_agg(version||':'||coalesce(name,'')||':'||md5(coalesce(array_to_string(statements,E'\\n'),'')),E'\\n' ORDER BY version))`;
export function stateSql(){return `SELECT json_build_object('rows',count(*),'fingerprint',${fingerprint},
 'applied',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version BETWEEN '20261104001500' AND '20261104002500'),
 'spectatorPaused',NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='public-spectator-v2-dispatch' AND active))::text
 FROM supabase_migrations.schema_migrations WHERE version NOT BETWEEN '20261104001500' AND '20261104002500';`;}
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
 const prefixGuards=pkg.entries.filter(e=>e.order<entry.order).map(e=>`IF NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${e.version}' AND name='${e.name}' AND encode(extensions.digest(convert_to(statements[1],'UTF8'),'sha256'),'hex')='${e.sha256}') THEN RAISE EXCEPTION 'HUD release prior receipt differs';END IF;`).join('\n');
 const guard=`LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
 DO $hud_release_guard$ BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>${expectedRows}
 OR (SELECT ${fingerprint} FROM supabase_migrations.schema_migrations WHERE version NOT BETWEEN '20261104001500' AND '20261104002500')<>'${pkg.manifest.baselineLedgerFingerprint}'
 OR EXISTS(SELECT 1 FROM cron.job WHERE jobname='public-spectator-v2-dispatch' AND active)
 THEN RAISE EXCEPTION 'HUD release baseline or paused dispatcher changed';END IF;
 ${prefixGuards}
 END $hud_release_guard$;
 SELECT pg_advisory_xact_lock(20261104,1);
 `;
 return query.slice(0,offset)+guard+query.slice(offset);
}
export function validateRecovery(r,now=Date.now()){
 if(r.projectRef!==PROJECT||r.producerExit!==0||r.fullArchiveStreamReadbackExit!==0||!Number.isSafeInteger(r.bytes)||r.bytes<=0||!/^[a-f0-9]{64}$/.test(r.sha256)||!r.privateStorage||!r.restoreProcedure||r.interveningWritesAssessed!==true)throw Error('Verified private recovery receipt required');
 const age=now-Date.parse(r.snapshotStart);if(!Number.isFinite(age)||age<0||age>3600000)throw Error('Recovery point older than one hour; reassess before apply');
}
function query(sql){
 const p=spawnSync(process.env.PSQL_BIN||'psql',['-X','-qAt','-w','-v','ON_ERROR_STOP=1','-f','-'],{input:sql,encoding:'utf8',maxBuffer:1024*1024});
 if(p.error||p.status!==0)throw Error('Database command failed; inspect stderr privately, no automatic retry');
 return p.stdout.trim();
}
function run(){
 const mode=process.argv[2];if(!['plan','apply'].includes(mode))throw Error('Usage: tracker-hud-20261104-release.mjs plan|apply');
 const pkg=loadPackage();
 if(process.env.PGHOST!==`db.${PROJECT}.supabase.co`||process.env.PGPORT!=='5432'||process.env.PGUSER!=='postgres'||process.env.PGDATABASE!=='postgres'||process.env.PGSSLMODE!=='require'||!process.env.PGPASSWORD)throw Error('Exact private production connection required');
 validateState(JSON.parse(query(stateSql())),pkg);
 if(mode==='plan'){console.log(JSON.stringify({mode,manifestHash:MANIFEST_HASH,migrations:11}));return;}
 if(process.env.CONFIRM_TRACKER_HUD_APPLY!=='APPLY_11_'+MANIFEST_HASH)throw Error('Exact owner-approved package confirmation absent');
 const sourceSha=execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();
 if(!/^[a-f0-9]{40}$/.test(process.env.TRACKER_HUD_APPROVED_SHA??'')||sourceSha!==process.env.TRACKER_HUD_APPROVED_SHA||execFileSync('git',['status','--porcelain'],{cwd:ROOT,encoding:'utf8'}).trim())throw Error('Clean exact approved source required');
 validateRecovery(JSON.parse(readFileSync(process.env.TRACKER_HUD_RECOVERY_RECEIPT,'utf8')));
 const reportPath=process.env.TRACKER_HUD_APPLY_REPORT;if(!reportPath)throw Error('Durable nonsecret receipt path required');
 const report={project:PROJECT,sourceSha,manifestHash:MANIFEST_HASH,status:'RUNNING',committed:[]};
 writeFileSync(reportPath,JSON.stringify(report,null,2),{flag:'wx'});
 for(const e of pkg.entries){
  try{
   query(atomicQuery(e,pkg));
   const receipt=JSON.parse(query(`SELECT json_build_object('name',name,'hash',encode(extensions.digest(convert_to(statements[1],'UTF8'),'sha256'),'hex'))::text FROM supabase_migrations.schema_migrations WHERE version='${e.version}';`));
   if(receipt.name!==e.name||receipt.hash!==e.sha256)throw Error('Exact receipt postcheck differs');
   report.committed.push({version:e.version,name:e.name,sha256:e.sha256});writeFileSync(reportPath,JSON.stringify(report,null,2));
  }catch{
   report.status='STOPPED_PARTIAL_OR_UNCONFIRMED_NO_RETRY';report.stoppedAt=e.version;writeFileSync(reportPath,JSON.stringify(report,null,2));throw Error('STOP at '+e.version+'; review exact receipts before any further action');
  }
 }
 report.status='ELEVEN_ATOMIC_RECEIPTS_VERIFIED_OBJECT_POSTCHECK_STILL_REQUIRED';writeFileSync(reportPath,JSON.stringify(report,null,2));console.log(report.status);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{run();}catch(e){console.error(e.message);process.exitCode=1;}}
