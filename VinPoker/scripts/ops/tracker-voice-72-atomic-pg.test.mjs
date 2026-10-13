import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {loadMigration,atomicSql,preflightSql,postcheckSql} from './tracker-voice-72-release-plan.mjs';
import {loadPackage} from './tracker-voice-70-71-release-plan.mjs';
import {loadMigration as load69} from './chip-issuance-69-release-plan.mjs';
import {receiptSql} from './floor-37-47-protected-apply.mjs';

test('PG17 Voice72 exact body and receipt atomic rollback, commit, replay',
 {skip:process.env.VOICE72_RECEIPT_PG_TEST!=='1'},()=>{
  assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGUSER,'postgres');
  assert.ok(['vinpoker_voice_receipt72_ci','vinpoker_voice_receipt72_recheck_20261014'].includes(process.env.PGDATABASE));
  assert.ok(['55464','55441'].includes(process.env.PGPORT));
  for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
  const useWsl=process.platform==='win32';
  if(useWsl)assert.match(process.env.VINPOKER_TEST_WSL_DISTRO??'',/^[A-Za-z0-9_.-]+$/);
  const base=['-X','-qAt','-w','-v','ON_ERROR_STOP=1'];
  const args=useWsl?['-d',process.env.VINPOKER_TEST_WSL_DISTRO,'--','psql','-h',process.env.PGHOST,'-p',process.env.PGPORT,'-U','postgres','-d',process.env.PGDATABASE,...base]:base;
  const query=sql=>spawnSync(useWsl?'wsl':'psql',args,{input:sql,encoding:'utf8',maxBuffer:2*1024*1024});
  const check=sql=>{const r=query(sql);assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
  assert.equal(check("SELECT inet_server_addr()='127.0.0.1'::inet AND current_setting('server_version_num')::integer BETWEEN 170000 AND 179999 AND current_user='postgres' AND NOT EXISTS(SELECT 1 FROM public.clubs);"),'t');
  assert.equal(check("SELECT to_regclass('supabase_migrations.schema_migrations') IS NULL;"),'t');
  check('CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);');
  // Synthetic ledger only qualifies receipt protocol; no production deployment claim.
  for(const item of [load69(),...loadPackage()]){
   const tag='$voice72_prior$';assert.ok(!item.sql.includes(tag));
   check(`INSERT INTO supabase_migrations.schema_migrations VALUES('${item.version}','${item.name}',ARRAY[${tag}${item.sql}${tag}]);`);
  }
  const pre=JSON.parse(check(preflightSql()).split('\n').find(x=>x.startsWith('{')));
  assert.equal(pre.baseline,true);assert.equal(pre.existing,0);
  const item=loadMigration(),digest="SELECT md5(replace(pg_get_functiondef('public._tracker_voice_assignment_context(uuid,uuid,uuid)'::regprocedure),chr(13),''));";
  const unchanged=()=>{assert.equal(check(digest),'96ba904dfcdfaa23dba36b6862aba168');assert.deepEqual(JSON.parse(check(receiptSql(item))),{count:0,exact:false});};
  unchanged();
  check("CREATE FUNCTION public.voice72_reject_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'voice72_injected_receipt_failure'; END $$; CREATE TRIGGER voice72_reject BEFORE INSERT ON supabase_migrations.schema_migrations FOR EACH ROW EXECUTE FUNCTION public.voice72_reject_receipt();");
  let failed=query(atomicSql());assert.notEqual(failed.status,0);assert.match(failed.stderr,/voice72_injected_receipt_failure/);unchanged();
  check('DROP TRIGGER voice72_reject ON supabase_migrations.schema_migrations; DROP FUNCTION public.voice72_reject_receipt();');
  const anchor=' EXECUTE definition;';assert.equal(item.sql.split(anchor).length,2);
  failed=query(atomicSql().replace(anchor,anchor+" RAISE EXCEPTION 'voice72_injected_body_failure';"));
  assert.notEqual(failed.status,0);assert.match(failed.stderr,/voice72_injected_body_failure/);unchanged();
  check(atomicSql());check(postcheckSql());
  assert.equal(check(digest),'0a9e1f4e0972015b1554d6cd10f5ee2a');assert.deepEqual(JSON.parse(check(receiptSql(item))),{count:1,exact:true});
  failed=query(atomicSql());assert.notEqual(failed.status,0);assert.match(failed.stderr,/voice_package_object_postcheck_failed|voice72_precondition_drift/);
  assert.deepEqual(JSON.parse(check(receiptSql(item))),{count:1,exact:true});check(postcheckSql());
  console.log('VOICE72_ATOMIC_BODY_RECEIPT_ROLLBACK_COMMIT_REPLAY_PASS');
 });
