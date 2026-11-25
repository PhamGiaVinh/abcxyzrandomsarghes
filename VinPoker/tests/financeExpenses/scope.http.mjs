import assert from 'node:assert/strict';
import {createHmac,randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';

assert.equal(process.env.PGHOST,'127.0.0.1');
assert.equal(process.env.PGDATABASE,'vinpoker_ops_finance_expense');
const api='http://127.0.0.1:3010';
const container='finance-expense-http';
const secret=randomBytes(48).toString('hex');
const clubA='17980000-0000-4000-8000-000000000001';
const clubB='17980000-0000-4000-8000-000000000002';
const accountant='17980000-0000-4000-8000-000000000033';
function command(program,args,options={}) {
  const result=spawnSync(program,args,{encoding:'utf8',...options});
  assert.equal(result.status,0,`${program} failed in isolated expense HTTP proof`);
  return result.stdout.trim();
}
function sql(query) { return command('psql',['-X','-At','-v','ON_ERROR_STOP=1','-c',query]); }
function token(sub,role='authenticated') {
  const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const payload=`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub,role,exp:Math.floor(Date.now()/1000)+300})}`;
  return `${payload}.${createHmac('sha256',secret).update(payload).digest('base64url')}`;
}
async function rpc(name,input,jwt) {
  const response=await fetch(`${api}/rpc/${name}`,{method:'POST',signal:AbortSignal.timeout(5000),
    headers:{'Content-Type':'application/json',...(jwt?{Authorization:`Bearer ${jwt}`}:{})},body:JSON.stringify(input)});
  return {status:response.status,data:await response.json()};
}
function state() {
  return sql(`SELECT md5(coalesce(jsonb_agg(to_jsonb(e) ORDER BY id),'[]'::jsonb)::text) FROM public.club_expenses e`);
}
try {
  sql(`DO $$ BEGIN IF current_database()<>'vinpoker_ops_finance_expense' THEN RAISE EXCEPTION 'isolated_database_required'; END IF; END $$;
    ALTER ROLE authenticator LOGIN NOINHERIT NOSUPERUSER;
    GRANT authenticated,anon TO authenticator;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $auth$
      SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
        nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
    $auth$;`);
  command('docker',['run','--detach','--name',container,'--network','host',
    '-e','PGRST_DB_URI','-e','PGRST_DB_SCHEMAS','-e','PGRST_DB_ANON_ROLE','-e','PGRST_JWT_SECRET',
    '-e','PGRST_SERVER_HOST','-e','PGRST_SERVER_PORT','postgrest/postgrest:v13.0.7'],{env:{...process.env,
      PGRST_DB_URI:'postgres://authenticator@127.0.0.1:5432/vinpoker_ops_finance_expense',
      PGRST_DB_SCHEMAS:'public',PGRST_DB_ANON_ROLE:'anon',PGRST_JWT_SECRET:secret,
      PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:'3010'}});
  let ready=false;
  for(let attempt=0;attempt<60;attempt++) {
    try { if((await fetch(api,{signal:AbortSignal.timeout(500)})).status<500){ready=true;break;} }
    catch { /* Startup only, no mutation retries. */ }
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  assert.ok(ready,'isolated expense gateway did not become ready');
  const jwt=token(accountant);
  const reportInput={p_club_id:clubA,p_from:'2026-11-01T00:00:00Z',p_to:'2026-12-01T00:00:00Z'};
  const initial=await rpc('get_club_expenses',reportInput,jwt);
  assert.equal(initial.status,200); assert.equal(initial.data.total_vnd,20000);
  const intent={p_club_id:clubA,p_category:'misc',p_amount_vnd:100000,p_incurred_at:'2026-11-25T10:00:00Z',
    p_description:'TEST HTTP expense',p_payment_status:'unpaid',p_idempotency_key:'expense-http-original-a'};
  const original=await rpc('record_club_expense',intent,jwt);
  assert.equal(original.status,200); assert.equal(original.data.status,'ok'); assert.equal(original.data.idempotent,false);
  assert.match(original.data.expense_id,/^[a-f0-9-]{36}$/);
  const beforeRetry=state();
  const retry=await rpc('record_club_expense',intent,jwt);
  assert.equal(retry.status,200); assert.equal(retry.data.idempotent,true);
  assert.equal(retry.data.expense_id,original.data.expense_id);
  const conflict=await rpc('record_club_expense',{...intent,p_amount_vnd:200000},jwt);
  assert.equal(conflict.status,400); assert.equal(conflict.data.code,'22023');
  assert.equal(state(),beforeRetry,'retry or rejected conflict changed saved expenses');
  const originalB=await rpc('record_club_expense',{...intent,p_club_id:clubB,p_idempotency_key:'expense-http-original-b'},
    token('17980000-0000-4000-8000-000000000022'));
  assert.equal(originalB.status,200); assert.equal(originalB.data.status,'ok');
  const beforeDenied=state();
  const foreign=await rpc('record_club_expense',{...intent,p_amount_vnd:-5000,
    p_adjusts_id:originalB.data.expense_id,p_idempotency_key:'expense-http-foreign'},jwt);
  assert.equal(foreign.status,403); assert.equal(foreign.data.code,'42501');
  const wrongClub=await rpc('record_club_expense',{...intent,p_club_id:clubB,p_idempotency_key:'expense-http-wrong-club'},jwt);
  assert.equal(wrongClub.status,403); assert.equal(wrongClub.data.code,'42501');
  for(const anonymousJwt of [undefined,token(accountant,'anon')]) {
    const denied=await rpc('record_club_expense',{...intent,p_idempotency_key:'expense-http-anonymous'},anonymousJwt);
    assert.ok([401,403,404].includes(denied.status));
    assert.ok(['42501','PGRST202'].includes(denied.data.code));
  }
  assert.equal(state(),beforeDenied,'denied HTTP intent changed financial rows');
  const adjustment=await rpc('record_club_expense',{...intent,p_amount_vnd:-5000,
    p_adjusts_id:original.data.expense_id,p_idempotency_key:'expense-http-valid-adjustment'},jwt);
  assert.equal(adjustment.status,200); assert.equal(adjustment.data.status,'ok');
  const report=await rpc('get_club_expenses',reportInput,jwt);
  assert.equal(report.status,200); assert.equal(report.data.club_id,clubA);
  assert.equal(report.data.total_vnd,115000); assert.equal(report.data.unpaid_vnd,115000);
  assert.equal(report.data.paid_vnd,0); assert.equal(report.data.rows.length,4);
  assert.ok(report.data.rows.some(row=>row.id===adjustment.data.expense_id&&row.adjusts_id===original.data.expense_id));
  const beforeRevoked=state();
  sql(`DELETE FROM public.club_accountants WHERE club_id='${clubA}' AND user_id='${accountant}'`);
  const revoked=await rpc('record_club_expense',{...intent,p_idempotency_key:'expense-http-revoked'},jwt);
  assert.equal(revoked.status,403); assert.equal(revoked.data.code,'42501');
  assert.equal(state(),beforeRevoked,'revoked request changed financial rows');
  console.log('EXPENSE_HTTP_RECORD_RETRY_CONFLICT_SCOPE_ADJUSTMENT_REPORT_REVOCATION_PASS');
} finally {
  spawnSync('docker',['rm','--force',container],{stdio:'ignore'});
}
