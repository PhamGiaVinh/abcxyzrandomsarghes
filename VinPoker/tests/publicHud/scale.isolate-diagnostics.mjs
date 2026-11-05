import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {sanitizeIsolateShutdowns} from './scale.failures.mjs';
import {parseSpectatorTrace} from './scale.spectator-trace.mjs';
const project=process.argv[2];if(!/^hud-scale-[a-z0-9-]+$/.test(project??''))throw Error('Disposable runtime scope required');
const name='supabase_edge_runtime_'+project;
let events=[],spectatorEvents=[],capture='unavailable';
try{
 const inspected=spawnSync('docker',['inspect','--format','{{.Name}}',name],{encoding:'utf8',maxBuffer:1024*1024});
 if(inspected.status!==0||inspected.stdout.trim()!=='/'+name)throw Error('scope');
 const logs=spawnSync('docker',['logs',name],{encoding:'utf8',maxBuffer:8*1024*1024});
 if(logs.status!==0||logs.error)throw Error('capture');
 events=sanitizeIsolateShutdowns(logs.stdout+'\n'+logs.stderr);spectatorEvents=parseSpectatorTrace(logs.stdout+'\n'+logs.stderr);capture='captured';
}catch{}
mkdirSync('output/hud-scale',{recursive:true});
writeFileSync('output/hud-scale/spectator-rpc-trace.json',JSON.stringify({kind:'ISOLATED_SHORT_WORKER_RPC_TIMINGS_NOT_QUALIFICATION',capture,events:spectatorEvents},null,2));
writeFileSync('output/hud-scale/isolate-shutdowns.json',JSON.stringify({kind:'ALLOWLISTED_DISPOSABLE_ISOLATE_SHUTDOWNS_NOT_HOSTED_CAPACITY',capture,events,counts:Object.fromEntries([...new Set(events.map(e=>e.reason))].map(reason=>[reason,events.filter(e=>e.reason===reason).length]))},null,2));
