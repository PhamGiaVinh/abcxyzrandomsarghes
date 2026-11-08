import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {loadPackage,MANIFEST_HASH} from './tracker-hud-20261104-release.mjs';

const modes=[process.env.LOCAL_CLOCK_CANDIDATE_PROBE??'0',process.env.LOCAL_OPERATIONS_CANDIDATE_PROBE??'0'];
assert.ok(modes.every(value=>value==='0'||value==='1')&&modes.filter(value=>value==='1').length===1,'Exactly one candidate probe mode is required');
assert.equal(process.env.CASHIER_SCHEMA_MODE,'current');
assert.equal(process.env.LOCAL_OPERATIONS_REALTIME,'1');
const source=process.env.LOCAL_CLOCK_CANDIDATE_STATUS,reportPath=process.env.LOCAL_CLOCK_CANDIDATE_REPORT;
assert.match(source??'',/^\/tmp\/cashier-e2e-[A-Za-z0-9]+\/isolated-status\.json$/);
assert.ok(reportPath?.endsWith('/output/operations-latency/clock-candidate-broadcast-http.json'));
const status=JSON.parse(readFileSync(source,'utf8'));
assert.equal(status.API_URL,'http://127.0.0.1:54321');
assert.equal(typeof status.SERVICE_ROLE_KEY,'string');
assert.ok(status.SERVICE_ROLE_KEY.length>32);
const pkg=loadPackage();
let stopped=false,completed=0,sent=0,failures=0,phase='starting';
const recentFlushes=[];
let failure=null;
const report=()=>writeFileSync(reportPath,JSON.stringify({kind:'ISOLATED_CANONICAL_CLOCK_REAL_HTTP_BROADCAST_FLUSH_ONLY',phase,probeMode:modes[0]==='1'?'clock-only':'operations',manifestSha256:MANIFEST_HASH,migrations:pkg.entries.map(e=>({version:e.version,sha256:e.sha256})),fixturePredecessors:['20261103131615_payout_publication_after_cashier','20270128000299_participation_bagged_read_classification_v1'],completed,sent,failures,recentFlushes,failure,qualification:false,productionChanged:false,limitations:'Host loop calls the unmodified service-only Broadcast flush RPC every1s. The stale retained capture is advanced through already-live payout and bagged reader migrations with exact private reader dependencies;not multi-day payout qualification. Not the Edge projector/cron/hand worker lifecycle,HUDreadactivation,backfill,32caseoperational suite or1000spectator capacity. No response bodies,frames,credentials or source definitions retained.'},null,2));
process.on('SIGTERM',()=>{stopped=true;});
report();
while(!stopped){
 const started=Date.now();
 let stage='transport',httpStatus=null,sqlState=null;
 try{
  const response=await fetch(status.API_URL+'/rest/v1/rpc/flush_public_spectator_broadcast_v2',{
   method:'POST',headers:{apikey:status.SERVICE_ROLE_KEY,Authorization:'Bearer '+status.SERVICE_ROLE_KEY,'Content-Type':'application/json'},
   body:JSON.stringify({p_limit:100}),signal:AbortSignal.timeout(5000),
  });
  httpStatus=response.status;stage='http-status';
  if(response.status!==200){
   try{const body=await response.json();if(typeof body?.code==='string'&&/^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(body.code))sqlState=body.code;}catch{}
   throw Error('flush_http_status');
  }
  stage='json';const value=await response.json();stage='payload';assert.ok(Number.isInteger(value)&&value>=0&&value<=100);
  completed++;sent+=value;recentFlushes.push({startedAt:started,finishedAt:Date.now(),sent:value});if(recentFlushes.length>64)recentFlushes.shift();phase='running';report();
 }catch(cause){
  const errorName=['TimeoutError','AbortError','TypeError','SyntaxError','AssertionError','Error'].includes(cause?.name)?cause.name:'other';
  const transportCode=['ECONNRESET','ECONNREFUSED','UND_ERR_SOCKET','UND_ERR_CONNECT_TIMEOUT'].includes(cause?.cause?.code)?cause.cause.code:null;
  failure={stage,errorName,transportCode,httpStatus,sqlState,startedAt:started,elapsedMs:Date.now()-started};
  failures++;phase='failed';report();process.exitCode=1;break;
 }
 await new Promise(resolve=>setTimeout(resolve,Math.max(1,1000-(Date.now()-started))));
}
if(stopped){phase='stopped';report();}
