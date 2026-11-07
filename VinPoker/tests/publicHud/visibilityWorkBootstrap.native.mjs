import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {initialize,sql} from './nativeDb.mjs';
import {nativeWorkerClient} from './nativeRpc.mjs';
if(process.argv.includes('--initialize')){
 initialize();
 for(const name of ['20261104003100_public_hud_enqueue_write_coalescing.sql','20261106010000_public_hud_visibility_restore_reclassification.sql'])sql(readFileSync('supabase/migrations/'+name,'utf8'));
}
const compiled=await build({entryPoints:['supabase/functions/public-hud-projector-v1/worker.ts'],bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent'});
const {processPublicHudJobs}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
async function call(limit=20){const result=await processPublicHudJobs(nativeWorkerClient,limit,Date.now()+20000);assert.equal(result.failed,0,JSON.stringify(result));}
async function drain(){for(let n=0;n<80;n++){if(sql('SELECT count(*) FROM tracker_analytics_v1.jobs;')==='0')return;await call();await new Promise(r=>setTimeout(r,50));}throw Error('Queue did not drain');}
const oldTour='10000000-0000-4000-8000-000000000008',newTour='10000000-0000-4000-8000-000000000009',hand='b3000000-0000-4000-8000-000000000001',player='30000000-0000-4000-8000-000000000001';
sql(`INSERT INTO public.tournaments(id) VALUES('${oldTour}'),('${newTour}');
 INSERT INTO public.tournament_hands(id,tournament_id) VALUES('${hand}','${oldTour}');
 INSERT INTO public.hand_players(hand_id,tournament_id,player_id,seat_number,starting_stack) VALUES('${hand}','${oldTour}','${player}',1,1000);`);
await drain();
sql(`UPDATE public.tournaments SET status='draft' WHERE id='${oldTour}';`);await call(1);
assert.equal(sql(`SELECT progress_cursor FROM tracker_analytics_v1.jobs WHERE kind='visibility' AND entity_id='${oldTour}';`),hand);
sql(`UPDATE public.tournament_hands SET tournament_id='${newTour}' WHERE id='${hand}';
 UPDATE public.hand_players SET tournament_id='${newTour}' WHERE hand_id='${hand}';`);
assert.equal(sql('SELECT count(*) FROM tracker_analytics_v1.jobs WHERE lease_token IS NOT NULL;'),'0');
sql(readFileSync('supabase/migrations/20261106025221_public_hud_visibility_required_work.sql','utf8'));
assert.equal(sql(`SELECT count(*) FROM tracker_analytics_v1.visibility_work WHERE tournament_id='${oldTour}' AND hand_id='${hand}';`),'1','Upgrade must retain old contribution ownership beyond cursor');
assert.equal(sql(`SELECT count(*) FROM tracker_analytics_v1.job_players WHERE player_id='${player}' AND hard_block;`),'1','Independent withdrawal block still required during ownership change');
await drain();
assert.equal(sql('SELECT count(*) FROM tracker_analytics_v1.visibility_work;'),'0');
assert.equal(sql(`SELECT tournament_id FROM tracker_analytics_v1.hand_contributions WHERE hand_id='${hand}';`),newTour);
assert.equal(sql(`SELECT count(*) FROM tracker_analytics_v1.visibility_barriers WHERE tournament_id='${oldTour}';`),'0');
console.log(JSON.stringify({kind:'NATIVE_VISIBILITY_REQUIRED_WORK_PENDING_UPGRADE',passed:true,
 checks:['actual-old-metadata-page-and-cursor','moved-source-old-contribution-required','withdrawal-hard-block-retained','actual-projector-drain'],limitations:'Tiny native fixture;not production upgrade/load qualification'}));
