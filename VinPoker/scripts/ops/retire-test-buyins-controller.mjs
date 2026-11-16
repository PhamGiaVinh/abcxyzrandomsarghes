import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {validateContext,psqlEnvironment} from './floor-37-47-protected-apply.mjs';

export const repository='PhamGiaVinh/abcxyzrandomsarghes';
export const project='orlesggcjamwuknxwcpk';
export const sqlSha256='8e5d654afab9f0b0967f6a911fa48f4790cd6e37f2172bf40121da0cf9dff914';
export const confirmation='CANCEL_EXACT_5_LEGACY_TEST_BUYINS_KEEP_EVIDENCE';
export const inventorySql="select jsonb_build_object(\n'triggers',(select jsonb_agg(jsonb_build_object('definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled,'functionMd5',md5(pg_get_functiondef(t.tgfoid))) order by t.tgname) from pg_trigger t where t.tgrelid='public.tournament_registrations'::regclass and not t.tgisinternal),\n'references',(select jsonb_agg(jsonb_build_object('table',c.conrelid::regclass::text,'definition',pg_get_constraintdef(c.oid),'validated',c.convalidated,'deferrable',c.condeferrable) order by c.conrelid::regclass::text COLLATE \"C\",c.conname COLLATE \"C\") from pg_constraint c where c.contype='f' and c.confrelid='public.tournament_registrations'::regclass),\n'auditTriggers',(select count(*) from pg_trigger where tgrelid='public.audit_logs'::regclass and not tgisinternal),\n'registrationColumns',(select jsonb_agg(jsonb_build_object('name',attname,'type',format_type(atttypid,atttypmod),'notNull',attnotnull) order by attnum) from pg_attribute where attrelid='public.tournament_registrations'::regclass and attnum>0 and not attisdropped),\n'auditColumns',(select jsonb_agg(jsonb_build_object('name',attname,'type',format_type(atttypid,atttypmod),'notNull',attnotnull) order by attnum) from pg_attribute where attrelid='public.audit_logs'::regclass and attnum>0 and not attisdropped)) as inventory";
export const expectedInventory=JSON.parse(readFileSync(new URL('./retire-test-buyins-inventory.json',import.meta.url),'utf8'));
const sourcePath=new URL('./retire-owner-confirmed-test-buyins-20261116.sql',import.meta.url);
export function loadSql(){
 const sql=readFileSync(sourcePath,'utf8').replace(/\r\n?/gu,'\n');
 assert.equal(createHash('sha256').update(sql).digest('hex'),sqlSha256,'Reviewed SQL drift');
 return sql;
}
const targets=()=>[...loadSql().matchAll(/\('([a-f0-9]{64})','([a-f0-9]{32})'\)/gu)].map(m=>[m[1],m[2]]);
export function outcomeSql(runId,sourceSha){
 assert.match(String(runId),/^\d+$/u);
 assert.match(sourceSha,/^[a-f0-9]{40}$/u);
 const values=targets().map(([id,before])=>`('${id}','${before}')`).join(',');
 return `BEGIN READ ONLY;SET LOCAL statement_timeout='5s';SET LOCAL TIME ZONE 'Asia/Ho_Chi_Minh';
 WITH targets(hash,before_md5) AS(VALUES ${values}),selected AS(
 SELECT r.*,t.before_md5 FROM public.tournament_registrations r JOIN targets t ON t.hash=encode(sha256(convert_to(r.id::text,'UTF8')),'hex'))
 SELECT jsonb_build_object('rows',(SELECT count(*) FROM selected),
 'preimages',(SELECT count(*) FROM selected r WHERE md5((to_jsonb(r)-'before_md5')::text)=r.before_md5),
 'cancelled',(SELECT count(*) FROM selected WHERE status='cancelled'),
 'auditExact',(SELECT count(*) FROM public.audit_logs a JOIN selected r ON a.entity_id=r.id
 WHERE a.action='owner_confirmed_legacy_test_buyin_retired_20261116'
 AND a.payload->>'beforeMd5'=r.before_md5 AND a.payload->>'afterMd5'=md5((to_jsonb(r)-'before_md5')::text)
 AND a.payload->>'reviewedSha'='${sourceSha}' AND a.payload->>'approvedOwner'='PhamGiaVinh'),
 'inFlight',(SELECT count(*) FROM pg_stat_activity WHERE application_name='test_buyin_cleanup_${runId}' AND pid<>pg_backend_pid() AND xact_start IS NOT NULL))::text;COMMIT;`;
}
export function validateExecution(env,receipt,evidence,now=Date.now()){
 validateContext(env,receipt,now);
 assert.equal(env.GITHUB_REPOSITORY,repository);assert.equal(env.GITHUB_EVENT_NAME,'workflow_dispatch');
 assert.equal(env.REPOSITORY_OWNER,'PhamGiaVinh');
 assert.equal(env.RELEASE_SHA,env.GITHUB_SHA);assert.equal(env.RECOVERY_BASE_SHA,env.RELEASE_SHA);
 assert.equal(env.CONFIRM_TEST_BUYIN_CLEANUP,confirmation);
 assert.equal(receipt.databaseOwnerAndEffectiveAclMatch,true);
 const {run,workflow,mainRef,pr,qualification,qualificationWorkflow,qualificationJobs,environment,branches,recoveryRun,recoveryWorkflow,recoveryArtifact,active}=evidence;
 assert.equal(String(run.id),env.GITHUB_RUN_ID);assert.equal(run.workflow_id,workflow.id);
 assert.equal(run.status,'in_progress');
 assert.equal(run.head_sha,env.RELEASE_SHA);assert.equal(run.head_branch,'main');assert.equal(run.event,'workflow_dispatch');
 for(const r of [run,recoveryRun]){assert.equal(r.actor?.login,'PhamGiaVinh');assert.equal(r.triggering_actor?.login,'PhamGiaVinh');}
 assert.equal(mainRef.ref,'refs/heads/main');assert.equal(mainRef.object?.sha,env.RELEASE_SHA);
 assert.equal(pr.number,1664);assert.equal(pr.merged,true);assert.equal(pr.merge_commit_sha,env.RELEASE_SHA);
 assert.equal(pr.head?.repo?.full_name,repository);assert.equal(pr.base?.ref,'main');
 assert.equal(qualification.head_sha,pr.head.sha);assert.equal(qualification.event,'pull_request');
 assert.equal(String(qualification.id),env.QUALIFICATION_RUN_ID);
 assert.equal(qualification.workflow_id,qualificationWorkflow.id);assert.equal(qualification.status,'completed');assert.equal(qualification.conclusion,'success');
 assert.ok(qualificationJobs.jobs?.some(j=>j.name==='restored-schema'&&j.conclusion==='success'));
 assert.ok(environment.protection_rules?.some(r=>r.type==='required_reviewers'&&r.reviewers?.length>0));
 assert.equal(environment.deployment_branch_policy?.custom_branch_policies,true);
 assert.deepEqual(branches.branch_policies?.map(r=>r.name).sort(),['main']);
 assert.equal(recoveryRun.workflow_id,recoveryWorkflow.id);assert.equal(recoveryRun.head_sha,env.RELEASE_SHA);
 assert.equal(String(recoveryRun.id),env.RECOVERY_RUN_ID);
 assert.equal(recoveryRun.event,'workflow_dispatch');assert.equal(recoveryRun.head_branch,'main');
 assert.equal(recoveryRun.status,'completed');assert.equal(recoveryRun.conclusion,'success');
 assert.equal(recoveryArtifact.name,'floor-v3-restore-verification-'+recoveryRun.id);
 assert.equal(recoveryArtifact.expired,false);assert.ok(recoveryArtifact.size_in_bytes>0&&recoveryArtifact.size_in_bytes<1048576);
 assert.match(recoveryArtifact.digest??'',/^sha256:[a-f0-9]{64}$/u);
 assert.deepEqual(active,[]);
 loadSql();
}
export function buildWriteSql(sha){
 assert.match(sha,/^[a-f0-9]{40}$/u);
 const expected=JSON.stringify(expectedInventory).replaceAll("'","''");
 return loadSql().replace("SET LOCAL TIME ZONE 'Asia/Ho_Chi_Minh';",`SET LOCAL TIME ZONE 'Asia/Ho_Chi_Minh';
 DO $inventory_guard$ BEGIN IF (${inventorySql}) IS DISTINCT FROM '${expected}'::jsonb
 THEN RAISE EXCEPTION 'TEST_CLEANUP_INVENTORY_CHANGED'; END IF;END $inventory_guard$;
 SELECT set_config('vinpoker.test_cleanup.project','${project}',true),set_config('vinpoker.test_cleanup.reviewed_sha','${sha}',true),set_config('vinpoker.test_cleanup.approved_owner','PhamGiaVinh',true);`);
}
export function executeOnce({env,receipt,evidence,transport,report=()=>{},now=()=>Date.now()}){
 validateExecution(env,receipt,evidence,now());
 const inv=transport.json(`BEGIN READ ONLY;SET LOCAL statement_timeout='5s';SELECT jsonb_build_object('actor',current_user,'database',current_database(),'inventory',(${inventorySql}));COMMIT;`);
 assert.equal(inv.actor,'postgres');assert.equal(inv.database,'postgres');assert.deepEqual(inv.inventory,expectedInventory);
 const before=transport.json(outcomeSql(env.GITHUB_RUN_ID,env.RELEASE_SHA));
 assert.deepEqual(before,{rows:5,preimages:5,cancelled:0,auditExact:0,inFlight:0},'Source no longer matches exact preparation');
 validateExecution(env,receipt,evidence,now());
 const sha=env.RELEASE_SHA;
 const sql=buildWriteSql(sha);
 report({phase:'WRITE_ATTEMPT',rows:5,sqlSha256});
 try{transport.execute(`SET application_name='test_buyin_cleanup_${env.GITHUB_RUN_ID}';\n`+sql);}
 catch{
  let observation=null;try{observation=transport.json(outcomeSql(env.GITHUB_RUN_ID,sha));}catch{}
  report({phase:'STOP_NO_AUTOMATIC_RETRY',outcome:observation});
  throw Error('Write transport failed or outcome uncertain; read-only adjudication required');
 }
 let after;
 try{after=transport.json(outcomeSql(env.GITHUB_RUN_ID,sha));}
 catch{report({phase:'STOP_POSTCHECK_UNAVAILABLE_NO_RETRY'});throw Error('Final read unavailable; no retry');}
 report({phase:'POST_WRITE_OBSERVATION',outcome:after});
 assert.deepEqual(after,{rows:5,preimages:0,cancelled:5,auditExact:5,inFlight:0},'Final source/audit observation not proven; do not retry');
 return {phase:'EXACT_5_CANCELLED_AUDIT_VERIFIED',rows:5,sqlSha256,sourceSha:sha,physicalDeletes:0};
}
function main(){
 const env=process.env;for(const key of ['RECOVERY_RUN_ID','QUALIFICATION_RUN_ID','GITHUB_RUN_ID'])assert.match(env[key]??'',/^\d+$/u);
 assert.match(env.RELEASE_SHA??'',/^[a-f0-9]{40}$/u);
 const root=fileURLToPath(new URL('../../../',import.meta.url));
 assert.equal(execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),env.RELEASE_SHA);
 const get=path=>JSON.parse(execFileSync('gh',['api',`repos/${repository}/${path}`],{encoding:'utf8',timeout:15000,maxBuffer:2097152,stdio:['ignore','pipe','pipe']}));
 const recoveryRun=get('actions/runs/'+env.RECOVERY_RUN_ID);
 const artifacts=get('actions/runs/'+env.RECOVERY_RUN_ID+'/artifacts').artifacts.filter(a=>a.name==='floor-v3-restore-verification-'+env.RECOVERY_RUN_ID);
 assert.equal(artifacts.length,1);const artifact=artifacts[0];
 assert.ok(artifact.size_in_bytes>0&&artifact.size_in_bytes<1048576);assert.match(artifact.digest??'',/^sha256:[a-f0-9]{64}$/u);
 const zip=execFileSync('gh',['api',`repos/${repository}/actions/artifacts/${artifact.id}/zip`],{timeout:30000,maxBuffer:1048576,stdio:['ignore','pipe','pipe']});
 assert.equal('sha256:'+createHash('sha256').update(zip).digest('hex'),artifact.digest);
 const zipPath=resolve(env.RUNNER_TEMP,'test-buyin-recovery-metadata.zip');writeFileSync(zipPath,zip,{mode:0o600});
 assert.equal(execFileSync('unzip',['-Z1',zipPath],{encoding:'utf8'}).trim(),'recovery-verification.json');
 const receipt=JSON.parse(execFileSync('unzip',['-p',zipPath,'recovery-verification.json'],{encoding:'utf8',maxBuffer:1048576}));
 const evidence={run:get('actions/runs/'+env.GITHUB_RUN_ID),workflow:get('actions/workflows/test-buyin-cleanup-apply.yml'),
 mainRef:get('git/ref/heads/main'),pr:get('pulls/1664'),qualification:get('actions/runs/'+env.QUALIFICATION_RUN_ID),
 qualificationWorkflow:get('actions/workflows/test-buyin-cleanup-qualification.yml'),qualificationJobs:get('actions/runs/'+env.QUALIFICATION_RUN_ID+'/jobs'),
 environment:get('environments/dealer-swing-production-critical'),branches:get('environments/dealer-swing-production-critical/deployment-branch-policies'),
 recoveryRun,recoveryWorkflow:get('actions/workflows/floor-v3-recovery-backup.yml'),recoveryArtifact:artifact,
 active:get('actions/runs?per_page=100').workflow_runs.filter(r=>String(r.id)!==env.GITHUB_RUN_ID&&r.event==='workflow_dispatch'&&['in_progress','waiting','queued'].includes(r.status)&&/database|migration|recovery|protected.*apply|release|cleanup apply/iu.test(r.name)).map(r=>r.id)};
 const query=sql=>{const r=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',env:psqlEnvironment(env),timeout:15000,maxBuffer:1048576});
  if(r.error||r.status!==0)throw Error('Private database output withheld');return r.stdout.trim();};
 const transport={execute:query,json:sql=>{const lines=query(sql).split('\n').filter(s=>s.startsWith('{'));assert.equal(lines.length,1);return JSON.parse(lines[0]);}};
 console.log(JSON.stringify(executeOnce({env,receipt,evidence,transport,report:r=>console.log(JSON.stringify(r))})));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{main();}catch{console.error('TEST_BUYIN_CLEANUP_STOP: no automatic retry or history overwrite; inspect sanitized outcome');process.exitCode=1;}
}
