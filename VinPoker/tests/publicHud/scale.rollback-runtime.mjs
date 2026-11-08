// Final destructive-to-derived-state check on the disposable real stack only.
// Run after all workload measurements; never restore or rewrite source data.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {createClient} from '@supabase/supabase-js';
import {sql,jsonSql} from './nativeDb.mjs';

const project=process.env.PUBLIC_HUD_STACK_PROJECT;
if(!/^hud-scale-[a-z0-9-]+$/.test(project??'')||process.env.PUBLIC_HUD_ISOLATED_STACK!=='vinpoker-hud-scale'||process.env.PUBLIC_HUD_LOCAL_DATABASE!=='postgres'||process.env.PUBLIC_HUD_LOCAL_PORT!=='54322')throw Error('Disposable real-stack rollback scope required');
const status=parseEnv(readFileSync(process.env.PUBLIC_HUD_STATUS_FILE,'utf8'));
assert.equal(status.API_URL,'http://127.0.0.1:54321');
assert.equal(sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'vinpoker-hud-scale-disposable');
const output='output/hud-scale/rollback-runtime.json';
let phase='preflight',revocations=0,phaseOneMs=null,readState=null;
const report=()=>writeFileSync(output,JSON.stringify({kind:'GENUINE_CRON_REALTIME_TWO_PHASE_HUD_ROLLBACK',project,phase,revocations,phaseOneMs,readState,productionChanged:false,qualification:false,limits:'Final isolated-stack rollback after workloads. One anonymous real Broadcast subscriber;actual cron and exact rollback scripts. Source conservation covers full row counts and first20hand-row fingerprint,not every source byte. No hosted recovery/backup proof or rollback latency p95.'},null,2));
const until=async(predicate)=>{const end=Date.now()+10000;while(Date.now()<end){if(await predicate())return;await new Promise(r=>setTimeout(r,100));}throw Error('Rollback verification deadline');};
const sourceState=()=>jsonSql(`SELECT jsonb_build_object(
 'hands',(SELECT count(*) FROM public.tournament_hands),
 'players',(SELECT count(*) FROM public.hand_players),
 'actions',(SELECT count(*) FROM public.hand_actions),
 'results',(SELECT count(*) FROM public.player_results),
 'handSample',(SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY id)::text,'[]')) FROM (SELECT * FROM public.tournament_hands ORDER BY id LIMIT 20) r));`);
const jobs=()=>jsonSql("SELECT jsonb_object_agg(jobname,active) FROM cron.job WHERE jobname IN('public-hud-projection-v1-dispatch','public-spectator-v2-dispatch') AND username='postgres';");
assert.deepEqual(jobs(),{'public-hud-projection-v1-dispatch':true,'public-spectator-v2-dispatch':true});
assert.equal(sql('SELECT enabled AND worker_enabled AND backfill_complete FROM tracker_analytics_v1.config WHERE singleton;'),'t');
const scope=jsonSql(`SELECT jsonb_build_object('tour',c.tournament_id,'player',c.player_id)
 FROM tracker_analytics_v1.tournament_totals c
 WHERE tracker_analytics_v1.public_context(c.tournament_id,c.player_id) IS NOT NULL LIMIT 1;`);
assert.ok(scope?.tour&&scope?.player);
const before=sourceState();
const client=createClient(status.API_URL,status.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
report();
try{
 await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>reject(Error('Rollback subscriber deadline')),10000);
  client.channel('public:player-hud-access-v1',{config:{private:false}}).on('broadcast',{event:'revoked'},()=>{revocations++;}).subscribe(state=>{
   if(state==='SUBSCRIBED'){clearTimeout(timeout);resolve();}
   else if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(state)){clearTimeout(timeout);reject(Error('Rollback subscriber unavailable'));}
  });
 });
 phase='disable-reads-and-notify';report();const started=Date.now();
 sql(readFileSync('scripts/ops/tracker-hud-20261104-rollback-read.sql','utf8'));
 assert.equal(sql('SELECT enabled OR backfill_complete FROM tracker_analytics_v1.config WHERE singleton;'),'f');
 await until(()=>revocations>0&&sql('SELECT count(*) FROM tracker_analytics_v1.revocation_broadcast_v1;')==='0');
 phaseOneMs=Date.now()-started;phase='stop-hud-worker';report();
 sql(readFileSync('scripts/ops/tracker-hud-20261104-rollback-stop.sql','utf8'));
 assert.deepEqual(jobs(),{'public-hud-projection-v1-dispatch':false,'public-spectator-v2-dispatch':true});
 assert.equal(sql('SELECT enabled OR worker_enabled OR backfill_complete FROM tracker_analytics_v1.config WHERE singleton;'),'f');
 assert.equal(sql("SELECT count(*) FROM pg_trigger WHERE tgname IN('hud_hand_changed','hud_outcome_changed','hud_result_changed','hud_visibility_changed','hud_withdrawal_broadcast') AND tgenabled='D';"),'5');
 const response=await fetch(status.API_URL+'/rest/v1/rpc/get_public_player_hud_summary_v1',{method:'POST',headers:{apikey:status.ANON_KEY,Authorization:'Bearer '+status.ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({p_tournament_id:scope.tour,p_player_id:scope.player}),signal:AbortSignal.timeout(5000)});
 assert.equal(response.ok,true);const summary=await response.json();assert.equal(summary.access,'public');assert.equal(summary.state,'warming');assert.equal(summary.counters,undefined);readState='warming';
 assert.deepEqual(sourceState(),before);phase='passed';report();
}catch{phase+='-failed';report();throw Error('Isolated rollback failed; inspect fixed-phase receipt');}
finally{await client.removeAllChannels();}
