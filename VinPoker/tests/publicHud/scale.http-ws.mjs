import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createClient} from '@supabase/supabase-js';
const status=parseEnv(readFileSync(process.env.PUBLIC_HUD_STATUS_FILE,'utf8'));
const project=process.env.PUBLIC_HUD_STACK_PROJECT;
if(status.API_URL!=='http://127.0.0.1:54321'||!/^hud-scale-[a-z0-9-]+$/.test(project))throw Error('Local isolated stack required');
const viewers=Number(process.env.PUBLIC_HUD_SCALE_VIEWERS??1000),duration=Number(process.env.PUBLIC_HUD_SCALE_SECONDS??1800);
if(!Number.isInteger(viewers)||viewers<1||viewers>1000||duration<30||duration>1800)throw Error('Invalid load bounds');
const run=promisify(execFile),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const uuid=(prefix,n)=>`${prefix}-0000-4000-8000-${n.toString(16).padStart(12,'0')}`;
const player=uuid('30000000',1),stats={summary:[],realtime:[],projection:[],errors:{},reconnects:0,sourceWrites:0};
let stopping=false;
const error=kind=>{stats.errors[kind]=(stats.errors[kind]??0)+1;};
async function post(path,body,privileged=false){
 const key=privileged?status.SERVICE_ROLE_KEY:status.ANON_KEY,start=performance.now();
 const response=await fetch(status.API_URL+path,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error(`HTTP_${response.status}`);
 const value=await response.json();if(path.endsWith('public-player-hud')&&body.mode==='summary')stats.summary.push(performance.now()-start);
 return value;
}
const rpc=(name,args,privileged=false)=>post('/rest/v1/rpc/'+name,args,privileged);
const hud=(tour,mode='summary')=>post('/functions/v1/public-player-hud',{tournament_id:tour,player_id:player,mode});
async function until(fn,timeout,label){const start=Date.now();while(Date.now()-start<timeout){if(await fn())return;await sleep(200);}throw Error(label);}
const percentile=(values,p)=>values.length?[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))]:null;
const reports=[];
for(const scenario of ['concentrated','distributed']){
 const offset={summary:stats.summary.length,realtime:stats.realtime.length,projection:stats.projection.length};
 const tourCount=scenario==='concentrated'?1:20,expected=new Map(),clients=[],tasks=new Set();
 let end=Infinity,reconnecting=false,started=0;
 const track=promise=>{tasks.add(promise);promise.finally(()=>tasks.delete(promise));};
 // Wait for the actual cron-dispatched Edge projector; no in-process worker shortcut.
 await until(async()=>{const reply=await rpc('get_public_tournament_viewer_snapshot_v2',{p_tournament_id:uuid('10000000',1),p_table_ids:[uuid('50000000',1)],p_sections:['tables'],p_known_revisions:{}});return reply.sections?.tables?.freshness?.state==='current';},60000,'Initial real worker publication unavailable');
 for(let i=0;i<viewers;i++){
  const n=1+i%tourCount,tour=uuid('10000000',n),table=uuid('50000000',n);
  const client=createClient(status.API_URL,status.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},realtime:{params:{eventsPerSecond:100}}});
  const state={client,online:false,joined:false,busy:false,pending:false,lastRead:0,lastVerify:0,lastHud:0,failures:0,frozen:null,table,tour};clients.push(state);
  const read=async()=>{
   if(state.busy){state.pending=true;return;}state.busy=true;
   try{
    const value=await rpc('get_public_tournament_table_live_or_last_hand_v2',{p_tournament_id:tour,p_tournament_table_id:table});
    const generation=value.sourceGeneration;
    if(generation&&expected.has(tour+':'+generation)&&state.online&&!reconnecting)stats.realtime.push(Date.now()-expected.get(tour+':'+generation));
    state.failures=0;state.lastRead=Date.now();
   }catch{state.failures++;error('table_read');}
   finally{state.busy=false;if(state.pending&&Date.now()<end){state.pending=false;track(read());}}
  };
  state.read=read;
  const openHud=async()=>{try{const value=await hud(tour);if(value.access==='public'&&value.state!=='preparing'){state.frozen=value.revision;state.lastHud=Date.now();await hud(tour,'history');}else error('hud_not_ready');}catch{error('hud_read');}};
  state.openHud=openHud;
  client.channel(`public:tournament-viewer-v2:${tour}`,{config:{private:false}}).on('broadcast',{event:'changed'},message=>{
   if(message.payload?.tournamentId!==tour)return;
   const components=message.payload.components??['tables'];
   if(components.includes('tables')||components.includes('visibility'))track(read());
  }).subscribe(s=>{state.online=s==='SUBSCRIBED';if(state.online){if(state.joined)stats.reconnects++;state.joined=true;track(read());}});
  client.channel('public:player-hud-access-v1',{config:{private:false}}).on('broadcast',{event:'revoked'},()=>{state.frozen=null;track(openHud());}).subscribe();
  if(i%25===24)await sleep(25);
 }
 await until(async()=>clients.every(c=>c.joined),60000,'Not all 1,000 WebSocket clients joined');
 // Stagger opens so this tests a real HTTP audience, not a single service cache call.
 for(let i=0;i<clients.length;i+=25)await Promise.all(clients.slice(i,i+25).map(c=>c.openHud()));
 started=Date.now();end=started+duration*1000;
 const writer=async(n)=>{
  let number=2_000_000+n*100000,step=0,hand=null;
  while(Date.now()<end&&!stopping){
   const start=Date.now();
   try{
    const value=await rpc('fixture_scale_step_v1',{p_tournament_id:uuid('10000000',n),p_number:number,p_step:step,p_hand_id:hand},true);
    hand=value.handId;stats.sourceWrites++;
    if(value.generation)expected.set(uuid('10000000',n)+':'+value.generation,Date.parse(value.sourceWrittenAt));
    if(step===5){
     const completed=hand,written=Date.parse(value.sourceWrittenAt);
     track((async()=>{try{await until(()=>rpc('fixture_scale_hand_ready_v1',{p_hand_id:completed},true),15000,'projection_timeout');stats.projection.push(Date.now()-written);}catch{error('projection_timeout');}})());
     number++;step=0;hand=null;
    }else step++;
   }catch{error('source_write');}
   await sleep(Math.max(0,1000-(Date.now()-start)));
  }
 };
 const writers=Array.from({length:tourCount},(_,i)=>writer(i+1));
 let restarted=false;
 while(Date.now()<end){
  if(!restarted&&Date.now()-started>duration*500){
   restarted=true;reconnecting=true;
   await run('docker',['restart',`supabase_realtime_${project}`]);
   await until(async()=>clients.every(c=>c.online),60000,'Mass reconnect failed');reconnecting=false;
  }
  for(const c of clients){
   const now=Date.now(),interval=c.online?30000:Math.min(30000,3000*2**Math.min(c.failures,3));
   if(now-c.lastVerify>interval+Math.random()*3000){c.lastVerify=now;track(c.read());}
   if(now-c.lastHud>60000){c.lastHud=now;track(c.openHud());}
  }
  await sleep(250);
 }
 await Promise.all(writers);await Promise.allSettled([...tasks]);
 await Promise.all(clients.map(c=>c.client.removeAllChannels()));
 const sample=key=>stats[key].slice(offset[key]);
 const report={scenario,viewers,durationSeconds:duration,httpSummarySamples:sample('summary').length,httpSummaryP95Ms:percentile(sample('summary'),.95),healthyRealtimeSamples:sample('realtime').length,healthyRealtimeP95Ms:percentile(sample('realtime'),.95),projectionSamples:sample('projection').length,projectionMaxMs:Math.max(0,...sample('projection')),errors:{...stats.errors},reconnects:stats.reconnects};
 reports.push(report);writeFileSync('output/hud-scale/http-ws.json',JSON.stringify({kind:'REAL_LOCAL_HTTP_SUPABASE_WEBSOCKET_POSTGRESQL',productionCapacityClaim:false,qualification:viewers===1000&&duration===1800,reports},null,2));
 console.log(JSON.stringify(report));
 assert.ok(report.httpSummarySamples>=viewers);assert.ok(report.healthyRealtimeSamples>0);assert.ok(report.projectionSamples>0);
 assert.ok(report.httpSummaryP95Ms<=1000,'HTTP summary p95 > 1s');assert.ok(report.healthyRealtimeP95Ms<=3000,'Realtime p95 > 3s');assert.ok(report.projectionMaxMs<=5000,'Projection > 5s');
 assert.equal(stats.errors.source_write??0,0);assert.equal(stats.errors.projection_timeout??0,0);
}
