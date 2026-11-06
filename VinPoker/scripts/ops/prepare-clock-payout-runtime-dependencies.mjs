import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {isAbsolute} from 'node:path';

// Reconstruct missing read-only dependencies from existing repository source,
// never a production schema dump. Only the isolated clock probe consumes this.
const output=process.argv[2];
assert.equal(process.argv.length,3);assert.ok(output&&isAbsolute(output));
assert.ok(output.endsWith('/clock-payout-dependencies.sql'));
const read=file=>readFileSync(new URL('../../supabase/'+file,import.meta.url),'utf8').replaceAll('\r\n','\n');
const md5=text=>createHash('md5').update(text).digest('hex');
const publication=read('migrations/20261103131615_payout_publication_after_cashier.sql');
assert.equal(createHash('sha256').update(publication).digest('hex'),'cd6f4c4264da7e4ca18bd2e45115cb7beadc2029ceaedbb5b10dcb810d9c069f');
assert.equal(createHash('sha256').update(read('migrations/20270128000299_participation_bagged_read_classification_v1.sql')).digest('hex'),'2594ff636d759c1c49702230a57f2aacf6369ec3f93df0cddea1c6c283db8335');
const individual=read('migrations/20261029053635_multiday_individual_complete_package_v1.sql');
const extract=(source,name,hash)=>{
 const pattern=new RegExp('CREATE (?:OR REPLACE )?FUNCTION '+name.replaceAll('.','\\.')+'\\([\\s\\S]*?\\bAS\\s+(\\$[A-Za-z0-9_]*\\$)([\\s\\S]*?)\\1\\s*;','g');
 const matches=[...source.matchAll(pattern)];assert.equal(matches.length,1,name);assert.equal(md5(matches[0][2]),hash,name+' body');return matches[0][0];
};
const place=extract(read('migrations/20270128000126_payout_participation_display_v1.sql'),'floor_private.payout_place_context_v1','430e56ef19b3b0e9d84694d4d1e8ba25');
const state=extract(individual,'private.multi_day_individual_payment_state_v1','461dad87754f4de29bede3ca3a7bff59');
const oldPublic=extract(read('pending-migrations/20270120000012_multiday_floor_owner_capabilities_v1.sql'),'public.multi_day_payout_postfinal_state_v1','c4d4dc9c12a329aa9e6584ca8e027274');
const firstDo=file=>{const match=read(file).match(/DO \$\$[\s\S]*?END \$\$;/);assert.ok(match,file);return match[0];};
const tables=['multi_day_individual_results_v1','multi_day_individual_obligations_v1'].map(name=>{
 const matches=[...individual.matchAll(new RegExp('CREATE TABLE private\\.'+name+'\\([\\s\\S]*?\n\\);','g'))];assert.equal(matches.length,1,name);
 return matches[0][0]+`\nALTER TABLE private.${name} ENABLE ROW LEVEL SECURITY;\nREVOKE ALL ON private.${name} FROM PUBLIC,anon,authenticated,service_role;`;
});
const triggers=['individual_result_immutable','individual_obligation_immutable'].map(name=>{
 const match=individual.match(new RegExp('CREATE TRIGGER '+name+' BEFORE UPDATE OR DELETE[\\s\\S]*?EXECUTE FUNCTION private\\.multi_day_qualification_immutable_v1\\(\\);'));assert.ok(match,name);return match[0];
});
const sql=`BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF current_setting('vinpoker.isolated_clock_candidate',true) IS DISTINCT FROM 'current-clock27-only'
 OR current_database()<>'postgres'
 OR NOT EXISTS(SELECT 1 FROM public.clubs WHERE id='a2000000-0000-4000-8000-000000000001' AND name='Cashier Edge TEST')
 OR md5(replace(pg_get_functiondef('public.get_public_tournament_viewer_snapshot_v2(uuid,uuid[],text[],jsonb)'::regprocedure),chr(13),''))<>'c23a5810b1307994c1b3428958bd92e0'
 OR to_regprocedure('floor_private.payout_place_context_v1(uuid,integer)') IS NOT NULL
 OR to_regprocedure('private.multi_day_payout_accounting_v1(uuid)') IS NOT NULL
 OR to_regprocedure('private.multi_day_individual_payment_state_v1(uuid)') IS NOT NULL
 OR to_regclass('private.multi_day_individual_results_v1') IS NOT NULL
 OR to_regclass('private.multi_day_individual_obligations_v1') IS NOT NULL
 THEN RAISE EXCEPTION 'clock_payout_dependency_fixture_drift';END IF;
 IF md5(replace(pg_get_functiondef('private.multi_day_qualification_immutable_v1()'::regprocedure),chr(13),''))<>'a96206919da1b8de3f5d1706cfd76c80'
 THEN RAISE EXCEPTION 'clock_payout_immutable_dependency_drift';END IF;
END $$;
${tables.join('\n')}
${triggers.join('\n')}
SET LOCAL check_function_bodies=false;
${place}
${state}
-- Derive accounting by the exact existing146/148 source transforms. The
-- captured public wrapper is restored in this same transaction, before commit.
CREATE TEMP TABLE clock_postfinal_original ON COMMIT DROP AS
 SELECT oid,pg_get_functiondef(oid) definition,proowner,proacl,proconfig,provolatile,prosecdef,pronargdefaults
 FROM pg_proc WHERE oid='public.multi_day_payout_postfinal_state_v1(uuid)'::regprocedure;
${oldPublic.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION')}
${firstDo('migrations/20270128000146_multiday_live_paid_accounting_v1.sql')}
${firstDo('migrations/20270128000148_multiday_club_liability_accounting_v1.sql')}
DO $$ DECLARE original record;BEGIN
 SELECT * INTO STRICT original FROM clock_postfinal_original;
 EXECUTE original.definition;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=original.oid
  AND pg_get_functiondef(p.oid)=original.definition AND p.proowner=original.proowner
  AND p.proacl IS NOT DISTINCT FROM original.proacl AND p.proconfig IS NOT DISTINCT FROM original.proconfig
  AND p.provolatile=original.provolatile AND p.prosecdef=original.prosecdef AND p.pronargdefaults=original.pronargdefaults)
 THEN RAISE EXCEPTION 'clock_postfinal_wrapper_not_restored';END IF;
END $$;
REVOKE ALL ON FUNCTION floor_private.payout_place_context_v1(uuid,integer),private.multi_day_individual_payment_state_v1(uuid),private.multi_day_payout_accounting_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE row record;p pg_proc%ROWTYPE;BEGIN
 FOR row IN SELECT * FROM (VALUES
  ('floor_private.payout_place_context_v1(uuid,integer)','0ff8786f320a9435e75e764b737b191e',false,'s'),
  ('private.multi_day_individual_payment_state_v1(uuid)','871f2380f5e7973895b428ef9a0706a5',false,'s'),
  ('private.multi_day_payout_accounting_v1(uuid)','025bcd3fe08cd8df6f8438e572cc0930',true,'v')) x(signature,hash,definer,volatility) LOOP
  SELECT * INTO STRICT p FROM pg_proc WHERE oid=row.signature::regprocedure;
  IF md5(replace(pg_get_functiondef(p.oid),chr(13),''))<>row.hash
   OR p.proowner<>'postgres'::regrole OR p.prosecdef<>row.definer OR p.provolatile::text<>row.volatility
   OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
  THEN RAISE EXCEPTION 'clock_payout_dependency_metadata_drift: %',row.signature;END IF;
 END LOOP;
END $$;
COMMIT;
`;
writeFileSync(output,sql);
console.log(JSON.stringify({kind:'OWNED_CLOCK_ONLY_PAYOUT_READER_DEPENDENCIES',functions:3,emptyPrivateTables:2,publicWrapperRestoredInTransaction:true,publicationSourceSha256:'cd6f4c4264da7e4ca18bd2e45115cb7beadc2029ceaedbb5b10dcb810d9c069f',limits:'Not multi-day payout qualification; no new obligations/payments/results,public writers or grants. Exact reader bodies/types only; real payout publication migration remains separate and guarded.'}));
