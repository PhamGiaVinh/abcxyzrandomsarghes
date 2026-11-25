import assert from 'node:assert/strict';
import {createHmac,randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.equal(process.env.PGDATABASE,'vinpoker_ops_pt_installment');
assert.ok(process.env.RUNNER_TEMP);
const club='18000000-0000-4000-8000-000000000001';
const api='http://127.0.0.1:3012',container='pt-report-cold-diagnostic';
const secret=randomBytes(48).toString('hex');
function command(program,args,options={}) {
  const r=spawnSync(program,args,{encoding:'utf8',...options});
  assert.equal(r.status,0,`${program}: disposable cold-report diagnostic failed`);return r.stdout.trim();
}
const sql=query=>command('psql',['-X','-At','-v','ON_ERROR_STOP=1','-c',query]);
const facts=()=>sql(`SELECT md5(jsonb_build_object(
 'expenses',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.club_expenses e),
 'payments',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.dealer_pt_wage_payments p),
 'statements',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.dealer_payroll_statements s),
 'settlements',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.dealer_pt_wage_settlements s)
 )::text)`);
function jwt(sub){
  const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const data=`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub,role:'authenticated',exp:Math.floor(Date.now()/1000)+1800})}`;
  return `${data}.${createHmac('sha256',secret).update(data).digest('base64url')}`;
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function sessionsDrained(){
  for(let i=0;i<200;i++) {
    if(sql("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND usename='authenticator'")==='0') return true;
    await sleep(100);
  }
  return false;
}
const evidence={mode:'cold-report-diagnostic',qualification:false,sourceSha:process.env.SOURCE_SHA,
  note:'Diagnostic ON/OFF/ON cohorts and traced SQL; not load qualification or production performance proof',cases:[]};
let original;
try {
  sql(`ALTER ROLE authenticator LOGIN NOINHERIT NOSUPERUSER; GRANT authenticated,anon TO authenticator;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $auth$
    SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
     nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $auth$;`);
  const fixture=JSON.parse(sql(`SELECT jsonb_build_object('statement_id',(SELECT id FROM public.dealer_payroll_statements LIMIT 1),
    'documents',(SELECT count(*) FROM public.club_expenses),
    'months',(SELECT jsonb_agg(jsonb_build_object('p_from_date',m::date,'p_to_date',(m+interval '1 month -1 day')::date,'p_club_id','${club}') ORDER BY m)
      FROM generate_series(date_trunc('month',now() AT TIME ZONE 'Asia/Ho_Chi_Minh')-interval '11 months',
       date_trunc('month',now() AT TIME ZONE 'Asia/Ho_Chi_Minh'),interval '1 month') AS months(m)))`));
  assert.equal(fixture.documents,100000);assert.equal(fixture.months.length,12);
  evidence.initialConfig=JSON.parse(sql(`SELECT jsonb_build_object('version',current_setting('server_version'),
   'jit',current_setting('jit'),'jit_above_cost',current_setting('jit_above_cost'),
   'jit_inline_above_cost',current_setting('jit_inline_above_cost'),'jit_optimize_above_cost',current_setting('jit_optimize_above_cost'))`));
  original=facts();
  const tokens=Array.from({length:20},(_,i)=>jwt(`18000000-0000-4000-8000-${String(201+i).padStart(12,'0')}`));
  async function rpc(name,args,token) {
    const r=await fetch(`${api}/rpc/${name}`,{method:'POST',signal:AbortSignal.timeout(5000),
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(args)});
    assert.equal(r.status,200,`status ${r.status}`);return r.json();
  }
  async function request(kind,actor,wave){
    const began=performance.now();let error=null;
    try {
      if(kind==='report') {
        const month=(actor+wave)%12,data=await rpc('get_club_finance_summary_v2',fixture.months[month],tokens[actor]);
        assert.equal(data.cost.clubExpenses,month<4?8334000:8333000);
        assert.equal(data.dealerLive.ptFinalizedUnpaidBalance,3000000);
      } else {
        const data=await rpc('get_pt_statement_installments_v1',{p_statement_id:fixture.statement_id},tokens[actor]);
        assert.equal(data.paid_total_vnd,2000000);assert.equal(data.remaining_vnd,3000000);
      }
    } catch(e){error=e.name==='TimeoutError'?'timeout':e.name;}
    return {actor,wave,kind,error,latencyMs:performance.now()-began};
  }
  for(const [name,jit] of [['on-before','on'],['off-production-reference','off'],['on-recheck','on']]) {
    assert.equal(await sessionsDrained(),true,'prior diagnostic cohort still owns database sessions');
    sql(`ALTER ROLE authenticator SET jit='${jit}';`);
    const actualJit=command('psql',['-XqAt','-U','authenticator','-c',"SELECT current_setting('jit')"]);
    assert.equal(actualJit,jit);
    command('docker',['run','--detach','--name',container,'--network','host',
      '-e','PGRST_DB_URI','-e','PGRST_DB_SCHEMAS','-e','PGRST_DB_ANON_ROLE','-e','PGRST_JWT_SECRET',
      '-e','PGRST_SERVER_HOST','-e','PGRST_SERVER_PORT','-e','PGRST_DB_POOL','postgrest/postgrest:v13.0.7'],{env:{...process.env,
      PGRST_DB_URI:'postgres://authenticator@127.0.0.1:5432/vinpoker_ops_pt_installment',PGRST_DB_SCHEMAS:'public',
      PGRST_DB_ANON_ROLE:'anon',PGRST_JWT_SECRET:secret,PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:'3012',PGRST_DB_POOL:'10'}});
    try {
      let ready=false;
      for(let i=0;i<60;i++){try{if((await fetch(api,{signal:AbortSignal.timeout(500)})).status<500){ready=true;break;}}catch{/* startup */}await sleep(500);}
      assert.ok(ready);
      // Match the original one-at-a-time correctness preflight. New pool
      // connections still start cold when the simultaneous report wave arrives.
      for(let actor=0;actor<20;actor++) for(const kind of ['report','statement']) {
        const r=await request(kind,actor,0);assert.equal(r.error,null,'correctness preflight failed');
      }
      const samples=[];
      for(let wave=0;wave<5;wave++) {
        const began=performance.now();
        samples.push(...await Promise.all(tokens.map((_,actor)=>request('report',actor,wave))));
        await sleep(Math.max(0,began+5000-performance.now()));
        samples.push(...await Promise.all(tokens.map((_,actor)=>request('statement',actor,wave))));
        await sleep(Math.max(0,began+10000-performance.now()));
      }
      evidence.cases.push({name,jit:actualJit,samples});
      console.log('PT_COLD_REPORT_DIAGNOSTIC_COHORT',JSON.stringify({name,jit:actualJit,errors:samples.filter(s=>s.error).length}));
    } finally {
      spawnSync('docker',['rm','--force',container],{stdio:'ignore'});
      const drained=await sessionsDrained();
      const cohort=evidence.cases.find(c=>c.name===name);if(cohort)cohort.sessionsDrained=drained;
      assert.equal(drained,true,'diagnostic cohort did not drain; comparison refused');
    }
    const month=fixture.months[11];
    const trace=spawnSync('psql',['-XqAt','-v','ON_ERROR_STOP=1'],{encoding:'utf8',input:`
      LOAD 'auto_explain'; SET client_min_messages='log'; SET statement_timeout='20s'; SET jit='${jit}';
      SET auto_explain.log_min_duration=0; SET auto_explain.log_analyze=on;
      SET auto_explain.log_buffers=on; SET auto_explain.log_nested_statements=on;
      SET auto_explain.log_parameter_max_length=0; SET auto_explain.log_format='json';
      SET ROLE authenticated; SET request.jwt.claim.sub='18000000-0000-4000-8000-000000000201';
      EXPLAIN(ANALYZE,BUFFERS,SETTINGS,FORMAT JSON)
      SELECT public.get_club_finance_summary_v2('${month.p_from_date}','${month.p_to_date}','${club}');`});
    assert.equal(trace.status,0,'nested SQL diagnostic trace failed');
    writeFileSync(join(process.env.RUNNER_TEMP,`pt-read-trace-${name}.txt`),trace.stdout+'\n'+trace.stderr);
  }
  evidence.financialFactsUnchanged=facts()===original;assert.equal(evidence.financialFactsUnchanged,true);
} catch(e){evidence.error=e.message.replaceAll(secret,'[REDACTED]');process.exitCode=1;}
finally {
  spawnSync('docker',['rm','--force',container],{stdio:'ignore'});
  writeFileSync(join(process.env.RUNNER_TEMP,'pt-read-performance.json'),JSON.stringify(evidence));
}
