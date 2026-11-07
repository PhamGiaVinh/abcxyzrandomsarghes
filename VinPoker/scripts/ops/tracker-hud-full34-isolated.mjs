// Isolated SQL/backfill rehearsal only. Never connects using production credentials.
import assert from 'node:assert/strict';
import {spawnSync,spawn,execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,isAbsolute} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';
import {createInterface} from 'node:readline';

export const CANDIDATE='8fd86933596d5755ae0293204fb4e794e40c286c';
export const BACKUP_RUN='42373584563';
export const SOURCE_ACTION_TABLE='public.hand_actions';
export const PAUSE_RESTORED_DISPATCHER_SQL="SELECT cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobname='public-spectator-v2-dispatch';";
export const RESTORE_OWNER_CONTEXT_SQL=`BEGIN;
LOCK TABLE supabase_migrations.schema_migrations IN SHARE MODE;
DO $owner_context$ BEGIN
 IF current_database()<>'postgres' OR current_user<>'supabase_admin'
 OR current_setting('cron.launch_active_jobs')<>'off'
 OR (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database())<>'supabase_admin'
 OR (SELECT rolsuper FROM pg_roles WHERE rolname='postgres') IS DISTINCT FROM false
 OR (SELECT count(*) FROM supabase_migrations.schema_migrations)<>763
 OR (SELECT md5(string_agg(version||':'||coalesce(name,'')||':'||md5(coalesce(array_to_string(statements,chr(10)),'')),chr(10) ORDER BY version)) FROM supabase_migrations.schema_migrations)<>'5bb5e2d79aca9b2d17be60931a2248ef'
 THEN RAISE EXCEPTION 'isolated_owner_context_preimage_differs';END IF;
END $owner_context$;
ALTER DATABASE postgres OWNER TO postgres;
COMMIT;`;
export function sqlFailureMetadata(stderr,exitCode){
 const text=String(stderr??'');
 return {exitCode:Number.isInteger(exitCode)?exitCode:null,
  sqlState:text.match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1]??null,
  inputLine:Number(text.match(/psql:<stdin>:(\d+):\s+ERROR:/)?.[1])||null,
  reason:text.includes('reserved role')&&text.includes('"postgres"')?'postgres-role-reserved':
   text.includes('permission denied to set parameter "app.supabase_url"')?'url-parameter-set-denied':'unclassified'};
}
export function validateInvocation(container,candidate,report,env=process.env){
 assert.equal(env.GITHUB_ACTIONS,'true');assert.match(env.GITHUB_RUN_ID??'',/^\d+$/);
 assert.match(container??'',/^[a-f0-9]{12,64}$/);
 assert.ok(isAbsolute(candidate??'')&&isAbsolute(report??''));
 assert.equal(resolve(candidate),resolve(env.GITHUB_WORKSPACE,'candidate/VinPoker'));
 assert.equal(resolve(report),resolve(env.RUNNER_TEMP,'hud-full34-rehearsal.json'));
 assert.equal(env.HUD_FULL34_ISOLATION_VERIFIED,'egress-blocked-cron-off');
}
export async function rehearse(container,candidate,output){
 validateInvocation(container,candidate,output);assert.equal(existsSync(output),false);
 assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:candidate,encoding:'utf8'}).trim(),CANDIDATE);
 assert.equal(execFileSync('git',['status','--porcelain'],{cwd:candidate,encoding:'utf8'}).trim(),'');
 assert.equal(execFileSync('docker',['inspect',container,'--format','{{.Name}}'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim(),'/supabase_db_postgres');
 const report={kind:'ISOLATED_FULL34_SQL_BACKFILL_REHEARSAL_NOT_PRODUCTION_RELEASE',candidateSha:CANDIDATE,backupRun:BACKUP_RUN,
  stage:'preflight',complete:false,passed:false,committed:[],activation:[],productionChanged:false,
  limitations:'Cron execution disabled and outbound blocked. SQL transitions and native worker only; not Edge dispatch, HTTP delivery, production capacity, historical pre03 proof or release approval.'};
 const save=()=>writeFileSync(output,JSON.stringify(report,null,2)+'\n');save();
 const args=['exec','-i',container,'psql','-h','/var/run/postgresql','-X','-qAt','-w','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-U','postgres','-d','postgres','-f','-'];
 function query(sql){const r=spawnSync('docker',args,{input:sql,encoding:'utf8',maxBuffer:16*1024*1024,stdio:['pipe','pipe','pipe']});if(r.error||r.status!==0){report.sqlFailure=sqlFailureMetadata(r.stderr,r.status);save();throw Error('Isolated SQL failed; raw diagnostics withheld');}return r.stdout.trim();}
 const json=sql=>JSON.parse(query(sql));
 const module=path=>import(pathToFileURL(resolve(candidate,path)).href);
 try{
  report.stage='preflight-identity';save();
  const identity=json("SELECT json_build_object('db',current_database(),'user',current_user,'superuser',(SELECT rolsuper FROM pg_roles WHERE rolname=current_user),'cron',current_setting('cron.launch_active_jobs'));");
  assert.deepEqual(identity,{db:'postgres',user:'postgres',superuser:false,cron:'off'});
  report.rolePolicy=json("SELECT jsonb_build_object('privilegedRole',current_setting('supautils.privileged_role',true),'reservedRoles',current_setting('supautils.reserved_roles',true),'privilegedRoleMembership',CASE WHEN to_regrole(current_setting('supautils.privileged_role',true)) IS NULL THEN false ELSE pg_has_role(current_user,to_regrole(current_setting('supautils.privileged_role',true)),'MEMBER') END);");save();
  report.stage='preflight-package';save();
  const {loadClosePackage,validateCloseObjects,closeObjectsSql}=await module('scripts/ops/tracker-hud-close-paid-prize-20261107-release.mjs');
  const {atomicQuery,stateSql,validateState}=await module('scripts/ops/tracker-hud-20261104-release.mjs');
  const {buildActivationSql}=await module('scripts/ops/tracker-hud-activation-20261107.mjs');
  const pkg=loadClosePackage(candidate),entries=[...pkg.base.entries,pkg.entry];assert.equal(entries.length,34);
  // Pausing the restored dispatcher changes this disposable clone only.
  report.stage='preflight-pause';save();
  query(PAUSE_RESTORED_DISPATCHER_SQL);
  report.stage='preflight-ledger';save();
  validateState(json(stateSql(entries)),pkg.base);
  report.stage='preflight-owner-context';save();
  const ownerEvidence=JSON.parse(readFileSync(new URL('./tracker-hud-restore-owner-context-20261107.json',import.meta.url),'utf8'));
  assert.equal(ownerEvidence.kind,'SEPARATE_READ_ONLY_OWNER_CONTEXT_NOT_BACKUP_METADATA');
  assert.equal(ownerEvidence.observedOwner,'postgres');assert.equal(ownerEvidence.backupRun,BACKUP_RUN);
  assert.equal(ownerEvidence.baselineLedgerRows,pkg.base.manifest.baselineLedgerRows);
  assert.equal(ownerEvidence.baselineLedgerFingerprint,pkg.base.manifest.baselineLedgerFingerprint);
  const admin=spawnSync('docker',['exec','-i',container,'sh','-ceu','exec env PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -X -qAt -w -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U supabase_admin -d postgres -f -'],{input:RESTORE_OWNER_CONTEXT_SQL,encoding:'utf8',stdio:['pipe','pipe','pipe']});
  if(admin.error||admin.status!==0){report.sqlFailure=sqlFailureMetadata(admin.stderr,admin.status);save();throw Error('Isolated owner-context restoration failed');}
  const ownerAfter=json("SELECT json_build_object('owner',pg_get_userbyid(datdba),'canCreate',has_database_privilege('postgres',datname,'CREATE'),'superuser',(SELECT rolsuper FROM pg_roles WHERE rolname='postgres')) FROM pg_database WHERE datname=current_database();");
  assert.deepEqual(ownerAfter,{owner:'postgres',canCreate:true,superuser:false});
  report.ownerContext={kind:ownerEvidence.kind,observedDate:ownerEvidence.observedDate,ownerRestored:'postgres',postgresRemainsNonsuperuser:true,source:'separate post-snapshot read-only observation',snapshotOwnershipAndAclFidelityCertified:false};save();
  const sourceSql=`SELECT json_build_object('hands',(SELECT count(*) FROM public.tournament_hands),'actions',(SELECT count(*) FROM ${SOURCE_ACTION_TABLE}),'payments',(SELECT md5(coalesce(string_agg(md5(to_jsonb(p)::text),'' ORDER BY p.id),'')) FROM public.tournament_prize_payments p));`;
  report.stage='preflight-source-integrity';save();const sourceBefore=json(sourceSql);
  report.stage='apply';save();
  for(const entry of entries){
   report.attempting={order:entry.order,version:entry.version};save();
   query(atomicQuery(entry,{...pkg.base,entries}));
   const receipt=json(`SELECT json_build_object('name',name,'hash',encode(extensions.digest(convert_to(statements[1],'UTF8'),'sha256'),'hex'),'statements',cardinality(statements)) FROM supabase_migrations.schema_migrations WHERE version='${entry.version}';`);
   assert.deepEqual(receipt,{name:entry.name,hash:entry.sha256,statements:1});
   report.committed.push({version:entry.version,sha256:entry.sha256});save();
  }
  delete report.attempting;
  validateCloseObjects(json(closeObjectsSql()),pkg.manifest.postchecks);
  const activationContext=phase=>`SET vinpoker.approved_project_ref='orlesggcjamwuknxwcpk';SET vinpoker.approved_source_sha='${CANDIDATE}';SET vinpoker.approved_activation_phase='${phase}';`;
  report.stage='configure-url';save();query(activationContext('configure-url')+buildActivationSql('configure-url',CANDIDATE));report.activation.push('configure-url');save();
  // Replace only the two disposable worker credentials before configuring jobs.
  // Cron remains disabled throughout; never invoke a production URL.
  for(const name of ['PUBLIC_HUD_WORKER_SECRET','PUBLIC_SPECTATOR_WORKER_SECRET']){
   const secret=randomBytes(32).toString('hex');
   query(`DO $local_secret$ DECLARE target uuid;BEGIN SELECT id INTO target FROM vault.secrets WHERE name='${name}';IF FOUND THEN PERFORM vault.update_secret(target,'${secret}');ELSE PERFORM vault.create_secret('${secret}','${name}');END IF;END $local_secret$;`);
  }
  report.stage='start-workers';save();query(activationContext('start-workers')+buildActivationSql('start-workers',CANDIDATE));report.activation.push('start-workers');save();
  const {build}=await import(pathToFileURL(resolve(candidate,'node_modules/esbuild/lib/main.js')).href);
  const bundle=await build({entryPoints:[resolve(candidate,'supabase/functions/public-hud-projector-v1/worker.ts')],bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent'});
  const {processPublicHudJobs}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  const {createNativeWorkerClient}=await module('tests/publicHud/nativeRpc.mjs');
  const client=createNativeWorkerClient(async sql=>query(sql));
  report.stage='backfill';report.backfill={batches:0,processed:0,failed:0};save();const deadline=Date.now()+30*60*1000;
  while(true){
   assert.ok(Date.now()<deadline,'Isolated backfill exceeded30minutes');
   json("SET request.jwt.claim.role='service_role';SET ROLE service_role;SELECT to_jsonb(public.backfill_public_hud_v1(100));");report.backfill.batches++;
   while(Number(query('SELECT count(*) FROM tracker_analytics_v1.jobs;'))>0){
    assert.ok(Date.now()<deadline);const work=await processPublicHudJobs(client,80,Date.now()+10000);report.backfill.processed+=work.processed;report.backfill.failed+=work.failed;assert.equal(work.failed,0);
    if(!work.claimed)await new Promise(r=>setTimeout(r,100));
   }
   save();if(query('SELECT backfill_complete FROM tracker_analytics_v1.config WHERE singleton;')==='t')break;
  }
  report.stage='shadow';save();
  const shadowModule=await module('scripts/ops/tracker-hud-shadow.mjs');const shadow=shadowModule.createShadow(await shadowModule.loadClassifier());
  const child=spawn('docker',args,{stdio:['pipe','pipe','pipe']});child.stderr.resume();
  const done=new Promise((yes,no)=>{child.on('error',()=>no(Error('Shadow transport unavailable')));child.on('close',yes);});
  child.stdin.on('error',()=>{});child.stdin.end(shadowModule.shadowSql);
  try{for await(const line of createInterface({input:child.stdout}))if(line.trim())shadow.accept(JSON.parse(line));assert.equal(await done,0);}
  catch{child.kill();await done;throw Error('Isolated raw-source shadow failed');}
  report.shadow=shadow.finish();assert.equal(report.shadow.passed,true);assert.equal(report.shadow.complete,true);
  assert.deepEqual(json(sourceSql),sourceBefore,'Source counts or prize payment history changed');
  const shadowText=JSON.stringify(report.shadow),shadowHash=createHash('sha256').update(shadowText).digest('hex');
  report.shadowSha256=shadowHash;
  report.stage='enable-reads';save();
  query(activationContext('enable-reads')+`SET vinpoker.verified_shadow_sha256='${shadowHash}';SET vinpoker.verified_shadow_at='${new Date().toISOString()}';`+buildActivationSql('enable-reads',CANDIDATE));
  report.activation.push('enable-reads');
  assert.equal(query("SELECT enabled AND worker_enabled AND backfill_complete AND current_setting('cron.launch_active_jobs')='off' FROM tracker_analytics_v1.config WHERE singleton;"),'t');
  report.complete=true;report.passed=true;report.stage='complete';save();return report;
 }catch{report.stage+='-failed';report.complete=false;report.passed=false;save();throw Error('Isolated rehearsal failed; inspect metadata receipt, no production action permitted');}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 rehearse(...process.argv.slice(2)).then(()=>console.log('HUD_FULL34_ISOLATED_REHEARSAL=PASS')).catch(()=>{console.error('HUD_FULL34_ISOLATED_REHEARSAL=FAIL; raw source and diagnostics withheld');process.exitCode=1;});
}
