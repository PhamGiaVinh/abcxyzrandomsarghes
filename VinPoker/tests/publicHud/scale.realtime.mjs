import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
// Realtime v2.86.3 recreates the self-hosted tenant on EVERY container boot.
// Configure the running tenant through its actual API context after startup,
// including forced reconnects; a pre-restart SQL UPDATE is discarded by seeds.
// https://github.com/supabase/realtime/blob/v2.86.3/priv/repo/seeds.exs
export async function configureLocalRealtime(project){
 if(!/^hud-scale-[a-z0-9-]+$/.test(project))throw Error('Disposable Realtime project required');
 const code=`case Realtime.Api.update_tenant_by_external_id("realtime-dev", %{max_concurrent_users: 2000, max_events_per_second: 20000, max_joins_per_second: 5000, max_bytes_per_second: 100000000}) do
 {:ok, tenant} when tenant.max_concurrent_users == 2000 -> IO.puts("HUD_SCALE_LIMITS_OK")
 _ -> raise "local tenant limit update failed"
 end`;
 for(let attempt=0;attempt<60;attempt++){
  try{
   const {stdout}=await run('docker',['exec',`supabase_realtime_${project}`,'/app/bin/realtime','rpc',code],{timeout:5000,maxBuffer:1024*1024});
   if(stdout.includes('HUD_SCALE_LIMITS_OK'))return;
  }catch{/* Do not expose admin command output or tenant credentials. */}
  await new Promise(resolve=>setTimeout(resolve,1000));
 }
 throw Error('Disposable Realtime tenant configuration unavailable after restart');
}
