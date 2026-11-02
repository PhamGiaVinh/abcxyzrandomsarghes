import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const distro='PokerVision-P16-4C-Eval',database='vinpoker_ops_cash115_qualified_c';
const sql=input=>execFileSync('wsl',['-d',distro,'--','env','PGHOST=127.0.0.1','PGPORT=55441',
 'PGUSER=postgres',`PGDATABASE=${database}`,'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],
 {input,encoding:'utf8',timeout:30000,maxBuffer:2e6}).trim();
assert.equal(sql('SELECT current_database();'),database);
assert.equal(sql('SHOW port;'),'55441');
assert.match(sql('SHOW data_directory;'),/^\/tmp\/vinpoker-sol-local-20261016-0e79a729\/data$/);
const read=path=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),'utf8');
const insideTransaction=text=>text.replace(/^BEGIN;\s*$/m,'').replace(/^COMMIT;\s*$/m,'');
const original=sql(`SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc
 WHERE oid='private.multi_day_payout_unverified_v1(uuid)'::regprocedure;`);
assert.equal(original,'156dffd08c53e36f216d1240af5cf56f');
assert.equal(sql(`SELECT to_regprocedure('public.multi_day_payout_configuration_preview_v1(uuid,jsonb)') IS NULL;`),'t');

const prelude=`BEGIN; SET LOCAL statement_timeout='10s';
 UPDATE public.multi_day_package_release_v1 SET enabled=true,
   allowed_club_ids=ARRAY['d988b901-2712-415b-a38d-914f0ea1f6a4'::uuid] WHERE id;
 SET LOCAL request.jwt.claim.sub='54d78bf7-528b-41a9-84ea-765fdd5826d6';
 SET LOCAL request.jwt.claims='{"sub":"54d78bf7-528b-41a9-84ea-765fdd5826d6","role":"authenticated"}';
 CREATE TEMP TABLE configuration196_legacy ON COMMIT DROP AS
   SELECT public.multi_day_payout_preview_v1('30eb935c-8ba6-43ab-a6a6-0c0934f71570') result;
 DO $$ BEGIN ASSERT (SELECT result->>'state' FROM configuration196_legacy)='READY'; END $$;
`;
const parity=`DO $$ DECLARE original jsonb; proposed jsonb; candidate jsonb; BEGIN
 SELECT result INTO original FROM configuration196_legacy;
 ASSERT public.multi_day_payout_preview_v1('30eb935c-8ba6-43ab-a6a6-0c0934f71570')=original;
 SELECT jsonb_agg(jsonb_build_object('position',q.position,'amount',q.amount) ORDER BY q.position)
   INTO proposed FROM public.tournament_prizes q WHERE q.tournament_id='6f0ebd0d-505b-4151-a8a9-bfe5b58ce34f';
 candidate:=public.multi_day_payout_configuration_preview_v1('30eb935c-8ba6-43ab-a6a6-0c0934f71570',proposed);
 ASSERT candidate-ARRAY['previewOnly','configurationPersistence','paymentExecution','configurationRevision']=original;
 ASSERT candidate->>'configurationRevision'=(SELECT md5(coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.position,q.id),'[]'::jsonb)::text)
   FROM public.tournament_prizes q WHERE q.tournament_id='6f0ebd0d-505b-4151-a8a9-bfe5b58ce34f');
 ASSERT candidate->>'configurationRevision'<>md5('[]');
 RAISE NOTICE 'MULTIDAY196_LEGACY_FULL_JSON_PARITY_AND_MATCHING_PROPOSAL_PASS';
 END $$;
`;
const migration=read('../../supabase/migrations/20270128000216_multiday_payout_configuration_preview_v1.sql');
const checks=read('./multiDayPayoutConfiguration.existing.pg17.sql');
const recovery=read('./multiDayPayoutConfiguration.recovery.pg17.sql');
sql(prelude+insideTransaction(migration)+parity+checks+insideTransaction(recovery)+`
 DO $$ BEGIN
 ASSERT to_regprocedure('public.multi_day_payout_configuration_preview_v1(uuid,jsonb)') IS NULL;
 ASSERT (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc
   WHERE oid='private.multi_day_payout_unverified_v1(uuid)'::regprocedure)='${original}';
 END $$; ROLLBACK;`);
assert.equal(sql(`SELECT to_regprocedure('public.multi_day_payout_configuration_preview_v1(uuid,jsonb)') IS NULL;`),'t');
assert.equal(sql(`SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc
 WHERE oid='private.multi_day_payout_unverified_v1(uuid)'::regprocedure;`),original);
console.log('MULTIDAY196_CANDIDATE_RUNTIME_PARITY_RECOVERY_ROLLED_BACK_PASS');
