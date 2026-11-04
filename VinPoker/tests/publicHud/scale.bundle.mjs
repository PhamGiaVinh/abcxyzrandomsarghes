import {build} from 'esbuild';
const root=process.argv[2];
if(!root?.startsWith('/tmp/vinpoker-hud-stack-'))throw Error('Disposable bundle destination required');
// The canonical poker core is outside supabase/functions. Package the exact
// source closure for the local runtime mount; never substitute a worker model.
for(const name of ['public-player-hud','public-hud-projector-v1','public-spectator-projector-v2']){
 await build({entryPoints:[`supabase/functions/${name}/index.ts`],outfile:`${root}/supabase/functions/${name}/index.ts`,bundle:true,format:'esm',platform:'neutral',target:'es2022',external:['npm:*','https:*'],logLevel:'silent'});
}
// Run the browser's real request coordinator in the HTTP/WS generator too.
await build({entryPoints:['src/components/cashier/tournament-live/viewer-hub/publicSnapshotCoordinator.ts'],outfile:'.local-data/hud-scale-runtime/publicSnapshotCoordinator.mjs',bundle:true,format:'esm',platform:'node',target:'node24',logLevel:'silent'});
await build({entryPoints:['src/lib/publicHudTransport.ts'],outfile:'.local-data/hud-scale-runtime/publicHudTransport.mjs',bundle:true,format:'esm',platform:'node',target:'node24',logLevel:'silent'});
