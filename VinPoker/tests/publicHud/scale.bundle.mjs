import {build} from 'esbuild';
const root=process.argv[2];
if(!root?.startsWith('/tmp/vinpoker-hud-stack-'))throw Error('Disposable bundle destination required');
// The canonical poker core is outside supabase/functions. Package the exact
// source closure for the local runtime mount; never substitute a worker model.
for(const name of ['public-player-hud','public-hud-projector-v1','public-spectator-projector-v2']){
 await build({entryPoints:[`supabase/functions/${name}/index.ts`],outfile:`${root}/supabase/functions/${name}/index.ts`,bundle:true,format:'esm',platform:'neutral',target:'es2022',external:['npm:*','https:*'],logLevel:'silent'});
}
