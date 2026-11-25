import assert from 'node:assert/strict';
import {createHmac,randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGDATABASE,'vinpoker_ops_pt_read_release');
const api='http://127.0.0.1:3012',container='finance-pt-read-release-http';
const club='18000000-0000-4000-8000-000000000001',dealer='18000000-0000-4000-8000-000000000051';
const owner='18000000-0000-4000-8000-000000000011',cashier='18000000-0000-4000-8000-000000000012';
const employee='18000000-0000-4000-8000-000000000013',accountant='18000000-0000-4000-8000-000000000014';
const secret=randomBytes(48).toString('hex');
function command(p,args,options={}){const r=spawnSync(p,args,{encoding:'utf8',...options});assert.equal(r.status,0,`${p} failed in isolated read proof`);return r.stdout.trim();}
const sql=q=>command('psql',['-XAt','-v','ON_ERROR_STOP=1','-c',q]);
function token(sub,role='authenticated') {const enc=o=>Buffer.from(JSON.stringify(o)).toString('base64url');const v=`${enc({alg:'HS256',typ:'JWT'})}.${enc({sub,role,exp:Math.floor(Date.now()/1000)+600})}`;return `${v}.${createHmac('sha256',secret).update(v).digest('base64url')}`;}
async function rpc(name,body,actor,role='authenticated') {
  const r=await fetch(`${api}/rpc/${name}`,{method:'POST',signal:AbortSignal.timeout(5000),headers:{'Content-Type':'application/json',...(actor?{Authorization:`Bearer ${token(actor,role)}`}:{})},body:JSON.stringify(body)});
  return {status:r.status,data:await r.json()};
}
async function success(name,body,actor){const r=await rpc(name,body,actor);assert.equal(r.status,200,`${name} failed: ${r.data.code??r.status}`);return r.data;}
const fingerprint=()=>sql(`SELECT md5(jsonb_build_object(
  'payments',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.dealer_pt_wage_payments p),
  'statements',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.dealer_payroll_statements s),
  'settlements',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.dealer_pt_wage_settlements s))::text)`);
function browser(input){const before=fingerprint();const jwt=token(input.actor);const r=spawnSync(process.execPath,['tests/financePayrollReadRelease/verify-browser.mjs'],{encoding:'utf8',input:JSON.stringify({...input,token:jwt}),timeout:120000});assert.equal(r.status,0,`read browser failed: ${(r.stderr??'').replaceAll(jwt,'[REDACTED]')}`);assert.equal(fingerprint(),before,'browser changed frozen financial rows');assert.match(r.stdout,/PT_READ_STANDALONE_BROWSER_PASS/);console.log('PT_READ_STANDALONE_BROWSER_PASS',input.actor===employee?'recipient':'operator',input.paid,input.historicalMode??'active');}
try {
  sql(`DO $$ BEGIN IF EXISTS(SELECT FROM public.clubs) THEN RAISE EXCEPTION 'empty_read_fixture_required';END IF;END $$;
    ALTER ROLE authenticator LOGIN NOINHERIT NOSUPERUSER;GRANT authenticated,anon TO authenticator;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $auth$
    SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $auth$;
    INSERT INTO auth.users(id) VALUES('${owner}'),('${cashier}'),('${employee}'),('${accountant}');
    INSERT INTO public.profiles(user_id,display_name) VALUES('${owner}','TEST read owner'),('${cashier}','TEST read cashier'),('${employee}','TEST read recipient'),('${accountant}','TEST read accountant');
    INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES('${club}','${owner}','PT standalone read TEST','TEST','approved');
    INSERT INTO public.club_cashiers(club_id,user_id) VALUES('${club}','${cashier}');
    INSERT INTO public.club_accountants(club_id,user_id) VALUES('${club}','${accountant}');
    SET request.jwt.claim.sub='${owner}';
    INSERT INTO public.dealers(id,club_id,user_id,full_name,status,employment_type,hourly_rate_vnd) VALUES('${dealer}','${club}','${employee}','PT standalone TEST dealer','active','part_time',50000);
    INSERT INTO public.dealer_pt_wage_rate_history(dealer_id,hourly_rate_vnd,pt_eligible,effective_from,changed_by) VALUES('${dealer}',50000,true,'2026-11-01T00:00:00+07:00','${owner}');
    INSERT INTO public.dealer_attendance(dealer_id,shift_date,status,current_state,check_in_time,check_out_time)
      SELECT '${dealer}',day::date,'checked_out','checked_out',day::timestamptz+interval '8 hours',day::timestamptz+interval '28 hours'
      FROM generate_series('2026-11-01'::date,'2026-11-05'::date,interval '1 day') AS days(day);`);
  assert.equal(sql(`SELECT to_regclass('public.finance_pt_installment_plans_v1') IS NULL AND to_regprocedure('public.record_pt_statement_installment_v1(uuid,text,bigint,text,text,uuid,text)') IS NULL`),'t','installment foundation must be absent');
  command('docker',['run','--detach','--name',container,'--network','host','-e','PGRST_DB_URI','-e','PGRST_DB_SCHEMAS','-e','PGRST_DB_ANON_ROLE','-e','PGRST_JWT_SECRET','-e','PGRST_SERVER_HOST','-e','PGRST_SERVER_PORT','postgrest/postgrest:v13.0.7'],{env:{...process.env,PGRST_DB_URI:'postgres://authenticator@127.0.0.1:5432/vinpoker_ops_pt_read_release',PGRST_DB_SCHEMAS:'public',PGRST_DB_ANON_ROLE:'anon',PGRST_JWT_SECRET:secret,PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:'3012'}});
  let ready=false;for(let i=0;i<60;i++){try{if((await fetch(api,{signal:AbortSignal.timeout(500)})).status<500){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}assert.ok(ready);
  const finalized=await success('finalize_part_time_payroll_statement',{p_request_id:'18000000-0000-4000-8000-000000000091',p_club_id:club,p_dealer_id:dealer,p_reason:'TEST standalone real legacy finalization'},owner);
  assert.equal(finalized.net_amount_vnd,5000000);
  const id=finalized.statement_id,detailBody={p_statement_id:id},listBody={p_club_id:club,p_dealer_id:dealer};
  const original=sql(`SELECT (to_jsonb(s)-'pt_wage_payment_id')::text FROM public.dealer_payroll_statements s WHERE id='${id}'`);
  const binding={statement_id:id,statement_hash:JSON.parse(original).statement_hash,club_id:club,dealer_id:dealer,net_amount_vnd:5000000};
  async function readers(paid){const before=fingerprint();for(const actor of [owner,cashier,accountant,employee]){const d=await success('get_pt_statement_installments_v1',detailBody,actor);assert.deepEqual([d.approved_amount_vnd,d.paid_total_vnd,d.remaining_vnd,d.payments.length],[5000000,paid?5000000:0,paid?0:5000000,paid?1:0]);}const list=await success('list_my_pt_statements_v1',listBody,employee);assert.equal(list.items.length,1);assert.equal(list.items[0].statement_id,id);assert.equal(list.items[0].remaining_vnd,paid?0:5000000);assert.equal(list.next_cursor,null);assert.equal(fingerprint(),before);}
  await readers(false);
  for(const actor of [owner,cashier,accountant])assert.equal((await rpc('list_my_pt_statements_v1',listBody,actor)).status,403);
  assert.equal((await rpc('list_my_pt_statements_v1',{...listBody,p_club_id:'18000000-0000-4000-8000-000000000002'},employee)).status,403);
  for(const name of ['list_my_pt_statements_v1','get_pt_statement_installments_v1'])for(const actor of [null,employee]){
    assert.ok([401,403,404].includes((await rpc(name,name.startsWith('list')?listBody:detailBody,actor,'anon')).status));
  }
  browser({actor:cashier,binding,paid:false});browser({actor:employee,binding,paid:false,salaryOnly:true});
  const intent={p_statement_id:id,p_payment_method:'bank',p_payment_reference:'TEST old canonical bank receipt',p_idempotency_key:'18000000-0000-4000-8000-000000000081',p_note:'TEST existing full-payment API'};
  const payment=await success('pay_finalized_part_time_payroll_statement',intent,cashier),replay=await success('pay_finalized_part_time_payroll_statement',intent,cashier);
  assert.equal(payment.amount_vnd,5000000);assert.equal(replay.payment_id,payment.payment_id);assert.equal(replay.idempotent,true);
  await readers(true);browser({actor:cashier,binding,paid:true});browser({actor:employee,binding,paid:true,salaryOnly:true});
  for(const historicalMode of ['inactive','full_time']) {const before=fingerprint();try {
    sql(`SET request.jwt.claim.sub='${owner}';UPDATE public.dealers SET status='${historicalMode==='inactive'?'inactive':'active'}',employment_type='${historicalMode==='full_time'?'full_time':'part_time'}' WHERE id='${dealer}'`);
    browser({actor:employee,binding,paid:true,salaryOnly:true,historicalMode});assert.equal(fingerprint(),before);
  }finally {sql(`SET request.jwt.claim.sub='${owner}';UPDATE public.dealers SET status='active',employment_type='part_time' WHERE id='${dealer}'`);}}
  assert.equal(sql(`SELECT count(*)||':'||sum(amount_vnd) FROM public.dealer_pt_wage_payments WHERE statement_id='${id}'`),'1:5000000');
  assert.equal(sql(`SELECT (to_jsonb(s)-'pt_wage_payment_id')::text FROM public.dealer_payroll_statements s WHERE id='${id}'`),original);
  console.log('PT_READ_STANDALONE_REAL_LEGACY_5M_FULL_PAY_RETRY_SCOPED_READ_IMMUTABLE_PASS');
}finally{spawnSync('docker',['rm','--force',container],{stdio:'ignore'});}
