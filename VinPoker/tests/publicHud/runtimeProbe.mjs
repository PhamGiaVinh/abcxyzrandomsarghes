// Read-only, explicit fixture IDs. Uses a publishable key and never signs in.
import {build} from 'esbuild';
import {createClient} from '@supabase/supabase-js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const tournamentId=process.env.PUBLIC_HUD_TEST_TOURNAMENT_ID;
const playerId=process.env.PUBLIC_HUD_TEST_PLAYER_ID;
if(!tournamentId||!playerId) throw new Error('Explicit public test tournament/player required');
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'vinpoker-hud-runtime-'));
const bundle=path.join(directory,'handler.mjs');
await build({entryPoints:['supabase/functions/public-player-hud/handler.ts'],bundle:true,platform:'node',format:'esm',outfile:bundle,logLevel:'silent'});
const {readPublicPlayerHud}=await import(pathToFileURL(bundle));
const client=createClient(process.env.VITE_SUPABASE_URL,process.env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const result=await readPublicPlayerHud(client,tournamentId,playerId);
if(result.tournamentId!==tournamentId||result.playerId!==playerId) throw new Error('Scope mismatch');
console.log(JSON.stringify({probe:'actual-anon-RLS-read',tournamentId,playerId,name:result.name,hands:result.analytics.handsObserved,
  sample:result.sampledTournamentHands,metrics:result.analytics.metrics,totalWinnings:result.totalWinnings,recentResultCount:result.recentResults?.length??null}));
