import {execFileSync,spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
const database=process.env.PUBLIC_HUD_LOCAL_DATABASE??'vinpoker_hud_scale_20261104';
const isolatedStack=database==='postgres'&&process.env.PUBLIC_HUD_ISOLATED_STACK==='vinpoker-hud-scale'&&process.env.PUBLIC_HUD_LOCAL_PORT==='54322';
if(!isolatedStack&&!/^vinpoker_hud_(scale|test)_[a-z0-9_]+$/.test(database)) throw Error('Disposable HUD database name required');
const windows=process.platform==='win32';
const prefix=windows?['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${database}`,'psql']:[];
export function sql(query){
  return execFileSync(windows?'wsl':'psql',[...prefix,'-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{
    input:query,encoding:'utf8',maxBuffer:8*1024*1024,
    env:windows?process.env:{...process.env,PGHOST:'127.0.0.1',PGPORT:process.env.PUBLIC_HUD_LOCAL_PORT??'5432',PGUSER:'postgres',PGDATABASE:database},
  }).trim();
}
export function jsonSql(query){return JSON.parse(sql(query));}
export function pgbench(script){
  const program=`import json,sys,tempfile,pathlib,subprocess
with tempfile.TemporaryDirectory(prefix='vinpoker-hud-pgbench-') as directory:
 root=pathlib.Path(directory)
 source=root/'writer.sql'
 source.write_text(sys.stdin.read())
 result=subprocess.run(['pgbench','-n','-M','prepared','-c','1','-j','1','-t','220','-f',str(source),'-l','--log-prefix='+str(root/'latency')],capture_output=True,text=True)
 if result.returncode: raise RuntimeError(result.stderr)
 samples=sorted(float(line.split()[2])/1000 for log in root.glob('latency.*') for line in log.read_text().splitlines()[20:])
 print(json.dumps(samples))`;
  return JSON.parse(execFileSync(windows?'wsl':'python3',windows?[...prefix.slice(0,-1),'python3','-c',program]:['-c',program],{
    input:script,
    encoding:'utf8',maxBuffer:1024*1024,
    env:windows?process.env:{...process.env,PGHOST:'127.0.0.1',PGPORT:process.env.PUBLIC_HUD_LOCAL_PORT??'5432',PGUSER:'postgres',PGDATABASE:database},
  }));
}
export function sqlAsync(query){
  return new Promise((resolve,reject)=>{
    const child=spawn(windows?'wsl':'psql',[...prefix,'-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{
      env:windows?process.env:{...process.env,PGHOST:'127.0.0.1',PGPORT:process.env.PUBLIC_HUD_LOCAL_PORT??'5432',PGUSER:'postgres',PGDATABASE:database},
    });
    let output='',error='';
    child.stdout.on('data',chunk=>{output+=chunk;if(output.length>8*1024*1024)child.kill();});
    child.stderr.on('data',chunk=>{error+=chunk;});
    child.on('error',reject);child.on('close',code=>code===0?resolve(output.trim()):reject(Error(error||`psql exit ${code}`)));
    child.stdin.end(query);
  });
}
export function initialize(options={}){
  if(sql('select current_database();')!==database)throw Error('Disposable database scope mismatch');
  if(isolatedStack&&sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();")!=='vinpoker-hud-scale-disposable')throw Error('Isolated stack database marker required');
  if(sql("select to_regnamespace('tracker_analytics_v1') is null;")!=='t')throw Error('Refuse to overwrite an existing test database');
  const fixture=readFileSync('tests/publicHud/incremental.fixture.sql','utf8');
  const split=fixture.indexOf('-- Minimal source-revision contract');
  if(split<0)throw Error('Source fixture bootstrap boundary missing');
  sql(fixture.slice(0,split));
  options.seedHistoricalSource?.();
  sql(fixture.slice(split));
  options.afterSourceTriggers?.();
  for(const file of [
    'supabase/migrations/20261104001500_public_hud_incremental_projection.sql',
    'supabase/migrations/20261104001600_public_hud_worker_rpc.sql',
    'supabase/migrations/20261104001700_public_hud_metadata_backfill.sql',
    'supabase/migrations/20261104001800_public_hud_read_contract.sql',
    'supabase/migrations/20261104002000_public_hud_dispatch_health.sql']) sql(readFileSync(file,'utf8'));
}
export const service="SET request.jwt.claim.role='service_role'; SET ROLE service_role;";
