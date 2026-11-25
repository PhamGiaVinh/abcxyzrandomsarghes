import assert from 'node:assert/strict';
import {createHmac, randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';

// Disposable runner only: no production URL, credential discovery or real notifications.
assert.equal(process.env.PGHOST, '127.0.0.1');
assert.equal(process.env.PGDATABASE, 'vinpoker_ops_pt_installment');
const api = 'http://127.0.0.1:3010';
const container = 'finance-pt-installments-http';
const club = '18000000-0000-4000-8000-000000000001';
const dealer = '18000000-0000-4000-8000-000000000052';
const owner = '18000000-0000-4000-8000-000000000011';
const cashier = '18000000-0000-4000-8000-000000000012';
const secret = randomBytes(48).toString('hex');
function command(program, args, options = {}) {
  const r = spawnSync(program, args, {encoding: 'utf8', ...options});
  assert.equal(r.status, 0, `${program} failed during disposable installment HTTP proof`);
  return r.stdout.trim();
}
function sql(query) { return command('psql', ['-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', query]); }
function token(sub, role = 'authenticated') {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const data = `${encode({alg:'HS256',typ:'JWT'})}.${encode({sub,role,exp:Math.floor(Date.now()/1000)+300})}`;
  return `${data}.${createHmac('sha256',secret).update(data).digest('base64url')}`;
}
async function rpc(name, body, jwt) {
  const r = await fetch(`${api}/rpc/${name}`, {
    method:'POST', signal:AbortSignal.timeout(5000),
    headers:{'Content-Type':'application/json', ...(jwt ? {Authorization:`Bearer ${jwt}`} : {})},
    body:JSON.stringify(body),
  });
  return {status:r.status, data:await r.json()};
}
async function success(name, body, jwt) {
  const r = await rpc(name,body,jwt);
  assert.equal(r.status,200,`${name}: expected HTTP success, got ${r.data.code ?? r.status}`);
  return r.data;
}
function fingerprint() {
  return sql(`SELECT md5(jsonb_build_object(
    'payments',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.dealer_pt_wage_payments p),
    'statements',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.dealer_payroll_statements s),
    'settlements',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.dealer_pt_wage_settlements s),
    'plans',(SELECT jsonb_agg(to_jsonb(p) ORDER BY statement_id) FROM public.finance_pt_installment_plans_v1 p)
  )::text)`);
}
function verifyBrowser(context) {
  if(process.env.PT_BROWSER_PROOF!=='true') return;
  const before=fingerprint();
  const r=spawnSync(process.execPath,['tests/financePayrollInstallments/verify-http-browser.mjs'],{
    encoding:'utf8',input:JSON.stringify(context),timeout:120000,
  });
  assert.equal(r.status,0,`isolated browser read failed: ${(r.stderr ?? '').replaceAll(context.token,'[REDACTED]')}`);
  assert.equal(fingerprint(),before,'browser read/revocation changed financial facts');
  assert.match(r.stdout,/PT_REAL_BROWSER_RPC_DB_DESKTOP_MOBILE_READ_PASS/);
  console.log('PT_REAL_BROWSER_RPC_DB_DESKTOP_MOBILE_READ_PASS',context.paymentCount);
}
try {
  sql(`DO $$ BEGIN
    IF current_database()<>'vinpoker_ops_pt_installment' THEN RAISE EXCEPTION 'isolated_database_required'; END IF;
    END $$;
    ALTER ROLE authenticator LOGIN NOINHERIT NOSUPERUSER;
    GRANT authenticated,anon TO authenticator;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $auth$
      SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
        nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
    $auth$;
    SET request.jwt.claim.sub='${owner}';
    INSERT INTO public.dealers(id,club_id,full_name,status,employment_type,hourly_rate_vnd)
      VALUES('${dealer}','${club}','PT HTTP TEST dealer','active','part_time',50000);
    INSERT INTO public.dealer_pt_wage_rate_history(dealer_id,hourly_rate_vnd,pt_eligible,effective_from,changed_by)
      VALUES('${dealer}',50000,true,'2026-11-01T00:00:00+07:00','${owner}');
    INSERT INTO public.dealer_attendance(dealer_id,shift_date,status,current_state,check_in_time,check_out_time)
      SELECT '${dealer}',day::date,'checked_out','checked_out',day::timestamptz+interval '8 hours',day::timestamptz+interval '28 hours'
      FROM generate_series('2026-11-01'::date,'2026-11-05'::date,interval '1 day') AS days(day);`);
  command('docker',['run','--detach','--name',container,'--network','host',
    '-e','PGRST_DB_URI','-e','PGRST_DB_SCHEMAS','-e','PGRST_DB_ANON_ROLE','-e','PGRST_JWT_SECRET',
    '-e','PGRST_SERVER_HOST','-e','PGRST_SERVER_PORT','postgrest/postgrest:v13.0.7'], {env:{...process.env,
      PGRST_DB_URI:'postgres://authenticator@127.0.0.1:5432/vinpoker_ops_pt_installment',
      PGRST_DB_SCHEMAS:'public',PGRST_DB_ANON_ROLE:'anon',PGRST_JWT_SECRET:secret,
      PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:'3010'}});
  let ready=false;
  for(let i=0;i<60;i++) {
    try { const r=await fetch(api,{signal:AbortSignal.timeout(500)}); if(r.status<500) {ready=true;break;} }
    catch { /* startup only; no automatic retry of a financial mutation */ }
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  assert.ok(ready,'isolated HTTP gateway unavailable');
  const ownerJwt=token(owner), cashierJwt=token(cashier);
  const finalized=await success('finalize_part_time_payroll_statement',{
    p_request_id:'18000000-0000-4000-8000-000000000081',p_club_id:club,p_dealer_id:dealer,p_reason:'TEST HTTP immutable 5M',
  },ownerJwt);
  assert.equal(finalized.net_amount_vnd,5000000);
  const statementId=finalized.statement_id;
  assert.match(statementId,/^[a-f0-9-]{36}$/);
  const original=sql(`SELECT (to_jsonb(s)-'pt_wage_payment_id')::text FROM public.dealer_payroll_statements s WHERE id='${statementId}'`);
  const detail=await success('get_pt_statement_installments_v1',{p_statement_id:statementId},ownerJwt);
  const period=JSON.parse(sql(`SELECT jsonb_build_object(
    'p_from_date',date_trunc('month',now() at time zone 'Asia/Ho_Chi_Minh')::date,
    'p_to_date',(date_trunc('month',now() at time zone 'Asia/Ho_Chi_Minh')+interval '1 month -1 day')::date,
    'p_club_id','${club}')`));
  const beforeCash=await success('get_club_finance_summary_v2',period,ownerJwt);
  const binding={p_statement_id:statementId,p_expected_hash:detail.statement_hash};
  await success('approve_pt_statement_installments_v1',{
    ...binding,p_request_id:'18000000-0000-4000-8000-000000000082',p_reason:'TEST HTTP owner approval',
  },ownerJwt);
  const first={...binding,p_amount_vnd:2000000,p_payment_method:'bank',p_payment_reference:'TEST HTTP part 1',
    p_request_id:'18000000-0000-4000-8000-000000000083',p_note:'TEST HTTP 2M'};
  const p=await success('record_pt_statement_installment_v1',first,ownerJwt);
  assert.deepEqual([p.amount_vnd,p.paid_total_vnd,p.remaining_vnd,p.idempotent],[2000000,2000000,3000000,false]);
  const partialReport=await success('get_club_finance_summary_v2',period,ownerJwt);
  assert.equal(partialReport.dealerLive.ptFinalizedUnpaidBalance,beforeCash.dealerLive.ptFinalizedUnpaidBalance-2000000);
  assert.equal(partialReport.cost.ptWagePaid,beforeCash.cost.ptWagePaid+2000000);
  const partial=fingerprint();
  const partialDetails=await success('get_pt_statement_installments_v1',{p_statement_id:statementId},ownerJwt);
  const resolution=await success('resolve_pt_full_payment_intent_v1',{
    ...binding,p_intent_key:'18000000-0000-4000-8000-000000000185'},cashierJwt);
  assert.deepEqual([resolution.resolution,resolution.actor_id,resolution.statement_id,resolution.intent_key,
    resolution.approved_amount_vnd,resolution.legacy_payment_recorded,resolution.payment_id],
    ['superseded_by_installments',cashier,statementId,'18000000-0000-4000-8000-000000000185',5000000,false,undefined]);
  const recordedResolution=await rpc('resolve_pt_full_payment_intent_v1',{...binding,p_intent_key:first.p_request_id},cashierJwt);
  assert.equal(recordedResolution.status,400);assert.equal(recordedResolution.data.code,'22023');
  assert.equal(fingerprint(),partial,'old intent resolution mutated financial rows');
  const browserBinding={statement_id:statementId,statement_hash:JSON.parse(original).statement_hash,
    club_id:club,dealer_id:dealer,net_amount_vnd:5000000};
  const originalSnapshot=JSON.parse(original);
  const oldIntent={actorId:cashier,key:'18000000-0000-4000-8000-000000000185',method:'cash',reference:null,
    statement:{statement_id:statementId,statement_hash:originalSnapshot.statement_hash,request_id:originalSnapshot.request_id,
      club_id:club,dealer_id:dealer,state:originalSnapshot.state,net_amount_vnd:5000000,finalized_at:originalSnapshot.finalized_at,payment_id:null}};
  verifyBrowser({actor:cashier,token:cashierJwt,binding:browserBinding,
    paid:'2.000.000',remaining:'3.000.000',paymentCount:1,verifyRevocation:false,oldIntent});
  for(const deniedJwt of [token(undefined),token('18000000-0000-4000-8000-000000000013')]) {
    const denied=await rpc('record_pt_statement_installment_v1',{...first,p_amount_vnd:1},deniedJwt);
    assert.equal(denied.status,403);assert.equal(denied.data.code,'42501');
  }
  for(const anonymous of [undefined,token(owner,'anon')]) {
    const denied=await rpc('record_pt_statement_installment_v1',first,anonymous);
    assert.ok([401,403,404].includes(denied.status));assert.equal(denied.data.payment_id,undefined);
  }
  assert.equal((await rpc('get_pt_statement_installments_v1',{p_statement_id:statementId},`${ownerJwt.slice(0,-8)}invalid!`)).status,401);
  const conflict=await rpc('record_pt_statement_installment_v1',{...first,p_amount_vnd:3000000},ownerJwt);
  assert.equal(conflict.status,400);assert.equal(conflict.data.code,'22023');
  const actorConflict=await rpc('record_pt_statement_installment_v1',first,cashierJwt);
  assert.equal(actorConflict.status,400);assert.equal(actorConflict.data.code,'22023');
  sql(`UPDATE public.finance_pt_installment_rollout_v1 SET enabled=false WHERE club_id='${club}'`);
  const replay=await success('record_pt_statement_installment_v1',first,ownerJwt);
  assert.deepEqual([replay.payment_id,replay.amount_vnd,replay.remaining_vnd,replay.idempotent],[p.payment_id,2000000,3000000,true]);
  const remainder={...binding,p_amount_vnd:3000000,p_payment_method:'cash',p_payment_reference:null,
    p_request_id:'18000000-0000-4000-8000-000000000084',p_note:'TEST HTTP 3M'};
  const disabled=await rpc('record_pt_statement_installment_v1',remainder,cashierJwt);
  assert.equal(disabled.data.code,'55000');
  assert.equal(fingerprint(),partial,'denials/replay/flag changed canonical cash or snapshots');
  sql(`UPDATE public.finance_pt_installment_rollout_v1 SET enabled=true WHERE club_id='${club}'`);
  const member=sql(`SELECT row_to_json(c)::text FROM public.club_cashiers c WHERE club_id='${club}' AND user_id='${cashier}'`);
  assert.ok(member);
  sql(`DELETE FROM public.club_cashiers WHERE club_id='${club}' AND user_id='${cashier}'`);
  const revoked=await rpc('record_pt_statement_installment_v1',remainder,cashierJwt);
  assert.equal(revoked.status,403);assert.equal(revoked.data.code,'42501');
  assert.equal(fingerprint(),partial,'revoked payment changed canonical cash');
  sql(`INSERT INTO public.club_cashiers SELECT * FROM json_populate_record(NULL::public.club_cashiers,$row$${member}$row$::json)`);
  const last=await success('record_pt_statement_installment_v1',remainder,cashierJwt);
  assert.deepEqual([last.amount_vnd,last.paid_total_vnd,last.remaining_vnd,last.idempotent],[3000000,5000000,0,false]);
  const complete=await success('get_pt_statement_installments_v1',{p_statement_id:statementId},ownerJwt);
  assert.equal(complete.payments.length,2);assert.equal(complete.paid_total_vnd,5000000);assert.equal(complete.remaining_vnd,0);
  verifyBrowser({actor:cashier,token:cashierJwt,binding:browserBinding,
    paid:'5.000.000',remaining:'0',paymentCount:2,verifyRevocation:true,oldIntent});
  const completeReport=await success('get_club_finance_summary_v2',period,ownerJwt);
  assert.equal(completeReport.dealerLive.ptFinalizedUnpaidBalance,beforeCash.dealerLive.ptFinalizedUnpaidBalance-5000000);
  assert.equal(completeReport.cost.ptWagePaid,beforeCash.cost.ptWagePaid+5000000);
  assert.equal(sql(`SELECT count(*)||':'||sum(amount_vnd)||':'||sum(minutes_paid) FROM public.dealer_pt_wage_payments WHERE statement_id='${statementId}'`),'2:5000000:6000');
  assert.equal(sql(`SELECT (to_jsonb(s)-'pt_wage_payment_id')::text FROM public.dealer_payroll_statements s WHERE id='${statementId}'`),original);
  // Synthetic TEST packets only, retained on the disposable runner for the real
  // client parser. Expected identity comes from finalization/original snapshot,
  // not from the detail packet under test. No credentials are written.
  if(process.env.RUNNER_TEMP) writeFileSync(join(process.env.RUNNER_TEMP,'pt-installment-client-packets.json'),JSON.stringify({
    expected:{statement_id:statementId,statement_hash:JSON.parse(original).statement_hash,club_id:club,dealer_id:dealer,net_amount_vnd:5000000},
    partial:partialDetails,complete,
  }));
  console.log('PT_HTTP_FINALIZE_APPROVE_2M_RETRY_DENY_REVOKE_3M_IMMUTABLE_5M_PASS');
} finally {
  spawnSync('docker',['rm','--force',container],{stdio:'ignore'});
}
