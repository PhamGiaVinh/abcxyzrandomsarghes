import assert from 'node:assert/strict';
import {createHmac,randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {summarizeReadQualification} from './load-qualification.mjs';
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.equal(process.env.PGDATABASE,'vinpoker_ops_pt_read_release_load');
assert.ok(process.env.RUNNER_TEMP);
const api='http://127.0.0.1:3013',container='pt-standalone-read-load';
const club='18000000-0000-4000-8000-000000000001',secret=randomBytes(48).toString('hex');
const durationMs=1800000,paceMs=5000,actors=20,slots=360,samples=[];
function command(p,args,options={}){const r=spawnSync(p,args,{encoding:'utf8',...options});assert.equal(r.status,0,`${p}: isolated read-load setup failed`);return r.stdout.trim();}
const sql=q=>command('psql',['-XqAt','-v','ON_ERROR_STOP=1','-c',q]);
const fingerprint=()=>JSON.parse(command('psql',['-XqAt','-v','ON_ERROR_STOP=1','-f','tests/financePayrollReadRelease/load.fingerprint.sql']));
function jwt(sub){const enc=o=>Buffer.from(JSON.stringify(o)).toString('base64url');const body=`${enc({alg:'HS256',typ:'JWT'})}.${enc({sub,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})}`;return `${body}.${createHmac('sha256',secret).update(body).digest('base64url')}`;}
async function waitUntil(target){while(performance.now()<target)await new Promise(r=>setTimeout(r,Math.max(1,Math.ceil(target-performance.now()))));}
async function read(name,body,token){const r=await fetch(`${api}/rpc/${name}`,{method:'POST',signal:AbortSignal.timeout(5000),headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body)});assert.equal(r.status,200);return r.json();}
let fixture,before,elapsedMs=0,terminalError=null,effectiveLoginConfig;
try {
  // Match verified production effective JIT=OFF only in this disposable login.
  sql(`ALTER ROLE authenticator LOGIN NOINHERIT NOSUPERUSER;GRANT authenticated,anon TO authenticator;
    ALTER ROLE authenticator SET jit='off';
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $auth$
    SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $auth$;`);
  effectiveLoginConfig=JSON.parse(command('psql',['-XqAt','-U','authenticator','-c',"SELECT jsonb_build_object('role',current_user,'version',current_setting('server_version'),'jit',current_setting('jit'),'jit_above_cost',current_setting('jit_above_cost'),'jit_inline_above_cost',current_setting('jit_inline_above_cost'),'jit_optimize_above_cost',current_setting('jit_optimize_above_cost'))"]));
  assert.equal(effectiveLoginConfig.jit,'off');assert.equal(effectiveLoginConfig.role,'authenticator');
  assert.equal(effectiveLoginConfig.jit_above_cost,'100000');assert.equal(effectiveLoginConfig.jit_inline_above_cost,'500000');assert.equal(effectiveLoginConfig.jit_optimize_above_cost,'500000');
  fixture=JSON.parse(sql(`SELECT jsonb_build_object(
    'documents',(SELECT count(*) FROM public.dealer_payroll_statements),'lines',(SELECT count(*) FROM public.dealer_payroll_statement_lines),
    'months',(SELECT count(DISTINCT date_trunc('month',finalized_at)) FROM public.dealer_payroll_statements),
    'actors',(SELECT jsonb_agg(jsonb_build_object('actor_id',d.user_id,'dealer_id',d.id,'statement_id',s.id,'statement_hash',s.statement_hash) ORDER BY d.id)
      FROM public.dealers d JOIN public.dealer_payroll_statements s ON s.dealer_id=d.id JOIN public.dealer_pt_wage_settlements t ON t.statement_id=s.id WHERE t.status='paid'))`));
  assert.equal(fixture.documents,100000);assert.equal(fixture.lines,500000);assert.equal(fixture.months,12);
  assert.equal(fixture.actors.length,20);assert.equal(new Set(fixture.actors.map(a=>a.actor_id)).size,20);
  before=fingerprint();
  command('docker',['run','--detach','--name',container,'--network','host','-e','PGRST_DB_URI','-e','PGRST_DB_SCHEMAS','-e','PGRST_DB_ANON_ROLE','-e','PGRST_JWT_SECRET','-e','PGRST_SERVER_HOST','-e','PGRST_SERVER_PORT','-e','PGRST_DB_POOL','postgrest/postgrest:v13.0.7'],{env:{...process.env,PGRST_DB_URI:'postgres://authenticator@127.0.0.1:5432/vinpoker_ops_pt_read_release_load',PGRST_DB_SCHEMAS:'public',PGRST_DB_ANON_ROLE:'anon',PGRST_JWT_SECRET:secret,PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:'3013',PGRST_DB_POOL:'10'}});
  let ready=false;for(let i=0;i<60;i++){try{if((await fetch(api,{signal:AbortSignal.timeout(500)})).status<500){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}assert.ok(ready);
  function validate(kind,data,a){
    if(kind==='statement'){
      assert.equal(data.statement_id,a.statement_id);assert.equal(data.statement_hash,a.statement_hash);
      assert.equal(data.club_id,club);assert.equal(data.dealer_id,a.dealer_id);
      assert.deepEqual([data.approved_amount_vnd,data.paid_total_vnd,data.remaining_vnd,data.lines.length,data.payments.length],[5000000,5000000,0,5,1]);
    }else{
      assert.equal(data.club_id,club);assert.equal(data.dealer_id,a.dealer_id);assert.equal(data.items.length,20);
      assert.equal(new Set(data.items.map(i=>i.statement_id)).size,20);
      data.items.forEach((item,i)=>{
        assert.equal(item.club_id,club);assert.equal(item.dealer_id,a.dealer_id);assert.equal(item.statement_hash,a.statement_hash);
        assert.deepEqual([item.net_amount_vnd,item.paid_total_vnd,item.remaining_vnd],[5000000,i===0?5000000:0,i===0?0:5000000]);
        if(i===0)assert.equal(item.statement_id,a.statement_id);else assert.match(item.statement_id,/^28000000-/);
      });
      assert.equal(data.next_cursor.statement_id,data.items[19].statement_id);assert.equal(data.next_cursor.finalized_at,data.items[19].finalized_at);
    }
  }
  const readers=fixture.actors.map(a=>({...a,token:jwt(a.actor_id)}));
  for(const a of readers){
    validate('history',await read('list_my_pt_statements_v1',{p_club_id:club,p_dealer_id:a.dealer_id},a.token),a);
    validate('statement',await read('get_pt_statement_installments_v1',{p_statement_id:a.statement_id},a.token),a);
  }
  console.log('PT_STANDALONE_READ_LOAD_100000_ROWS_500000_LINES_20_SELF_READY');
  const start=performance.now();
  await Promise.all(readers.map(async(a,actor)=>{
    for(let slot=0;slot<slots;slot++){
      const scheduled=start+slot*paceMs;await waitUntil(scheduled);const began=performance.now();
      const kind=slot%2===0?'history':'statement';
      if(began>start+durationMs+10000){samples.push({actor,slot,kind,ok:false,incomplete:true,queueMs:began-scheduled,latencyMs:began-scheduled});continue;}
      let ok=false,error=null;
      try{const data=kind==='history'?await read('list_my_pt_statements_v1',{p_club_id:club,p_dealer_id:a.dealer_id},a.token):await read('get_pt_statement_installments_v1',{p_statement_id:a.statement_id},a.token);validate(kind,data,a);ok=true;}
      catch(e){error=e.name==='TimeoutError'?'timeout':e.name==='AssertionError'?'wrong_result_or_status':'request_error';}
      samples.push({actor,slot,kind,ok,error,queueMs:began-scheduled,latencyMs:performance.now()-scheduled});
    }
  }));
  await waitUntil(start+durationMs);elapsedMs=performance.now()-start;
}catch(e){terminalError=e.name;console.error('PT_STANDALONE_READ_LOAD_FAILED',e.message.replaceAll(secret,'[REDACTED]'));}
finally{
  let financialFactsUnchanged=false,catalogFactsUnchanged=false;
  try{const after=fingerprint();financialFactsUnchanged=!!before&&after.financial===before.financial;catalogFactsUnchanged=!!before&&after.catalog===before.catalog;}catch{terminalError??='fingerprint_failed';}
  const result=summarizeReadQualification({samples,elapsedMs,documents:fixture?.documents,lines:fixture?.lines,months:fixture?.months,financialFactsUnchanged,catalogFactsUnchanged,terminalError});
  writeFileSync(join(process.env.RUNNER_TEMP,'pt-standalone-read-load.json'),JSON.stringify({...result,scope:'isolated original-schema self-history/detail RPC load only; no hosted capacity, UI latency, writer or TC6 qualification',
    sourceSha:process.env.SOURCE_SHA,durationMs,elapsedMs,actors,slots,paceMs,pool:10,documents:fixture?.documents,lines:fixture?.lines,months:fixture?.months,
    fixtureScope:'20 real legacy references;99980 synthetic own-payload read-volume clones/12 display months; not independent earnings or chronological accounting',effectiveLoginConfig,
    productionReference:'verified productionPG17.6 effectiveJIT=OFF; isolatedPGminor/hardware differ; production not changed',productionCapacityClaim:false,fullIntegrationQualification:false,
    financialFactsUnchanged,catalogFactsUnchanged,terminalError,samples}));
  console.log('PT_STANDALONE_READ_LOAD_RESULT',JSON.stringify({...result,elapsedMs,financialFactsUnchanged,catalogFactsUnchanged}));
  spawnSync('docker',['rm','--force',container],{stdio:'ignore'});if(!result.qualification)process.exitCode=1;
}
