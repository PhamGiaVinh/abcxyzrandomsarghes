import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {spawn} from 'node:child_process';
import {chromium,expect} from '@playwright/test';
import {sql} from './nativeDb.mjs';

assert.equal(process.env.GITHUB_ACTIONS,'true');
assert.equal(process.env.PUBLIC_HUD_ISOLATED_STACK,'vinpoker-hud-scale');
assert.equal(sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'vinpoker-hud-scale-disposable');
const status=parseEnv(readFileSync(process.env.PUBLIC_HUD_STATUS_FILE,'utf8'));
assert.equal(status.API_URL,'http://127.0.0.1:54321');
const tour='10000000-0000-4000-8000-000000000001',origin='http://127.0.0.1:4179';
const samples=[],reads={};let joined=false,phase='start',browser,server;
const report=()=>writeFileSync('output/hud-scale/clock-ui.json',JSON.stringify({
 kind:'REAL_CHROMIUM_SOURCE_TRIGGER_BROADCAST_PUBLIC_CLOCK_RENDER',sha:process.env.GITHUB_SHA,phase,joined,
 warmup:5,graded:20,samples,rpcReads:reads,qualification:false,productionChanged:false,
 p95Ms:samples.filter(row=>!row.warmup).map(row=>row.writeToVisibleMs).sort((a,b)=>a-b)[18]??null,
 limitations:'One anonymous browser and synthetic source clock writes on the full isolated projection stack. Not canonical control RPC/Edge,staff authorization,1,000 browser render or production capacity proof. Payout uses the exact canonical public adapter and actual prepared projection; no response is mocked.',
},null,2));
try{
 // Source fixture only: no business writer, money,attendance or notification.
 assert.equal(sql(`SELECT current_level=1 AND clock_started_at IS NOT NULL AND clock_paused_at IS NULL FROM public.tournaments WHERE id='${tour}';`),'t');
 server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4179','--strictPort'],{
  env:{...process.env,VITE_SUPABASE_URL:status.API_URL,VITE_SUPABASE_PUBLISHABLE_KEY:status.ANON_KEY},stdio:'ignore',
 });
 let ready=false;
 for(let i=0;i<60;i++){
  if(server.exitCode!==null)throw Error('clock_ui_dev_server_exited');
  try{if((await fetch(origin,{signal:AbortSignal.timeout(1000)})).ok){ready=true;break;}}catch{}
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 assert.ok(ready,'Clock browser server unavailable');
 browser=await chromium.launch();const page=await browser.newPage();
 await page.route('**/*',route=>{
  const url=new URL(route.request().url());
  return [origin,status.API_URL].includes(url.origin)?route.continue():route.abort();
 });
 page.on('response',response=>{
  const match=new URL(response.url()).pathname.match(/^\/rest\/v1\/rpc\/([a-z0-9_]+)$/);
  if(match){const key=match[1]+':'+response.status();reads[key]=(reads[key]??0)+1;}
 });
 page.on('websocket',socket=>socket.on('framereceived',frame=>{
  try{
   const wire=JSON.parse(String(frame.payload));
   const event=Array.isArray(wire)?wire[3]:wire.event,topic=Array.isArray(wire)?wire[2]:wire.topic,payload=Array.isArray(wire)?wire[4]:wire.payload;
   if(event==='phx_reply'&&topic==='realtime:public:tournament-viewer-v2:'+tour&&payload?.status==='ok')joined=true;
  }catch{}
 }));
 phase='initial-public-read';report();await page.goto(origin+'/clock/'+tour);
 await expect(page.getByRole('heading',{name:'SCALE TEST',exact:true})).toBeVisible({timeout:30000});
 await expect.poll(()=>joined,{timeout:10000}).toBe(true);
 await expect(page.getByRole('status')).toHaveCount(0,{timeout:35000});
 await expect(page.getByText('#1',{exact:true})).toBeVisible();
 await expect(page.getByText('Đồng hồ đang dừng',{exact:true})).toHaveCount(0);
 for(let index=0;index<25;index++){
  const paused=index%2===0;phase=paused?'pause-source':'resume-source';
  const started=performance.now();
  sql(`UPDATE public.tournaments SET clock_paused_at=${paused?'clock_timestamp()':'NULL'} WHERE id='${tour}';`);
  const ackMs=performance.now()-started;
  if(paused)await expect(page.getByText('Đồng hồ đang dừng',{exact:true})).toBeVisible({timeout:5000});
  else await expect(page.getByText('Đồng hồ đang dừng',{exact:true})).toHaveCount(0,{timeout:5000});
  const visibleMs=performance.now()-started;
  const response=await fetch(status.API_URL+'/rest/v1/rpc/get_public_tournament_clock_summary',{
   method:'POST',headers:{apikey:status.ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({p_tournament_id:tour}),signal:AbortSignal.timeout(5000),
  });
  assert.equal(response.status,200);const rows=await response.json();assert.equal(rows[0].is_running,!paused);
  samples.push({action:paused?'pause':'resume',warmup:index<5,ackMs,writeToVisibleMs:visibleMs});report();
 }
 const graded=samples.filter(row=>!row.warmup).map(row=>row.writeToVisibleMs).sort((a,b)=>a-b);
 assert.ok((reads['get_public_tournament_results:200']??0)>0,'Canonical public payout read did not succeed');
 assert.equal(reads['get_public_tournament_results:404']??0,0,'Public payout adapter missing');
 assert.equal(graded.length,20);const p95Ms=graded[18];assert.ok(p95Ms<=3000,'Clock source-to-screen p95 exceeds3s');
 phase='passed';report();console.log(JSON.stringify({clockUi:'passed',samples:graded.length,p95Ms,maxMs:graded.at(-1)}));
}catch(error){phase+='-failed';report();throw error;}
finally{
 await browser?.close();server?.kill('SIGTERM');
 sql(`UPDATE public.tournaments SET clock_paused_at=NULL WHERE id='${tour}' AND clock_paused_at IS NOT NULL;`);
}
