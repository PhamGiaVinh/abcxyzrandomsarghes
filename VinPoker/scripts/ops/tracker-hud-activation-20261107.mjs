// Generates reviewable SQL only. No connection, secret provisioning or apply.
// Execute through the controlled runbook's verified project connection after
// exact approval, recovery, object/Edge postchecks and recorded configuration
// preimages. The intent markers below do not replace those external checks.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {loadCorrectionPackage,PROJECT,MANIFEST_HASH,REENTRY_MANIFEST_HASH,CORRECTION_MANIFEST_HASH} from './tracker-hud-20261104-release.mjs';

const phases=['configure-url','start-workers','enable-reads'];
const url='https://'+PROJECT+'.supabase.co';
const spectatorJob="jobname='public-spectator-v2-dispatch' AND username='postgres' AND database=current_database() AND schedule='1 second' AND command IN('SELECT public.dispatch_public_spectator_projection_v2()','SELECT public.dispatch_public_spectator_projection_v2();')";
const hudJob="jobname='public-hud-projection-v1-dispatch' AND username='postgres' AND database=current_database() AND schedule='1 second' AND command='SELECT public.dispatch_public_hud_projection_v1()'";
export function buildActivationSql(phase,sourceSha){
 assert.ok(phases.includes(phase),'Unknown activation phase');assert.match(sourceSha??'',/^[a-f0-9]{40}$/,'Exact reviewed SHA required');
 const pkg=loadCorrectionPackage(),entries=[...pkg.base.entries,pkg.entry],baseline=pkg.base.manifest;
 assert.equal(entries.length,33);
 const versions=entries.map(e=>"'"+e.version+"'").join(',');
 const receipts=entries.map(e=>`IF NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${e.version}' AND name='${e.name}' AND cardinality(statements)=1 AND encode(extensions.digest(convert_to(statements[1],'UTF8'),'sha256'),'hex')='${e.sha256}') THEN RAISE EXCEPTION 'activation_prior_receipt_differs';END IF;`).join('\n');
 const root=resolve(fileURLToPath(new URL('../..',import.meta.url)));
 const supplements=['tracker-hud-reentry-20261107-manifest.json','tracker-correction-hand-lock-20261107-manifest.json'].map(name=>JSON.parse(readFileSync(resolve(root,'scripts/ops',name),'utf8')));
 const postimages=supplements.map(({postcheck:p})=>`IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('${p.signature}') AND md5(replace(prosrc,chr(13),''))='${p.bodyMd5}' AND pg_get_userbyid(proowner)='postgres' AND prosecdef=${!p.securityInvoker} AND provolatile='v' AND proconfig=ARRAY['search_path=""']::text[] AND NOT has_function_privilege('anon',oid,'EXECUTE') AND NOT has_function_privilege('authenticated',oid,'EXECUTE') AND (SELECT array_agg(DISTINCT r.rolname ORDER BY r.rolname) FROM aclexplode(coalesce(proacl,acldefault('f',proowner))) a JOIN pg_roles r ON r.oid=a.grantee WHERE a.privilege_type='EXECUTE')=ARRAY[${p.executeRoles.map(r=>"'"+r+"'").join(',')}]::name[] AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(proacl,acldefault('f',proowner))) a WHERE a.is_grantable)) THEN RAISE EXCEPTION 'activation_supplement_object_differs';END IF;`).join('\n');
 const common=`BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
DO $activation_context$ BEGIN
 IF current_user<>'postgres' OR current_database()<>'postgres'
 OR current_setting('vinpoker.approved_project_ref',true) IS DISTINCT FROM '${PROJECT}'
 OR current_setting('vinpoker.approved_source_sha',true) IS DISTINCT FROM '${sourceSha}'
 OR current_setting('vinpoker.approved_activation_phase',true) IS DISTINCT FROM '${phase}'
 THEN RAISE EXCEPTION 'activation_context_not_approved';END IF;
END $activation_context$;
LOCK TABLE supabase_migrations.schema_migrations IN SHARE MODE;
DO $activation_package$ BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>${baseline.baselineLedgerRows+33}
 OR (SELECT md5(string_agg(version||':'||coalesce(name,'')||':'||md5(coalesce(array_to_string(statements,E'\\n'),'')),E'\\n' ORDER BY version)) FROM supabase_migrations.schema_migrations WHERE version NOT IN(${versions}))<>'${baseline.baselineLedgerFingerprint}'
 THEN RAISE EXCEPTION 'activation_baseline_differs';END IF;
 ${receipts}
 ${postimages}
 PERFORM 1 FROM tracker_analytics_v1.config WHERE singleton AND NOT enabled FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'activation_read_preimage_differs';END IF;
END $activation_package$;
`;
 let body;
 if(phase==='configure-url')body=`DO $configure$ BEGIN
 IF EXISTS(SELECT 1 FROM tracker_analytics_v1.config WHERE worker_enabled OR backfill_complete)
 OR EXISTS(SELECT 1 FROM cron.job WHERE jobname IN('public-hud-projection-v1-dispatch','public-hud-v1-dispatch'))
 OR (SELECT count(*) FROM cron.job WHERE jobname='public-spectator-v2-dispatch')<>1
 OR (SELECT count(*) FROM cron.job WHERE ${spectatorJob} AND NOT active)<>1
 OR EXISTS(SELECT 1 FROM pg_db_role_setting s CROSS JOIN LATERAL unnest(s.setconfig) x WHERE s.setrole='postgres'::regrole AND s.setdatabase=(SELECT oid FROM pg_database WHERE datname='postgres') AND x LIKE 'app.supabase_url=%' AND x<>'app.supabase_url=${url}')
 THEN RAISE EXCEPTION 'activation_url_preimage_differs';END IF;
END $configure$;
ALTER ROLE postgres IN DATABASE postgres SET app.supabase_url='${url}';
-- Reconnect before start-workers so cron and the verifier inherit this setting.
`;
 if(phase==='start-workers')body=`DO $workers$ DECLARE target bigint;BEGIN
 IF current_setting('app.supabase_url',true) IS DISTINCT FROM '${url}'
 OR EXISTS(SELECT 1 FROM tracker_analytics_v1.config WHERE worker_enabled OR backfill_complete)
 OR EXISTS(SELECT 1 FROM cron.job WHERE jobname IN('public-hud-projection-v1-dispatch','public-hud-v1-dispatch'))
 OR (SELECT count(*) FROM cron.job WHERE jobname='public-spectator-v2-dispatch')<>1
 OR (SELECT count(*) FROM cron.job WHERE ${spectatorJob} AND NOT active)<>1
 OR (SELECT count(*) FROM vault.decrypted_secrets WHERE name='PUBLIC_HUD_WORKER_SECRET' AND length(decrypted_secret)>0)<>1
 OR (SELECT count(*) FROM vault.decrypted_secrets WHERE name='PUBLIC_SPECTATOR_WORKER_SECRET' AND length(decrypted_secret)>0)<>1
 THEN RAISE EXCEPTION 'activation_worker_prerequisite_differs';END IF;
 PERFORM cron.schedule('public-hud-projection-v1-dispatch','1 second','SELECT public.dispatch_public_hud_projection_v1()');
 SELECT jobid INTO STRICT target FROM cron.job WHERE ${spectatorJob} AND NOT active;
 PERFORM cron.alter_job(target,active:=true);
 UPDATE tracker_analytics_v1.config SET worker_enabled=true WHERE singleton;
 IF (SELECT count(*) FROM cron.job WHERE (${hudJob} OR ${spectatorJob}) AND active)<>2 THEN RAISE EXCEPTION 'activation_schedule_postcheck_differs';END IF;
END $workers$;
-- Reads remain disabled. Run checkpointed backfill and independent raw shadow.
`;
 if(phase==='enable-reads')body=`DO $reads$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM tracker_analytics_v1.config WHERE singleton AND worker_enabled AND backfill_complete AND NOT enabled)
 OR current_setting('app.supabase_url',true) IS DISTINCT FROM '${url}'
 OR (SELECT count(*) FROM cron.job WHERE (${hudJob} OR ${spectatorJob}) AND active)<>2
 OR (SELECT count(*) FROM cron.job WHERE jobname IN('public-hud-projection-v1-dispatch','public-spectator-v2-dispatch','public-hud-v1-dispatch'))<>2
 OR EXISTS(SELECT 1 FROM tracker_analytics_v1.jobs)
 OR EXISTS(SELECT 1 FROM tracker_analytics_v1.job_players)
 OR EXISTS(SELECT 1 FROM tracker_analytics_v1.visibility_barriers)
 OR EXISTS(SELECT 1 FROM tracker_analytics_v1.visibility_work)
 OR coalesce(current_setting('vinpoker.verified_shadow_sha256',true),'')!~'^[a-f0-9]{64}$'
 OR nullif(current_setting('vinpoker.verified_shadow_at',true),'')::timestamptz IS NULL
 OR nullif(current_setting('vinpoker.verified_shadow_at',true),'')::timestamptz NOT BETWEEN clock_timestamp()-interval '5 minutes' AND clock_timestamp()
 THEN RAISE EXCEPTION 'activation_backfill_shadow_prerequisite_differs';END IF;
 UPDATE tracker_analytics_v1.config SET enabled=true WHERE singleton;
END $reads$;
-- Shadow markers attest a separately verified, SHA-bound full-scope report.
-- Never set them merely to satisfy this gate. Preserve its file/hash in receipt.
`;
 return '-- Exact owner-reviewed activation;no source/ledger/audit mutation.\n'+common+body+'COMMIT;\n';
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [directory,sourceSha]=process.argv.slice(2);assert.ok(directory&&isAbsolute(directory),'Absolute private evidence directory required');
 const artifacts=phases.map(phase=>{const text=buildActivationSql(phase,sourceSha);return {phase,text,file:'hud-'+phase+'.sql',sha256:createHash('sha256').update(text).digest('hex')};});
 mkdirSync(directory,{recursive:true});for(const a of artifacts)writeFileSync(resolve(directory,a.file),a.text,{flag:'wx'});
 const manifest={kind:'PREPARED_ACTIVATION_SQL_NOT_APPLY_OR_APPROVAL',sourceSha,projectRef:PROJECT,manifestHashes:[MANIFEST_HASH,REENTRY_MANIFEST_HASH,CORRECTION_MANIFEST_HASH],artifacts:artifacts.map(({text,...a})=>a),requires:'Controlled exact project connection;fresh recovery/object/Edge evidence;private secret provisioning;verified shadow;exact final approval',productionChanged:false};
 writeFileSync(resolve(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(manifest));
}
