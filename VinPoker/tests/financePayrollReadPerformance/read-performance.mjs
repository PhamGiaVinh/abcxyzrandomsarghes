import assert from 'node:assert/strict';
import {createHmac,randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {summarizeReadQualification} from './qualification.mjs';
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.equal(process.env.PGDATABASE,'vinpoker_ops_pt_installment');
assert.ok(process.env.RUNNER_TEMP);
const durationMs=1800000,paceMs=5000,actors=20,slots=360;
const api='http://127.0.0.1:3011',container='pt-read-performance';
const club='18000000-0000-4000-8000-000000000001';
const secret=randomBytes(48).toString('hex');
function command(program,args,options={}) {
  const r=spawnSync(program,args,{encoding:'utf8',...options});
  assert.equal(r.status,0,`${program}: isolated read performance setup failed`);return r.stdout.trim();
}
const sql=query=>command('psql',['-X','-At','-v','ON_ERROR_STOP=1','-c',query]);
function jwt(sub){
  const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const data=`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})}`;
  return `${data}.${createHmac('sha256',secret).update(data).digest('base64url')}`;
}
function fingerprint(){return sql(`SELECT md5(jsonb_build_object(
 'expenses',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.club_expenses e),
 'payments',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.dealer_pt_wage_payments p),
 'statements',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.dealer_payroll_statements s),
 'settlements',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.dealer_pt_wage_settlements s)
 )::text)`);}
const samples=[];
let before,start,elapsedMs=0,fixture,terminalError,effectiveLoginConfig;
async function waitUntil(target) {
  // Node truncates fractional timer delays. Recheck the monotonic deadline;
  // never weaken the full30minute qualification window with a tolerance.
  while(performance.now()<target) {
    await new Promise(resolve=>setTimeout(resolve,Math.max(1,Math.ceil(target-performance.now()))));
  }
}
async function read(name,args,token,timeoutMs=5000){
  const r=await fetch(`${api}/rpc/${name}`,{method:'POST',signal:AbortSignal.timeout(timeoutMs),
    headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(args)});
  assert.equal(r.status,200,`read RPC status ${r.status}`);return r.json();
}
try {
  sql(`ALTER ROLE authenticator LOGIN NOINHERIT NOSUPERUSER; GRANT authenticated,anon TO authenticator;
    -- Match verified production config only in this disposable login role.
    -- ProductionPG17.6 uses configuration-fileJIT=OFF with no auth role override.
    ALTER ROLE authenticator SET jit='off';
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $auth$
      SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
        nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $auth$;`);
  effectiveLoginConfig=JSON.parse(command('psql',['-XqAt','-U','authenticator','-c',
    "SELECT jsonb_build_object('role',current_user,'version',current_setting('server_version'),'jit',current_setting('jit'),'jit_above_cost',current_setting('jit_above_cost'),'jit_inline_above_cost',current_setting('jit_inline_above_cost'),'jit_optimize_above_cost',current_setting('jit_optimize_above_cost'))"]));
  assert.equal(effectiveLoginConfig.role,'authenticator');assert.equal(effectiveLoginConfig.jit,'off');
  assert.equal(effectiveLoginConfig.jit_above_cost,'100000');
  assert.equal(effectiveLoginConfig.jit_inline_above_cost,'500000');assert.equal(effectiveLoginConfig.jit_optimize_above_cost,'500000');
  fixture=JSON.parse(sql(`SELECT jsonb_build_object(
    'statement_id',(SELECT id FROM public.dealer_payroll_statements LIMIT 1),
    'documents',(SELECT count(*) FROM public.club_expenses),
    'months',(SELECT jsonb_agg(jsonb_build_object('p_from_date',m::date,'p_to_date',(m+interval '1 month -1 day')::date,'p_club_id','${club}') ORDER BY m)
      FROM generate_series(date_trunc('month',now() AT TIME ZONE 'Asia/Ho_Chi_Minh')-interval '11 months',
       date_trunc('month',now() AT TIME ZONE 'Asia/Ho_Chi_Minh'),interval '1 month') AS months(m)))`));
  assert.equal(fixture.documents,100000);assert.equal(fixture.months.length,12);assert.ok(fixture.statement_id);
  before=fingerprint();
  command('docker',['run','--detach','--name',container,'--network','host',
    '-e','PGRST_DB_URI','-e','PGRST_DB_SCHEMAS','-e','PGRST_DB_ANON_ROLE','-e','PGRST_JWT_SECRET',
    '-e','PGRST_SERVER_HOST','-e','PGRST_SERVER_PORT','-e','PGRST_DB_POOL','postgrest/postgrest:v13.0.7'],{env:{...process.env,
    PGRST_DB_URI:'postgres://authenticator@127.0.0.1:5432/vinpoker_ops_pt_installment',PGRST_DB_SCHEMAS:'public',
    PGRST_DB_ANON_ROLE:'anon',PGRST_JWT_SECRET:secret,PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:'3011',PGRST_DB_POOL:'10'}});
  let ready=false;
  for(let i=0;i<60;i++) {
    try {if((await fetch(api,{signal:AbortSignal.timeout(500)})).status<500){ready=true;break;}}catch{/* startup only */}
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  assert.ok(ready,'isolated gateway not ready');
  const readers=Array.from({length:actors},(_,i)=>jwt(`18000000-0000-4000-8000-${String(201+i).padStart(12,'0')}`));
  function validate(kind,data,monthIndex){
    if(kind==='statement') {
      assert.equal(data.statement_id,fixture.statement_id);assert.equal(data.approved_amount_vnd,5000000);
      assert.equal(data.paid_total_vnd,2000000);assert.equal(data.remaining_vnd,3000000);assert.equal(data.payments.length,1);
    } else {
      const expectedExpenses=monthIndex<4?8334000:8333000;
      const expectedPaid=monthIndex===11?2000000:0;
      assert.equal(data.cost.clubExpenses,expectedExpenses);assert.equal(data.cost.ptWagePaid,expectedPaid);
      assert.equal(data.cost.payrollNet,expectedPaid);assert.equal(data.net,-expectedExpenses-expectedPaid);
      assert.equal(data.dealerLive.ptFinalizedUnpaidBalance,3000000);
    }
  }
  // Every month/actor must produce independently known facts before timed load.
  for(let i=0;i<actors;i++) {
    validate('report',await read('get_club_finance_summary_v2',fixture.months[i%12],readers[i]),i%12);
    validate('statement',await read('get_pt_statement_installments_v1',{p_statement_id:fixture.statement_id},readers[i]));
  }
  console.log('PT_READ_PERF_FIXTURE_100000_DOCUMENTS_12_MONTHS_20_READERS_READY');
  start=performance.now();
  await Promise.all(readers.map(async(token,actor)=>{
    for(let slot=0;slot<slots;slot++) {
      const scheduled=start+slot*paceMs;
      await waitUntil(scheduled);
      const kind=slot%2===0?'report':'statement',monthIndex=(actor+Math.floor(slot/2))%12;
      const began=performance.now();
      if(began>start+durationMs+10000) {
        samples.push({actor,slot,kind,ok:false,incomplete:true,latencyMs:began-scheduled});continue;
      }
      let ok=false,error=null;
      try {
        const data=kind==='report'?await read('get_club_finance_summary_v2',fixture.months[monthIndex],token)
          :await read('get_pt_statement_installments_v1',{p_statement_id:fixture.statement_id},token);
        validate(kind,data,monthIndex);ok=true;
      } catch(e){error=e.name==='TimeoutError'?'timeout':e.name==='AssertionError'?'wrong_result_or_status':'request_error';}
      samples.push({actor,slot,kind,ok,error,queueMs:began-scheduled,latencyMs:performance.now()-scheduled});
    }
  }));
  // Last scheduled request is at29m55s. Keep the actual observation open30m.
  await waitUntil(start+durationMs);
  elapsedMs=performance.now()-start;
} catch(e){terminalError=e.name;console.error('PT_READ_PERFORMANCE_FAILED',e.message.replaceAll(secret,'[REDACTED]'));}
finally {
  let unchanged=false;
  try {unchanged=!!before && fingerprint()===before;} catch {terminalError??='fingerprint_failed';}
  const {qualification:qualified,results}=summarizeReadQualification({samples,elapsedMs,
    documents:fixture?.documents,months:fixture?.months.length,financialFactsUnchanged:unchanged,terminalError});
  const evidence={scope:'isolated read RPC performance only; not UI latency, payment writer, hosted capacity or TC6 qualification',
    qualification:qualified,sourceSha:process.env.SOURCE_SHA,durationMs,elapsedMs,actors,slots,paceMs,
    documents:fixture?.documents,months:fixture?.months.length,pool:10,effectiveLoginConfig,
    environmentReference:'Production read-only pg_settings and auth role/database override audit2026-11-26; PG17.6,jitOFF; isolated PGminor/hardware differ',
    productionCapacityClaim:false,fullIntegrationQualification:false,financialFactsUnchanged:unchanged,
    terminalError,results,samples};
  writeFileSync(join(process.env.RUNNER_TEMP,'pt-read-performance.json'),JSON.stringify(evidence));
  console.log('PT_READ_PERFORMANCE_RESULT',JSON.stringify({qualification:qualified,elapsedMs,results,financialFactsUnchanged:unchanged}));
  spawnSync('docker',['rm','--force',container],{stdio:'ignore'});
  if(!qualified) process.exitCode=1;
}
