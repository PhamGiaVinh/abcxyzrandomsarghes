import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {atomicSql,loadPackage,preflightSql,postcheckSql} from './tracker-voice-70-71-release-plan.mjs';
import {loadMigration as load69} from './chip-issuance-69-release-plan.mjs';
import {receiptSql} from './floor-37-47-protected-apply.mjs';
test('PG17 Voice70/71 atomic body/receipt rollback, ordered commit and replay denial',
 {skip:process.env.VOICE71_PG_TEST!=='1'},()=>{
  assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGUSER,'postgres');
  assert.ok(['vinpoker_voice_atomic71_20261014','vinpoker_voice_atomic71_recheck_20261014','vinpoker_voice_atomic71_ci'].includes(process.env.PGDATABASE));
  assert.ok(['55464','55441'].includes(process.env.PGPORT));
  for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
  const useWsl=process.platform==='win32';
  if(useWsl)assert.match(process.env.VINPOKER_TEST_WSL_DISTRO??'',/^[A-Za-z0-9_.-]+$/);
  const base=['-X','-qAt','-w','-v','ON_ERROR_STOP=1'];
  const args=useWsl?['-d',process.env.VINPOKER_TEST_WSL_DISTRO,'--','psql','-h',process.env.PGHOST,'-p',process.env.PGPORT,'-U','postgres','-d',process.env.PGDATABASE,...base]:base;
  const query=sql=>spawnSync(useWsl?'wsl':'psql',args,{input:sql,encoding:'utf8',maxBuffer:2*1024*1024});
  const check=sql=>{const r=query(sql);assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
  assert.equal(check("SELECT inet_server_addr()='127.0.0.1'::inet AND current_setting('server_version_num')::integer BETWEEN 170000 AND 179999 AND current_user='postgres';"),'t');
  assert.equal(check('SELECT count(*)=0 FROM public.clubs;'),'t');
  // Public schema captures omit the managed migration ledger. This synthetic
  // ledger qualifies the receipt protocol only, not issuance69 deployment proof.
  assert.equal(check("SELECT to_regclass('supabase_migrations.schema_migrations') IS NULL;"),'t');
  check('CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);');
  const prior=load69();assert.ok(!prior.sql.includes('$voice_test_prior$'));
  check(`INSERT INTO supabase_migrations.schema_migrations VALUES('${prior.version}','${prior.name}',ARRAY[$voice_test_prior$${prior.sql}$voice_test_prior$]);`);
  const pre=JSON.parse(check(preflightSql()));assert.equal(pre.baseline,true);assert.equal(pre.existing,0);
  const [first,second]=loadPackage();
  const unchanged=()=>{
   assert.equal(check("SELECT md5(replace(pg_get_functiondef('public.update_community_cards(uuid,jsonb,uuid)'::regprocedure),chr(13),''));"),'fad65f1d894c364249dd51f25ac06dde');
   assert.equal(check("SELECT to_regprocedure('public._tracker_card_board_source_v1(uuid,jsonb,uuid,boolean)') IS NULL;"),'t');
   assert.deepEqual(JSON.parse(check(receiptSql(first))),{count:0,exact:false});
  };
  check("CREATE FUNCTION public.voice71_reject_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'voice71_injected_receipt_failure'; END $$; CREATE TRIGGER voice71_reject BEFORE INSERT ON supabase_migrations.schema_migrations FOR EACH ROW EXECUTE FUNCTION public.voice71_reject_receipt();");
  let failed=query(atomicSql(first));assert.notEqual(failed.status,0);assert.match(failed.stderr,/voice71_injected_receipt_failure/);unchanged();
  check('DROP TRIGGER voice71_reject ON supabase_migrations.schema_migrations; DROP FUNCTION public.voice71_reject_receipt();');
  failed=query(atomicSql(first).replace('SELECT pg_advisory_xact_lock(280000,3747);',"SELECT pg_advisory_xact_lock(280000,3747); SELECT 1/0;"));
  assert.notEqual(failed.status,0);assert.match(failed.stderr,/division by zero/);unchanged();
  failed=query(atomicSql(second));assert.notEqual(failed.status,0);assert.match(failed.stderr,/voice_package_precondition_drift/);unchanged();
  check(atomicSql(first));check(postcheckSql(1));assert.deepEqual(JSON.parse(check(receiptSql(first))),{count:1,exact:true});
  // Failure in second transaction must not erase first committed migration.
  const secondSql=atomicSql(second),bodyAnchor=' EXECUTE definition;';
  assert.equal(second.sql.split(bodyAnchor).length,2,'unique body fault injection seam in source (receipt contains its own immutable copy)');
  failed=query(secondSql.replace(bodyAnchor,bodyAnchor+" RAISE EXCEPTION 'voice71_injected_body_failure';"));
  assert.notEqual(failed.status,0);assert.match(failed.stderr,/voice71_injected_body_failure/);
  check(postcheckSql(1));assert.deepEqual(JSON.parse(check(receiptSql(second))),{count:0,exact:false});
  check(atomicSql(second));check(postcheckSql(2));assert.deepEqual(JSON.parse(check(receiptSql(second))),{count:1,exact:true});
  failed=query(atomicSql(first));assert.notEqual(failed.status,0);assert.match(failed.stderr,/voice_package_precondition_drift/);
  console.log('VOICE70_71_ATOMIC_ROLLBACK_ORDER_COMMIT_REPLAY_PASS');
 });
