import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
import {instrumentSpectatorWorker} from './scale.spectator-trace.mjs';
const root=process.argv[2];
if(!root?.startsWith('/tmp/vinpoker-hud-stack-'))throw Error('Disposable bundle destination required');
// The canonical poker core is outside supabase/functions. Package the exact
// source closure for the local runtime mount; never substitute a worker model.
for(const name of ['public-player-hud','public-hud-projector-v1','public-spectator-projector-v2']){
 // Both bounded diagnostic durations need publication timing evidence. Keep
 // instrumentation out of the required1800second qualification runs.
 const trace=name==='public-spectator-projector-v2'&&['30','300'].includes(process.env.PUBLIC_HUD_SCALE_SECONDS)&&process.env.PUBLIC_HUD_SCALE_VIEWERS==='1000';
 await build({entryPoints:[`supabase/functions/${name}/index.ts`],outfile:`${root}/supabase/functions/${name}/index.ts`,bundle:true,format:'esm',platform:'neutral',target:'es2022',external:['npm:*','https:*'],logLevel:'silent',plugins:trace?[{name:'isolated-short-spectator-timing',setup(plugin){plugin.onLoad({filter:/public-spectator-projector-v2[\\/]worker\.ts$/},args=>({contents:instrumentSpectatorWorker(readFileSync(args.path,'utf8')),loader:'ts'}));}}]:[]});
}
// Run the browser's real request coordinator in the HTTP/WS generator too.
await build({entryPoints:['src/components/cashier/tournament-live/viewer-hub/publicSnapshotCoordinator.ts'],outfile:'.local-data/hud-scale-runtime/publicSnapshotCoordinator.mjs',bundle:true,format:'esm',platform:'node',target:'node24',logLevel:'silent'});
await build({entryPoints:['src/lib/publicHudTransport.ts'],outfile:'.local-data/hud-scale-runtime/publicHudTransport.mjs',bundle:true,format:'esm',platform:'node',target:'node24',logLevel:'silent'});
await build({entryPoints:['src/lib/publicTableTransport.ts'],outfile:'.local-data/hud-scale-runtime/publicTableTransport.mjs',bundle:true,format:'esm',platform:'node',target:'node24',logLevel:'silent'});
await build({entryPoints:['src/components/cashier/tournament-live/viewer-hub/publicTableHistory.ts'],outfile:'.local-data/hud-scale-runtime/publicTableHistory.mjs',bundle:true,format:'esm',platform:'node',target:'node24',logLevel:'silent'});
