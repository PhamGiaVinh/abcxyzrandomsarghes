import {execFileSync,spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
const database=process.env.PUBLIC_HUD_LOCAL_DATABASE??'vinpoker_hud_scale_20261104';
if(!/^vinpoker_hud_(scale|test)_[a-z0-9_]+$/.test(database)) throw Error('Disposable HUD database name required');
const windows=process.platform==='win32';
const prefix=windows?['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${database}`,'psql']:[];
export function sql(query){
  return execFileSync(windows?'wsl':'psql',[...prefix,'-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{
    input:query,encoding:'utf8',maxBuffer:8*1024*1024,
    env:windows?process.env:{...process.env,PGHOST:'127.0.0.1',PGPORT:process.env.PUBLIC_HUD_LOCAL_PORT??'5432',PGUSER:'postgres',PGDATABASE:database},
  }).trim();
}
export function jsonSql(query){return JSON.parse(sql(query));}
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
export function initialize(){
  if(sql('select current_database();')!==database)throw Error('Disposable database scope mismatch');
  if(sql("select to_regnamespace('tracker_analytics_v1') is null;")!=='t')throw Error('Refuse to overwrite an existing test database');
  for(const file of ['tests/publicHud/incremental.fixture.sql',
    'supabase/pending-migrations/20261104001500_public_hud_incremental_projection.sql',
    'supabase/pending-migrations/20261104001600_public_hud_worker_rpc.sql',
    'supabase/pending-migrations/20261104001700_public_hud_metadata_backfill.sql',
    'supabase/pending-migrations/20261104001800_public_hud_read_contract.sql']) sql(readFileSync(file,'utf8'));
}
export const service="SET request.jwt.claim.role='service_role'; SET ROLE service_role;";
