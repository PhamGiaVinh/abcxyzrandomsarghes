import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';

assert.equal(process.env.VINPOKER_RPC1039_LOCAL,'1');
const sql=input=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',timeout:20000,maxBuffer:4e6}).trim();
const read=query=>JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL statement_timeout='10s';${query}ROLLBACK;`));
const guard=read(`SELECT jsonb_build_object('db',current_database(),'host',host(inet_server_addr()),'port',inet_server_port(),'dir',current_setting('data_directory'),'comment',(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()),'external',(SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink')));`);
assert.equal(guard.db,'vinpoker_ranking860_local');assert.equal(guard.host,'127.0.0.1');assert.equal(guard.port,55441);assert.equal(guard.dir,'/tmp/vinpoker-sol-local-20261016-0e79a729/data');assert.equal(guard.external,0);
assert.equal(guard.comment,'VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
const tour='46cab483-91e7-4220-aacf-e17bdf05269c',club='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',actor='675fe35e-60a8-4452-bb90-e79486d54da6';
const cases=[
 ['Cashier worklist','cashier_tour_worklist_v1',{p_club_id:club,p_tournament_id:tour,p_query:'',p_bucket:'all',p_page:0,p_limit:50},`'${club}','${tour}','','all',0,50`,false],
 ['Cashier issues','cashier_tour_issues_v1',{p_club_id:club,p_tournament_id:tour},`'${club}','${tour}'`,false],
];
const catalog=read(`SELECT jsonb_agg(jsonb_build_object('name',proname,'set',proretset)) FROM pg_proc JOIN pg_namespace n ON n.oid=pronamespace WHERE n.nspname='public' AND proname IN(${cases.map(c=>`'${c[1]}'`).join(',')});`);
for(const c of cases)assert.equal(catalog.find(x=>x.name===c[1])?.set,c[4]);
const tables=['tournaments','tournament_entries','tournament_seats','tournament_hands','cashier_buyin_movements','tournament_prize_payments','dealer_attendance','tournament_close_report'];
const fingerprint=()=>read(`SELECT to_jsonb(md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')})::text));`);
const fixture=read(`SELECT jsonb_build_object('status',(SELECT status FROM tournaments WHERE id='${tour}' AND club_id='${club}'),'activeSeats',(SELECT count(*) FROM tournament_seats WHERE tournament_id='${tour}' AND is_active),'autoSwing',(SELECT auto_swing_enabled FROM club_settings WHERE club_id='${club}'));`);
assert.equal(fixture.activeSeats,2);assert.equal(fixture.autoSwing,false);
assert.equal(requireArtifactAbsent(),true);
function requireArtifactAbsent(){assert.equal(existsSync('D:/Quy trình/output/reports/rpc1039-sdk-http-performance-local-20261027.json'),false,'Do not overwrite retained measurements');return true;}
const result={kind:'ACTUAL_SUPABASE_SDK_LOOPBACK_NATIVE_READS_MODELED_ACTOR_NOT_BROWSER_OR_HOSTED_PERFORMANCE',guard,fixture:{...fixture,tour,club,actor},sourceHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),before:fingerprint(),observations:[],measurements:[],denied:[],errors:[]};
const prefix=`BEGIN READ ONLY;SET LOCAL statement_timeout='10s';SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;`;
const server=createServer(async(req,res)=>{
 try{
  const c=cases.find(c=>req.url===`/rest/v1/rpc/${c[1]}`);
  if(req.method!=='POST'||!c){result.denied.push({method:req.method,path:req.url});res.writeHead(403);return res.end('{}');}
  let bytes='';for await(const chunk of req){bytes+=chunk;assert.ok(bytes.length<4096);}
  assert.deepEqual(JSON.parse(bytes),c[2]);
  const start=performance.now();
  const data=JSON.parse(sql(`${prefix}${c[4]?`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM public.${c[1]}(${c[3]}) x;`:`SELECT public.${c[1]}(${c[3]});`}ROLLBACK;`));
  result.observations.push({module:c[0],nativeProcessMs:performance.now()-start,bytes:Buffer.byteLength(JSON.stringify(data))});
  res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));
 }catch(error){result.errors.push({name:error.name,message:error.message.slice(0,120)});res.writeHead(500,{'Content-Type':'application/json'});res.end('{"message":"LOCAL1039_READ_FAILURE"}');}
});
const client=createClient('http://127.0.0.1:54329','LOCAL_TEST_ONLY',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const resources=()=>({nodeMemory:process.memoryUsage(),nodeCpu:process.cpuUsage()});
result.resourcesBefore=resources();
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(54329,'127.0.0.1',resolve);});
 for(const c of cases){
  const samples=[];result.measurements.push({module:c[0],rpc:c[1],samples});
  for(let index=0;index<=20;index++){
   const start=performance.now(),observationStart=result.observations.length;
   const response=await client.rpc(c[1],c[2]).abortSignal(AbortSignal.timeout(15000));
   const sdkHttpMs=performance.now()-start;
   assert.equal(response.error,null);assert.notEqual(response.data,null);assert.equal(response.data.ok,true);assert.ok(Array.isArray(response.data.rows));if(c[0]==='Cashier worklist'){assert.equal(response.data.counts.total,3);assert.equal(response.data.rows.length,3);}assert.equal(result.observations.length,observationStart+1);
   if(c[4])assert.ok(Array.isArray(response.data));
   samples.push({index,phase:index===0?'FIRST_ADAPTER_REQUEST_NOT_BROWSER_COLD':'SEQUENTIAL_WARM_ADAPTER',sdkHttpMs,nativeProcessMs:result.observations.at(-1).nativeProcessMs,responseSha256:createHash('sha256').update(JSON.stringify(response.data)).digest('hex')});
  }
  const warm=samples.slice(1).map(x=>x.sdkHttpMs).sort((a,b)=>a-b);
  const current=result.measurements.at(-1);current.firstAdapterRequestMs=samples[0].sdkHttpMs;current.warmP95Ms=warm[18];current.warmSamples=20;
  console.log(JSON.stringify({module:c[0],warmP95Ms:current.warmP95Ms,firstAdapterRequestMs:current.firstAdapterRequestMs}));
 }
 assert.equal(result.observations.length,42);assert.equal(result.errors.length,0);assert.equal(result.denied.length,0);
}finally{
 if(server.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 result.resourcesAfter=resources();result.after=fingerprint();result.unchanged=result.before===result.after;
 writeFileSync('D:/Quy trình/output/reports/rpc1039-sdk-http-performance-local-20261027.json',JSON.stringify(result,null,2)+'\n');
 assert.equal(result.unchanged,true);
}
console.log('RPC1039_SDK_HTTP_NATIVE_READS_42_UNCHANGED_PASS_NOT_BROWSER_R13_ACCEPTANCE');
