import {readFileSync,existsSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {execFileSync,spawnSync} from 'node:child_process';
const [root,project]=process.argv.slice(2);
if(!root?.startsWith('/tmp/vinpoker-hud-stack-')||!/^hud-scale-[a-z0-9-]+$/.test(project))throw Error('Disposable diagnostic scope required');
const secretValues=[];
for(const name of ['status.env','workers.env'])if(existsSync(root+'/'+name))secretValues.push(...Object.values(parseEnv(readFileSync(root+'/'+name,'utf8'))).filter(s=>s.length>12));
function safeErrors(body){
 let safe=body;for(const value of secretValues)safe=safe.replaceAll(value,'[redacted]');
 safe=safe.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[redacted-jwt]').replace(/Bearer\s+\S+/gi,'Bearer [redacted]');
 return safe.split('\n').filter(line=>/error|failed|cannot|isolate|serving|worker|port|limit|connection|file change|setting up|unavailable/i.test(line)&&!line.includes('SECRET=')).slice(-30).join('\n');
}
for(const name of ['serve.log','start.log'])if(existsSync(root+'/'+name)){const body=readFileSync(root+'/'+name,'utf8');console.log(name+' lifecycle counts: '+JSON.stringify({fileChanges:(body.match(/File change detected/gi)??[]).length,runtimeSetups:(body.match(/Setting up Edge Functions runtime/gi)??[]).length}));console.log(name+' sanitized diagnostics:\n'+safeErrors(body));}
try{console.log('local Edge sanitized diagnostics:\n'+safeErrors(execFileSync('docker',['logs','--tail','100',`supabase_edge_runtime_${project}`],{encoding:'utf8',stdio:['ignore','pipe','pipe']})));}catch{console.log('Local Edge diagnostic unavailable');}
for(const service of ['kong','realtime']){
 try{const result=spawnSync('docker',['logs','--tail','200',`supabase_${service}_${project}`],{encoding:'utf8',maxBuffer:2*1024*1024});if(result.error||result.status!==0)throw Error('unavailable');console.log(`local ${service} sanitized diagnostics:\n`+safeErrors((result.stdout??'')+'\n'+(result.stderr??'')));}catch{console.log(`Local ${service} diagnostics unavailable`);}
}
try{
 const query=`SELECT jsonb_build_object('hudJobs',(SELECT count(*) FROM tracker_analytics_v1.jobs),
  'spectatorJobs',(SELECT count(*) FROM spectator_projection_v2.work_groups),
  'cronFailures',(SELECT jsonb_agg(r) FROM (SELECT status,return_message FROM cron.job_run_details WHERE status='failed' ORDER BY start_time DESC LIMIT 3) r),
  'httpErrors',(SELECT jsonb_agg(r) FROM (SELECT status_code,error_msg FROM net._http_response ORDER BY created DESC LIMIT 5) r));`;
 const result=execFileSync('psql',['-h','127.0.0.1','-p','54322','-U','postgres','-d','postgres','-w','-X','-qAt','-c',query],{encoding:'utf8',env:{...process.env,PGPASSWORD:'postgres'},stdio:['ignore','pipe','pipe']});
 console.log('Local worker failure state:\n'+safeErrors(result));
}catch{console.log('Local worker state diagnostic unavailable');}
