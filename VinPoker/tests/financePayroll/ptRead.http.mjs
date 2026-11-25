import assert from 'node:assert/strict';
import {createHmac, randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';

// Disposable CI only. Never discover credentials or accept an external target.
assert.equal(process.env.PGHOST, '127.0.0.1');
assert.equal(process.env.PGDATABASE, 'vinpoker_ops_finance_pt');
const api = 'http://127.0.0.1:3009';
const clubA = '17950000-0000-4000-8000-000000000001';
const clubB = '17950000-0000-4000-8000-000000000002';
const owner = '17950000-0000-4000-8000-000000000011';
const accountant = '17950000-0000-4000-8000-000000000033';
const container = 'finance-pt-http';
const secret = randomBytes(48).toString('hex');
function command(program, args, options = {}) {
  const result = spawnSync(program, args, {encoding: 'utf8', ...options});
  assert.equal(result.status, 0, `${program} failed during isolated HTTP proof`);
  return result.stdout.trim();
}
function sql(query) { return command('psql', ['-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', query]); }
function token(sub, role = 'authenticated') {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const payload = `${encode({alg:'HS256',typ:'JWT'})}.${encode({sub,role,exp:Math.floor(Date.now()/1000)+300})}`;
  return `${payload}.${createHmac('sha256',secret).update(payload).digest('base64url')}`;
}
async function rpc(name, club, jwt) {
  const response = await fetch(`${api}/rpc/${name}`, {
    method:'POST', signal:AbortSignal.timeout(5000),
    headers:{'Content-Type':'application/json', ...(jwt ? {Authorization:`Bearer ${jwt}`} : {})},
    body:JSON.stringify({p_club_id:club}),
  });
  return {status:response.status, data:await response.json()};
}
function snapshot() {
  return sql(`SELECT md5(jsonb_build_object(
    'dealers',(SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM public.dealers d),
    'attendance',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.dealer_attendance a),
    'rates',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.dealer_pt_wage_rate_history r),
    'payments',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.dealer_pt_wage_payments p),
    'settlements',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.dealer_pt_wage_settlements s),
    'accountants',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.club_accountants c)
  )::text)`);
}

let membershipRemoved = false;
try {
  // The captured product readers/calculator/permissions stay untouched. Only the
  // isolated Auth shim is extended to read the standard PostgREST JWT claims GUC.
  sql(`DO $$ BEGIN
    IF current_database() <> 'vinpoker_ops_finance_pt' THEN RAISE EXCEPTION 'isolated_database_required'; END IF;
    END $$;
    ALTER ROLE authenticator LOGIN NOINHERIT NOSUPERUSER;
    GRANT authenticated, anon TO authenticator;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $auth$
      SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
        nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
    $auth$;`);
  const before = snapshot();
  command('docker', ['run','--detach','--name',container,'--network','host',
    '-e','PGRST_DB_URI','-e','PGRST_DB_SCHEMAS','-e','PGRST_DB_ANON_ROLE',
    '-e','PGRST_JWT_SECRET','-e','PGRST_SERVER_HOST','-e','PGRST_SERVER_PORT',
    'postgrest/postgrest:v13.0.7'], {env:{...process.env,
      PGRST_DB_URI:'postgres://authenticator@127.0.0.1:5432/vinpoker_ops_finance_pt',
      PGRST_DB_SCHEMAS:'public',PGRST_DB_ANON_ROLE:'anon',PGRST_JWT_SECRET:secret,
      PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:'3009'}});
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(api,{signal:AbortSignal.timeout(500)});
      if (response.status < 500) { ready = true; break; }
    } catch { /* Gateway startup only; never retry a product mutation. */ }
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  assert.ok(ready,'isolated PostgREST gateway did not become ready');
  const jwt = token(accountant);
  const baseline = await rpc('get_club_pt_wages',clubA,jwt);
  assert.equal(baseline.status,403);
  assert.equal(baseline.data.code,'42501');
  const allowed = await rpc('get_finance_dealer_pt_wages_v1',clubA,jwt);
  assert.equal(allowed.status,200);
  assert.equal(allowed.data.club_id,clubA);
  assert.equal(allowed.data.dealers.length,1);
  assert.equal(allowed.data.dealers[0].balance_vnd,60000);
  assert.equal(allowed.data.dealers[0].accrued_minutes,60);
  const wrongClub = await rpc('get_finance_dealer_pt_wages_v1',clubB,jwt);
  assert.equal(wrongClub.status,403);
  assert.equal(wrongClub.data.code,'42501');
  const noActor = await rpc('get_finance_dealer_pt_wages_v1',clubA,token(undefined));
  assert.equal(noActor.status,403);
  assert.equal(noActor.data.code,'42501');
  for (const anonymousJwt of [undefined,token(accountant,'anon')]) {
    const anonymous = await rpc('get_finance_dealer_pt_wages_v1',clubA,anonymousJwt);
    assert.ok([401,403,404].includes(anonymous.status));
    assert.ok(['42501','PGRST202'].includes(anonymous.data.code));
    assert.equal(anonymous.data.dealers,undefined);
  }
  const invalidJwt = `${jwt.slice(0,-8)}invalid!`;
  assert.equal((await rpc('get_finance_dealer_pt_wages_v1',clubA,invalidJwt)).status,401);
  const oldOwner = await rpc('get_club_pt_wages',clubA,token(owner));
  const newOwner = await rpc('get_finance_dealer_pt_wages_v1',clubA,token(owner));
  assert.equal(oldOwner.status,200); assert.equal(newOwner.status,200);
  // Separate requests have different as_of timestamps; compare the earned facts.
  assert.deepEqual(newOwner.data.dealers.map(d=>[d.dealer_id,d.balance_vnd,d.accrued_minutes]),
    oldOwner.data.dealers.map(d=>[d.dealer_id,d.balance_vnd,d.accrued_minutes]));
  assert.equal(snapshot(),before,'HTTP reads mutated the financial fixture');
  const membership = sql(`SELECT row_to_json(c)::text FROM public.club_accountants c WHERE club_id='${clubA}' AND user_id='${accountant}'`);
  assert.ok(membership);
  sql(`DELETE FROM public.club_accountants WHERE club_id='${clubA}' AND user_id='${accountant}'`);
  membershipRemoved = true;
  const revoked = await rpc('get_finance_dealer_pt_wages_v1',clubA,jwt);
  assert.equal(revoked.status,403); assert.equal(revoked.data.code,'42501');
  // Restore exact TEST row, including its original ID/timestamp, then compare.
  sql(`INSERT INTO public.club_accountants SELECT * FROM json_populate_record(NULL::public.club_accountants,$row$${membership}$row$::json)`);
  membershipRemoved = false;
  assert.equal(snapshot(),before,'revoked request mutated the financial fixture');
  console.log('CAPTURED_SCHEMA_HTTP_PT_SCOPE_REVOCATION_READONLY_PASS');
} finally {
  // Any failure destroys only the disposable gateway/database with the CI job.
  spawnSync('docker',['rm','--force',container],{stdio:'ignore'});
  if (membershipRemoved) console.error('HTTP fixture stopped after TEST membership revocation; disposable DB will be discarded');
}
