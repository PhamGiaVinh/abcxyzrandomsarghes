// Bounded read-only comparison against the existing public TEST fixture.
// Uses the same published Edge function for both frontend orchestrators.
import {build} from 'esbuild';
import {createClient} from '@supabase/supabase-js';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

const tournamentId=process.env.PUBLIC_HUD_TEST_TOURNAMENT_ID;
const playerId=process.env.PUBLIC_HUD_TEST_PLAYER_ID;
const baseline=process.env.PUBLIC_HUD_BASELINE_SHA;
if(!tournamentId||!playerId||!baseline||!/^[a-f0-9]{40}$/.test(baseline)) throw Error('Explicit TEST scope and baseline SHA required');
const client=createClient(process.env.VITE_SUPABASE_URL,process.env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'vinpoker-hud-performance-'));
let requests=0;
globalThis.__publicHudProbeClient={functions:{invoke:(...args)=>{requests++;return client.functions.invoke(...args);}}};
async function loadModule(label,source){
  const outfile=path.join(directory,`${label}.mjs`);
  await build({stdin:{contents:source,resolveDir:process.cwd(),sourcefile:'src/lib/publicPlayerHud.ts',loader:'ts'},outfile,bundle:true,platform:'node',format:'esm',logLevel:'silent',plugins:[{
    name:'read-only-public-hud-client',setup(builder){
      builder.onResolve({filter:/^@\/integrations\/supabase\/client$/},()=>({path:'public-client',namespace:'probe'}));
      builder.onLoad({filter:/.*/,namespace:'probe'},()=>({contents:'export const supabase=globalThis.__publicHudProbeClient;'}));
    },
  }]});
  return import(pathToFileURL(outfile));
}
try{
  const oldSource=execFileSync('git',['show',`${baseline}:VinPoker/src/lib/publicPlayerHud.ts`],{encoding:'utf8'});
  const newSource=await fs.readFile('src/lib/publicPlayerHud.ts','utf8');
  const oldModule=await loadModule('baseline',oldSource),newModule=await loadModule('optimized',newSource);
  const samples=[];
  // Reverse the second pair so warm connections do not always favor one version.
  for(const [label,module] of [['baseline',oldModule],['optimized',newModule],['optimized',newModule],['baseline',oldModule]]){
    const start=performance.now(),before=requests;
    let historyMs=null;
    const data=await module.loadPublicPlayerHud(tournamentId,playerId,new AbortController().signal,undefined,()=>{historyMs=Math.round(performance.now()-start);});
    const totalMs=Math.round(performance.now()-start);
    samples.push({label,totalMs,historyMs:historyMs??totalMs,requests:requests-before,hands:data.lifetimeHands,data});
  }
  for(const sample of samples.slice(1)){
    assert.deepEqual(samples[0].data.analytics,sample.data.analytics);
    assert.deepEqual(samples[0].data.handHistory,sample.data.handHistory);
    assert.equal(samples[0].data.totalWinnings,sample.data.totalWinnings);
  }
  console.log(JSON.stringify({kind:'ANON_READ_ONLY_TWO_PAIRS_NOT_BROWSER_OR_LOAD_BENCHMARK',baseline,tournamentId,playerId,equivalent:true,samples:samples.map(({data,...sample})=>sample)},null,2));
}finally{
  delete globalThis.__publicHudProbeClient;
  await fs.rm(directory,{recursive:true,force:true});
}
