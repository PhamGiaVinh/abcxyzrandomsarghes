import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {sql,jsonSql,sqlAsync} from './nativeDb.mjs';
const signature='public.get_public_tournament_clock_summary(uuid)';
const migration=readFileSync('supabase/migrations/20261104003200_public_clock_counts_only.sql','utf8');
const recovery=readFileSync('tests/publicHud/clock-counts.forward-rollback.sql','utf8');
const strip=source=>source.replace(/^BEGIN;\r?\n/m,'').replace(/COMMIT;\s*$/,'');
const tour='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const missing='10000000-0000-4000-8000-999999999999';
const hash=()=>sql(`SELECT md5(replace(pg_get_functiondef('${signature}'::regprocedure),chr(13),''));`);
const metadata=()=>jsonSql(`SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid='${signature}'::regprocedure;`);
const sourceState=()=>jsonSql(`SELECT jsonb_build_object(
 'tournaments',(SELECT md5(string_agg(to_jsonb(t)::text,'' ORDER BY id)) FROM public.tournaments t),
 'entries',(SELECT md5(string_agg(to_jsonb(e)::text,'' ORDER BY id)) FROM public.tournament_entries e),
 'seats',(SELECT md5(string_agg(to_jsonb(s)::text,'' ORDER BY id)) FROM public.tournament_seats s));`);
// PostgreSQL requires a new function owner to have CREATE in its namespace.
// Managed postgres is not a superuser. Use a dedicated, uncommitted TEST role
// instead of assuming a browser role can own private-schema functions.
const ownerProbe=`CREATE ROLE hud_clock_counts_owner_probe NOLOGIN NOSUPERUSER NOBYPASSRLS;
 GRANT hud_clock_counts_owner_probe TO postgres;
 GRANT CREATE ON SCHEMA public,floor_private TO hud_clock_counts_owner_probe;`;
assert.equal(hash(),'6eb40dbf8d7444e09924a68ffd921d1b','Run after the actual025 clock wrapper');
const beforeMetadata=metadata(),beforeSource=sourceState();
const original=sql(`SELECT pg_get_functiondef('${signature}'::regprocedure);`);
const reference=original.replace('public.get_public_tournament_clock_summary(','pg_temp.clock_counts_reference(');
assert.notEqual(reference,original);
const referenceSetup=`CREATE TEMP TABLE clock_counts_case_marker(n integer);
 ${reference};
 REVOKE ALL ON FUNCTION pg_temp.clock_counts_reference(uuid) FROM PUBLIC;
 DO $$ BEGIN EXECUTE format('GRANT USAGE ON SCHEMA %I TO anon,authenticated',pg_my_temp_schema()::regnamespace::text);END $$;
 GRANT EXECUTE ON FUNCTION pg_temp.clock_counts_reference(uuid) TO anon,authenticated;`;
const entry=sql(`SELECT id FROM public.tournament_entries WHERE tournament_id='${tour}' ORDER BY id LIMIT 1;`);
assert.match(entry,/^[a-f0-9-]{36}$/);
const skew=`INSERT INTO public.tournament_entries(id,tournament_id,player_id,status)
 SELECT public.fixture_scale_uuid('82000000',n),'${tour}',public.fixture_scale_uuid('32000000',n),'waiting' FROM generate_series(1,1000) n;
 UPDATE public.tournament_entries SET status='registered',current_stack=50000 WHERE id IN (public.fixture_scale_uuid('82000000',1),public.fixture_scale_uuid('82000000',2));
 UPDATE public.tournament_entries SET player_id=public.fixture_scale_uuid('32000000',1),entry_no=2 WHERE id=public.fixture_scale_uuid('82000000',2);
 UPDATE public.tournament_entries SET status='cancelled' WHERE id=public.fixture_scale_uuid('82000000',3);
 UPDATE public.tournament_entries SET status='busted' WHERE id=public.fixture_scale_uuid('82000000',4);`;
const scenarios=[['baseline',''],...['registered','seated','waiting','busted','bagged','finished','cancelled'].map(status=>['entry-'+status,`UPDATE public.tournament_entries SET status='${status}' WHERE id='${entry}';`]),
 ['null-stack',`UPDATE public.tournament_entries SET current_stack=NULL WHERE id='${entry}';`],
 ['null-player',`UPDATE public.tournament_entries SET player_id=NULL WHERE id='${entry}';`],
 ['null-entry-number',`UPDATE public.tournament_entries SET entry_no=NULL WHERE id='${entry}';`],
 ['anomalous-seat',`UPDATE public.tournament_seats SET chip_count=chip_count+123,entry_number=77 WHERE entry_id='${entry}';`],
 ['zero-live-entries',`UPDATE public.tournament_entries SET status='finished' WHERE tournament_id='${tour}';`],
 ['mixed-status-reentry-1000',skew],
 ['paused',`UPDATE public.tournaments SET clock_paused_at=clock_started_at+interval '30 seconds' WHERE id='${tour}';`],
 ['not-started',`UPDATE public.tournaments SET clock_started_at=NULL WHERE id='${tour}';`],
 ['unconfigured-level',`UPDATE public.tournaments SET current_level=NULL WHERE id='${tour}';`],
 ['break-clock',`UPDATE public.tournaments SET status='break' WHERE id='${tour}';`],
 ['withdrawn',`UPDATE public.tournaments SET deleted_at=clock_timestamp() WHERE id='${tour}';`]];
const parity=[];
for(const [name,changes] of scenarios)for(const role of ['anon','authenticated']){
 const result=jsonSql(`BEGIN;${referenceSetup}${changes}${strip(migration)}SET LOCAL ROLE ${role};
 SELECT jsonb_build_object('scopes',count(*),'mismatches',count(*) FILTER(WHERE actual IS DISTINCT FROM expected))
 FROM (SELECT q.id,
  (SELECT jsonb_agg(to_jsonb(c)) FROM public.get_public_tournament_clock_summary(q.id) c) actual,
  (SELECT jsonb_agg(to_jsonb(c)) FROM pg_temp.clock_counts_reference(q.id) c) expected
  FROM (VALUES('${tour}'::uuid),('${other}'::uuid),('${missing}'::uuid),(NULL::uuid)) q(id)) compared;
 ROLLBACK;`);
 assert.equal(result.scopes,4);assert.equal(result.mismatches,0,`${name}/${role}`);
 parity.push({name,role,scopes:result.scopes});
}
// Reject changed clock/canonical semantics rather than applying a textual rewrite
// to an unreviewed function. Failed transactions retain no backup or source edit.
for(const fn of [signature,'floor_private.tournament_participation_v1(uuid)']){
 assert.throws(()=>sql(`BEGIN;ALTER FUNCTION ${fn} VOLATILE;${strip(migration)}ROLLBACK;`,{captureFailure:true}),/clock_counts_preimage_differs/);
 assert.equal(hash(),'6eb40dbf8d7444e09924a68ffd921d1b');
 assert.equal(sql("SELECT to_regclass('spectator_projection_v2.clock_counts_original_v1') IS NULL;"),'t');
}
for(const change of [
 `${ownerProbe}ALTER FUNCTION ${signature} OWNER TO hud_clock_counts_owner_probe;`,
 `${ownerProbe}ALTER FUNCTION floor_private.tournament_participation_v1(uuid) OWNER TO hud_clock_counts_owner_probe;`,
 `GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`,
 'GRANT EXECUTE ON FUNCTION floor_private.tournament_participation_v1(uuid) TO anon;',
])assert.throws(()=>sql(`BEGIN;${change}${strip(migration)}ROLLBACK;`,{captureFailure:true}),/clock_counts_preimage_differs/);
sql(migration);
const candidateHash=hash(),candidate=sql(`SELECT pg_get_functiondef('${signature}'::regprocedure);`);
assert.notEqual(candidateHash,'6eb40dbf8d7444e09924a68ffd921d1b');
assert.deepEqual(metadata(),beforeMetadata);
assert.equal(sql("SELECT relrowsecurity FROM pg_class WHERE oid='spectator_projection_v2.clock_counts_original_v1'::regclass;"),'t');
for(const role of ['anon','authenticated','service_role'])assert.throws(()=>sql(`SET ROLE ${role};SELECT * FROM spectator_projection_v2.clock_counts_original_v1;`,{captureFailure:true}),/permission denied/);
assert.throws(()=>sql(`SET ROLE service_role;SELECT * FROM public.get_public_tournament_clock_summary('${tour}');`,{captureFailure:true}),/permission denied/);
// Execute the exact release postchecks, including the025→032 hash chain. Do not
// require managed Vault/cron access or substitute a separately copied assertion.
const objectKeys=['clockReadPlanDefinitionMatches','clockCountsDefinitionMatches','clockCountsDependencyMatches',
 'clockCountsReaderMetadataMatches','clockCountsPrivateRlsOwner','clockCountsPrivateBrowserGrants'];
const postcheckLines=readFileSync('scripts/ops/tracker-hud-20261104-postcheck.sql','utf8').split(/\r?\n/);
const objectChecks=objectKeys.map(key=>{const matches=postcheckLines.filter(line=>line.trimStart().startsWith(`'${key}',`));assert.equal(matches.length,1,key);return matches[0].trim().replace(/,$/,'');});
const readObjects=(changes='')=>jsonSql(`BEGIN;${changes}SELECT jsonb_build_object(${objectChecks.join(',\n')});ROLLBACK;`);
const objects=readObjects();
for(const key of objectKeys.filter(key=>key!=='clockCountsPrivateBrowserGrants'))assert.equal(objects[key],true,key);
assert.equal(objects.clockCountsPrivateBrowserGrants,0);
for(const [changes,key,expected] of [
 ["UPDATE spectator_projection_v2.clock_read_plan_original_v1 SET wrapped_definition_hash=repeat('0',32);",'clockReadPlanDefinitionMatches',false],
 ["UPDATE spectator_projection_v2.clock_counts_original_v1 SET candidate_definition_hash=repeat('0',32);",'clockCountsDefinitionMatches',false],
 ['ALTER TABLE spectator_projection_v2.clock_counts_original_v1 DISABLE ROW LEVEL SECURITY;','clockCountsPrivateRlsOwner',false],
 ['GRANT SELECT ON spectator_projection_v2.clock_counts_original_v1 TO anon;','clockCountsPrivateBrowserGrants',1],
 [`${ownerProbe}ALTER FUNCTION ${signature} OWNER TO hud_clock_counts_owner_probe;`,'clockCountsReaderMetadataMatches',false],
])assert.equal(readObjects(changes)[key],expected,key);
// Reused plans must observe new entry counters and withdrawal in new statements,
// while retaining the other tournament's independent source values.
sql(`BEGIN;SET LOCAL ROLE anon;DO $$ BEGIN FOR n IN 1..20 LOOP
 PERFORM * FROM public.get_public_tournament_clock_summary('${tour}');
 PERFORM * FROM public.get_public_tournament_clock_summary('${other}');END LOOP;END $$;RESET ROLE;
 UPDATE public.tournament_entries SET current_stack=2000 WHERE id='${entry}';
 SET LOCAL ROLE anon;DO $$ BEGIN
 IF (SELECT average_stack FROM public.get_public_tournament_clock_summary('${tour}')) IS DISTINCT FROM 1500::numeric THEN RAISE EXCEPTION 'clock_counts_warm_stack';END IF;END $$;RESET ROLE;
 UPDATE public.tournament_entries SET status='busted' WHERE id='${entry}';
 SET LOCAL ROLE authenticated;DO $$ BEGIN
 IF (SELECT players_remaining FROM public.get_public_tournament_clock_summary('${tour}')) IS DISTINCT FROM 1::bigint
 OR (SELECT players_remaining FROM public.get_public_tournament_clock_summary('${other}')) IS DISTINCT FROM 2::bigint THEN RAISE EXCEPTION 'clock_counts_warm_scope';END IF;END $$;RESET ROLE;
 UPDATE public.tournaments SET deleted_at=clock_timestamp() WHERE id='${tour}';
 SET LOCAL ROLE anon;DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.get_public_tournament_clock_summary('${tour}')) THEN RAISE EXCEPTION 'clock_counts_warm_withdrawal';END IF;END $$;ROLLBACK;`);
// An overlapping uncommitted writer must not leak its stack into public reads.
// Source updates and their triggered jobs all roll back on the owned fixture.
const writer=sqlAsync(`SET application_name='hud_clock_counts_overlap';BEGIN;
 UPDATE public.tournament_entries SET current_stack=current_stack+999 WHERE id='${entry}';
 SELECT pg_sleep(2);ROLLBACK;`);
let overlap=false;
try{
 for(let attempt=0;attempt<10;attempt++){
  if(sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name='hud_clock_counts_overlap' AND wait_event='PgSleep');")==='t'){overlap=true;break;}
  await new Promise(resolve=>setTimeout(resolve,20));
 }
 assert.equal(overlap,true,'Actual writer/read overlap required');
 const during=jsonSql(`SET ROLE anon;SELECT to_jsonb(c) FROM public.get_public_tournament_clock_summary('${tour}') c;`);
 assert.equal(Number(during.average_stack),1000);
}finally{await writer;}
assert.deepEqual(sourceState(),beforeSource);
assert.equal(sql("SELECT NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='hud_clock_counts_owner_probe');"),'t');
// Guard rollback against a changed candidate, then exercise exact metadata and
// ordered032→025→023/022 recovery. No old migration is edited.
assert.throws(()=>sql(`BEGIN;ALTER FUNCTION ${signature} VOLATILE;${strip(recovery)}ROLLBACK;`,{captureFailure:true}),/clock_counts_recovery_drift/);
const ordered=strip(recovery)+strip(readFileSync('tests/publicHud/clock-read-plan.forward-rollback.sql','utf8'))+strip(readFileSync('tests/publicHud/read-plans.forward-rollback.sql','utf8'));
assert.equal(sql(`BEGIN;${ordered}SELECT md5(replace(pg_get_functiondef('${signature}'::regprocedure),chr(13),''));ROLLBACK;`),'bf84cbeb48770e13805718e0d8a0def9');
assert.equal(hash(),candidateHash);
sql(recovery);assert.equal(hash(),'6eb40dbf8d7444e09924a68ffd921d1b');assert.deepEqual(metadata(),beforeMetadata);
sql(candidate);assert.equal(hash(),candidateHash);assert.deepEqual(metadata(),beforeMetadata);
assert.deepEqual(sourceState(),beforeSource);
const report={kind:'NATIVE_COUNTS_ONLY_CLOCK_FULL_ROW_PARITY_NOT_HTTP_CAPACITY',passed:true,candidateHash,
 scenarios:scenarios.length,roles:['anon','authenticated'],fullRowComparisons:parity.reduce((sum,x)=>sum+x.scopes,0),
 checks:['full-row-same-statement-parity','actual025-and023-preimages','metadata-owner-acl-oid-signature-preserved','malformed-preimage-denied',
 'no-source-edit','all-entry-statuses','null-entry-fields','seat-anomalies','reentry-and-1000-entry-skew','paused-not-started-break-unconfigured',
 'anonymous-authenticated-cross-scope-missing-null','service-execute-denied','private-backup-rls-and-acl','warmed-source-and-withdrawal',
 'actual-uncommitted-writer-read-overlap','runnable-object-postchecks-and-drift','guarded-rollback-and-candidate-reinstall','ordered032-025-023-022-recovery']};
if(process.env.PUBLIC_HUD_CLOCK_COUNTS_REPORT)writeFileSync(process.env.PUBLIC_HUD_CLOCK_COUNTS_REPORT,JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
