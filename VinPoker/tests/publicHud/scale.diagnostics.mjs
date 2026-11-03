import {readFileSync,existsSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {execFileSync} from 'node:child_process';
const [root,project]=process.argv.slice(2);
if(!root?.startsWith('/tmp/vinpoker-hud-stack-')||!/^hud-scale-[a-z0-9-]+$/.test(project))throw Error('Disposable diagnostic scope required');
const secretValues=[];
for(const name of ['status.env','workers.env'])if(existsSync(root+'/'+name))secretValues.push(...Object.values(parseEnv(readFileSync(root+'/'+name,'utf8'))).filter(s=>s.length>12));
function safeErrors(body){
 let safe=body;for(const value of secretValues)safe=safe.replaceAll(value,'[redacted]');
 safe=safe.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[redacted-jwt]').replace(/Bearer\s+\S+/gi,'Bearer [redacted]');
 return safe.split('\n').filter(line=>/error|failed|cannot|isolate|serving|worker|port/i.test(line)&&!line.includes('SECRET=')).slice(-30).join('\n');
}
for(const name of ['serve.log','start.log'])if(existsSync(root+'/'+name))console.log(name+' sanitized diagnostics:\n'+safeErrors(readFileSync(root+'/'+name,'utf8')));
try{console.log('local Edge sanitized diagnostics:\n'+safeErrors(execFileSync('docker',['logs','--tail','100',`supabase_edge_runtime_${project}`],{encoding:'utf8',stdio:['ignore','pipe','pipe']})));}catch{console.log('Local Edge diagnostic unavailable');}
