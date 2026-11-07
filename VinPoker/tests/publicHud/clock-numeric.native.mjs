import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {sql,jsonSql} from './nativeDb.mjs';
const signature='public.get_public_tournament_clock_summary(uuid)';
const migration=readFileSync('supabase/migrations/20261106105930_public_clock_numeric_buy_in.sql','utf8');
const recovery=readFileSync('tests/publicHud/clock-numeric.forward-rollback.sql','utf8');
const strip=s=>s.replace(/^BEGIN;\r?\n/m,'').replace(/COMMIT;\s*$/,'');
const hash=()=>sql(`SELECT md5(replace(pg_get_functiondef('${signature}'::regprocedure),chr(13),''));`);
const metadata=()=>jsonSql(`SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid='${signature}'::regprocedure;`);
assert.equal(hash(),'0996e504a583390a6ac36cad27937378');
const before=metadata();
// The actual retained production schema uses bigint. The old synthetic scale
// fixture used numeric, which hid RETURN QUERY's stricter type checking.
const reference=sql('SELECT definition FROM spectator_projection_v2.clock_read_plan_original_v1;')
 .replace('public.get_public_tournament_clock_summary(','pg_temp.clock_numeric_reference(');
const outcomes=jsonSql(`BEGIN;
 ALTER TABLE public.tournaments ALTER COLUMN buy_in TYPE bigint USING buy_in::bigint;
 ${reference};
 REVOKE ALL ON FUNCTION pg_temp.clock_numeric_reference(uuid) FROM PUBLIC;
 DO $$ BEGIN EXECUTE format('GRANT USAGE ON SCHEMA %I TO anon,authenticated',pg_my_temp_schema()::regnamespace::text);END $$;
 GRANT EXECUTE ON FUNCTION pg_temp.clock_numeric_reference(uuid) TO anon,authenticated;
 CREATE TEMP TABLE clock_numeric_receipts(kind text,value jsonb);
 DO $$ DECLARE target uuid;v record;BEGIN
  SELECT id INTO STRICT target FROM public.tournaments ORDER BY id LIMIT 1;
  BEGIN SELECT * INTO v FROM public.get_public_tournament_clock_summary(target);
   RAISE EXCEPTION 'Expected bigint regression was not reproduced';
  EXCEPTION WHEN datatype_mismatch THEN INSERT INTO clock_numeric_receipts VALUES('regression',jsonb_build_object('sqlstate',SQLSTATE));END;
 END $$;
 ${strip(migration)}
 -- Compare every public column in one statement/snapshot, for both roles,
 -- two tours, missing and NULL scope, unchanged/pause/run/deleted source states.
 CREATE FUNCTION pg_temp.clock_numeric_compare() RETURNS void LANGUAGE plpgsql AS $$
 DECLARE scope uuid;actual jsonb;expected jsonb;BEGIN
  FOREACH scope IN ARRAY ARRAY['10000000-0000-4000-8000-000000000001'::uuid,'10000000-0000-4000-8000-000000000002'::uuid,'10000000-0000-4000-9999-999999999999'::uuid,NULL::uuid] LOOP
   SELECT (SELECT jsonb_agg(to_jsonb(c)) FROM public.get_public_tournament_clock_summary(scope) c),
    (SELECT jsonb_agg(to_jsonb(c)) FROM pg_temp.clock_numeric_reference(scope) c) INTO actual,expected;
   IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'clock_numeric_row_parity';END IF;
  END LOOP;
 END $$;
 GRANT EXECUTE ON FUNCTION pg_temp.clock_numeric_compare() TO anon,authenticated;
 DO $$ DECLARE state integer;actor text;BEGIN
  FOR state IN 0..3 LOOP
   IF state=1 THEN UPDATE public.tournaments SET clock_paused_at=clock_started_at+interval '30 seconds';END IF;
   IF state=2 THEN UPDATE public.tournaments SET clock_started_at=NULL,clock_paused_at=NULL;END IF;
   IF state=3 THEN UPDATE public.tournaments SET deleted_at=statement_timestamp();END IF;
   FOREACH actor IN ARRAY ARRAY['anon','authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I',actor);PERFORM pg_temp.clock_numeric_compare();RESET ROLE;
   END LOOP;
  END LOOP;
 END $$;
 INSERT INTO clock_numeric_receipts VALUES('parity',jsonb_build_object('fullRowComparisons',32,'roles',2,'sourceBuyInType','bigint'));
 SELECT jsonb_agg(to_jsonb(r) ORDER BY kind) FROM clock_numeric_receipts r;
 ROLLBACK;`);
assert.equal(outcomes.find(r=>r.kind==='regression').value.sqlstate,'42804');
assert.equal(hash(),'0996e504a583390a6ac36cad27937378');
assert.deepEqual(metadata(),before);
assert.throws(()=>sql(`BEGIN;ALTER FUNCTION ${signature} VOLATILE;${strip(migration)}ROLLBACK;`,{captureFailure:true}),/clock_numeric_preimage_differs/);
sql(migration);const candidateHash=hash();assert.notEqual(candidateHash,'0996e504a583390a6ac36cad27937378');assert.deepEqual(metadata(),before);
for(const role of ['anon','authenticated','service_role'])assert.throws(()=>sql(`SET ROLE ${role};SELECT * FROM spectator_projection_v2.clock_numeric_original_v1;`,{captureFailure:true}),/permission denied/);
assert.throws(()=>sql(`BEGIN;ALTER FUNCTION ${signature} VOLATILE;${strip(recovery)}ROLLBACK;`,{captureFailure:true}),/clock_numeric_recovery_drift/);
assert.equal(sql(`BEGIN;${strip(recovery)}SELECT md5(replace(pg_get_functiondef('${signature}'::regprocedure),chr(13),''));ROLLBACK;`),'0996e504a583390a6ac36cad27937378');
assert.equal(hash(),candidateHash);assert.deepEqual(metadata(),before);
// Recovery retains the private receipt for audit. Reinstall only inside a
// rollback with that exact receipt temporarily absent, never overwrite it.
const reinstalled=sql(`BEGIN;${strip(recovery)}DROP TABLE spectator_projection_v2.clock_numeric_original_v1;${strip(migration)}SELECT md5(replace(pg_get_functiondef('${signature}'::regprocedure),chr(13),''));ROLLBACK;`);
assert.equal(reinstalled,candidateHash);
assert.equal(hash(),candidateHash);assert.deepEqual(metadata(),before);
const ordered=strip(recovery)+['clock-counts.forward-rollback.sql','clock-read-plan.forward-rollback.sql','read-plans.forward-rollback.sql'].map(f=>strip(readFileSync('tests/publicHud/'+f,'utf8'))).join('\n');
assert.equal(sql(`BEGIN;${ordered}SELECT md5(replace(pg_get_functiondef('${signature}'::regprocedure),chr(13),''));ROLLBACK;`),'bf84cbeb48770e13805718e0d8a0def9');
const keys=['clockNumericDefinitionMatches','clockNumericPrivateRlsOwner','clockNumericPrivateBrowserGrants','clockCountsDefinitionMatches'];
const lines=readFileSync('scripts/ops/tracker-hud-20261104-postcheck.sql','utf8').split(/\r?\n/);
const expressions=keys.map(key=>{const matches=lines.filter(line=>line.trimStart().startsWith(`'${key}',`));assert.equal(matches.length,1);return matches[0].trim().replace(/,$/,'');});
const check=(change='')=>jsonSql(`BEGIN;${change}SELECT jsonb_build_object(${expressions.join(',')});ROLLBACK;`);
assert.deepEqual(check(),{clockNumericDefinitionMatches:true,clockNumericPrivateRlsOwner:true,clockNumericPrivateBrowserGrants:0,clockCountsDefinitionMatches:true});
assert.equal(check("UPDATE spectator_projection_v2.clock_numeric_original_v1 SET candidate_definition_hash=repeat('0',32);").clockNumericDefinitionMatches,false);
assert.equal(check('ALTER TABLE spectator_projection_v2.clock_numeric_original_v1 DISABLE ROW LEVEL SECURITY;').clockNumericPrivateRlsOwner,false);
assert.equal(check('GRANT SELECT ON spectator_projection_v2.clock_numeric_original_v1 TO anon;').clockNumericPrivateBrowserGrants,1);
// Leave the real load fixture using the captured production column type, after
// earlier historical-wrapper tests have independently exercised their preimages.
sql('ALTER TABLE public.tournaments ALTER COLUMN buy_in TYPE bigint USING buy_in::bigint;');
const report={kind:'ACTUAL_CLOCK_BIGINT_TO_NUMERIC_READER_REGRESSION_NATIVE',passed:true,candidateHash,outcomes,checks:['real-bigint-42804-reproduced','same-statement-full-row-reference-parity','actor-and-scope','metadata-oid-owner-acl-unchanged','private-backup-access-denied','preimage-drift-denied','guarded-recovery-reinstall'],qualification:false,productionChanged:false};
if(process.env.PUBLIC_HUD_CLOCK_NUMERIC_REPORT)writeFileSync(process.env.PUBLIC_HUD_CLOCK_NUMERIC_REPORT,JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
