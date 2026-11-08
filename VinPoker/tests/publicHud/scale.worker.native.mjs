import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {nativeWorkerClient} from './nativeRpc.mjs';
import {sql,jsonSql,service} from './nativeDb.mjs';
const temp=mkdtempSync(path.join(tmpdir(),'hud-scale-worker-'));
await build({entryPoints:['supabase/functions/public-spectator-projector-v2/worker.ts'],outfile:path.join(temp,'worker.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'silent'});
const {processPublicSpectatorJobs}=await import(pathToFileURL(path.join(temp,'worker.mjs')));
for(let i=0;i<10;i++){
 if(sql('SELECT count(*) FROM spectator_projection_v2.work_groups;')==='0')break;
 const result=await processPublicSpectatorJobs(nativeWorkerClient,Date.now()+10_000);
 assert.equal(result.results.some(r=>r.error),false,JSON.stringify(result));
}
assert.equal(sql('SELECT count(*) FROM spectator_projection_v2.work_groups;'),'0');
const tour='10000000-0000-4000-8000-000000000001',table='50000000-0000-4000-8000-000000000001';
const reply=jsonSql(`SET ROLE anon; SELECT public.get_public_tournament_viewer_snapshot_v2('${tour}',ARRAY['${table}'::uuid],ARRAY['tables','ranking','payout'],'{}');`);
assert.equal(reply.access,'public');assert.equal(reply.sections.tables.items.length,1);assert.equal(reply.sections.ranking.items.length,2);
const current=jsonSql(`SET ROLE anon; SELECT public.get_public_tournament_table_live_or_last_hand_v2('${tour}','${table}');`);
assert.equal(current.access,'public');assert.equal(current.hand.players.length,2);assert.equal(current.hand.actions.length,4);
console.log(JSON.stringify({kind:'NATIVE_POSTGRESQL_PROJECTOR_RUNTIME_NOT_WEBSOCKET',passed:true,currentHand:current.hand.id}));
