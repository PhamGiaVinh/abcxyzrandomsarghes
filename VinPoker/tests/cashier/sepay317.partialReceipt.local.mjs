import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync,spawn} from 'node:child_process';
import {parseSePayReceipt} from '../../src/lib/sepaySettlementIntent.ts';
assert.equal(process.env.VINPOKER_SEPAY_PARTIAL317,'1');
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('wsl',args,{input:q,encoding:'utf8',timeout:30000,maxBuffer:2e6}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441');
const fingerprint=()=>sql(`SELECT md5(jsonb_build_object(
 'movements',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
 'banks',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.bank_transactions x),
 'entries',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
 'seats',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x),
 'authUsage',has_schema_privilege('authenticated','auth','USAGE'),
 'authUid',(SELECT jsonb_build_array(pg_get_functiondef(oid),proowner,proacl,proconfig) FROM pg_proc WHERE oid='auth.uid()'::regprocedure))::text);`);
const before=fingerprint();
const worker=process.env.VINPOKER_SEPAY_WORKER318==='1';
const upstreamClaims713=process.env.VINPOKER_SEPAY_UPSTREAM_CLAIMS713==='1';
if(upstreamClaims713)assert.ok(worker,'713 is a distinct transaction-local Auth contract model, not a replacement of diagnostic318');
let locker;
try {
if(worker){
 locker=spawn('wsl',args,{stdio:['pipe','pipe','pipe']});
 await new Promise((resolve,reject)=>{
  let output='';const timer=setTimeout(()=>reject(Error('pending lock session not ready')),15000);
  locker.once('error',reject);locker.stdout.on('data',chunk=>{output+=chunk.toString();if(output.includes('SEPAY318_LOCK_READY')){clearTimeout(timer);resolve();}});
  locker.once('exit',code=>{clearTimeout(timer);reject(Error(`lock session exited:${code}`));});
  locker.stdin.write("BEGIN; SELECT count(*) FROM (SELECT id FROM public.tournament_registrations WHERE status='pending' FOR UPDATE) locked; SELECT 'SEPAY318_LOCK_READY';\n");
 });
}
const raw=readFileSync('tests/cashier/cashPaymentIdentity.pg17.sql','utf8');
const marker=' -- CASH112_CONCURRENCY_FIXTURE_READY';assert.equal(raw.split(marker).length,2);
let prefix=raw.slice(0,raw.indexOf(marker)).replace('BEGIN;','BEGIN;\nGRANT USAGE ON SCHEMA auth TO authenticated;\nCREATE TEMP TABLE sepay317_receipts(value jsonb);');
if(upstreamClaims713){
 // Supabase Auth migration20220224000811, upstream source inspected2026-10-24:
 // https://github.com/supabase/auth/blob/e062eeae0079a6b1a70d5d5da9e5ac5cb8c21194/migrations/20220224000811_update_auth_functions.up.sql
 // Transaction-local only; existing318 remains RED on its original baseline.
 // No human sub is injected into service claims. Preserve the official legacy-
 // claim precedence and strict UUID cast; do not relax canonical actor equality.
 prefix=prefix.replace('BEGIN;',()=>`BEGIN;
 SET LOCAL lock_timeout='2s';
 DO $$ BEGIN
  ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
  ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 END $$;
 CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $uid$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
   (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub'))::uuid
 $uid$;
 DO $$ DECLARE invalid_denied boolean:=false; BEGIN
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claims','{"sub":"71300000-0000-4000-8000-000000000001","role":"authenticated"}',true);
  ASSERT auth.uid()='71300000-0000-4000-8000-000000000001'::uuid,'JSON subject must resolve';
  PERFORM set_config('request.jwt.claim.sub','71300000-0000-4000-8000-000000000002',true);
  ASSERT auth.uid()='71300000-0000-4000-8000-000000000002'::uuid,'upstream legacy subject precedence';
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
  ASSERT auth.uid() IS NULL,'service worker must not acquire human subject';
  PERFORM set_config('request.jwt.claims','{"sub":"not-a-uuid"}',true);
  BEGIN PERFORM auth.uid(); EXCEPTION WHEN invalid_text_representation THEN invalid_denied:=true; END;
  ASSERT invalid_denied,'invalid subject must not become authorized';
  PERFORM set_config('request.jwt.claims','',true);
  ASSERT auth.uid() IS NULL,'empty claims must remain anonymous';
 END $$;
 `);
}
let tail=readFileSync('tests/cashier/sepayPartial297.rollback.sql','utf8');
if(worker){
 // Floor still acts as its real owner. Worker execution gets a service token
 // without a human sub, unlike the older fixture's inherited owner claim.
 tail=tail.replaceAll("PERFORM set_config('role','service_role',true);",`PERFORM set_config('request.jwt.claim.sub','',true);
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 PERFORM set_config('role','service_role',true);`);
 // The rights-restoration step must use known fixture identity, not auth.uid().
 tail=tail.replace('UPDATE public.clubs SET owner_id=auth.uid() WHERE id=club;',
  'UPDATE public.clubs SET owner_id=(SELECT cc.user_id FROM public.club_dealer_controls cc WHERE cc.club_id=club) WHERE id=club;');
 if(upstreamClaims713){
  const call='checked:=public.cashier_retry_paid_seating_v1(false,100);';
  assert.equal(tail.split(call).length,4,'three distinct revoked/success/retry worker boundaries');
  tail=tail.replaceAll(call,()=>`${call}
   -- Read the restored GUCs without granting service_role access to auth schema.
   -- The upstream helper's no-sub=>NULL behavior was qualified above.
   PERFORM pg_temp.assert_cash(nullif(current_setting('request.jwt.claim.sub',true),'') IS NULL
    AND current_setting('request.jwt.claims',true)::jsonb='{"role":"service_role"}'::jsonb,
    'canonical worker must restore service-only claims after every attempt');`);
 }
}
const anchor='END;\nEND $$;';assert.equal(tail.split(anchor).length,2);
tail=tail.replace(anchor,()=>`PERFORM set_config('role','none',true);
 INSERT INTO pg_temp.sepay317_receipts VALUES(jsonb_build_object('receipt',result_a,'intent',jsonb_build_object(
  'actorId',owner_id,'requestId',key_a,'bankId',bank_a,'registrationId',registration,'clubId',club,'operation','confirm','reason','TEST partial transfer'))),
 (jsonb_build_object('receipt',result_b,'intent',jsonb_build_object('actorId',owner_id,'requestId',key_b,'bankId',bank_b,
  'registrationId',registration,'clubId',club,'operation','confirm','reason','TEST completion plus surplus')));
 ${anchor}`);
tail=tail.replace("SELECT 'SEPAY297_PARTIAL_SURPLUS_WAIT_RECEIPT_TENANT_ROLLBACK_PASS';","SELECT value FROM pg_temp.sepay317_receipts;");
const lines=sql((worker?prefix.replace('CREATE TEMP TABLE sepay317_receipts(value jsonb);',"CREATE TEMP TABLE sepay317_receipts(value jsonb); SELECT set_config('test.sepay_retry298','true',true);"):prefix)+tail).split(/\r?\n/).filter(line=>line.startsWith('{'));
assert.equal(lines.length,2);
const parsed=lines.map(line=>{const r=JSON.parse(line);return parseSePayReceipt(r.receipt,r.intent);});
assert.deepEqual(parsed,[{status:'partial',received:40000,remaining:60000,surplus:0},{status:'waiting',surplus:20000}]);
assert.equal(fingerprint(),before,'rollback must preserve business rows and auth schema ACL');
console.log('SEPAY317_ACTUAL_NATIVE_PARTIAL_WAIT_RECEIPTS_PRODUCT_PARSER_PASS_ROLLBACK_UNCHANGED',JSON.stringify(parsed));
if(worker)console.log(upstreamClaims713?'SEPAY713_UPSTREAM_CLAIMS_MODEL_WORKER_NO_HUMAN_SUB_SEATED_ONCE_NO_RECOLLECTION_ROLLBACK_PASS':'SEPAY318_WORKER_NO_HUMAN_SUB_SEATED_ONCE_NO_RECOLLECTION_ROLLBACK_PASS');
} finally {
 if(locker){
  locker.stdin.end('ROLLBACK;\n\\q\n');
  await new Promise(resolve=>{if(locker.exitCode!==null)resolve();else locker.once('exit',resolve);});
 }
 assert.equal(fingerprint(),before,'failed or successful run must roll back all scoped business facts');
}
